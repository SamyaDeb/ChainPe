/** GET /v1/public/providers/:address/summary: allowlisted, aggregate-only, no session. Real Postgres and HTTP. */
import fs from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import request from 'supertest'
import { getAddress } from 'viem'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { eq } from 'drizzle-orm'
import { createApp } from '../src/app.js'
import { createProviderViews } from '../src/plan.js'
import { services } from '../src/schema.js'
import { createSessions } from '../src/session.js'
import { BUYER, BUYER2, CHAIN_ID, CLI_DOMAIN, DASH_DOMAIN, db, FakeChain, harness, newAccount, resetDb, SECRET } from './helpers.js'
import { seedProvider, type Seeded } from './seed.js'

const spec = parseYaml(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf-8'))
const ajv = new Ajv2020({ strict: false, allErrors: true })
;(addFormats as unknown as (a: unknown) => void)(ajv)
ajv.addSchema(spec, 'openapi')
const validate = ajv.compile({ $ref: 'openapi#/components/schemas/PublicProviderSummary' })

const OPEN = { nonce: 100_000, verify: 100_000, ingestKey: 100_000, ingestIp: 100_000, read: 100_000, public: 100_000, sampleProvider: 100_000 }

function sampleApp(allowlist: string[], sampleLimit = 100_000) {
  const chain = new FakeChain()
  return createApp({
    db,
    chain,
    views: createProviderViews(db, chain),
    sessions: createSessions(db, SECRET),
    corsOrigins: [`https://${DASH_DOMAIN}`],
    chainId: CHAIN_ID,
    dashboardDomain: DASH_DOMAIN,
    cliDomain: CLI_DOMAIN,
    limits: { ...OPEN, sampleProvider: sampleLimit },
    sampleProviders: allowlist,
  })
}

let sample: Seeded
let other: Seeded

beforeAll(async () => {
  await resetDb()
  const h = harness()
  sample = await seedProvider(h, { agentId: 4217n })
  other = await seedProvider(h, { agentId: 4218n })
  // The indexer stores each service's agentId; the seed leaves it out.
  await db.update(services).set({ agentId: '4217' }).where(eq(services.key, sample.serviceKey))
  await db.update(services).set({ agentId: '4218' }).where(eq(services.key, other.serviceKey))
})

const url = (address: string, range?: string) => `/v1/public/providers/${address}/summary${range ? `?range=${range}` : ''}`

describe('/v1/public/providers/:address/summary', () => {
  it('serves an allowlisted provider with no session, matching openapi.yaml', async () => {
    const app = sampleApp([sample.account.address])
    const { body } = await request(app).get(url(sample.account.address, 'all')).expect(200)
    expect(validate(body) ? [] : validate.errors).toEqual([])
    expect(body.address).toBe(getAddress(sample.address))
    expect(body.range).toBe('all')
    expect(body.services).toHaveLength(1)
    expect(body.services[0].key).toBe(sample.serviceKey)
    // Two verified payments of 0.01 (one reported by the proxy, one read from chain); the failed call is not revenue.
    expect(body.revenue.totalVerifiedAtomic).toBe('20000')
    expect(body.calls.failed).toBe(1)
    expect(body.calls.verified).toBe(2)
    expect(body.uniqueBuyers).toBe(2)
    // Paid score counts only the verified rating (95); raw averages it with the unpaid 40.
    expect(body.reputation).toEqual({ paidScore: 95, paidReviews: 1, rawScore: 67.5, rawReviews: 2 })
    expect(body.services[0]).toMatchObject({ agentId: '4217', paidScore: 95, paidReviews: 1, rawReviews: 2 })
    expect(body.series.points.length).toBeGreaterThan(0)
  })

  it('answers 404 for a valid address that is not on the allowlist, even a real provider', async () => {
    const app = sampleApp([sample.account.address])
    const res = await request(app).get(url(other.account.address)).expect(404)
    expect(res.body.error).toBe('not_found')
    await request(app).get(url(newAccount().address)).expect(404)
  })

  it('answers 404 for everyone when SAMPLE_PROVIDERS is empty', async () => {
    await request(sampleApp([])).get(url(sample.account.address)).expect(404)
  })

  it('accepts lowercase and checksummed input, refuses a bad checksum or a malformed address', async () => {
    const app = sampleApp([sample.address])
    await request(app).get(url(sample.address)).expect(200)
    await request(app).get(url(getAddress(sample.address))).expect(200)
    // Flip the case of one letter in a checksummed address: still hex, but the checksum no longer holds.
    const good = getAddress(sample.address)
    const i = [...good].findIndex((c, k) => k > 1 && /[a-fA-F]/.test(c))
    const flipped = good.slice(0, i) + (good[i] === good[i].toUpperCase() ? good[i].toLowerCase() : good[i].toUpperCase()) + good.slice(i + 1)
    expect((await request(app).get(url(flipped)).expect(400)).body.error).toBe('invalid_request')
    for (const bad of ['0x123', 'not-an-address', `0x${'g'.repeat(40)}`, `${sample.address}00`]) {
      await request(app).get(url(bad)).expect(400)
    }
    await request(app).get(`${url(sample.address)}?range=1y`).expect(400)
    await request(app).get(`${url(sample.address)}?range=7d&buyers=1`).expect(400)
  })

  it('returns aggregates only: no buyers, keys, wallets, routes or payment ids', async () => {
    const app = sampleApp([sample.address])
    const res = await request(app).get(url(sample.address, 'all')).expect(200)
    const text = res.text.toLowerCase()
    const [, , payer, route, , , exactTx, exactId, , wallet] = sample.markers
    for (const secret of [sample.key, sample.token, payer, route, exactTx, exactId, wallet, BUYER, BUYER2]) {
      expect(text).not.toContain(secret.toLowerCase())
    }
    for (const field of ['buyers', 'payer', 'payments', 'keys', 'wallets', 'doctor', 'heartbeat', 'notRevenue', 'selfPay']) {
      expect(res.text).not.toContain(`"${field}"`)
    }
    // Nothing from the other provider either.
    expect(text).not.toContain(other.address)
    expect(text).not.toContain(other.serviceKey)
  })

  it('is readable cross-origin from the landing site', async () => {
    const res = await request(sampleApp([sample.address])).get(url(sample.address)).set('Origin', 'https://chainpe.vercel.app').expect(200)
    expect(res.headers['access-control-allow-origin']).toBe('https://chainpe.vercel.app')
  })

  it('has its own rate limit, separate from the other public reads', async () => {
    const app = sampleApp([sample.address], 2)
    await request(app).get(url(sample.address)).expect(200)
    await request(app).get(url(sample.address)).expect(200)
    expect((await request(app).get(url(sample.address)).expect(429)).body.error).toBe('rate_limited')
    await request(app).get('/v1/public/stats').expect(200)
  })
})
