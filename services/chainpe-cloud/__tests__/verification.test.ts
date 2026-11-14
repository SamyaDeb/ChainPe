import { eq } from 'drizzle-orm'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { onchainTransfers, paymentEvents, services } from '../src/schema.js'
import { upsertTransfers } from '../src/workers/indexer.js'
import { authKey, derivePayments, onchainEventId } from '../src/workers/payments.js'
import { createReconciler } from '../src/workers/reconciler.js'
import { auth, BUYER, BUYER2, CAIP2, db, event, harness, hex32, newAccount, newKey, resetDb, signIn, SimChain, transferLog, USDC, type Harness } from './helpers.js'

let h: Harness
let seller: ReturnType<typeof newAccount>
let provider: string
let token: string
let key: string
const reconciler = () => createReconciler({ db, usdc: USDC, log: () => {} })

beforeEach(async () => {
  await resetDb()
  h = harness()
  seller = newAccount()
  provider = seller.address.toLowerCase()
  h.chain.register(seller.address)
  token = await signIn(h, seller)
  key = await newKey(h, token)
})

const ingest = (...events: unknown[]) => request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events }).expect(200)
const transfer = (txHash: string, overrides: Partial<Parameters<typeof upsertTransfers>[1][number]> = {}) =>
  upsertTransfers(db, [
    {
      txHash,
      logIndex: 2,
      block: 100n,
      blockTs: new Date('2026-11-05T00:00:00Z'),
      from: BUYER,
      to: provider,
      valueRaw: '10000',
      amountAtomic: '10000',
      ...overrides,
    },
  ])
const eventRow = async (id: unknown) => (await db.select().from(paymentEvents).where(eq(paymentEvents.id, String(id))))[0]
const summary = async (range = 'all') => (await request(h.app).get(`/v1/me/summary?range=${range}`).set(...auth(token)).expect(200)).body

describe('exact rail', () => {
  it('verifies an event matched by tx, recipient, amount and payer, and uses the block time', async () => {
    const e = event(seller.address)
    await ingest(e)
    await transfer(String(e.txHash))
    await reconciler().run()
    const row = await eventRow(e.id)
    expect(row.verification).toBe('verified')
    expect(row.matchedTransfer).toBe(`exact:${e.txHash}:2`)
    expect(row.effectiveTs.toISOString()).toBe('2026-11-05T00:00:00.000Z')
    expect((await summary()).revenue.exactAtomic).toBe('10000')
  })

  it('stays unverified with no transfer, and turns verified when the log arrives', async () => {
    const e = event(seller.address)
    await ingest(e)
    await reconciler().run()
    expect((await eventRow(e.id)).verificationReason).toBe('no_transfer_yet')
    expect((await summary()).revenue.totalVerifiedAtomic).toBe('0')
    await transfer(String(e.txHash))
    await reconciler().run()
    expect((await eventRow(e.id)).verification).toBe('verified')
  })

  it.each([
    ['amount', { amountAtomic: '9999', valueRaw: '9999' }, 'amount_mismatch'],
    ['payer', { from: BUYER2 }, 'payer_mismatch'],
  ])('keeps an event with a different %s unverified and out of revenue', async (_name, overrides, reason) => {
    const e = event(seller.address)
    await ingest(e)
    await transfer(String(e.txHash), overrides)
    await reconciler().run()
    const row = await eventRow(e.id)
    expect(row.verification).toBe('unverified')
    expect(row.verificationReason).toBe(reason)
    const s = await summary()
    expect(s.revenue.totalVerifiedAtomic).toBe('0')
    expect(s.notRevenue.unverifiedAtomic).toBe('10000')
  })

  it('does not match a transfer to another address', async () => {
    const e = event(seller.address)
    await ingest(e)
    await transfer(String(e.txHash), { to: BUYER2 })
    await reconciler().run()
    expect((await eventRow(e.id)).verificationReason).toBe('no_transfer_yet')
  })

  it('counts a transfer once when two events claim it', async () => {
    const first = event(seller.address)
    const second = event(seller.address, { txHash: first.txHash })
    await ingest(first, second)
    await transfer(String(first.txHash))
    await reconciler().run()
    const states = [await eventRow(first.id), await eventRow(second.id)].map((r) => r.verification).sort()
    expect(states).toEqual(['unverified', 'verified'])
    expect((await summary()).revenue.exactAtomic).toBe('10000')
  })

  it('lets two events claim two transfers in one tx', async () => {
    const first = event(seller.address)
    const second = event(seller.address, { txHash: first.txHash })
    await ingest(first, second)
    await transfer(String(first.txHash))
    await transfer(String(first.txHash), { logIndex: 5 })
    await reconciler().run()
    expect((await summary()).revenue.exactAtomic).toBe('20000')
  })

  it('ignores events that never completed, and counts them as failed calls', async () => {
    const e = event(seller.address, { status: 'failed', txHash: undefined, error: 'insufficient_funds' })
    await ingest(e)
    await reconciler().run()
    expect((await eventRow(e.id)).verification).toBe('unverified')
    const s = await summary()
    expect(s.calls.failed).toBe(1)
    expect(s.calls.successRate).toBe(0)
    expect(s.notRevenue.unverifiedAtomic).toBe('0')
  })

  it('reads the receipt once for an event the log scan missed, ignoring other tokens', async () => {
    const rpc = new SimChain()
    const e = event(seller.address)
    await ingest(e)
    const hash = String(e.txHash)
    rpc.receipts.set(hash, {
      blockNumber: 50n,
      logs: [
        transferLog({ from: BUYER, to: provider, atomic: 10000n, txHash: hash, logIndex: 3, emitter: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7' }),
        transferLog({ from: BUYER, to: provider, atomic: 10000n, txHash: hash, logIndex: 2 }),
      ],
    })
    let time = Date.now()
    let calls = 0
    const counted = { ...rpc, blockTimestamp: rpc.blockTimestamp, getTransactionReceipt: async (x: `0x${string}`) => (calls++, rpc.getTransactionReceipt(x)) }
    const r = createReconciler({ db, usdc: USDC, rpc: counted, now: () => time, log: () => {} })
    await r.run()
    expect(calls).toBe(0) // too recent: the scan gets its chance first
    time += 31_000
    await r.run()
    expect(calls).toBe(1)
    expect((await eventRow(e.id)).matchedTransfer).toBe(`exact:${hash}:2`)
    expect(await db.select().from(onchainTransfers)).toHaveLength(1)
  })

  it('does not re-read a receipt that had nothing', async () => {
    const e = event(seller.address)
    await ingest(e)
    let time = Date.now() + 31_000
    let calls = 0
    const rpc = { getTransactionReceipt: async () => (calls++, null), blockTimestamp: async () => 1n }
    const r = createReconciler({ db, usdc: USDC, rpc, now: () => time, log: () => {} })
    await r.run()
    time += 60_000
    await r.run()
    expect(calls).toBe(1)
  })
})

describe('Avalanche specifics', () => {
  const PAYOUT = '0x4444444444444444444444444444444444444444'
  const addService = (payTo: string) =>
    db.insert(services).values({
      key: hex32(1),
      provider,
      name: 'weather',
      endpoint: 'https://weather.example.com',
      price: '0.01',
      network: 'avalanche',
      payTo,
      acceptsExact: true,
      acceptsGateway: false,
      createdBlock: 1n,
      updatedBlock: 1n,
    })

  it('refuses a Gateway event, since Avalanche settles exact only', async () => {
    const res = await request(h.app)
      .post('/v1/ingest/events')
      .set(...auth(key))
      .send({ events: [event(seller.address, { rail: 'gateway', txHash: undefined, paymentId: 't-1' })] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('wrong_rail')
  })

  it("verifies an event paid to the service's own payTo address", async () => {
    await addService(PAYOUT)
    const e = event(PAYOUT)
    await ingest(e)
    await transfer(String(e.txHash), { to: PAYOUT })
    await reconciler().run()
    expect((await eventRow(e.id)).verification).toBe('verified')
  })

  it("lets a proxy event take over the indexer's record of the same payment, counting it once", async () => {
    await addService(provider)
    const e = event(seller.address)
    await transfer(String(e.txHash))
    const [row] = await db.select().from(onchainTransfers)
    expect(await derivePayments(db, [row], CAIP2, new Set([authKey(row.txHash, row.from)]))).toBe(1)
    expect((await summary()).revenue.exactAtomic).toBe('10000')

    await ingest(e)
    await reconciler().run()
    const taken = await eventRow(e.id)
    expect(taken.verification).toBe('verified')
    expect(taken.route).toBe('/weather')
    expect(await eventRow(onchainEventId(String(e.txHash), 2))).toBeUndefined()
    const s = await summary()
    expect(s.revenue.exactAtomic).toBe('10000')
    expect(s.calls.total).toBe(1)
  })
})

describe('self-pay', () => {
  it('flags payer == provider and leaves it out of revenue', async () => {
    const e = event(seller.address, { payer: provider })
    await ingest(e)
    await transfer(String(e.txHash), { from: provider })
    await reconciler().run()
    const s = await summary()
    expect(s.revenue.totalVerifiedAtomic).toBe('0')
    expect(s.notRevenue.selfPayAtomic).toBe('10000')
  })

  it('applies my wallets to past and future events, and un-applies them', async () => {
    const past = event(seller.address)
    await ingest(past)
    await transfer(String(past.txHash))
    await reconciler().run()
    expect((await summary()).revenue.totalVerifiedAtomic).toBe('10000')

    const put = await request(h.app).put('/v1/me/wallets').set(...auth(token)).send({ wallets: [BUYER] }).expect(200)
    expect(put.body.wallets).toHaveLength(1)
    let s = await summary()
    expect(s.revenue.totalVerifiedAtomic).toBe('0')
    expect(s.notRevenue.selfPayAtomic).toBe('10000')

    const future = event(seller.address)
    await ingest(future)
    expect((await eventRow(future.id)).selfPay).toBe(true)

    await request(h.app).put('/v1/me/wallets').set(...auth(token)).send({ wallets: [] }).expect(200)
    s = await summary()
    expect(s.revenue.totalVerifiedAtomic).toBe('10000')
  })
})

describe('summary', () => {
  it('reports transfers with no event as unattributed, never as revenue', async () => {
    await transfer(hex32(77))
    const s = await summary()
    expect(s.revenue.totalVerifiedAtomic).toBe('0')
    expect(s.notRevenue.unattributedInflowAtomic).toBe('10000')
    const e = event(seller.address, { txHash: hex32(77) })
    await ingest(e)
    await reconciler().run()
    const after = await summary()
    expect(after.notRevenue.unattributedInflowAtomic).toBe('0')
    expect(after.revenue.totalVerifiedAtomic).toBe('10000')
  })

  it('adds money as integers, exact beyond the safe range', async () => {
    const big = '9007199254740993123456789'
    const e = event(seller.address, { amountAtomic: big })
    await ingest(e)
    await transfer(String(e.txHash), { amountAtomic: big, valueRaw: '1' })
    await reconciler().run()
    expect((await summary()).revenue.exactAtomic).toBe(big)
    const series = (await summary()).series.points
    expect(series[0].revenueAtomic).toBe(big)
  })

  it('cannot backdate: revenue windows use the block time, not the proxy time', async () => {
    const e = event(seller.address, { ts: Date.now() - 400 * 24 * 3600 * 1000 })
    await ingest(e)
    await transfer(String(e.txHash), { blockTs: new Date() })
    await reconciler().run()
    expect((await summary('24h')).revenue.exactAtomic).toBe('10000')
  })

  it('returns every money field as a string', async () => {
    const s = await summary()
    for (const value of [s.revenue.totalVerifiedAtomic, s.revenue.exactAtomic, s.revenue.gateway.settledAtomic, s.notRevenue.unverifiedAtomic]) {
      expect(typeof value).toBe('string')
    }
  })
})
