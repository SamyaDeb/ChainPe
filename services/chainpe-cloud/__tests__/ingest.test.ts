import { eq, sql } from 'drizzle-orm'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { heartbeats, paymentEvents } from '../src/schema.js'
import { auth, db, event, harness, hex32, newAccount, newKey, resetDb, signIn, type Harness } from './helpers.js'

let h: Harness
let seller: ReturnType<typeof newAccount>
let key: string

beforeEach(async () => {
  await resetDb()
  h = harness()
  seller = newAccount()
  h.chain.register(seller.address)
  key = await newKey(h, await signIn(h, seller))
})

const send = (events: unknown[], k = key) => request(h.app).post('/v1/ingest/events').set(...auth(k)).send({ events })
const rows = () => db.select().from(paymentEvents)

describe('POST /v1/ingest/events', () => {
  it('stores a batch unverified, whatever the proxy claims', async () => {
    const res = await send([event(seller.address), event(seller.address, { rail: 'gateway', txHash: undefined, paymentId: 'abc-123' })]).expect(200)
    expect(res.body).toEqual({ accepted: 2, updated: 0, duplicates: 0 })
    expect((await rows()).map((r) => r.verification)).toEqual(['unverified', 'unverified'])
    expect(h.wakes.count).toBe(1)
  })

  it('rejects the whole batch with 403 if any payTo is not the provider', async () => {
    const res = await send([event(seller.address), event(newAccount().address)])
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('pay_to_mismatch')
    expect(await rows()).toEqual([])
  })

  it('matches payTo regardless of address case', async () => {
    await send([event(seller.address.toLowerCase())]).expect(200)
  })

  it('stores a duplicate event id once', async () => {
    const e = event(seller.address)
    await send([e]).expect(200)
    const res = await send([e]).expect(200)
    expect(res.body).toEqual({ accepted: 0, updated: 0, duplicates: 1 })
    expect(await rows()).toHaveLength(1)
  })

  it('handles the same id twice inside one batch, keeping the completed one', async () => {
    const id = event(seller.address).id
    const res = await send([event(seller.address, { id, status: 'failed' }), event(seller.address, { id, status: 'completed' })]).expect(200)
    expect(res.body.accepted).toBe(1)
    expect((await rows())[0].status).toBe('completed')
  })

  it('never lets a replay downgrade a completed payment', async () => {
    const e = event(seller.address)
    await send([e]).expect(200)
    await send([{ ...e, status: 'failed', amountAtomic: '1', error: 'payment_already_used', txHash: undefined }]).expect(200)
    const [row] = await rows()
    expect(row.status).toBe('completed')
    expect(row.amountAtomic).toBe('10000')
    expect(row.txHash).toBe(e.txHash)
  })

  it('lets pending or failed become completed, since a retried payment keeps its id', async () => {
    const pending = event(seller.address, { status: 'pending', txHash: undefined })
    await send([pending]).expect(200)
    const res = await send([{ ...pending, status: 'completed', txHash: hex32(5) }]).expect(200)
    expect(res.body.updated).toBe(1)
    const failed = event(seller.address, { status: 'failed', txHash: undefined })
    await send([failed]).expect(200)
    await send([{ ...failed, status: 'completed', txHash: hex32(6) }]).expect(200)
    expect((await rows()).map((r) => [r.status, r.verificationReason])).toEqual([
      ['completed', 'no_transfer_yet'],
      ['completed', 'no_transfer_yet'],
    ])
  })

  it('answers 413 for a batch over 500 events and for a body over 1 MB', async () => {
    const big = await send(Array.from({ length: 501 }, () => event(seller.address)))
    expect(big.status).toBe(413)
    expect(big.body.error).toBe('payload_too_large')
    const huge = await send(Array.from({ length: 400 }, () => event(seller.address, { error: 'x'.repeat(5000) })))
    expect(huge.status).toBe(413)
    expect(huge.body.error).toBe('payload_too_large')
    expect(await rows()).toEqual([])
  })

  it('accepts exactly 500 events', async () => {
    const res = await send(Array.from({ length: 500 }, () => event(seller.address))).expect(200)
    expect(res.body.accepted).toBe(500)
  })

  it.each(['signature', 'paymentPayload', 'authorization', 'privateKey'])('refuses an event carrying %s, so it cannot be stored', async (field) => {
    const res = await send([event(seller.address, { [field]: '0xabc' })])
    expect(res.status).toBe(400)
    expect(await rows()).toEqual([])
  })

  it.each([
    ['a JS-number amount', { amountAtomic: 10000 }],
    ['a negative amount', { amountAtomic: '-1' }],
    ['a decimal amount', { amountAtomic: '0.01' }],
    ['a bad id', { id: 'not-a-hash' }],
    ['a bad tx hash', { txHash: '0x12' }],
    ['an unknown rail', { rail: 'lightning' }],
    ['a path in the payment id', { paymentId: '../../admin' }],
  ])('refuses %s with 400', async (_name, overrides) => {
    const res = await send([event(seller.address, overrides)])
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_request')
  })

  it('refuses another network and a future date', async () => {
    const wrong = await send([event(seller.address, { network: 'eip155:1' })])
    expect(wrong.status).toBe(400)
    expect(wrong.body.error).toBe('wrong_network')
    await send([event(seller.address, { ts: Date.now() + 10 * 60 * 1000 })]).expect(400)
  })

  it('scopes ids to the provider, so one provider cannot block another by using its id first', async () => {
    const other = newAccount()
    h.chain.register(other.address)
    const otherKey = await newKey(h, await signIn(h, other))
    const id = event(seller.address).id
    await send([event(other.address, { id })], otherKey).expect(200)
    const res = await send([event(seller.address, { id })]).expect(200)
    expect(res.body.accepted).toBe(1)
    expect(await rows()).toHaveLength(2)
  })

  it('keeps atomic amounts beyond the safe integer range exact', async () => {
    await send([event(seller.address, { amountAtomic: '9007199254740993123456789' })]).expect(200)
    expect((await rows())[0].amountAtomic).toBe('9007199254740993123456789')
  })

  it('flags self-pay at ingest', async () => {
    await send([event(seller.address, { payer: seller.address })]).expect(200)
    expect((await rows())[0].selfPay).toBe(true)
  })

  it('has no column that could hold a signature', async () => {
    const columns = await db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'`)
    const names = columns.rows.map((c) => c.column_name)
    expect(names.filter((n) => /signature|private|secret|plaintext/.test(n))).toEqual([])
  })
})

describe('POST /v1/ingest/heartbeat', () => {
  const beat = (overrides: Record<string, unknown> = {}) => ({
    serviceKey: hex32(1),
    version: '3.0.0',
    network: 'eip155:5042002',
    rails: ['exact', 'gateway'],
    gatewayBalanceAtomic: '1000',
    doctor: { ok: true, score: { passed: 10, total: 10 } },
    ...overrides,
  })

  it('stores a heartbeat for an owned service', async () => {
    h.chain.serviceOwners.set(hex32(1), seller.address.toLowerCase())
    await request(h.app).post('/v1/ingest/heartbeat').set(...auth(key)).send(beat()).expect(200)
    const [row] = await db.select().from(heartbeats).where(eq(heartbeats.serviceKey, hex32(1)))
    expect(row.gatewayBalanceAtomic).toBe('1000')
  })

  it('refuses a service the provider does not own', async () => {
    h.chain.serviceOwners.set(hex32(1), newAccount().address.toLowerCase())
    const res = await request(h.app).post('/v1/ingest/heartbeat').set(...auth(key)).send(beat())
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('service_not_owned')
  })

  it('refuses a doctor report over 64 KB', async () => {
    h.chain.serviceOwners.set(hex32(1), seller.address.toLowerCase())
    const res = await request(h.app).post('/v1/ingest/heartbeat').set(...auth(key)).send(beat({ doctor: { pad: 'x'.repeat(70_000) } }))
    expect(res.status).toBe(413)
  })
})

describe('rate limits', () => {
  it('answers 429 as JSON per IP on sign-in and per key on ingest', async () => {
    const limited = harness({ nonce: 2, verify: 100, ingestKey: 1, ingestIp: 100, read: 100 })
    limited.chain.register(seller.address)
    const body = { address: seller.address }
    await request(limited.app).post('/v1/auth/nonce').send(body).expect(200)
    await request(limited.app).post('/v1/auth/nonce').send(body).expect(200)
    const res = await request(limited.app).post('/v1/auth/nonce').send(body)
    expect(res.status).toBe(429)
    expect(res.body.error).toBe('rate_limited')

    const session = harness({ nonce: 100, verify: 100, ingestKey: 1, ingestIp: 100, read: 100 })
    session.chain.register(seller.address)
    const sessionKey = await newKey(session, await signIn(session, seller))
    await request(session.app).post('/v1/ingest/events').set(...auth(sessionKey)).send({ events: [event(seller.address)] }).expect(200)
    const over = await request(session.app).post('/v1/ingest/events').set(...auth(sessionKey)).send({ events: [event(seller.address)] })
    expect(over.status).toBe(429)
  })
})
