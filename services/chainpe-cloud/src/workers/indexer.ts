/**
 * Arc log indexer. One chunk commits in one transaction with the cursor, so a
 * restart resumes exactly and repeats nothing. Spec 08a section 4.
 */
import { eq, sql } from 'drizzle-orm'
import { decodeEventLog, parseAbi, parseAbiItem, type AbiEvent } from 'viem'
import { chainPeAccountsAbi } from '../accountsAbi.js'
import type { Db, Tx } from '../db.js'
import { feedback, indexerState, onchainTransfers, providers, services, subscriptions } from '../schema.js'
import { toAtomic6 } from '../util.js'

/** Arc's single USDC stream (EIP-7708). The 0x3600 emitter is not read: a payment logs on both, so reading both double-counts. */
export const SYSTEM_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe'
export const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

const REPUTATION_ABI = parseAbi([
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  'event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex)',
])

const ACCOUNT_EVENT_NAMES = [
  'ProviderRegistered',
  'AgentIdUpdated',
  'ServiceRegistered',
  'ServiceUpdated',
  'ServiceDeactivated',
  'Subscribed',
] as const

export const ACCOUNT_EVENTS = chainPeAccountsAbi.filter(
  (item) => item.type === 'event' && (ACCOUNT_EVENT_NAMES as readonly string[]).includes(item.name)
) as unknown as AbiEvent[]

export const REPUTATION_EVENTS = REPUTATION_ABI as unknown as AbiEvent[]

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
  getTransactionReceipt(hash: `0x${string}`): Promise<{ blockNumber: bigint; logs: RawLog[] } | null>
  serviceMeta(key: `0x${string}`): Promise<ServiceMeta | null>
}

export interface IndexerOptions {
  db: Db
  rpc: IndexerRpc
  accounts: string
  reputation: string
  startBlock: bigint
  maxChunk?: bigint
  onSubscribed?: (provider: string) => void
  log?: (message: string) => void
}

const STATE_ID = 1
/** Not a finality rule: Arc has none to wait for. A load-balanced node behind head can answer an unseen block with an empty success. */
export const TAIL_BLOCKS = 2n
const MIN_CHUNK = 100n
const GET_LOGS_GAP_MS = 400
const MAX_TO_FILTER = 1000
/**
 * Ran on Arc's public RPC. A refused range is -32012 "requested range too large" or "query exceeds max results 2000".
 * A 429 is -32005 "rate limit exceeded": that must back off instead, because a smaller range would not help.
 */
const IS_RANGE_ERROR = /range too large|exceeds max results/i

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

function toTransfer(log: RawLog, blockTs: bigint): TransferRow | null {
  if (log.address.toLowerCase() !== SYSTEM_EMITTER) return null
  const { args } = decodeEventLog({
    abi: [TRANSFER_EVENT],
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    data: log.data as `0x${string}`,
  })
  const atomic = toAtomic6(args.value)
  return {
    txHash: log.transactionHash.toLowerCase(),
    logIndex: log.logIndex,
    block: log.blockNumber,
    blockTs: new Date(Number(blockTs) * 1000),
    from: args.from.toLowerCase(),
    to: args.to.toLowerCase(),
    valueRaw: args.value.toString(),
    amountAtomic: atomic === null ? null : atomic.toString(),
  }
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** For the reconciler's receipt fallback, where logs are not filtered by event. */
export function transferFromReceiptLog(log: RawLog, blockTs: bigint): TransferRow | null {
  if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) return null
  return toTransfer(log, blockTs)
}

export function createIndexer(options: IndexerOptions) {
  const { db, rpc, startBlock, onSubscribed, log = console.warn } = options
  const accounts = options.accounts.toLowerCase()
  const reputation = options.reputation.toLowerCase()
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
    const accountLogs = await rpc.getLogs({ address: accounts, events: ACCOUNT_EVENTS, fromBlock: from, toBlock: to })
    const reputationLogs = await rpc.getLogs({ address: reputation, events: REPUTATION_EVENTS, fromBlock: from, toBlock: to })

    // Providers first, so a provider's first payment is caught in the chunk that registered it.
    const known = await db.select({ address: providers.address }).from(providers)
    const payees = new Set(known.map((row) => row.address))
    for (const entry of accountLogs) {
      if (entry.eventName === 'ProviderRegistered') payees.add(String(entry.args!.provider).toLowerCase())
    }

    const transferLogs: RawLog[] = []
    const addresses = [...payees]
    for (let i = 0; i < addresses.length; i += MAX_TO_FILTER) {
      const batch = await rpc.getLogs({
        address: SYSTEM_EMITTER,
        events: [TRANSFER_EVENT as unknown as AbiEvent],
        args: { to: addresses.slice(i, i + MAX_TO_FILTER) },
        fromBlock: from,
        toBlock: to,
      })
      transferLogs.push(...batch)
    }

    const cache = new Map<bigint, bigint>()
    const transfers: TransferRow[] = []
    for (const entry of transferLogs) {
      const row = toTransfer(entry, await timestampOf(entry, cache))
      if (row && payees.has(row.to)) transfers.push(row)
    }

    const ordered = [...accountLogs].sort(byPosition)
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

    const subscribed = new Set<string>()
    await db.transaction(async (tx) => {
      for (const entry of ordered) {
        if (entry.address.toLowerCase() !== accounts) continue
        await applyAccountEvent(tx, entry, tsOf.get(entry)!, metaByKey, subscribed)
      }
      for (const entry of [...reputationLogs].sort(byPosition)) {
        if (entry.address.toLowerCase() !== reputation) continue
        await applyReputationEvent(tx, entry, tsOf.get(entry)!)
      }
      await upsertTransfers(tx, transfers)
      await tx
        .insert(indexerState)
        .values({ id: STATE_ID, lastBlock: to })
        .onConflictDoUpdate({ target: indexerState.id, set: { lastBlock: to } })
    })
    for (const provider of subscribed) onSubscribed?.(provider)
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

async function applyAccountEvent(
  tx: Tx,
  entry: RawLog,
  ts: bigint,
  meta: Map<string, ServiceMeta | null>,
  subscribed: Set<string>
): Promise<void> {
  const args = entry.args!
  const blockTs = new Date(Number(ts) * 1000)
  switch (entry.eventName) {
    case 'ProviderRegistered':
    case 'AgentIdUpdated': {
      const agentId = nullIfZero(args.agentId)
      await tx
        .insert(providers)
        .values({
          address: String(args.provider).toLowerCase(),
          agentId,
          createdAt: blockTs,
          registeredBlock: entry.blockNumber,
        })
        .onConflictDoUpdate({ target: providers.address, set: { agentId } })
      return
    }
    case 'ServiceRegistered':
    case 'ServiceUpdated': {
      const key = String(args.key).toLowerCase()
      const details = meta.get(key)
      const row = {
        key,
        provider: String(args.provider).toLowerCase(),
        name: String(args.name),
        endpoint: String(args.endpoint),
        price: String(args.pricePerRequest),
        network: String(args.network),
        payTo: String(args.payTo).toLowerCase(),
        acceptsExact: Boolean(args.acceptsExact),
        acceptsGateway: Boolean(args.acceptsGateway),
        active: true,
        updatedBlock: entry.blockNumber,
      }
      await tx
        .insert(services)
        .values({ ...row, description: details?.description ?? '', tags: details?.tags ?? '', createdBlock: entry.blockNumber })
        .onConflictDoUpdate({
          target: services.key,
          set: {
            ...row,
            // A failed metadata read must not blank what is already stored.
            ...(details ? { description: details.description, tags: details.tags } : {}),
          },
        })
      return
    }
    case 'ServiceDeactivated':
      await tx
        .update(services)
        .set({ active: false, updatedBlock: entry.blockNumber })
        .where(eq(services.key, String(args.key).toLowerCase()))
      return
    case 'Subscribed': {
      const provider = String(args.provider).toLowerCase()
      const paidUntil = new Date(Number(args.paidUntil) * 1000)
      await tx
        .insert(subscriptions)
        .values({
          txHash: entry.transactionHash.toLowerCase(),
          logIndex: entry.logIndex,
          provider,
          periods: Number(args.periods),
          amountAtomic: String(args.amount),
          paidUntil,
          block: entry.blockNumber,
        })
        .onConflictDoNothing()
      await tx.update(providers).set({ paidUntil }).where(eq(providers.address, provider))
      subscribed.add(provider)
      return
    }
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
export function viemRpc(client: import('viem').PublicClient, accounts: string): IndexerRpc {
  // Ran: the public RPC answered 429 from the 4th getLogs in 600 ms, and one chunk takes 3.
  let nextAt = 0
  async function pace(): Promise<void> {
    const wait = nextAt - Date.now()
    nextAt = Math.max(Date.now(), nextAt) + GET_LOGS_GAP_MS
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
  return {
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    async getLogs({ address, events, args, fromBlock, toBlock }) {
      // viem drops `args` when given `events`, so a filtered read must use `event`, or the node returns every log on Arc.
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
      try {
        const receipt = await client.getTransactionReceipt({ hash })
        return { blockNumber: receipt.blockNumber, logs: receipt.logs as unknown as RawLog[] }
      } catch (err) {
        if ((err as Error).name === 'TransactionReceiptNotFoundError') return null
        throw err
      }
    },
    async serviceMeta(key) {
      try {
        const service = await client.readContract({
          address: accounts as `0x${string}`,
          abi: chainPeAccountsAbi,
          functionName: 'getService',
          args: [key],
        })
        return { description: service.description, tags: service.tags }
      } catch {
        return null
      }
    },
  }
}
