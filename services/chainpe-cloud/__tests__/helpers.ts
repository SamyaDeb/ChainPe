/** Real Postgres, real signatures, real HTTP. Only the RPC is simulated. */
import { sql } from 'drizzle-orm'
import { encodeAbiParameters, encodeEventTopics, parseAbi, verifyMessage, type AbiEvent } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import request from 'supertest'
import { createApp, type Limits } from '../src/app.js'
import type { ChainReader, ProviderOnChain } from '../src/chain.js'
import { createDb, runMigrations } from '../src/db.js'
import { createProviderViews } from '../src/plan.js'
import { createSessions } from '../src/session.js'
import type { IndexerRpc, RawLog } from '../src/workers/indexer.js'
import { SYSTEM_EMITTER } from '../src/workers/indexer.js'

export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost/chainpe_cloud_test'
export const CHAIN_ID = 5042002
export const CAIP2 = `eip155:${CHAIN_ID}`
export const DASH_DOMAIN = 'app.chainpe.test'
export const CLI_DOMAIN = 'api.chainpe.test'
export const SECRET = 'test-secret-test-secret-test-secret-1234'
export const ACCOUNTS = '0xd315322c9d83a6f50a04236a2a242e0259bfb580'
export const REPUTATION = '0x8004b663056a597dffe9eccc1965a193b7388713'

export const handle = createDb(DATABASE_URL)
export const db = handle.db

let migrated = false
export async function resetDb(): Promise<void> {
  if (!migrated) {
    await runMigrations(db)
    migrated = true
  }
  await db.execute(sql`TRUNCATE providers, services, subscriptions, siwe_nonces, revoked_sessions, ingest_keys,
    payment_events, onchain_transfers, gateway_transfers, feedback, heartbeats, my_wallets, indexer_state`)
}

export class FakeChain implements ChainReader {
  providers = new Map<string, ProviderOnChain>()
  plans = new Map<string, number>()
  owners = new Map<string, string>()
  serviceOwners = new Map<string, string>()
  /** Smart accounts: ERC-1271 says yes, and ecrecover would not. */
  smartAccounts = new Set<string>()
  down = false
  reads = 0

  register(address: string, opts: { pro?: boolean; agentId?: bigint; paidUntil?: Date } = {}): void {
    const a = address.toLowerCase()
    this.providers.set(a, {
      exists: true,
      agentId: opts.agentId ?? 0n,
      createdAt: 1_790_000_000n,
      paidUntil: opts.paidUntil ? BigInt(Math.floor(opts.paidUntil.getTime() / 1000)) : 0n,
    })
    this.plans.set(a, opts.pro ? 1 : 0)
    if (opts.agentId) this.owners.set(opts.agentId.toString(), a)
  }

  private guard(): void {
    this.reads++
    if (this.down) throw new Error('RPC unreachable')
  }

  async getProvider(address: `0x${string}`): Promise<ProviderOnChain> {
    this.guard()
    return this.providers.get(address.toLowerCase()) ?? { exists: false, agentId: 0n, createdAt: 0n, paidUntil: 0n }
  }
  async planOf(address: `0x${string}`): Promise<number> {
    this.guard()
    return this.plans.get(address.toLowerCase()) ?? 0
  }
  async ownerOf(agentId: bigint): Promise<string | null> {
    this.guard()
    return this.owners.get(agentId.toString()) ?? null
  }
  async serviceProvider(key: `0x${string}`): Promise<string | null> {
    this.guard()
    return this.serviceOwners.get(key.toLowerCase()) ?? null
  }
  async verifySiwe(check: Parameters<ChainReader['verifySiwe']>[0]): Promise<boolean> {
    this.guard()
    if (this.smartAccounts.has(check.address.toLowerCase())) return true
    return verifyMessage({ address: check.address, message: check.message, signature: check.signature })
  }
}

export interface Harness {
  app: ReturnType<typeof createApp>
  chain: FakeChain
  clock: { offset: number; now(): number }
  views: ReturnType<typeof createProviderViews>
  wakes: { count: number }
}

const OPEN_LIMITS: Limits = { nonce: 100_000, verify: 100_000, ingestKey: 100_000, ingestIp: 100_000, read: 100_000 }

export function harness(limits: Limits = OPEN_LIMITS): Harness {
  const chain = new FakeChain()
  const clock = {
    offset: 0,
    now() {
      return Date.now() + this.offset
    },
  }
  const now = () => clock.now()
  const views = createProviderViews(db, chain, now)
  const wakes = { count: 0 }
  const app = createApp({
    db,
    chain,
    views,
    sessions: createSessions(db, SECRET, now),
    corsOrigins: [`https://${DASH_DOMAIN}`],
    chainId: CHAIN_ID,
    dashboardDomain: DASH_DOMAIN,
    cliDomain: CLI_DOMAIN,
    limits,
    onEvents: () => wakes.count++,
    now,
  })
  return { app, chain, clock, views, wakes }
}

export const newAccount = (): PrivateKeyAccount => privateKeyToAccount(generatePrivateKey())

export async function signIn(h: Harness, account: PrivateKeyAccount, client: 'dashboard' | 'cli' = 'dashboard'): Promise<string> {
  const { body } = await request(h.app).post('/v1/auth/nonce').send({ address: account.address, client }).expect(200)
  const signature = await account.signMessage({ message: body.message })
  const verified = await request(h.app).post('/v1/auth/verify').send({ message: body.message, signature }).expect(200)
  return verified.body.token
}

export async function newKey(h: Harness, token: string): Promise<string> {
  const { body } = await request(h.app).post('/v1/keys').set('Authorization', `Bearer ${token}`).send({}).expect(201)
  return body.key
}

let counter = 0
/** A payment event as the proxy sends it. */
export function event(payTo: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  counter++
  return {
    id: `chainpe_${counter.toString(16).padStart(48, '0')}`,
    ts: Date.now(),
    route: '/weather',
    method: 'GET',
    rail: 'exact',
    network: CAIP2,
    amountAtomic: '10000',
    payer: BUYER,
    payTo,
    txHash: `0x${counter.toString(16).padStart(64, 'a')}`,
    status: 'completed',
    latencyMs: 120,
    backendStatus: 200,
    ...overrides,
  }
}

export const BUYER = '0x24bc730c658201bc51873f7aeaade65a545c7a11'
export const BUYER2 = '0x1111111111111111111111111111111111111111'

export const hex32 = (n: number, fill = '0'): string => `0x${n.toString(16).padStart(64, fill)}`

const TRANSFER = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])

/** A log exactly as Arc's system emitter writes it, with its 18-decimal value. */
export function transferLog(o: {
  from: string
  to: string
  atomic?: bigint
  raw?: bigint
  txHash: string
  logIndex?: number
  block?: bigint
  ts?: bigint
  emitter?: string
}): RawLog {
  const value = o.raw ?? (o.atomic ?? 0n) * 1_000_000_000_000n
  return {
    address: o.emitter ?? SYSTEM_EMITTER,
    topics: encodeEventTopics({
      abi: TRANSFER,
      eventName: 'Transfer',
      args: { from: o.from as `0x${string}`, to: o.to as `0x${string}` },
    }) as string[],
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
    blockNumber: o.block ?? 100n,
    logIndex: o.logIndex ?? 0,
    transactionHash: o.txHash,
    blockTimestamp: o.ts ?? 1_790_000_100n,
  }
}

/** A chain in memory: answers getLogs by address, range and `to`, and enforces a range limit like the public RPC. */
export class SimChain implements IndexerRpc {
  logs: RawLog[] = []
  head = 0n
  maxRange = 10_000n
  calls: { address: string | string[]; fromBlock: bigint; toBlock: bigint }[] = []
  failNext: Error | undefined
  receipts = new Map<string, { blockNumber: bigint; logs: RawLog[] }>()
  meta = { description: 'desc', tags: 'a,b' }

  async getBlockNumber(): Promise<bigint> {
    return this.head
  }
  async getLogs(p: { address: string | string[]; events: AbiEvent[]; args?: Record<string, unknown>; fromBlock: bigint; toBlock: bigint }): Promise<RawLog[]> {
    this.calls.push({ address: p.address, fromBlock: p.fromBlock, toBlock: p.toBlock })
    if (this.failNext) {
      const err = this.failNext
      this.failNext = undefined
      throw err
    }
    if (p.toBlock - p.fromBlock + 1n > this.maxRange) throw new Error('requested range too large')
    const names = new Set(p.events.map((e) => e.name))
    const to = p.args?.to as string[] | undefined
    return this.logs.filter((l) => {
      if (l.address.toLowerCase() !== String(p.address).toLowerCase()) return false
      if (l.blockNumber < p.fromBlock || l.blockNumber > p.toBlock) return false
      if (l.eventName && !names.has(l.eventName)) return false
      if (to && !to.includes(`0x${l.topics[2].slice(-40)}`)) return false
      return true
    })
  }
  async blockTimestamp(block: bigint): Promise<bigint> {
    return 1_790_000_000n + block
  }
  async getTransactionReceipt(hash: `0x${string}`) {
    return this.receipts.get(hash) ?? null
  }
  async serviceMeta(): Promise<{ description: string; tags: string } | null> {
    return this.meta
  }
}

/** A decoded account or reputation log. */
export function eventLog(address: string, eventName: string, args: Record<string, unknown>, block: bigint, logIndex = 0, txHash?: string): RawLog {
  return {
    address,
    topics: [],
    data: '0x',
    blockNumber: block,
    logIndex,
    transactionHash: txHash ?? hex32(Number(block) * 1000 + logIndex),
    blockTimestamp: 1_790_000_000n + block,
    eventName,
    args,
  }
}

export const auth = (token: string): [string, string] => ['Authorization', `Bearer ${token}`]
