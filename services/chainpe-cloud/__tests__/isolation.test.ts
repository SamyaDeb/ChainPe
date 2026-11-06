import fs from 'node:fs'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { ingestKeys } from '../src/schema.js'
import { eq } from 'drizzle-orm'
import { auth, db, harness, resetDb, type Harness } from './helpers.js'
import { seedProvider, type Seeded } from './seed.js'

/** Every session-scoped read. A new route must be added here, which the last test enforces. */
const READS: { path: string; openapi?: string }[] = [
  { path: '/v1/me' },
  { path: '/v1/me/services' },
  { path: '/v1/me/summary?range=all', openapi: '/v1/me/summary' },
  { path: '/v1/me/payments' },
  { path: '/v1/me/payments.csv' },
  { path: '/v1/me/buyers' },
  { path: '/v1/me/reputation' },
  { path: '/v1/me/health' },
  { path: '/v1/me/wallets' },
  { path: '/v1/me/fees' },
  { path: '/v1/keys' },
]

let h: Harness
let a: Seeded
let b: Seeded

beforeAll(async () => {
  await resetDb()
  h = harness()
  a = await seedProvider(h, { pro: true, agentId: 11n })
  b = await seedProvider(h, { pro: true, agentId: 22n })
})

describe('provider isolation', () => {
  it.each(READS)('$path shows A only A, and B only B', async ({ path }) => {
    const asA = await request(h.app).get(path).set(...auth(a.token)).expect(200)
    const asB = await request(h.app).get(path).set(...auth(b.token)).expect(200)
    const textA = asA.text.toLowerCase()
    const textB = asB.text.toLowerCase()
    for (const marker of a.markers) expect(textB).not.toContain(marker.toLowerCase())
    for (const marker of b.markers) expect(textA).not.toContain(marker.toLowerCase())
  })

  it('actually returns data to its owner, so the checks above are not passing on empty responses', async () => {
    const payments = await request(h.app).get('/v1/me/payments').set(...auth(a.token)).expect(200)
    expect(payments.body.payments).toHaveLength(3)
    const summary = await request(h.app).get('/v1/me/summary?range=all').set(...auth(a.token)).expect(200)
    expect(summary.body.revenue.totalVerifiedAtomic).toBe('11000')
    const services = await request(h.app).get('/v1/me/services').set(...auth(a.token)).expect(200)
    expect(services.body.services).toHaveLength(1)
    const reputation = await request(h.app).get('/v1/me/reputation').set(...auth(a.token)).expect(200)
    expect(reputation.body).toMatchObject({ payerCount: 1, payerAverage: '95.00', allCount: 2, allAverage: '67.50' })
    const csv = await request(h.app).get('/v1/me/payments.csv').set(...auth(a.token)).expect(200)
    expect(csv.text.split('\n').length).toBeGreaterThan(3)
  })

  it('ignores any attempt to name another provider in the query', async () => {
    for (const query of [`provider=${a.address}`, `address=${a.address}`]) {
      const res = await request(h.app).get(`/v1/me/payments?${query}`).set(...auth(b.token))
      expect(res.status).toBe(400)
    }
  })

  it('does not let B revoke A\'s key', async () => {
    const [row] = await db.select().from(ingestKeys).where(eq(ingestKeys.provider, a.address))
    await request(h.app).delete(`/v1/keys/${row.id}`).set(...auth(b.token)).expect(404)
    const [after] = await db.select().from(ingestKeys).where(eq(ingestKeys.id, row.id))
    expect(after.revokedAt).toBeNull()
  })

  it('does not let B write into A with B\'s ingest key', async () => {
    const res = await request(h.app)
      .post('/v1/ingest/heartbeat')
      .set(...auth(b.key))
      .send({ serviceKey: a.serviceKey, version: '1', network: 'eip155:5042002', rails: [] })
    expect(res.status).toBe(403)
  })

  it('does not let a cursor reach across providers', async () => {
    const page = await request(h.app).get('/v1/me/payments?limit=1').set(...auth(a.token)).expect(200)
    const res = await request(h.app).get(`/v1/me/payments?cursor=${page.body.nextCursor}`).set(...auth(b.token)).expect(200)
    for (const marker of a.markers) expect(res.text.toLowerCase()).not.toContain(marker.toLowerCase())
  })

  it('covers every session-scoped GET in openapi.yaml', () => {
    const spec = parseYaml(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf-8'))
    const documented = Object.entries(spec.paths as Record<string, Record<string, { security?: { session?: unknown }[] }>>)
      .filter(([, ops]) => ops.get?.security?.some((s) => 'session' in s))
      .map(([path]) => path)
    const covered = READS.map((r) => r.openapi ?? r.path)
    expect(documented.sort()).toEqual([...covered].sort())
  })
})
