import { eq } from 'drizzle-orm'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { feeAccruals, feeBatches, gatewayTransfers, paymentEvents, providers } from '../src/schema.js'
import { auth, BUYER, CAIP2, db, FEE_CONFIG, harness, newAccount, resetDb, signIn, type Harness } from './helpers.js'

const FEES = '/v1/me/fees'
let h: Harness
let seller: ReturnType<typeof newAccount>
let address: string
let token: string
let id = 0

beforeEach(async () => {
  await resetDb()
  h = harness(undefined, FEE_CONFIG)
  seller = newAccount()
  address = seller.address.toLowerCase()
  h.chain.register(seller.address)
  token = await signIn(h, seller)
})

const optIn = (amount = 100_000_000n) => h.feeChain.allowances.set(address, amount)

/** A payment the reconciler has already verified. Well after any opt-in the test makes. */
async function pay(amountAtomic: string, over: Partial<typeof paymentEvents.$inferInsert> = {}, provider = address): Promise<string> {
  id++
  const eventId = `chainpe_${id.toString(16).padStart(48, '0')}`
  const ts = new Date(Date.now() + 60_000)
  await db.insert(paymentEvents).values({
    provider,
    id: eventId,
    ts,
    effectiveTs: ts,
    route: '/weather',
    method: 'GET',
    rail: 'exact',
    network: CAIP2,
    amountAtomic,
    payer: BUYER,
    payTo: provider,
    status: 'completed',
    latencyMs: 10,
    verification: 'verified',
    ...over,
  })
  return eventId
}

const accruals = () => db.select().from(feeAccruals)
const batches = () => db.select().from(feeBatches)
const summary = async () => (await request(h.app).get(FEES).set(...auth(token)).expect(200)).body

describe('recording fees', () => {
  it('charges 1% on Free and 0.5% on Pro, as whole atomic units rounded down', async () => {
    optIn()
    await pay('1000')
    await pay('1999')
    await h.fees!.accrue()
    expect((await accruals()).map((a) => a.feeAtomic).sort()).toEqual(['10', '19'])

    await db.delete(feeAccruals)
    h.chain.plans.set(address, 1)
    h.views.invalidate(address)
    await h.fees!.accrue()
    expect((await accruals()).map((a) => a.feeAtomic).sort()).toEqual(['5', '9'])
    expect((await summary()).rateBps).toBe(50)
  })

  it('charges nobody who has not opted in', async () => {
    await pay('1000000')
    await h.fees!.run()
    expect(await accruals()).toEqual([])
    expect((await summary()).status).toBe('not_enrolled')
    expect(h.feeChain.sends).toBe(0)
  })

  it('does not charge for payments from before the opt-in', async () => {
    await pay('1000', { effectiveTs: new Date(Date.now() - 3_600_000) })
    optIn()
    await h.fees!.accrue()
    expect(await accruals()).toEqual([])
    await pay('1000')
    await h.fees!.accrue()
    expect(await accruals()).toHaveLength(1)
  })

  it('starts charging when the dashboard first sees the approval, not at the next payment', async () => {
    optIn()
    expect((await summary()).status).toBe('active')
    await pay('1000', { effectiveTs: new Date(Date.now() + 1000) })
    h.clock.offset = 5000
    await h.fees!.accrue()
    expect(await accruals()).toHaveLength(1)
  })

  it('keeps recording fees after a revoke, so they count toward the lock', async () => {
    optIn()
    await summary()
    h.feeChain.allowances.set(address, 0n)
    await pay('1000')
    await h.fees!.accrue()
    expect(await accruals()).toHaveLength(1)
  })

  it('charges a provider registered after FEES_START_AT without an opt-in, and not an older one', async () => {
    h = harness(undefined, { ...FEE_CONFIG, startAt: new Date(Date.now() - 1000) })
    await db.insert(providers).values({ address, createdAt: new Date(), registeredBlock: 1n })
    const older = newAccount().address.toLowerCase()
    await db.insert(providers).values({ address: older, createdAt: new Date(Date.now() - 86_400_000), registeredBlock: 1n })
    await pay('1000')
    await pay('1000', {}, older)
    await h.fees!.accrue()
    expect((await accruals()).map((a) => a.provider)).toEqual([address])
  })

  it.each([
    ['self-pay', { selfPay: true }],
    ['unverified', { verification: 'unverified' as const }],
    ['failed verification', { verification: 'failed' as const }],
    ['a failed call', { status: 'failed' as const }],
    ['a pending call', { status: 'pending' as const }],
  ])('does not charge %s', async (_name, over) => {
    optIn()
    await pay('1000000', over)
    await h.fees!.accrue()
    expect(await accruals()).toEqual([])
  })

  it('charges Gateway only once its batch has landed', async () => {
    optIn()
    await pay('1000', { rail: 'gateway', paymentId: 'transfer-1' })
    const transfer = { id: 'transfer-1', from: BUYER, to: address, amountAtomic: '1000', token: 'USDC', network: CAIP2, createdAt: new Date(), updatedAt: new Date() }
    await db.insert(gatewayTransfers).values({ ...transfer, status: 'received' })
    await h.fees!.accrue()
    expect(await accruals()).toEqual([])
    await db.update(gatewayTransfers).set({ status: 'completed' }).where(eq(gatewayTransfers.id, 'transfer-1'))
    await h.fees!.accrue()
    expect(await accruals()).toHaveLength(1)
  })

  it('never charges one payment twice', async () => {
    optIn()
    await pay('1000')
    await h.fees!.accrue()
    await h.fees!.accrue()
    expect(await accruals()).toHaveLength(1)
  })

  it('drops an uncollected fee when the payer becomes the provider\'s own wallet', async () => {
    optIn()
    const eventId = await pay('1000')
    await h.fees!.accrue()
    await db.update(paymentEvents).set({ selfPay: true }).where(eq(paymentEvents.id, eventId))
    await h.fees!.accrue()
    expect(await accruals()).toEqual([])
  })

  it('leaves the fee unrecorded when Arc cannot be read, and catches up after', async () => {
    await pay('1000')
    h.feeChain.down = true
    await h.fees!.accrue()
    expect(await accruals()).toEqual([])
    h.feeChain.down = false
    optIn()
    await h.fees!.accrue()
    expect(await accruals()).toHaveLength(1)
  })
})

describe('collecting fees', () => {
  it('collects once 1 USDC is owed, and states the revenue it came from', async () => {
    optIn()
    await pay('100000000')
    await h.fees!.run()
    const [batch] = await batches()
    expect(batch).toMatchObject({ status: 'collected', feeAtomic: '1000000', revenueAtomic: '100000000' })
    const onChain = h.feeChain.collected.get(batch.id)!
    expect(onChain).toMatchObject({ feeAtomic: 1_000_000n, revenueAtomic: 100_000_000n })
    const body = await summary()
    expect(body).toMatchObject({ owedAtomic: '0', collectedAtomic: '1000000', status: 'active' })
  })

  it('waits below the threshold, then collects after a day above the minimum', async () => {
    optIn()
    await pay('10000000')
    await h.fees!.run()
    expect(await batches()).toEqual([])
    h.clock.offset = 86_400_000 + 1000
    await h.fees!.run()
    expect((await batches())[0].status).toBe('collected')
  })

  it('does not spend gas on a day-old fee below the minimum', async () => {
    optIn()
    await pay('1000')
    await h.fees!.run()
    h.clock.offset = 86_400_000 + 1000
    await h.fees!.run()
    expect(h.feeChain.sends).toBe(0)
  })

  it('never exceeds 5% of the stated revenue', async () => {
    optIn()
    await pay('100000000')
    await h.fees!.run()
    const [batch] = await batches()
    expect(BigInt(batch.feeAtomic) * 10000n).toBeLessThanOrEqual(BigInt(batch.revenueAtomic) * 500n)
  })

  it('keeps the fee owed when the allowance or balance is short', async () => {
    optIn(1n)
    await pay('100000000')
    await h.fees!.run()
    expect(h.feeChain.sends).toBe(0)
    expect((await summary()).owedAtomic).toBe('1000000')

    optIn()
    h.feeChain.balances.set(address, 0n)
    await h.fees!.run()
    expect(h.feeChain.sends).toBe(0)
  })

  it('releases the fees to try again when a collection reverts', async () => {
    optIn()
    await pay('100000000')
    h.feeChain.revertNext = true
    await h.fees!.run()
    expect((await batches())[0].status).toBe('failed')
    expect((await accruals())[0].batchId).toBeNull()
    await h.fees!.run()
    expect((await batches()).map((b) => b.status).sort()).toEqual(['collected', 'failed'])
  })

  it('does not collect twice after losing the connection to a transaction that landed', async () => {
    optIn()
    await pay('100000000')
    h.feeChain.crashAfterSend = true
    await h.fees!.run()
    expect((await batches())[0].status).toBe('pending')
    const left = h.feeChain.allowances.get(address)
    await h.fees!.run()
    expect((await batches())[0].status).toBe('collected')
    expect(h.feeChain.sends).toBe(1)
    expect(h.feeChain.allowances.get(address)).toBe(left)
  })

  it('collects nothing without the collector key, and still records', async () => {
    h.feeChain.canCollect = false
    optIn()
    await pay('100000000')
    await h.fees!.run()
    expect(h.feeChain.sends).toBe(0)
    expect((await summary()).owedAtomic).toBe('1000000')
  })

  it('keeps providers apart', async () => {
    const other = newAccount()
    const otherAddress = other.address.toLowerCase()
    h.chain.register(other.address)
    optIn()
    h.feeChain.allowances.set(otherAddress, 100_000_000n)
    await pay('100000000')
    await pay('500000000', {}, otherAddress)
    await h.fees!.run()
    const all = await batches()
    expect(all.map((b) => [b.provider, b.feeAtomic]).sort()).toEqual([[address, '1000000'], [otherAddress, '5000000']].sort())
    expect((await summary()).collectedAtomic).toBe('1000000')
    expect((await summary()).batches).toHaveLength(1)
  })
})

describe('the lock', () => {
  const owe = async () => {
    optIn(1n)
    await pay('500000000')
    await h.fees!.run()
  }

  it('stops the data at 5 USDC owed, and only that provider\'s', async () => {
    const other = newAccount()
    h.chain.register(other.address)
    const otherToken = await signIn(h, other)
    await owe()
    const res = await request(h.app).get('/v1/me/payments').set(...auth(token)).expect(403)
    expect(res.body.error).toBe('fees_due')
    await request(h.app).get('/v1/me/summary').set(...auth(token)).expect(403)
    await request(h.app).get('/v1/me/payments').set(...auth(otherToken)).expect(200)
    expect((await summary()).locked).toBe(true)
  })

  it('leaves open what a provider needs to pay, and what their proxy needs to run', async () => {
    await owe()
    await request(h.app).get('/v1/me').set(...auth(token)).expect(200)
    await request(h.app).get(FEES).set(...auth(token)).expect(200)
    const key = await request(h.app).post('/v1/keys').set(...auth(token)).send({}).expect(201)
    await request(h.app)
      .post('/v1/ingest/events')
      .set('Authorization', `Bearer ${key.body.key}`)
      .send({ events: [{ id: 'chainpe_'.padEnd(56, 'a'), ts: Date.now(), route: '/w', method: 'GET', rail: 'exact', network: CAIP2, amountAtomic: '1', payer: BUYER, payTo: address, status: 'completed', latencyMs: 1 }] })
      .expect(200)
  })

  it('opens again once the fee is collected', async () => {
    await owe()
    optIn()
    await h.fees!.run()
    await request(h.app).get('/v1/me/payments').set(...auth(token)).expect(200)
    expect((await summary()).locked).toBe(false)
  })

  it('does not lock when the fee service is off, and says it is off', async () => {
    h = harness()
    h.chain.register(seller.address)
    const fresh = await signIn(h, seller)
    await pay('500000000')
    await request(h.app).get('/v1/me/payments').set(...auth(fresh)).expect(200)
    const body = (await request(h.app).get(FEES).set(...auth(fresh)).expect(200)).body
    expect(body).toMatchObject({ enabled: false, locked: false, contract: null })
  })

  it('shows an unreadable allowance as unknown, not as zero', async () => {
    optIn()
    h.feeChain.down = true
    expect((await summary()).allowanceAtomic).toBeNull()
  })

  it('requires a session', async () => {
    await request(h.app).get(FEES).expect(401)
  })
})
