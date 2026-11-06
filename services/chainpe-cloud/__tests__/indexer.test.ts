import { beforeEach, describe, expect, it } from 'vitest'
import { feedback, indexerState, onchainTransfers, providers, services, subscriptions } from '../src/schema.js'
import { createPublicClient, custom, type AbiEvent, type PublicClient } from 'viem'
import { createIndexer, REPUTATION_EVENTS, SYSTEM_EMITTER, TAIL_BLOCKS, TRANSFER_EVENT, viemRpc } from '../src/workers/indexer.js'
import { ACCOUNTS, BUYER, db, eventLog, hex32, REPUTATION, resetDb, SimChain, transferLog } from './helpers.js'

const SELLER = '0x261f058496d81703c858ddfed201834f0b5f2e73'
const OTHER = '0x3333333333333333333333333333333333333333'
const USDC_ERC20 = '0x3600000000000000000000000000000000000000'
const START = 1000n

let sim: SimChain
const indexer = (opts: Partial<Parameters<typeof createIndexer>[0]> = {}) =>
  createIndexer({ db, rpc: sim, accounts: ACCOUNTS, reputation: REPUTATION, startBlock: START, log: () => {}, ...opts })

const registered = (block = START) => eventLog(ACCOUNTS, 'ProviderRegistered', { provider: SELLER, agentId: 0n }, block)

async function drain(i: ReturnType<typeof indexer>): Promise<void> {
  while (await i.step());
}

beforeEach(async () => {
  await resetDb()
  sim = new SimChain()
  sim.head = START + 10n
})

describe('chunking', () => {
  it('starts at the deploy block and covers every block once, in chunks', async () => {
    sim.head = START + 5000n
    const i = indexer()
    await drain(i)
    const scans = sim.calls.filter((c) => c.address === ACCOUNTS)
    expect(scans[0].fromBlock).toBe(START)
    for (const scan of scans) expect(scan.toBlock - scan.fromBlock + 1n).toBeLessThanOrEqual(2000n)
    for (let n = 1; n < scans.length; n++) expect(scans[n].fromBlock).toBe(scans[n - 1].toBlock + 1n)
    expect(scans.at(-1)!.toBlock).toBe(sim.head - TAIL_BLOCKS)
    expect(await i.cursor()).toBe(sim.head - TAIL_BLOCKS)
  })

  it('halves on a range error and grows back, losing nothing', async () => {
    sim.head = START + 4000n
    sim.maxRange = 700n
    sim.logs = [registered(), transferLog({ from: BUYER, to: SELLER, atomic: 5n, txHash: hex32(1), block: START + 3000n })]
    const i = indexer()
    await drain(i)
    expect(await db.select().from(onchainTransfers)).toHaveLength(1)
    expect(await i.cursor()).toBe(sim.head - TAIL_BLOCKS)
  })

  it('recovers a larger chunk after the range limit lifts', async () => {
    sim.head = START + 10_000n
    sim.maxRange = 300n
    const i = indexer()
    await i.step() // 2000 refused
    await i.step() // 1000 refused
    await i.step() // 500 refused
    expect(i.chunkSize()).toBe(250n)
    sim.maxRange = 10_000n
    await i.step()
    await i.step()
    expect(i.chunkSize()).toBe(1000n)
  })

  it('never goes below the floor, and surfaces the error there', async () => {
    sim.head = START + 1000n
    sim.maxRange = 50n
    const i = indexer()
    for (let n = 0; n < 5; n++) await i.step()
    expect(i.chunkSize()).toBe(100n)
    await expect(i.step()).rejects.toThrow(/range/)
    expect(await i.cursor()).toBe(START - 1n)
  })

  it('does not shrink on a 429, which a smaller range would not help', async () => {
    sim.head = START + 5000n
    const i = indexer()
    sim.failNext = Object.assign(new Error('Request exceeds defined limit.'), { details: 'rate limit exceeded' })
    await expect(i.step()).rejects.toThrow(/defined limit/)
    expect(i.chunkSize()).toBe(2000n)
    expect(await i.cursor()).toBe(START - 1n)
    await i.step()
    expect(await i.cursor()).toBe(START + 1999n)
  })

  it('shrinks when the node refuses a result as too big, as it really words it', async () => {
    sim.head = START + 5000n
    const i = indexer()
    sim.failNext = Object.assign(new Error('RPC Request failed.'), {
      details: 'request exceeded max allowed range: query exceeds max results 2000, retry with the range 1-2',
    })
    expect(await i.step()).toBe(true)
    expect(i.chunkSize()).toBe(1000n)
  })

  it('stops short of head, and waits when caught up', async () => {
    const i = indexer()
    expect(await i.step()).toBe(false)
    const before = sim.calls.length
    expect(await i.step()).toBe(false)
    expect(sim.calls.length).toBe(before)
  })
})

describe('restart', () => {
  it('resumes from the last block, with no duplicate rows', async () => {
    sim.head = START + 5000n
    sim.logs = [
      registered(),
      transferLog({ from: BUYER, to: SELLER, atomic: 1n, txHash: hex32(1), block: START + 100n }),
      transferLog({ from: BUYER, to: SELLER, atomic: 2n, txHash: hex32(2), block: START + 4500n }),
    ]
    const first = indexer()
    await first.step()
    expect(await first.cursor()).toBe(START + 1999n)
    expect(await db.select().from(onchainTransfers)).toHaveLength(1)

    sim.calls = []
    const second = indexer()
    await drain(second)
    expect(sim.calls[0].fromBlock).toBe(START + 2000n)
    expect(await db.select().from(onchainTransfers)).toHaveLength(2)
  })

  it('stores nothing and keeps the cursor if a read fails mid-chunk', async () => {
    sim.logs = [registered(), transferLog({ from: BUYER, to: SELLER, atomic: 1n, txHash: hex32(1), block: START + 1n })]
    const i = indexer()
    const realGetLogs = sim.getLogs.bind(sim)
    let seen = 0
    sim.getLogs = async (p) => {
      if (++seen === 3) throw new Error('boom')
      return realGetLogs(p)
    }
    await expect(i.step()).rejects.toThrow('boom')
    expect(await db.select().from(providers)).toEqual([])
    expect(await db.select().from(indexerState)).toEqual([])
    sim.getLogs = realGetLogs
    await drain(i)
    expect(await db.select().from(onchainTransfers)).toHaveLength(1)
    expect(await db.select().from(providers)).toHaveLength(1)
  })

  it('reprocessing the same range adds no rows', async () => {
    sim.logs = [
      registered(),
      transferLog({ from: BUYER, to: SELLER, atomic: 1n, txHash: hex32(1), block: START + 1n }),
      eventLog(ACCOUNTS, 'Subscribed', { provider: SELLER, periods: 1, amount: 1_000_000n, paidUntil: 1_800_000_000n }, START + 2n),
    ]
    const i = indexer()
    await i.processRange(START, START + 5n)
    await i.processRange(START, START + 5n)
    expect(await db.select().from(onchainTransfers)).toHaveLength(1)
    expect(await db.select().from(subscriptions)).toHaveLength(1)
    expect(await db.select().from(providers)).toHaveLength(1)
  })
})

describe('USDC transfers', () => {
  it('reads the system emitter only, and converts 18 decimals to atomic', async () => {
    sim.logs = [
      registered(),
      // One real payment logs on both emitters.
      transferLog({ from: BUYER, to: SELLER, atomic: 10000n, txHash: hex32(1), logIndex: 2, block: START + 1n }),
      transferLog({ from: BUYER, to: SELLER, raw: 10000n, txHash: hex32(1), logIndex: 3, block: START + 1n, emitter: USDC_ERC20 }),
    ]
    const i = indexer()
    await drain(i)
    const rows = await db.select().from(onchainTransfers)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ logIndex: 2, amountAtomic: '10000', valueRaw: '10000000000000000', from: BUYER, to: SELLER })
    expect(sim.calls.some((c) => c.address === USDC_ERC20)).toBe(false)
    expect(sim.calls.some((c) => c.address === SYSTEM_EMITTER)).toBe(true)
  })

  it('ignores a Transfer from a contract pretending to be the emitter', async () => {
    const realGetLogs = sim.getLogs.bind(sim)
    sim.logs = [registered()]
    sim.getLogs = async (p) => {
      const logs = await realGetLogs(p)
      return p.address === SYSTEM_EMITTER
        ? [...logs, transferLog({ from: BUYER, to: SELLER, atomic: 999n, txHash: hex32(9), block: START + 1n, emitter: OTHER })]
        : logs
    }
    await drain(indexer())
    expect(await db.select().from(onchainTransfers)).toEqual([])
  })

  it('stores a value that is not a whole 6-decimal amount with no atomic amount', async () => {
    sim.logs = [registered(), transferLog({ from: BUYER, to: SELLER, raw: 123n, txHash: hex32(1), block: START + 1n })]
    await drain(indexer())
    const [row] = await db.select().from(onchainTransfers)
    expect(row.valueRaw).toBe('123')
    expect(row.amountAtomic).toBeNull()
  })

  it('catches a provider\'s first payment in the chunk that registered it, and skips strangers', async () => {
    sim.logs = [
      registered(START + 5n),
      transferLog({ from: BUYER, to: SELLER, atomic: 1n, txHash: hex32(1), block: START + 6n }),
      transferLog({ from: BUYER, to: OTHER, atomic: 1n, txHash: hex32(2), block: START + 6n }),
    ]
    await drain(indexer())
    const rows = await db.select().from(onchainTransfers)
    expect(rows.map((r) => r.to)).toEqual([SELLER])
  })

  it('keeps two transfers in one tx apart', async () => {
    sim.logs = [
      registered(),
      transferLog({ from: BUYER, to: SELLER, atomic: 1n, txHash: hex32(1), logIndex: 1, block: START + 1n }),
      transferLog({ from: BUYER, to: SELLER, atomic: 2n, txHash: hex32(1), logIndex: 2, block: START + 1n }),
    ]
    await drain(indexer())
    expect(await db.select().from(onchainTransfers)).toHaveLength(2)
  })

  it('falls back to getBlock when a log has no timestamp, reading each block once', async () => {
    const log = transferLog({ from: BUYER, to: SELLER, atomic: 1n, txHash: hex32(1), block: START + 1n })
    delete log.blockTimestamp
    const log2 = { ...log, logIndex: 5 }
    sim.logs = [registered(), log, log2]
    let reads = 0
    const real = sim.blockTimestamp.bind(sim)
    sim.blockTimestamp = (b) => {
      reads++
      return real(b)
    }
    await drain(indexer())
    expect(reads).toBe(1)
    const [row] = await db.select().from(onchainTransfers)
    expect(row.blockTs.getTime()).toBe(Number(1_790_000_000n + START + 1n) * 1000)
  })
})

describe('ChainPeAccounts events', () => {
  const service = (name: string, extra = {}) => ({
    key: hex32(1),
    provider: SELLER,
    name,
    endpoint: 'https://a.example',
    pricePerRequest: '0.01',
    payTo: SELLER,
    network: 'eip155:5042002',
    acceptsExact: true,
    acceptsGateway: true,
    agentId: 0n,
    ...extra,
  })

  it('tracks provider, agentId, services and plans', async () => {
    const onSubscribed: string[] = []
    sim.logs = [
      registered(),
      eventLog(ACCOUNTS, 'AgentIdUpdated', { provider: SELLER, agentId: 42n }, START + 1n),
      eventLog(ACCOUNTS, 'ServiceRegistered', service('one'), START + 2n),
      eventLog(ACCOUNTS, 'ServiceUpdated', service('one', { pricePerRequest: '0.02' }), START + 3n),
      eventLog(ACCOUNTS, 'Subscribed', { provider: SELLER, periods: 2, amount: 2_000_000n, paidUntil: 1_800_000_000n }, START + 4n),
    ]
    await drain(indexer({ onSubscribed: (p) => onSubscribed.push(p) }))
    const [p] = await db.select().from(providers)
    expect(p).toMatchObject({ address: SELLER, agentId: '42' })
    expect(p.paidUntil?.getTime()).toBe(1_800_000_000_000)
    const [s] = await db.select().from(services)
    expect(s).toMatchObject({ name: 'one', price: '0.02', description: 'desc', tags: 'a,b', active: true, createdBlock: START + 2n, updatedBlock: START + 3n })
    const [sub] = await db.select().from(subscriptions)
    expect(sub).toMatchObject({ provider: SELLER, periods: 2, amountAtomic: '2000000' })
    expect(onSubscribed).toEqual([SELLER])
  })

  it('applies deactivate and reactivate in order, within one chunk', async () => {
    sim.logs = [
      registered(),
      eventLog(ACCOUNTS, 'ServiceRegistered', service('one'), START + 1n),
      eventLog(ACCOUNTS, 'ServiceDeactivated', { key: hex32(1), provider: SELLER }, START + 2n),
    ]
    await drain(indexer())
    expect((await db.select().from(services))[0].active).toBe(false)
    sim.logs.push(eventLog(ACCOUNTS, 'ServiceRegistered', service('one'), START + 12n))
    sim.head += 10n
    await drain(indexer())
    expect((await db.select().from(services))[0].active).toBe(true)
  })

  it('keeps stored metadata when its read fails', async () => {
    sim.logs = [registered(), eventLog(ACCOUNTS, 'ServiceRegistered', service('one'), START + 1n)]
    await drain(indexer())
    sim.serviceMeta = async () => null
    sim.logs.push(eventLog(ACCOUNTS, 'ServiceUpdated', service('one', { pricePerRequest: '0.05' }), START + 12n))
    sim.head += 10n
    await drain(indexer())
    const [row] = await db.select().from(services)
    expect(row.price).toBe('0.05') // proves the update was applied
    expect(row.description).toBe('desc')
  })

  it('treats agentId 0 as no identity', async () => {
    sim.logs = [registered()]
    await drain(indexer())
    expect((await db.select().from(providers))[0].agentId).toBeNull()
  })

  it('ignores an event with the right shape from another contract', async () => {
    const realGetLogs = sim.getLogs.bind(sim)
    sim.getLogs = async (p) => {
      const logs = await realGetLogs(p)
      return p.address === ACCOUNTS ? [...logs, eventLog(OTHER, 'Subscribed', { provider: SELLER, periods: 1, amount: 1n, paidUntil: 1n }, START + 1n)] : logs
    }
    await drain(indexer())
    expect(await db.select().from(subscriptions)).toEqual([])
  })
})

describe('reputation events', () => {
  const nf = (index: bigint, value: bigint, block: bigint) =>
    eventLog(REPUTATION, 'NewFeedback', { agentId: 7n, clientAddress: BUYER, feedbackIndex: index, value, valueDecimals: 0, tag1: 'x402', tag2: '/weather', endpoint: 'https://a.example', feedbackURI: 'ipfs://x' }, block)

  it('stores feedback for any agentId, so linking one later keeps its history', async () => {
    sim.logs = [nf(1n, 95n, START + 1n)]
    await drain(indexer())
    const [row] = await db.select().from(feedback)
    expect(row).toMatchObject({ agentId: '7', client: BUYER, value: '95', tag1: 'x402', revoked: false })
  })

  it('holds an int128 value that a JS number or integer column could not', async () => {
    const huge = -(2n ** 126n)
    sim.logs = [nf(1n, huge, START + 1n)]
    await drain(indexer())
    expect((await db.select().from(feedback))[0].value).toBe(huge.toString())
  })

  it('marks revoked feedback, in order within one chunk', async () => {
    sim.logs = [nf(1n, 95n, START + 1n), eventLog(REPUTATION, 'FeedbackRevoked', { agentId: 7n, clientAddress: BUYER, feedbackIndex: 1n }, START + 2n)]
    await drain(indexer())
    expect((await db.select().from(feedback))[0].revoked).toBe(true)
  })
})

describe('the viem binding, at the JSON-RPC level', () => {
  /** SimChain applies filters by itself, so this checks what really goes to the node. */
  function capture() {
    const requests: { topics: unknown[]; address: unknown }[] = []
    const client = createPublicClient({
      transport: custom({
        async request({ method, params }: { method: string; params: unknown[] }) {
          if (method === 'eth_getLogs') requests.push(params[0] as { topics: unknown[]; address: unknown })
          return []
        },
      }),
    }) as PublicClient
    return { rpc: viemRpc(client, ACCOUNTS), requests }
  }

  it('sends the recipient filter to the node, in topic 2', async () => {
    const { rpc, requests } = capture()
    await rpc.getLogs({ address: SYSTEM_EMITTER, events: [TRANSFER_EVENT as unknown as AbiEvent], args: { to: [SELLER, OTHER] }, fromBlock: 1n, toBlock: 2n })
    expect(requests[0].address).toBe(SYSTEM_EMITTER)
    const topics = requests[0].topics as (string | string[] | null)[]
    expect(topics[0]).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')
    expect(topics[1]).toBeNull()
    expect(topics[2]).toEqual([`0x${'0'.repeat(24)}${SELLER.slice(2)}`, `0x${'0'.repeat(24)}${OTHER.slice(2)}`])
  })

  it('asks for all listed events when unfiltered', async () => {
    const { rpc, requests } = capture()
    await rpc.getLogs({ address: REPUTATION, events: REPUTATION_EVENTS, fromBlock: 1n, toBlock: 2n })
    expect((requests[0].topics[0] as string[]).length).toBe(2)
  })

  it('refuses a filter with several events, which viem would silently drop', async () => {
    const { rpc } = capture()
    await expect(rpc.getLogs({ address: REPUTATION, events: REPUTATION_EVENTS, args: { to: [SELLER] }, fromBlock: 1n, toBlock: 2n })).rejects.toThrow(/exactly one event/)
  })
})
