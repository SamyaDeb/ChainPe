/**
 * Avalanche has no paid plan: there is no account contract to subscribe on. Every provider gets
 * what Pro gave on Arc, and nothing answers plan_required or fees_due.
 */
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { services } from '../src/schema.js'
import { auth, db, harness, hex32, resetDb, type Harness } from './helpers.js'
import { seedProvider, type Seeded } from './seed.js'

let h: Harness
let s: Seeded

beforeAll(async () => {
  await resetDb()
  h = harness()
  s = await seedProvider(h, { agentId: 77n })
  // A second, inactive service: an Arc Free account would not see it.
  await db.insert(services).values({
    key: hex32(9, 'a'),
    provider: s.address,
    name: 'retired',
    endpoint: 'https://old.example.com',
    price: '0.02',
    network: 'avalanche',
    payTo: s.address,
    acceptsExact: true,
    acceptsGateway: false,
    active: false,
    createdBlock: 88_400_000n,
    updatedBlock: 88_400_001n,
  })
})

const get = (path: string) => request(h.app).get(path).set(...auth(s.token))

describe('every Avalanche provider gets the full view', () => {
  it('reports the plan as pro, with no paid period', async () => {
    const me = (await get('/v1/me').expect(200)).body
    expect(me).toMatchObject({ plan: 'pro', paidUntil: null, agentId: '77', agentIdStatus: 'owned' })
  })

  it.each(['24h', '7d', '30d', '90d', 'all'])('serves the %s range', async (range) => {
    await get(`/v1/me/summary?range=${range}`).expect(200)
    await get(`/v1/me/buyers?range=${range}`).expect(200)
  })

  it('lists every service, inactive ones included', async () => {
    const body = (await get('/v1/me/services').expect(200)).body
    expect(body.services).toHaveLength(2)
    expect(body.services.map((x: { active: boolean }) => x.active).sort()).toEqual([false, true])
    expect(body.truncated).toBe(false)
  })

  it('exports CSV and shows each review', async () => {
    const csv = await get('/v1/me/payments.csv').expect(200)
    expect(csv.text.split('\n')[0]).toContain('amount_usdc')
    const rep = (await get('/v1/me/reputation').expect(200)).body
    expect(rep.items).toHaveLength(2)
    expect(rep.payerCount).toBe(1)
  })

  it('counts both the proxy-reported and the chain-read payment as revenue', async () => {
    const summary = (await get('/v1/me/summary?range=all').expect(200)).body
    expect(summary.revenue.totalVerifiedAtomic).toBe('20000')
    expect(summary.uniqueBuyers).toBe(2)
    expect(summary.calls).toMatchObject({ total: 3, completed: 2, failed: 1, verified: 2 })
  })

  it('reports the usage fee as off', async () => {
    const fees = (await get('/v1/me/fees').expect(200)).body
    expect(fees).toMatchObject({ enabled: false, locked: false, rateBps: 0 })
  })

  it('keeps the full health history', async () => {
    expect((await get('/v1/me/health').expect(200)).body.latestOnly).toBe(false)
  })
})
