/** Shared data for the isolation, plan and contract tests: a full account, every table populated. */
import request from 'supertest'
import { feedback, onchainTransfers, services } from '../src/schema.js'
import { upsertTransfers } from '../src/workers/indexer.js'
import { authKey, derivePayments } from '../src/workers/payments.js'
import { createReconciler } from '../src/workers/reconciler.js'
import { eq } from 'drizzle-orm'
import { auth, BUYER, BUYER2, CAIP2, db, event, hex32, indexProvider, newAccount, newKey, signIn, USDC, type Harness } from './helpers.js'

export interface Seeded {
  account: ReturnType<typeof newAccount>
  address: string
  token: string
  key: string
  serviceKey: string
  /** Text that belongs to this provider alone: it must never appear in another's response. */
  markers: string[]
}

let n = 1000

export async function seedProvider(h: Harness, opts: { agentId?: bigint } = {}): Promise<Seeded> {
  const account = newAccount()
  const address = account.address.toLowerCase()
  const id = n++
  h.chain.register(account.address, { agentId: opts.agentId })
  await indexProvider(account.address, opts.agentId)
  const token = await signIn(h, account)
  const key = await newKey(h, token)
  const serviceKey = hex32(id, 'c')
  const payer = `0x${id.toString(16).padStart(40, 'b')}`
  const route = `/marker-route-${id}`
  const name = `marker-service-${id}`
  const onchainTx = hex32(id, 'd')
  h.chain.serviceOwners.set(serviceKey, address)

  await db.insert(services).values({
    key: serviceKey,
    provider: address,
    name,
    description: 'Current weather as JSON',
    tags: 'weather,demo',
    endpoint: 'https://weather.example.com',
    price: '0.01',
    network: 'avalanche',
    payTo: address,
    acceptsExact: true,
    acceptsGateway: false,
    createdBlock: 88_300_000n,
    updatedBlock: 88_300_000n,
  })

  // A payment the proxy reported, matched by the reconciler.
  const exact = event(account.address, { route, payer, serviceKey, ts: Date.now() - 60_000 })
  const failed = event(account.address, { route, payer: BUYER2, status: 'failed', txHash: undefined, error: 'insufficient_funds', amountAtomic: '10000', ts: Date.now() - 20_000 })
  await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [exact, failed] }).expect(200)
  await upsertTransfers(db, [
    { txHash: String(exact.txHash), logIndex: 2, block: 88_300_100n, blockTs: new Date(Date.now() - 60_000), from: payer, to: address, valueRaw: '10000', amountAtomic: '10000' },
    // A payment no proxy reported: the indexer reads it straight from the transfer.
    { txHash: onchainTx, logIndex: 4, block: 88_300_200n, blockTs: new Date(Date.now() - 30_000), from: BUYER, to: address, valueRaw: '10000', amountAtomic: '10000' },
  ])
  await createReconciler({ db, usdc: USDC, log: () => {} }).run()
  await derivePayments(db, await db.select().from(onchainTransfers).where(eq(onchainTransfers.txHash, onchainTx)), CAIP2, new Set([authKey(onchainTx, BUYER)]))

  await request(h.app)
    .post('/v1/ingest/heartbeat')
    .set(...auth(key))
    .send({
      serviceKey,
      version: '2.0.1',
      network: CAIP2,
      rails: ['exact'],
      doctor: { version: 1, ok: true, allGreen: true, score: { passed: 10, total: 10 }, checks: [] },
    })
    .expect(200)

  if (opts.agentId) {
    await db.insert(feedback).values({
      agentId: opts.agentId.toString(),
      client: BUYER,
      feedbackIndex: 1n,
      value: '95',
      valueDecimals: 0,
      tag1: 'x402',
      tag2: route,
      endpoint: 'https://weather.example.com',
      feedbackUri: '',
      block: 88_300_300n,
      blockTs: new Date(Date.now() - 10_000),
      txHash: hex32(id, 'e'),
      // Its x402 payment was verified, so it counts in the paid score.
      feedbackHash: onchainTx,
      verified: true,
      paymentTx: onchainTx,
      paidAtomic: '10000',
      paidTo: address,
    })
    // Unsolicited: BUYER2's only payment failed, so this must not count as a payer's rating.
    await db.insert(feedback).values({
      agentId: opts.agentId.toString(),
      client: BUYER2,
      feedbackIndex: 1n,
      value: '40',
      valueDecimals: 0,
      tag1: 'patrol',
      tag2: '',
      endpoint: '',
      feedbackUri: '',
      block: 88_300_301n,
      blockTs: new Date(Date.now() - 5_000),
      txHash: hex32(id, 'f'),
      verificationReason: 'no_proof',
    })
  }
  await request(h.app).put('/v1/me/wallets').set(...auth(token)).send({ wallets: [`0x${id.toString(16).padStart(40, 'f')}`] }).expect(200)

  return {
    account,
    address,
    token,
    key,
    serviceKey,
    markers: [address, account.address, payer, route, name, onchainTx, String(exact.txHash), String(exact.id), serviceKey, `0x${id.toString(16).padStart(40, 'f')}`],
  }
}
