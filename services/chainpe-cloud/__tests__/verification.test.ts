import { eq } from 'drizzle-orm'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { gatewayTransfers, onchainTransfers, paymentEvents } from '../src/schema.js'
import { upsertTransfers } from '../src/workers/indexer.js'
import { createReconciler } from '../src/workers/reconciler.js'
import { auth, BUYER, BUYER2, CAIP2, db, event, harness, hex32, newAccount, newKey, resetDb, signIn, SimChain, transferLog, type Harness } from './helpers.js'

let h: Harness
let seller: ReturnType<typeof newAccount>
let provider: string
let token: string
let key: string
const reconciler = () => createReconciler({ db, caip2: CAIP2, log: () => {} })

beforeEach(async () => {
  await resetDb()
  h = harness()
  seller = newAccount()
  provider = seller.address.toLowerCase()
  h.chain.register(seller.address, { pro: true })
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
      valueRaw: '10000000000000000',
      amountAtomic: '10000',
      ...overrides,
    },
  ])
const gateway = (id: string, overrides: Record<string, unknown> = {}) =>
  db
    .insert(gatewayTransfers)
    .values({
      id,
      from: BUYER,
      to: provider,
      amountAtomic: '1000',
      token: 'USDC',
      status: 'received',
      network: CAIP2,
      createdAt: new Date(Date.now() - 1000),
      updatedAt: new Date(),
      ...overrides,
    })
    .onConflictDoUpdate({ target: gatewayTransfers.id, set: { polledAt: new Date(), ...overrides } })
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
    ['amount', { amountAtomic: '9999', valueRaw: '9999000000000000' }, 'amount_mismatch'],
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

  it('never matches a value that is not a whole 6-decimal amount', async () => {
    const e = event(seller.address, { amountAtomic: '0' })
    await ingest(e)
    await transfer(String(e.txHash), { valueRaw: '123', amountAtomic: null })
    await reconciler().run()
    expect((await eventRow(e.id)).verification).toBe('unverified')
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

  it('reads the receipt once for an event the log scan missed, ignoring other emitters', async () => {
    const rpc = new SimChain()
    const e = event(seller.address)
    await ingest(e)
    const hash = String(e.txHash)
    rpc.receipts.set(hash, {
      blockNumber: 50n,
      logs: [
        transferLog({ from: BUYER, to: provider, atomic: 10000n, txHash: hash, logIndex: 3, emitter: '0x3600000000000000000000000000000000000000' }),
        transferLog({ from: BUYER, to: provider, atomic: 10000n, txHash: hash, logIndex: 2 }),
      ],
    })
    let time = Date.now()
    let calls = 0
    const counted = { ...rpc, blockTimestamp: rpc.blockTimestamp, getTransactionReceipt: async (x: `0x${string}`) => (calls++, rpc.getTransactionReceipt(x)) }
    const r = createReconciler({ db, caip2: CAIP2, rpc: counted, now: () => time, log: () => {} })
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
    const r = createReconciler({ db, caip2: CAIP2, rpc, now: () => time, log: () => {} })
    await r.run()
    time += 60_000
    await r.run()
    expect(calls).toBe(1)
  })
})

describe('gateway rail', () => {
  const gwEvent = (id: string, overrides: Record<string, unknown> = {}) =>
    event(seller.address, { rail: 'gateway', txHash: undefined, paymentId: id, amountAtomic: '1000', ...overrides })

  it('verifies on a matching record, and splits pending from settled', async () => {
    const e = gwEvent('t-1')
    await ingest(e)
    await reconciler().run()
    expect((await eventRow(e.id)).verificationReason).toBe('no_transfer_yet')
    await gateway('t-1')
    await reconciler().run()
    expect((await eventRow(e.id)).verification).toBe('verified')
    let s = await summary()
    expect(s.revenue.gateway).toEqual({ settledAtomic: '0', pendingBatchAtomic: '1000' })
    expect(s.revenue.totalVerifiedAtomic).toBe('1000')
    await gateway('t-1', { status: 'completed' })
    await reconciler().run()
    s = await summary()
    expect(s.revenue.gateway).toEqual({ settledAtomic: '1000', pendingBatchAtomic: '0' })
  })

  it('moves a verified event to failed when Circle later fails the transfer, and takes it out of revenue', async () => {
    const e = gwEvent('t-2')
    await ingest(e)
    await gateway('t-2', { status: 'batched' })
    await reconciler().run()
    expect((await summary()).revenue.totalVerifiedAtomic).toBe('1000')

    await gateway('t-2', { status: 'failed' })
    await reconciler().run()
    const row = await eventRow(e.id)
    expect(row.verification).toBe('failed')
    expect(row.verificationReason).toBe('gateway_failed')
    const s = await summary()
    expect(s.revenue.totalVerifiedAtomic).toBe('0')
    expect(s.notRevenue.failedAtomic).toBe('1000')
    expect(s.uniqueBuyers).toBe(0)
    const list = await request(h.app).get('/v1/me/payments').set(...auth(token)).expect(200)
    expect(list.body.payments[0]).toMatchObject({ verification: 'failed', status: 'completed', gateway: { status: 'failed' } })
    const buyers = await request(h.app).get('/v1/me/buyers').set(...auth(token)).expect(200)
    expect(buyers.body.buyers).toEqual([])
  })

  it('marks a transfer already failed at first sight as failed', async () => {
    const e = gwEvent('t-3')
    await ingest(e)
    await gateway('t-3', { status: 'failed' })
    await reconciler().run()
    expect((await eventRow(e.id)).verification).toBe('failed')
  })

  it.each([
    ['recipient', { to: BUYER2 }, 'recipient_mismatch'],
    ['amount', { amountAtomic: '999' }, 'amount_mismatch'],
    ['payer', { from: BUYER2 }, 'payer_mismatch'],
    ['token', { token: 'EURC' }, 'asset_mismatch'],
    ['network', { network: 'eip155:8453' }, 'asset_mismatch'],
  ])('keeps a record with a different %s unverified', async (_name, overrides, reason) => {
    const e = gwEvent('t-4')
    await ingest(e)
    await gateway('t-4', { ...overrides })
    await db.update(gatewayTransfers).set(overrides).where(eq(gatewayTransfers.id, 't-4'))
    await reconciler().run()
    const row = await eventRow(e.id)
    expect(row.verification).toBe('unverified')
    expect(row.verificationReason).toBe(reason)
  })

  it('stops two events counting one transfer', async () => {
    const a = gwEvent('t-5')
    const b = gwEvent('t-5')
    await ingest(a, b)
    await gateway('t-5')
    await reconciler().run()
    expect((await summary()).revenue.totalVerifiedAtomic).toBe('1000')
    const reasons = [await eventRow(a.id), await eventRow(b.id)].map((r) => r.verificationReason)
    expect(reasons).toContain('already_claimed')
  })

  it('cannot verify without a transfer id', async () => {
    const e = gwEvent('x', { paymentId: undefined })
    await ingest(e)
    await reconciler().run()
    expect((await eventRow(e.id)).verificationReason).toBe('no_transfer_id')
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
