import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { gatewayTransfers } from '../src/schema.js'
import { createGatewayApi, createGatewayPoller } from '../src/workers/gatewayPoller.js'
import { auth, BUYER, CAIP2, db, event, harness, newAccount, newKey, resetDb, signIn } from './helpers.js'

/** The shape Circle really returned on 2026-11-06 (see spec 08a), with lowercase addresses. */
const record = (id: string, to: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: 'received',
  token: 'USDC',
  sendingNetwork: CAIP2,
  recipientNetwork: CAIP2,
  fromAddress: BUYER,
  toAddress: to,
  amount: '1000',
  nonce: `0x${'1'.repeat(64)}`,
  txHash: null,
  createdAt: '2026-11-05T20:25:28.078Z',
  updatedAt: '2026-11-05T20:26:03.139Z',
  ...overrides,
})

function fakeFetch(routes: (url: URL) => { status?: number; body: unknown; link?: string }) {
  const seen: URL[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    seen.push(url)
    const { status = 200, body, link } = routes(url)
    return new Response(JSON.stringify(body), { status, headers: link ? { link } : {} })
  }) as typeof fetch
  return { impl, seen }
}

let seller: ReturnType<typeof newAccount>
let provider: string

async function ingest(events: unknown[]) {
  const h = harness()
  h.chain.register(seller.address)
  const key = await newKey(h, await signIn(h, seller))
  await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events }).expect(200)
}

beforeEach(async () => {
  await resetDb()
  seller = newAccount()
  provider = seller.address.toLowerCase()
})

const gw = (paymentId: string) => event(seller.address, { rail: 'gateway', txHash: undefined, paymentId, amountAtomic: '1000' })

describe('Gateway poller', () => {
  it('polls by recipient, narrowed to this network and USDC, and stores the record', async () => {
    await ingest([gw('t-1')])
    const { impl, seen } = fakeFetch(() => ({ body: { transfers: [record('t-1', provider)] } }))
    await createGatewayPoller({ db, api: createGatewayApi('https://gw.test/', CAIP2, impl) }).run()
    const [row] = await db.select().from(gatewayTransfers)
    expect(row).toMatchObject({ id: 't-1', to: provider, from: BUYER, amountAtomic: '1000', status: 'received', network: CAIP2 })
    const url = seen[0]
    expect(url.pathname).toBe('/v1/x402/transfers')
    expect(url.searchParams.get('to')).toBe(provider)
    expect(url.searchParams.get('network')).toBe(CAIP2)
    expect(url.searchParams.get('token')).toBe('USDC')
  })

  it('follows pages through the Link header', async () => {
    await ingest([gw('t-2')])
    const { impl, seen } = fakeFetch((url) =>
      url.searchParams.get('pageAfter')
        ? { body: { transfers: [record('t-2', provider)] } }
        : { body: { transfers: [record('t-1', provider)] }, link: '<https://gw.test/v1/x402/transfers?pageAfter=abc>; rel="next"' }
    )
    await createGatewayPoller({ db, api: createGatewayApi('https://gw.test', CAIP2, impl) }).run()
    expect(seen[1].searchParams.get('pageAfter')).toBe('abc')
    expect(await db.select().from(gatewayTransfers)).toHaveLength(2)
  })

  it('updates a record when its status changes', async () => {
    await ingest([gw('t-1')])
    let status = 'received'
    const { impl } = fakeFetch(() => ({ body: { transfers: [record('t-1', provider, { status, txHash: status === 'completed' ? `0x${'A'.repeat(64)}` : null })] } }))
    const poller = createGatewayPoller({ db, api: createGatewayApi('https://gw.test', CAIP2, impl) })
    await poller.run()
    status = 'completed'
    await poller.run()
    const rows = await db.select().from(gatewayTransfers)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'completed', txHash: `0x${'a'.repeat(64)}` })
  })

  it('looks up by id when the list did not return the transfer, and encodes the id', async () => {
    await ingest([gw('t-9')])
    const { impl, seen } = fakeFetch((url) =>
      url.pathname.endsWith('/t-9') ? { body: record('t-9', provider, { status: 'failed' }) } : { body: { transfers: [] } }
    )
    await createGatewayPoller({ db, api: createGatewayApi('https://gw.test', CAIP2, impl) }).run()
    expect(seen.map((u) => u.pathname)).toContain('/v1/x402/transfers/t-9')
    expect((await db.select().from(gatewayTransfers))[0].status).toBe('failed')
  })

  it('treats a 404 by id as not there yet', async () => {
    await ingest([gw('t-9')])
    const { impl } = fakeFetch((url) => (url.pathname.endsWith('/t-9') ? { status: 404, body: {} } : { body: { transfers: [] } }))
    await createGatewayPoller({ db, api: createGatewayApi('https://gw.test', CAIP2, impl) }).run()
    expect(await db.select().from(gatewayTransfers)).toEqual([])
  })

  it('survives a Circle error and logs it, storing nothing', async () => {
    await ingest([gw('t-1')])
    const logs: string[] = []
    const { impl } = fakeFetch(() => ({ status: 500, body: { message: 'down' } }))
    await createGatewayPoller({ db, api: createGatewayApi('https://gw.test', CAIP2, impl), log: (m) => logs.push(m) }).run()
    expect(logs.length).toBeGreaterThan(0)
    expect(await db.select().from(gatewayTransfers)).toEqual([])
  })

  it('skips a record with an unexpected shape, and reports it', async () => {
    await ingest([gw('t-1')])
    const logs: string[] = []
    const { impl } = fakeFetch(() => ({ body: { transfers: [record('t-1', provider, { amount: 1000 })] } }))
    await createGatewayPoller({ db, api: createGatewayApi('https://gw.test', CAIP2, impl), log: (m) => logs.push(m) }).run()
    expect(logs.join()).toMatch(/unexpected shape/)
    expect(await db.select().from(gatewayTransfers)).toEqual([])
  })

  it('does nothing without Gateway events', async () => {
    await ingest([event(seller.address)])
    const { impl, seen } = fakeFetch(() => ({ body: { transfers: [] } }))
    await createGatewayPoller({ db, api: createGatewayApi('https://gw.test', CAIP2, impl) }).run()
    expect(seen).toEqual([])
  })
})
