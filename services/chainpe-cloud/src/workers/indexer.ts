/**
 * Avalanche log indexer. One chunk commits in one transaction with the cursor, so a
 * restart resumes exactly and repeats nothing.
 *
 * It reads three streams: ChainPeRegistry service events, ERC-8004 feedback, and USDC
 * transfers into the payTo address of any registered service.
 */
import { eq, sql } from 'drizzle-orm'
import { decodeEventLog, parseAbi, parseAbiItem, toEventSelector, type AbiEvent } from 'viem'
import type { Db, Tx } from '../db.js'
import { registryAbi } from '../registryAbi.js'
import { feedback, indexerState, onchainTransfers, providers, services } from '../schema.js'
import { authKey, derivePayments } from './payments.js'

export const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
/** FiatTokenV2 emits this for every EIP-3009 transferWithAuthorization, which is how x402 "exact" settles. */
export const AUTHORIZATION_USED_EVENT = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)')
export const AUTHORIZATION_USED_TOPIC = toEventSelector(AUTHORIZATION_USED_EVENT)
export const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

const REPUTATION_ABI = parseAbi([
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex)',
])

const REGISTRY_EVENT_NAMES = ['ServiceRegistered', 'ServiceUpdated', 'ServiceDeregistered'] as const

export const REGISTRY_EVENTS = registryAbi.filter(
  (item) => item.type === 'event' && (REGISTRY_EVENT_NAMES as readonly string[]).includes(item.name)
) as unknown as AbiEvent[]

export const REPUTATION_EVENTS = REPUTATION_ABI as unknown as AbiEvent[]
export const NEW_FEEDBACK_EVENT = parseAbiItem(
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)'
)
export const NEW_FEEDBACK_TOPIC = toEventSelector(NEW_FEEDBACK_EVENT)

export interface RawLog {
  address: string
  topics: readonly string[]
  data: string
  blockNumber: bigint
  logIndex: number
  transactionHash: string
  blockTimestamp?: bigint
  eventName?: string
  args?: Record<string, unknown>
}

export interface ServiceMeta {
  description: string
  tags: string
  network: string
}

export interface IndexerRpc {
  getBlockNumber(): Promise<bigint>
  getLogs(params: {
    address: string | string[]
    events: AbiEvent[]
    args?: Record<string, unknown>
    fromBlock: bigint
    toBlock: bigint
  }): Promise<RawLog[]>
  blockTimestamp(block: bigint): Promise<bigint>
  getTransactionReceipt(hash: `0x${string}`): Promise<{ blockNumber: bigint; status?: 'success' | 'reverted'; logs: RawLog[] } | null>
  serviceMeta(key: `0x${string}`): Promise<ServiceMeta | null>
}

export interface IndexerOptions {
  db: Db
  rpc: IndexerRpc
  registry: string
  reputation: string
  usdc: string
  caip2: string
  startBlock: bigint
  maxChunk?: bigint
  onProviderChanged?: (provider: string) => void
  log?: (message: string) => void
}

const STATE_ID = 1
/** A load-balanced node behind head can answer an unseen block with an empty success. Avalanche finalizes in about a second. */
export const TAIL_BLOCKS = 2n
const MIN_CHUNK = 100n
const GET_LOGS_GAP_MS = 400
const MAX_TO_FILTER = 1000
/**
 * Ran on the public Avalanche RPC: "block range too large: total block range in this request exceeds the maximum
 * of 100 blocks". Provider RPCs word it in other ways. A 429 must back off instead, because a smaller range would not help.
 */
const IS_RANGE_ERROR = /range too large|exceeds max|max block range|too many blocks|maximum is set to|response size/i

export interface TransferRow {
  txHash: string
  logIndex: number
  block: bigint
  blockTs: Date
  from: string
  to: string
  valueRaw: string
  amountAtomic: string | null
}

export async function upsertTransfers(db: Db | Tx, rows: TransferRow[]): Promise<void> {
  if (rows.length === 0) return
  await db.insert(onchainTransfers).values(rows).onConflictDoNothing()
}

/** A USDC Transfer log, or null when it came from any other contract. Avalanche USDC has 6 decimals, so value is atomic. */
export function toTransfer(log: RawLog, blockTs: bigint, usdc: string): TransferRow | null {
  if (log.address.toLowerCase() !== usdc.toLowerCase()) return null
  if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) return null
  const { args } = decodeEventLog({
    abi: [TRANSFER_EVENT],
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    data: log.data as `0x${string}`,
  })
  return {
    txHash: log.transactionHash.toLowerCase(),
    logIndex: log.logIndex,
    block: log.blockNumber,
    blockTs: new Date(Number(blockTs) * 1000),
    from: args.from.toLowerCase(),
    to: args.to.toLowerCase(),
    valueRaw: args.value.toString(),
    amountAtomic: args.value.toString(),
  }
}

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export function createIndexer(options: IndexerOptions) {
  const { db, rpc, startBlock, caip2, onProviderChanged, log = console.warn } = options
  const registry = options.registry.toLowerCase()
  const reputation = options.reputation.toLowerCase()
  const usdc = options.usdc.toLowerCase()
  const maxChunk = options.maxChunk ?? 2000n
  let chunk = maxChunk
  let head = 0n

  async function cursor(): Promise<bigint> {
    const [row] = await db.select().from(indexerState).where(eq(indexerState.id, STATE_ID))
    return row ? row.lastBlock : startBlock - 1n
  }

  async function timestampOf(entry: RawLog, cache: Map<bigint, bigint>): Promise<bigint> {
    if (entry.blockTimestamp !== undefined) return entry.blockTimestamp
    const known = cache.get(entry.blockNumber)
    if (known !== undefined) return known
    const ts = await rpc.blockTimestamp(entry.blockNumber)
    cache.set(entry.blockNumber, ts)
    return ts
  }

  /** Reads and writes [from, to]. Throws without moving the cursor if any read fails. */
  async function processRange(from: bigint, to: bigint): Promise<void> {
    const registryLogs = await rpc.getLogs({ address: registry, events: REGISTRY_EVENTS, fromBlock: from, toBlock: to })
    const reputationLogs = await rpc.getLogs({ address: reputation, events: REPUTATION_EVENTS, fromBlock: from, toBlock: to })

    // Services first, so a service's first payment is caught in the chunk that registered it.
    const known = await db.selectDistinct({ payTo: services.payTo }).from(services)
    const payees = new Set(known.map((row) => row.payTo))
    for (const entry of registryLogs) {
      if (entry.eventName === 'ServiceRegistered' || entry.eventName === 'ServiceUpdated') payees.add(String(entry.args!.payTo).toLowerCase())
    }

    const transferLogs: RawLog[] = []
    const addresses = [...payees]
    for (let i = 0; i < addresses.length; i += MAX_TO_FILTER) {
      const batch = await rpc.getLogs({
        address: usdc,
        events: [TRANSFER_EVENT as unknown as AbiEvent],
        args: { to: addresses.slice(i, i + MAX_TO_FILTER) },
        fromBlock: from,
        toBlock: to,
      })
      transferLogs.push(...batch)
    }

    // One extra read per chunk, and only when a transfer could be a payment: which of those tx were EIP-3009 payments.
    const authorizations = new Set<string>()
    if (transferLogs.length > 0) {
      const used = await rpc.getLogs({ address: usdc, events: [AUTHORIZATION_USED_EVENT as unknown as AbiEvent], fromBlock: from, toBlock: to })
      for (const entry of used) {
        if (entry.address.toLowerCase() !== usdc || entry.topics[0] !== AUTHORIZATION_USED_TOPIC || entry.topics.length !== 3) continue
        authorizations.add(authKey(entry.transactionHash, `0x${entry.topics[1].slice(-40)}`))
      }
    }

    const cache = new Map<bigint, bigint>()
    const transfers: TransferRow[] = []
    for (const entry of transferLogs) {
      const row = toTransfer(entry, await timestampOf(entry, cache), usdc)
      if (row && payees.has(row.to)) transfers.push(row)
    }

    const ordered = [...registryLogs].sort(byPosition)
    const metaByKey = new Map<string, ServiceMeta | null>()
    for (const entry of ordered) {
      if (entry.eventName !== 'ServiceRegistered' && entry.eventName !== 'ServiceUpdated') continue
      const key = String(entry.args!.key).toLowerCase()
      if (!metaByKey.has(key)) metaByKey.set(key, await rpc.serviceMeta(key as `0x${string}`))
    }
    const timed = await Promise.all(
      [...ordered, ...reputationLogs].map(async (entry) => [entry, await timestampOf(entry, cache)] as const)
    )
    const tsOf = new Map(timed)

    const changed = new Set<string>()
    await db.transaction(async (tx) => {
      for (const entry of ordered) {
        if (entry.address.toLowerCase() !== registry) continue
        await applyRegistryEvent(tx, entry, tsOf.get(entry)!, metaByKey, changed)
      }
      for (const entry of [...reputationLogs].sort(byPosition)) {
        if (entry.address.toLowerCase() !== reputation) continue
        await applyReputationEvent(tx, entry, tsOf.get(entry)!)
      }
      await upsertTransfers(tx, transfers)
      await derivePayments(tx, transfers, caip2, authorizations)
      await tx
        .insert(indexerState)
        .values({ id: STATE_ID, lastBlock: to })
        .onConflictDoUpdate({ target: indexerState.id, set: { lastBlock: to } })
    })
    for (const provider of changed) onProviderChanged?.(provider)
  }

  return {
    head: () => head,
    cursor,
    processRange,
    chunkSize: () => chunk,
    /** Runs one chunk. Returns true while there is more to catch up on. */
    async step(): Promise<boolean> {
      head = await rpc.getBlockNumber()
      const target = head - TAIL_BLOCKS
      const from = (await cursor()) + 1n
      if (from > target) return false
      const end = from + chunk - 1n
      const to = end > target ? target : end
      try {
        await processRange(from, to)
      } catch (err) {
        if (IS_RANGE_ERROR.test(`${(err as Error).message} ${(err as { details?: string }).details ?? ''}`) && chunk > MIN_CHUNK) {
          chunk = chunk / 2n < MIN_CHUNK ? MIN_CHUNK : chunk / 2n
          log(`getLogs range refused; chunk is now ${chunk}`)
          return true
        }
        throw err
      }
      if (chunk < maxChunk) chunk = chunk * 2n > maxChunk ? maxChunk : chunk * 2n
      return to < target
    },
  }
}

export type Indexer = ReturnType<typeof createIndexer>

const byPosition = (a: RawLog, b: RawLog): number =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1

const nullIfZero = (value: unknown): string | null => {
  const text = String(value)
  return text === '0' ? null : text
}

async function applyRegistryEvent(
  tx: Tx,
  entry: RawLog,
  ts: bigint,
  meta: Map<string, ServiceMeta | null>,
  changed: Set<string>
): Promise<void> {
  const args = entry.args!
  const blockTs = new Date(Number(ts) * 1000)
  const developer = String(args.developer).toLowerCase()
  switch (entry.eventName) {
    case 'ServiceRegistered':
    case 'ServiceUpdated': {
      // A provider is any wallet that has registered a service. Its agent id follows its newest service that names one.
      const agentId = nullIfZero(args.agentId)
      await tx
        .insert(providers)
        .values({ address: developer, agentId, createdAt: blockTs, registeredBlock: entry.blockNumber })
        .onConflictDoUpdate({ target: providers.address, set: agentId ? { agentId } : { address: developer } })
      if (agentId) changed.add(developer)

      const key = String(args.key).toLowerCase()
      const details = meta.get(key)
      const row = {
        key,
        provider: developer,
        name: String(args.name),
        endpoint: String(args.endpoint),
        price: String(args.pricePerRequest),
        payTo: String(args.payTo).toLowerCase(),
        agentId,
        // The Avalanche proxy settles x402 "exact" through the facilitator. There is no Gateway rail here.
        acceptsExact: true,
        acceptsGateway: false,
        active: true,
        updatedBlock: entry.blockNumber,
      }
      await tx
        .insert(services)
        .values({
          ...row,
          description: details?.description ?? '',
          tags: details?.tags ?? '',
          network: details?.network ?? '',
          createdBlock: entry.blockNumber,
        })
        .onConflictDoUpdate({
          target: services.key,
          set: {
            ...row,
            // A failed metadata read must not blank what is already stored.
            ...(details ? { description: details.description, tags: details.tags, network: details.network } : {}),
          },
        })
      if (agentId) {
        // Ratings that gave up waiting for this agent's service get another chance now that it is linked.
        await tx
          .update(feedback)
          .set({ verifyAttempts: 0, nextVerifyAt: new Date(), verificationReason: null })
          .where(sql`${feedback.agentId} = ${agentId} AND NOT ${feedback.verified} AND ${feedback.verificationReason} = 'service_unknown'`)
      }
      return
    }
    case 'ServiceDeregistered':
      await tx
        .update(services)
        .set({ active: false, updatedBlock: entry.blockNumber })
        .where(eq(services.key, String(args.key).toLowerCase()))
      return
  }
}

async function applyReputationEvent(tx: Tx, entry: RawLog, ts: bigint): Promise<void> {
  const args = entry.args!
  const key = {
    agentId: String(args.agentId),
    client: String(args.clientAddress).toLowerCase(),
    feedbackIndex: BigInt(String(args.feedbackIndex)),
  }
  if (entry.eventName === 'NewFeedback') {
    // feedbackHash carries the x402 settlement tx the rater paid with. All zeros means no proof was attached.
    const hash = String(args.feedbackHash ?? ZERO_HASH).toLowerCase()
    const proof = hash === ZERO_HASH ? null : hash
    await tx
      .insert(feedback)
      .values({
        ...key,
        value: String(args.value),
        valueDecimals: Number(args.valueDecimals),
        tag1: String(args.tag1 ?? ''),
        tag2: String(args.tag2 ?? ''),
        endpoint: String(args.endpoint ?? ''),
        feedbackUri: String(args.feedbackURI ?? ''),
        block: entry.blockNumber,
        blockTs: new Date(Number(ts) * 1000),
        txHash: entry.transactionHash.toLowerCase(),
        feedbackHash: proof,
        // A rating with no proof is settled at once; the rest wait for verifyFeedback.
        verificationReason: proof ? null : 'no_proof',
        nextVerifyAt: proof ? new Date() : null,
      })
      .onConflictDoNothing()
  } else if (entry.eventName === 'FeedbackRevoked') {
    await tx
      .update(feedback)
      .set({ revoked: true })
      .where(
        sql`${feedback.agentId} = ${key.agentId} AND ${feedback.client} = ${key.client} AND ${feedback.feedbackIndex} = ${key.feedbackIndex}`
      )
  }
}

/** The viem-backed RPC. Kept thin so tests can substitute a simulated chain. */
export function viemRpc(client: import('viem').PublicClient, registry: string, gapMs = GET_LOGS_GAP_MS): IndexerRpc {
  // The public RPC rate-limits an unpaced scan, and one chunk takes at least three getLogs.
  let nextAt = 0
  async function pace(): Promise<void> {
    const wait = nextAt - Date.now()
    nextAt = Math.max(Date.now(), nextAt) + gapMs
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
  return {
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    async getLogs({ address, events, args, fromBlock, toBlock }) {
      // viem drops `args` when given `events`, so a filtered read must use `event`, or the node returns every USDC transfer.
      const selector = args ? { event: events[0], args: args as never } : { events }
      if (args && events.length !== 1) throw new Error('A filtered getLogs takes exactly one event.')
      await pace()
      const logs = await client.getLogs({ address: address as `0x${string}`, ...selector, fromBlock, toBlock } as never)
      return logs as unknown as RawLog[]
    },
    async blockTimestamp(block) {
      return (await client.getBlock({ blockNumber: block })).timestamp
    },
    async getTransactionReceipt(hash) {
      // Receipt reads share the public RPC budget with getLogs, so they wait their turn too.
      await pace()
      try {
        const receipt = await client.getTransactionReceipt({ hash })
        return { blockNumber: receipt.blockNumber, status: receipt.status, logs: receipt.logs as unknown as RawLog[] }
      } catch (err) {
        if ((err as Error).name === 'TransactionReceiptNotFoundError') return null
        throw err
      }
    },
    async serviceMeta(key) {
      try {
        const service = await client.readContract({
          address: registry as `0x${string}`,
          abi: registryAbi,
          functionName: 'getServiceByKey',
          args: [key],
        })
        return { description: service.description, tags: service.tags, network: service.network }
      } catch {
        return null
      }
    },
  }
}
