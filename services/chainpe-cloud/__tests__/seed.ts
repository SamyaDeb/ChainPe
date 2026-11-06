/** Shared data for the isolation and contract tests: a full account, every table populated. */
import request from 'supertest'
import { feedback, gatewayTransfers, services } from '../src/schema.js'
import { upsertTransfers } from '../src/workers/indexer.js'
import { createReconciler } from '../src/workers/reconciler.js'
import { auth, BUYER, BUYER2, CAIP2, db, event, hex32, newAccount, newKey, signIn, type Harness } from './helpers.js'

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

export async function seedProvider(h: Harness, opts: { pro?: boolean; agentId?: bigint } = {}): Promise<Seeded> {
  const account = newAccount()
  const address = account.address.toLowerCase()
  const id = n++
  h.chain.register(account.address, { pro: opts.pro, agentId: opts.agentId, paidUntil: opts.pro ? new Date(Date.now() + 30 * 86400_000) : undefined })
  const token = await signIn(h, account)
  const key = await newKey(h, token)
  const serviceKey = hex32(id, 'c')
  const payer = `0x${id.toString(16).padStart(40, 'b')}`
  const route = `/marker-route-${id}`
  const name = `marker-service-${id}`
  const transferId = `marker-transfer-${id}`
  h.chain.serviceOwners.set(serviceKey, address)

  await db.insert(services).values({
    key: serviceKey,
    provider: address,
    name,
    description: 'Current weather as JSON',
    tags: 'weather,demo',
    endpoint: 'https://weather.example.com',
    price: '0.01',
    network: CAIP2,
    payTo: address,
    acceptsExact: true,
    acceptsGateway: true,
    createdBlock: 70918700n,
    updatedBlock: 70918700n,
  })

  const exact = event(account.address, { route, payer, serviceKey, ts: Date.now() - 60_000 })
  const gateway = event(account.address, { route, payer: BUYER, rail: 'gateway', txHash: undefined, paymentId: transferId, amountAtomic: '1000', serviceKey, ts: Date.now() - 30_000 })
  const failed = event(account.address, { route, payer: BUYER2, status: 'failed', txHash: undefined, error: 'insufficient_funds', amountAtomic: '10000', ts: Date.now() - 20_000 })
  await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [exact, gateway, failed] }).expect(200)
  await upsertTransfers(db, [
    {
      txHash: String(exact.txHash),
      logIndex: 2,
      block: 70918800n,
      blockTs: new Date(Date.now() - 60_000),
      from: payer,
      to: address,
      valueRaw: '10000000000000000',
      amountAtomic: '10000',
    },
  ])
  await db.insert(gatewayTransfers).values({
    id: transferId,
    from: BUYER,
    to: address,
    amountAtomic: '1000',
    token: 'USDC',
    status: 'completed',
    network: CAIP2,
    txHash: hex32(id, 'd'),
    createdAt: new Date(Date.now() - 30_000),
    updatedAt: new Date(),
  })
  await createReconciler({ db, caip2: CAIP2, log: () => {} }).run()

  await request(h.app)
    .post('/v1/ingest/heartbeat')
    .set(...auth(key))
    .send({
      serviceKey,
      version: '3.0.0-arc.0',
      network: CAIP2,
      rails: ['exact', 'gateway'],
      gatewayBalanceAtomic: '1000',
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
      block: 70918900n,
      blockTs: new Date(Date.now() - 10_000),
      txHash: hex32(id, 'e'),
    })
  }
  await request(h.app).put('/v1/me/wallets').set(...auth(token)).send({ wallets: [`0x${id.toString(16).padStart(40, 'f')}`] }).expect(200)

  return {
    account,
    address,
    token,
    key,
    serviceKey,
    markers: [address, account.address, payer, route, name, transferId, String(exact.txHash), String(exact.id), serviceKey, `0x${id.toString(16).padStart(40, 'f')}`],
  }
}
