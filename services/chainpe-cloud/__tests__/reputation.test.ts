/** Phase 3: payment-gated reputation. Real Postgres and HTTP; only the chain is simulated. */
import { and, eq } from 'drizzle-orm'
import request from 'supertest'
import { encodeAbiParameters, encodeEventTopics, parseAbi } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'
import { feedback, myWallets, onchainTransfers, paymentEvents, services } from '../src/schema.js'
import { createIndexer } from '../src/workers/indexer.js'
import { authKey, derivePayments } from '../src/workers/payments.js'
import { createFeedbackVerifier, MAX_ATTEMPTS, retryDelayMs } from '../src/workers/verifyFeedback.js'
import { auth, authLog, CAIP2, db, eventLog, harness, hex32, indexProvider, newAccount, REGISTRY, REPUTATION, resetDb, signIn, SimChain, transferLog, USDC, type Harness } from './helpers.js'

const DEV = '0x261f058496d81703c858ddfed201834f0b5f2e73'
const PAYTO = '0x4444444444444444444444444444444444444444'
const OTHER_PAYTO = '0x5555555555555555555555555555555555555555'
const R1 = '0xa100000000000000000000000000000000000001'
const R2 = '0xa100000000000000000000000000000000000002'
const R3 = '0xa100000000000000000000000000000000000003'
const AGENT = 7n
const PRICE = 10_000n
const FB_BLOCK = 500n

let sim: SimChain
let t0: number
let clock: number
const verifier = () => createFeedbackVerifier({ db, rpc: sim, usdc: USDC, now: () => clock, log: () => {} })

beforeEach(async () => {
  await resetDb()
  sim = new SimChain()
  t0 = Date.now()
  clock = t0 + 1000
})

async function addService(o: { key?: string; provider?: string; payTo?: string; agentId?: bigint | null; createdBlock?: bigint; name?: string } = {}) {
  await db.insert(services).values({
    key: o.key ?? hex32(1),
    provider: o.provider ?? DEV,
    name: o.name ?? 'weather',
    endpoint: 'https://weather.example.com',
    price: '0.01',
    network: 'avalanche',
    payTo: o.payTo ?? PAYTO,
    agentId: o.agentId === null ? null : (o.agentId ?? AGENT).toString(),
    acceptsExact: true,
    acceptsGateway: false,
    createdBlock: o.createdBlock ?? 1n,
    updatedBlock: o.createdBlock ?? 1n,
  })
}

async function addFeedback(o: { client: string; index?: bigint; value?: number; hash?: string | null; block?: bigint; agentId?: bigint; revoked?: boolean; verified?: boolean; paid?: bigint; paidTo?: string; reason?: string }) {
  const hash = o.hash === undefined ? hex32(900) : o.hash
  await db.insert(feedback).values({
    agentId: (o.agentId ?? AGENT).toString(),
    client: o.client,
    feedbackIndex: o.index ?? 1n,
    value: String(o.value ?? 90),
    valueDecimals: 0,
    tag1: 'x402',
    tag2: '',
    endpoint: 'https://weather.example.com',
    feedbackUri: '',
    revoked: o.revoked ?? false,
    block: o.block ?? FB_BLOCK,
    blockTs: new Date(t0),
    txHash: hex32(Number(o.index ?? 1n) + 5000, 'e'),
    feedbackHash: hash,
    verified: o.verified ?? false,
    paidAtomic: o.paid?.toString() ?? null,
    paidTo: o.paidTo ?? (o.verified ? PAYTO : null),
    paymentTx: o.verified ? (hash ?? null) : null,
    verificationReason: hash ? (o.reason ?? null) : 'no_proof',
    nextVerifyAt: o.verified || !hash || o.reason ? null : new Date(t0),
  })
}

/** What the chain holds for a payment tx: its transfers, and who (if anyone) signed the EIP-3009 authorization. */
function setReceipt(hash: string, o: { block?: bigint; status?: 'success' | 'reverted'; pays?: { from: string; to: string; atomic?: bigint }[]; authorizer?: string | null }) {
  const pays = o.pays ?? [{ from: R1, to: PAYTO }]
  const block = o.block ?? 400n
  sim.receipts.set(hash as `0x${string}`, {
    blockNumber: block,
    status: o.status ?? 'success',
    logs: [
      ...pays.map((p, i) => transferLog({ from: p.from, to: p.to, atomic: p.atomic ?? PRICE, txHash: hash, logIndex: i * 2, block })),
      ...(o.authorizer === null ? [] : [authLog({ authorizer: o.authorizer ?? pays[0].from, txHash: hash, logIndex: 1, block })]),
    ],
  })
}

const row = async (client = R1, index = 1n) =>
  (await db.select().from(feedback).where(and(eq(feedback.client, client), eq(feedback.feedbackIndex, index))))[0]

describe('verifyFeedback: each rule', () => {
  it('verifies a rating whose tx paid the service from the rater with an EIP-3009 authorization', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), {})
    await verifier().run()
    const r = await row()
    expect(r).toMatchObject({ verified: true, verificationReason: null, paidAtomic: '10000', paidTo: PAYTO, paymentTx: hex32(900), nextVerifyAt: null })
  })

  it('accepts a payment in the same block as the rating', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), { block: FB_BLOCK })
    await verifier().run()
    expect((await row()).verified).toBe(true)
  })

  it('no_payment: the tx moved no USDC from the rater', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), { pays: [{ from: R2, to: PAYTO }], authorizer: R2 })
    await verifier().run()
    expect(await row()).toMatchObject({ verified: false, verificationReason: 'no_payment', nextVerifyAt: null })
  })

  it('wrong_payee: the rater paid someone other than the rated service', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), { pays: [{ from: R1, to: OTHER_PAYTO }] })
    await verifier().run()
    expect((await row()).verificationReason).toBe('wrong_payee')
  })

  it('not_x402: a plain transfer, with no AuthorizationUsed', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), { authorizer: null })
    await verifier().run()
    expect(await row()).toMatchObject({ verified: false, verificationReason: 'not_x402' })
  })

  it('not_x402: AuthorizationUsed signed by someone other than the rater does not count', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), { authorizer: R3 })
    await verifier().run()
    expect((await row()).verificationReason).toBe('not_x402')
  })

  it('reused: one payment backs one rating; the earliest keeps it', async () => {
    await addService()
    await addFeedback({ client: R1, index: 1n, block: 500n })
    await addFeedback({ client: R1, index: 2n, block: 501n })
    setReceipt(hex32(900), {})
    await verifier().run()
    expect((await row(R1, 1n)).verified).toBe(true)
    expect(await row(R1, 2n)).toMatchObject({ verified: false, verificationReason: 'reused', nextVerifyAt: null })
  })

  it('reused: the database refuses two verified ratings on one payment even if the check races', async () => {
    await addService()
    await addFeedback({ client: R1, index: 1n, verified: true, paid: PRICE, hash: hex32(900) })
    await expect(addFeedback({ client: R2, index: 1n, verified: true, paid: PRICE, hash: hex32(900) })).rejects.toThrow()
  })

  it('self_rating: the provider rating itself with its own wallet', async () => {
    await addService()
    await addFeedback({ client: DEV })
    setReceipt(hex32(900), { pays: [{ from: DEV, to: PAYTO }] })
    await verifier().run()
    expect((await row(DEV)).verificationReason).toBe('self_rating')
  })

  it("self_rating: a wallet the provider declared as its own, and the service's own payTo", async () => {
    await addService()
    await db.insert(myWallets).values({ provider: DEV, address: R2 })
    await addFeedback({ client: R2 })
    await addFeedback({ client: PAYTO, hash: hex32(901) })
    setReceipt(hex32(900), { pays: [{ from: R2, to: PAYTO }] })
    setReceipt(hex32(901), { pays: [{ from: PAYTO, to: PAYTO }] })
    await verifier().run()
    expect((await row(R2)).verificationReason).toBe('self_rating')
    expect((await row(PAYTO)).verificationReason).toBe('self_rating')
  })

  it('payment_after_feedback: the payment landed in a later block than the rating', async () => {
    await addService()
    await addFeedback({ client: R1, block: 500n })
    setReceipt(hex32(900), { block: 501n })
    await verifier().run()
    expect((await row()).verificationReason).toBe('payment_after_feedback')
  })

  it('tx_failed: a reverted tx proves nothing', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), { status: 'reverted' })
    await verifier().run()
    expect((await row()).verificationReason).toBe('tx_failed')
  })

  it("a copycat service reusing another provider's payTo earns nothing from payments to it", async () => {
    await addService({ key: hex32(1), provider: DEV, agentId: AGENT, createdBlock: 10n })
    const squatter = '0x9999999999999999999999999999999999999999'
    await addService({ key: hex32(2), provider: squatter, agentId: 8n, createdBlock: 20n, name: 'copy' })
    await addFeedback({ client: R1, agentId: 8n })
    setReceipt(hex32(900), {})
    await verifier().run()
    expect((await row()).verificationReason).toBe('wrong_payee')
  })

  it('a rating with no proof is never queued', async () => {
    await addService()
    await addFeedback({ client: R1, hash: null })
    await verifier().run()
    expect(await row()).toMatchObject({ verified: false, verificationReason: 'no_proof', verifyAttempts: 0, nextVerifyAt: null })
  })
})

describe('verifyFeedback: retry with backoff', () => {
  it('retries a tx the node cannot see yet, waits out the backoff, then verifies', async () => {
    await addService()
    await addFeedback({ client: R1 })
    await verifier().run()
    let r = await row()
    expect(r).toMatchObject({ verified: false, verificationReason: 'receipt_not_found', verifyAttempts: 1 })
    expect(r.nextVerifyAt!.getTime()).toBe(clock + retryDelayMs(1))

    // Not due yet: the verifier leaves it alone.
    setReceipt(hex32(900), {})
    expect(await verifier().run()).toBe(false)
    expect((await row()).verified).toBe(false)

    clock += retryDelayMs(1) + 1
    await verifier().run()
    r = await row()
    expect(r).toMatchObject({ verified: true, verificationReason: null })
  })

  it('backs off exponentially and gives up for good after MAX_ATTEMPTS', async () => {
    await addService()
    await addFeedback({ client: R1 })
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1))
    for (let n = 0; n < MAX_ATTEMPTS; n++) {
      const r = await row()
      if (!r.nextVerifyAt) break
      clock = r.nextVerifyAt.getTime() + 1
      await verifier().run()
    }
    expect(await row()).toMatchObject({ verified: false, verificationReason: 'receipt_not_found', nextVerifyAt: null, verifyAttempts: MAX_ATTEMPTS })
  })

  it('waits for the service to be indexed, rather than rejecting a rating that came first', async () => {
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), {})
    await verifier().run()
    expect(await row()).toMatchObject({ verified: false, verificationReason: 'service_unknown', verifyAttempts: 1 })
    await addService()
    clock += retryDelayMs(1) + 1
    await verifier().run()
    expect((await row()).verified).toBe(true)
  })

  it('does not touch a settled rating again', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), { authorizer: null })
    await verifier().run()
    clock += 10 * 3_600_000
    setReceipt(hex32(900), {}) // even if the chain now looks different, a final verdict stands
    await verifier().run()
    expect((await row()).verificationReason).toBe('not_x402')
  })
})

describe('indexer: proof and attribution', () => {
  const START = 1000n
  const indexer = () => createIndexer({ db, rpc: sim, registry: REGISTRY, reputation: REPUTATION, usdc: USDC, caip2: CAIP2, startBlock: START, log: () => {} })
  const registered = (key: string, developer: string, block: bigint, extra: Record<string, unknown> = {}) =>
    eventLog(REGISTRY, 'ServiceRegistered', { key, developer, name: `s${key.slice(-2)}`, endpoint: 'https://a.example', pricePerRequest: '0.01', paymentToken: 'USDC', payTo: PAYTO, agentId: 0n, ...extra }, block)
  const drain = async (i: ReturnType<typeof indexer>) => {
    while (await i.step());
  }
  beforeEach(() => {
    sim.head = START + 10n
  })

  it('stores feedbackHash from NewFeedback, queues it, and settles a zero hash as no_proof', async () => {
    const nf = (index: bigint, feedbackHash: string) =>
      eventLog(REPUTATION, 'NewFeedback', { agentId: 7n, clientAddress: R1, feedbackIndex: index, value: 90n, valueDecimals: 0, tag1: 'x402', tag2: '', endpoint: '', feedbackURI: '', feedbackHash }, START + 1n, Number(index))
    sim.logs = [nf(1n, hex32(900)), nf(2n, hex32(0))]
    await drain(indexer())
    const [withHash, without] = [await row(R1, 1n), await row(R1, 2n)]
    expect(withHash).toMatchObject({ feedbackHash: hex32(900), verified: false, verificationReason: null })
    expect(withHash.nextVerifyAt).not.toBeNull()
    expect(without).toMatchObject({ feedbackHash: null, verificationReason: 'no_proof', nextVerifyAt: null })
  })

  it('stores the agentId of each service', async () => {
    sim.logs = [registered(hex32(1), DEV, START + 1n, { agentId: 7n })]
    await drain(indexer())
    expect((await db.select().from(services))[0].agentId).toBe('7')
  })

  it('counts a transfer only when its tx emitted AuthorizationUsed from the payer', async () => {
    const pay = (n: number, from: string) => transferLog({ from, to: PAYTO, atomic: PRICE, txHash: hex32(n), block: START + 2n, logIndex: n })
    sim.logs = [
      registered(hex32(1), DEV, START + 1n),
      pay(1, R1), authLog({ authorizer: R1, txHash: hex32(1), block: START + 2n }), // x402 payment
      pay(2, R1), // plain transfer
      pay(3, R1), authLog({ authorizer: R2, txHash: hex32(3), block: START + 2n }), // authorized by someone else
    ]
    await drain(indexer())
    expect(await db.select().from(onchainTransfers)).toHaveLength(3)
    const events = await db.select().from(paymentEvents)
    expect(events).toHaveLength(1)
    expect(events[0].txHash).toBe(hex32(1))
  })

  it('credits a shared payTo to its earliest registrant only', async () => {
    const early = '0x1111111111111111111111111111111111111111'
    const late = '0x2222222222222222222222222222222222222222'
    sim.logs = [
      registered(hex32(2), late, START + 5n),
      registered(hex32(1), early, START + 1n),
      transferLog({ from: R1, to: PAYTO, atomic: PRICE, txHash: hex32(1), block: START + 6n }),
      authLog({ authorizer: R1, txHash: hex32(1), block: START + 6n }),
    ]
    await drain(indexer())
    const events = await db.select().from(paymentEvents)
    expect(events).toHaveLength(1)
    expect(events[0].provider).toBe(early)
  })

  it('does not let a later service win a shared payTo by matching the price the earlier one does not', async () => {
    sim.logs = [
      registered(hex32(1), '0x1111111111111111111111111111111111111111', START + 1n, { pricePerRequest: '0.05' }),
      registered(hex32(2), '0x2222222222222222222222222222222222222222', START + 2n, { pricePerRequest: '0.01' }),
      transferLog({ from: R1, to: PAYTO, atomic: PRICE, txHash: hex32(1), block: START + 6n }),
      authLog({ authorizer: R1, txHash: hex32(1), block: START + 6n }),
    ]
    await drain(indexer())
    expect(await db.select().from(paymentEvents)).toEqual([])
  })

  it('reads AuthorizationUsed once per chunk, only when a transfer needs it, and never per transfer', async () => {
    sim.logs = [registered(hex32(1), DEV, START + 1n)]
    await drain(indexer())
    expect(sim.calls.filter((c) => c.address === USDC).every((c) => c.fromBlock >= 0n)).toBe(true)
    const noTransfers = sim.calls.filter((c) => c.address === USDC).length
    expect(noTransfers).toBe(1) // the Transfer scan only: nothing to authorize

    sim.calls = []
    sim.logs = [
      registered(hex32(1), DEV, START + 1n),
      ...[1, 2, 3, 4].flatMap((n) => [transferLog({ from: R1, to: PAYTO, atomic: PRICE, txHash: hex32(n), block: START + 2n, logIndex: n * 2 }), authLog({ authorizer: R1, txHash: hex32(n), block: START + 2n, logIndex: n * 2 + 1 })]),
    ]
    await resetDb()
    await drain(indexer())
    expect(sim.calls.filter((c) => c.address === USDC)).toHaveLength(2) // one Transfer scan + one AuthorizationUsed scan
  })
})

describe('paid score', () => {
  it('weights by USDC paid, caps each payment at 1 USDC, and ignores unverified and revoked ratings', async () => {
    await addService()
    await addFeedback({ client: R1, value: 80, verified: true, paid: 1_000_000n, hash: hex32(901) })
    await addFeedback({ client: R2, value: 40, verified: true, paid: 3_000_000n, hash: hex32(902) }) // capped to 1 USDC
    await addFeedback({ client: R3, value: 100, verified: true, paid: 500_000n, hash: hex32(903) })
    await addFeedback({ client: '0xa100000000000000000000000000000000000004', value: 0, verified: true, paid: 1_000_000n, hash: hex32(904), revoked: true })
    for (let n = 0; n < 5; n++) await addFeedback({ client: `0xb10000000000000000000000000000000000000${n}`, value: 100, hash: null }) // unpaid, 100 each
    // (80*1 + 40*1 + 100*0.5) / 2.5 = 68.00; raw = (80+40+100+500) / 8 = 90.00
    const h = harness()
    const { body } = await request(h.app).get('/v1/public/services').expect(200)
    expect(body.services[0]).toMatchObject({ paidScore: 68, paidReviews: 3, rawScore: 90, rawReviews: 8 })
  })

  it('is null, not the raw score, when nobody has paid', async () => {
    await addService()
    for (let n = 0; n < 3; n++) await addFeedback({ client: `0xb10000000000000000000000000000000000000${n}`, value: 100, hash: null })
    const { body } = await request(harness().app).get('/v1/public/services').expect(200)
    expect(body.services[0]).toMatchObject({ paidScore: null, paidReviews: 0, rawScore: 100, rawReviews: 3 })
  })

  it('scores each service by the payTo that was paid, even when they share an agent', async () => {
    await addService({ key: hex32(1), payTo: PAYTO, name: 'a' })
    await addService({ key: hex32(2), payTo: OTHER_PAYTO, name: 'b', createdBlock: 2n })
    await addFeedback({ client: R1, value: 90, verified: true, paid: PRICE, hash: hex32(901), paidTo: PAYTO })
    await addFeedback({ client: R2, value: 20, verified: true, paid: PRICE, hash: hex32(902), paidTo: OTHER_PAYTO })
    const { body } = await request(harness().app).get('/v1/public/services').expect(200)
    const by = Object.fromEntries(body.services.map((s: { name: string }) => [s.name, s]))
    expect(by.a.paidScore).toBe(90)
    expect(by.b.paidScore).toBe(20)
  })
})

describe('/v1/me/reputation', () => {
  it('returns paid and raw scores next to the legacy averages', async () => {
    const h = harness()
    const seller = newAccount()
    const me = seller.address.toLowerCase()
    h.chain.register(seller.address, { agentId: AGENT })
    await indexProvider(seller.address, AGENT)
    await addService({ provider: me })
    await addFeedback({ client: R1, value: 80, verified: true, paid: 1_000_000n, hash: hex32(901) })
    await addFeedback({ client: R2, value: 100, hash: null })
    const token = await signIn(h, seller)
    const { body } = await request(h.app).get('/v1/me/reputation').set(...auth(token)).expect(200)
    expect(body).toMatchObject({ paidScore: '80.00', paidReviews: 1, rawScore: '90.00', rawReviews: 2, allCount: 2 })
    const item = body.items.find((i: { client: string }) => i.client.toLowerCase() === R1)
    expect(item).toMatchObject({ verified: true, paymentTx: hex32(901), paidAtomic: '1000000' })
    expect(body.items.find((i: { client: string }) => i.client.toLowerCase() === R2)).toMatchObject({ verified: false, verificationReason: 'no_proof' })
  })
})

describe('/v1/public', () => {
  let h: Harness
  beforeEach(async () => {
    h = harness()
    await addService()
  })

  const settle = async (txHash: string, from: string, ts: number) => {
    const row = { txHash, logIndex: 2, block: 100n, blockTs: new Date(ts), from, to: PAYTO, valueRaw: String(PRICE), amountAtomic: String(PRICE) }
    await db.insert(onchainTransfers).values(row)
    await derivePayments(db, [row], CAIP2, new Set([authKey(txHash, from)]))
  }

  it('needs no session', async () => {
    for (const path of ['/v1/public/services', '/v1/public/feed', '/v1/public/stats', `/v1/public/services/${hex32(1)}/reviews`]) {
      await request(h.app).get(path).expect(200)
    }
  })

  it('lists services with price, payTo, agent, scores and settlement totals', async () => {
    await settle(hex32(11), R1, t0 - 2000)
    await settle(hex32(12), R2, t0 - 1000)
    await addFeedback({ client: R1, value: 90, verified: true, paid: PRICE, hash: hex32(11) })
    const { body } = await request(h.app).get('/v1/public/services').expect(200)
    expect(body.services).toHaveLength(1)
    expect(body.services[0]).toMatchObject({
      key: hex32(1),
      name: 'weather',
      endpoint: 'https://weather.example.com',
      price: '0.01',
      agentId: '7',
      paidScore: 90,
      paidReviews: 1,
      rawScore: 90,
      rawReviews: 1,
      totalSettledAtomic: '20000',
      paidCalls: 2,
      payToShared: false,
    })
    expect(body.services[0].payTo.toLowerCase()).toBe(PAYTO)
  })

  it('hides deregistered services and flags a service that shares an earlier one\'s payTo', async () => {
    await addService({ key: hex32(2), provider: '0x9999999999999999999999999999999999999999', createdBlock: 5n, name: 'copy' })
    await addService({ key: hex32(3), payTo: OTHER_PAYTO, createdBlock: 6n, name: 'gone' })
    await db.update(services).set({ active: false }).where(eq(services.key, hex32(3)))
    const { body } = await request(h.app).get('/v1/public/services').expect(200)
    expect(body.services.map((s: { name: string; payToShared: boolean }) => [s.name, s.payToShared])).toEqual([['weather', false], ['copy', true]])
  })

  it('pages reviews with their verification status and reason', async () => {
    await addFeedback({ client: R1, index: 1n, block: 500n, value: 90, verified: true, paid: PRICE, hash: hex32(11) })
    await addFeedback({ client: R2, index: 1n, block: 501n, value: 100, hash: null })
    await addFeedback({ client: R3, index: 1n, block: 502n, value: 100, hash: hex32(13), reason: 'not_x402' })
    await addFeedback({ client: DEV.replace('26', '27'), index: 1n, block: 503n, value: 70, hash: hex32(14) }) // still pending
    const first = (await request(h.app).get(`/v1/public/services/${hex32(1)}/reviews?limit=3`).expect(200)).body
    expect(first.total).toBe(4)
    expect(first.reviews.map((r: { status: string }) => r.status)).toEqual(['pending', 'unverified', 'unverified'])
    expect(first.reviews[1]).toMatchObject({ verificationReason: 'not_x402', verified: false, paymentTx: null })
    const second = (await request(h.app).get(`/v1/public/services/${hex32(1)}/reviews?limit=3&offset=3`).expect(200)).body
    expect(second.reviews).toHaveLength(1)
    expect(second.reviews[0]).toMatchObject({ status: 'verified', verified: true, paymentTx: hex32(11), paidAtomic: '10000', score: 90 })
  })

  it('answers 404 for an unknown service and 400 for a malformed key or limit', async () => {
    await request(h.app).get(`/v1/public/services/${hex32(99)}/reviews`).expect(404)
    await request(h.app).get('/v1/public/services/nothex/reviews').expect(400)
    await request(h.app).get(`/v1/public/services/${hex32(1)}/reviews?limit=1000`).expect(400)
    await request(h.app).get('/v1/public/feed?limit=0').expect(400)
  })

  it('feeds the latest verified settlements, newest first, leaving out self-pay', async () => {
    await settle(hex32(11), R1, t0 - 3000)
    await settle(hex32(12), R2, t0 - 1000)
    await settle(hex32(13), DEV, t0 - 500) // the provider paying itself
    const { body } = await request(h.app).get('/v1/public/feed?limit=10').expect(200)
    expect(body.settlements.map((s: { txHash: string }) => s.txHash)).toEqual([hex32(12), hex32(11)])
    expect(body.settlements[0]).toMatchObject({ service: 'weather', serviceKey: hex32(1), amountAtomic: '10000' })
    const limited = (await request(h.app).get('/v1/public/feed?limit=1').expect(200)).body
    expect(limited.settlements).toHaveLength(1)
  })

  it('reports network totals', async () => {
    await settle(hex32(11), R1, t0 - 3000)
    await settle(hex32(12), DEV, t0 - 500)
    await addFeedback({ client: R1, verified: true, paid: PRICE, hash: hex32(11) })
    await addFeedback({ client: R2, hash: null })
    const { body } = await request(h.app).get('/v1/public/stats').expect(200)
    expect(body).toEqual({ totalSettledAtomic: '10000', paidCalls: 1, services: 1, verifiedReviews: 1, totalReviews: 2 })
  })

  it('allows the landing site and the service host to read it cross-origin, and nobody else', async () => {
    for (const origin of ['https://chainpe.vercel.app', 'https://app.chainpe.test']) {
      const res = await request(h.app).get('/v1/public/stats').set('Origin', origin).expect(200)
      expect(res.headers['access-control-allow-origin']).toBe(origin)
    }
    const evil = await request(h.app).get('/v1/public/stats').set('Origin', 'https://evil.example').expect(200)
    expect(evil.headers['access-control-allow-origin']).toBeUndefined()
    const pre = await request(h.app).options('/v1/public/services').set('Origin', 'https://chainpe.vercel.app').set('Access-Control-Request-Method', 'GET').expect(204)
    expect(pre.headers['access-control-allow-origin']).toBe('https://chainpe.vercel.app')
  })

  it('has its own rate limit per IP, separate from the session API', async () => {
    const limited = harness({ nonce: 100_000, verify: 100_000, ingestKey: 100_000, ingestIp: 100_000, read: 100_000, public: 3 })
    for (let n = 0; n < 3; n++) await request(limited.app).get('/v1/public/stats').expect(200)
    const res = await request(limited.app).get('/v1/public/stats').expect(429)
    expect(res.body.error).toBe('rate_limited')
    // The authenticated API is unaffected.
    await request(limited.app).get('/health').expect(200)
  })
})

describe('verifyFeedback: hardening', () => {
  const NEW_FEEDBACK = parseAbi([
    'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  ])
  function feedbackLog(o: { agentId: bigint; client: string; index: bigint; hash: string; txHash: string }) {
    return {
      address: REPUTATION,
      topics: encodeEventTopics({
        abi: NEW_FEEDBACK,
        eventName: 'NewFeedback',
        args: { agentId: o.agentId, clientAddress: o.client as `0x${string}`, indexedTag1: 'x402' },
      }) as string[],
      data: encodeAbiParameters(
        [{ type: 'uint64' }, { type: 'int128' }, { type: 'uint8' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }],
        [o.index, 90n, 0, 'x402', '', 'https://weather.example.com', '', o.hash as `0x${string}`]
      ),
      blockNumber: FB_BLOCK,
      logIndex: 0,
      transactionHash: o.txHash,
    }
  }

  it('recovers the proof of a rating indexed before migration 0002, then verifies it', async () => {
    await addService()
    await addFeedback({ client: R1, hash: null })
    await db.update(feedback).set({ verificationReason: null, nextVerifyAt: new Date(t0) })
    const r0 = await row()
    sim.receipts.set(r0.txHash as `0x${string}`, { blockNumber: FB_BLOCK, status: 'success', logs: [feedbackLog({ agentId: AGENT, client: R1, index: 1n, hash: hex32(900), txHash: r0.txHash })] })
    setReceipt(hex32(900), {})
    await verifier().run()
    expect(await row()).toMatchObject({ feedbackHash: hex32(900), verified: true })
  })

  it('a legacy rating whose NewFeedback carried no hash becomes no_proof', async () => {
    await addService()
    await addFeedback({ client: R1, hash: null })
    await db.update(feedback).set({ verificationReason: null, nextVerifyAt: new Date(t0) })
    const r0 = await row()
    sim.receipts.set(r0.txHash as `0x${string}`, { blockNumber: FB_BLOCK, status: 'success', logs: [feedbackLog({ agentId: AGENT, client: R1, index: 1n, hash: hex32(0), txHash: r0.txHash })] })
    await verifier().run()
    expect(await row()).toMatchObject({ verified: false, verificationReason: 'no_proof', nextVerifyAt: null })
  })

  it('not_x402: an authorization by the rater that is not next to the paying transfer does not count', async () => {
    await addService()
    await addFeedback({ client: R1 })
    sim.receipts.set(hex32(900) as `0x${string}`, {
      blockNumber: 400n,
      status: 'success',
      logs: [transferLog({ from: R1, to: PAYTO, atomic: PRICE, txHash: hex32(900), logIndex: 0, block: 400n }), authLog({ authorizer: R1, txHash: hex32(900), logIndex: 9, block: 400n })],
    })
    await verifier().run()
    expect((await row()).verificationReason).toBe('not_x402')
  })

  it('below_minimum: a dust payment cannot back a review', async () => {
    await addService()
    await addFeedback({ client: R1 })
    setReceipt(hex32(900), { pays: [{ from: R1, to: PAYTO, atomic: 1n }] })
    await verifier().run()
    expect((await row()).verificationReason).toBe('below_minimum')
  })

  it('an RPC error counts as an attempt instead of stalling the queue', async () => {
    await addService()
    await addFeedback({ client: R1 })
    sim.getTransactionReceipt = async () => {
      throw new Error('429 rate limited')
    }
    await verifier().run()
    const r = await row()
    expect(r).toMatchObject({ verified: false, verificationReason: 'rpc_error', verifyAttempts: 1 })
    expect(r.nextVerifyAt!.getTime()).toBeGreaterThan(clock)
  })
})
