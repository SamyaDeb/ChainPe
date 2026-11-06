/**
 * Keeps openapi.yaml and fixtures/ exact, because the Phase 6 dashboard is built from
 * them: every live response is checked against the spec, and so is every fixture.
 * `npm run fixtures` regenerates the fixtures from real responses.
 */
import fs from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { eq } from 'drizzle-orm'
import { feeAccounts, feeAccruals, feeBatches } from '../src/schema.js'
import { auth, db, event, FEE_CONFIG, harness, newAccount, resetDb, type Harness } from './helpers.js'
import { seedProvider, type Seeded } from './seed.js'

const spec = parseYaml(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf-8'))
const FIXTURES = new URL('../fixtures/', import.meta.url)
const UPDATE = process.env.UPDATE_FIXTURES === '1'

const ajv = new Ajv2020({ strict: false, allErrors: true })
;(addFormats as unknown as (a: unknown) => void)(ajv)
ajv.addSchema(spec, 'openapi')

function check(schemaName: string, body: unknown): void {
  const validate = ajv.compile({ $ref: `openapi#/components/schemas/${schemaName}` })
  const ok = validate(body)
  expect(ok ? [] : validate.errors, schemaName).toEqual([])
}

/** The schema an operation documents for a status, so the test cannot drift from the spec. */
function schemaOf(path: string, method: string, status: number): string {
  const response = spec.paths[path]?.[method]?.responses?.[String(status)]
  expect(response, `${method} ${path} ${status} is documented`).toBeTruthy()
  const direct = response.content?.['application/json']?.schema?.$ref ?? (response.$ref ? spec.components.responses[response.$ref.split('/').pop()].content['application/json'].schema.$ref : undefined)
  expect(direct, `${method} ${path} ${status} has a JSON schema`).toBeTruthy()
  return direct.split('/').pop()
}

let h: Harness
let pro: Seeded
let free: Seeded
const seen: { name: string; schema: string; body: unknown }[] = []

const record = (name: string, schema: string, body: unknown) => {
  seen.push({ name, schema, body })
  check(schema, body)
}

async function call(name: string, path: string, method: 'get' | 'post' | 'put' | 'delete', status: number, opts: { url?: string; token?: string; body?: unknown } = {}) {
  let req = request(h.app)[method](opts.url ?? path)
  if (opts.token) req = req.set(...auth(opts.token))
  const res = await (opts.body === undefined ? req : req.send(opts.body as object))
  expect(res.status, `${name}: ${res.text.slice(0, 300)}`).toBe(status)
  record(name, schemaOf(path, method, status), res.body)
  return res
}

beforeAll(async () => {
  await resetDb()
  h = harness()
  pro = await seedProvider(h, { pro: true, agentId: 4217n })
  free = await seedProvider(h, { agentId: 4218n })
})

describe('every documented endpoint matches openapi.yaml', () => {
  it('auth', async () => {
    const account = newAccount()
    h.chain.register(account.address)
    const nonce = await call('auth-nonce', '/v1/auth/nonce', 'post', 200, { body: { address: account.address } })
    const signature = await account.signMessage({ message: nonce.body.message })
    const verify = await call('auth-verify', '/v1/auth/verify', 'post', 200, { body: { message: nonce.body.message, signature } })
    await call('auth-logout', '/v1/auth/logout', 'post', 200, { token: verify.body.token })

    const stranger = newAccount()
    const n2 = await call('auth-nonce-2', '/v1/auth/nonce', 'post', 200, { body: { address: stranger.address } })
    await call('error-not-registered', '/v1/auth/verify', 'post', 403, {
      body: { message: n2.body.message, signature: await stranger.signMessage({ message: n2.body.message }) },
    })
    await call('error-invalid-siwe', '/v1/auth/verify', 'post', 401, { body: { message: n2.body.message, signature: '0x00' } })
  })

  it('keys', async () => {
    const created = await call('keys-create', '/v1/keys', 'post', 201, { token: pro.token, body: { name: 'railway-demo' } })
    await call('keys-list', '/v1/keys', 'get', 200, { token: pro.token })
    await call('keys-revoke', '/v1/keys/{id}', 'delete', 200, { url: `/v1/keys/${created.body.id}`, token: pro.token })
  })

  it('ingest', async () => {
    await call('ingest-events', '/v1/ingest/events', 'post', 200, { token: pro.key, body: { events: [event(pro.account.address)] } })
    await call('error-pay-to-mismatch', '/v1/ingest/events', 'post', 403, { token: pro.key, body: { events: [event(newAccount().address)] } })
    await call('ingest-heartbeat', '/v1/ingest/heartbeat', 'post', 200, {
      token: pro.key,
      body: { serviceKey: pro.serviceKey, version: '3.0.0', network: 'eip155:5042002', rails: ['exact'] },
    })
  })

  it('me, on Pro', async () => {
    await call('me-pro', '/v1/me', 'get', 200, { token: pro.token })
    await call('services-pro', '/v1/me/services', 'get', 200, { token: pro.token })
    await call('summary-pro', '/v1/me/summary', 'get', 200, { url: '/v1/me/summary?range=30d', token: pro.token })
    await call('summary-24h', '/v1/me/summary', 'get', 200, { url: '/v1/me/summary?range=24h', token: pro.token })
    await call('payments-pro', '/v1/me/payments', 'get', 200, { token: pro.token })
    await call('buyers-pro', '/v1/me/buyers', 'get', 200, { token: pro.token })
    await call('reputation-pro', '/v1/me/reputation', 'get', 200, { token: pro.token })
    await call('health-pro', '/v1/me/health', 'get', 200, { token: pro.token })
    await call('wallets', '/v1/me/wallets', 'get', 200, { token: pro.token })
    await call('wallets-put', '/v1/me/wallets', 'put', 200, { token: free.token, body: { wallets: [] } })
  })

  it('me, on Free', async () => {
    await call('me-free', '/v1/me', 'get', 200, { token: free.token })
    await call('services-free', '/v1/me/services', 'get', 200, { token: free.token })
    await call('summary-free', '/v1/me/summary', 'get', 200, { url: '/v1/me/summary?range=7d', token: free.token })
    await call('error-plan-required', '/v1/me/summary', 'get', 403, { url: '/v1/me/summary?range=30d', token: free.token })
    await call('buyers-free', '/v1/me/buyers', 'get', 200, { token: free.token })
    await call('reputation-free', '/v1/me/reputation', 'get', 200, { token: free.token })
    await call('health-free', '/v1/me/health', 'get', 200, { token: free.token })
    const csv = await request(h.app).get('/v1/me/payments.csv').set(...auth(free.token))
    expect(csv.status).toBe(403)
  })

  it('fees', async () => {
    await call('fees-disabled', '/v1/me/fees', 'get', 200, { token: free.token })
    const withFees = harness(undefined, FEE_CONFIG)
    const seller = await seedProvider(withFees, {})
    withFees.feeChain.allowances.set(seller.address, 20_000_000n)
    const at = new Date('2026-11-06T10:00:00.000Z')
    await db.insert(feeAccounts).values({ provider: seller.address, enrolledAt: at })
    const batchId = `0x${'b'.repeat(64)}`
    await db.insert(feeBatches).values({ id: batchId, provider: seller.address, revenueAtomic: '100000000', feeAtomic: '1000000', status: 'collected', txHash: `0x${'c'.repeat(64)}`, createdAt: at, updatedAt: at })
    await db.insert(feeAccruals).values([
      { provider: seller.address, eventId: 'fixture-collected', revenueAtomic: '100000000', feeBps: 100, feeAtomic: '1000000', accruedAt: at, batchId },
      { provider: seller.address, eventId: 'fixture-owed', revenueAtomic: '25000000', feeBps: 100, feeAtomic: '250000', accruedAt: at },
    ])
    const res = await request(withFees.app).get('/v1/me/fees').set(...auth(seller.token)).expect(200)
    record('fees-active', schemaOf('/v1/me/fees', 'get', 200), res.body)
    await db.update(feeAccruals).set({ feeAtomic: '5000000' }).where(eq(feeAccruals.eventId, 'fixture-owed'))
    const locked = await request(withFees.app).get('/v1/me/payments').set(...auth(seller.token)).expect(403)
    record('error-fees-due', 'Error', locked.body)
  })

  it('health', async () => {
    const res = await request(h.app).get('/health').expect(200)
    check('Health', res.body)
  })

  it('documents every route the app answers', () => {
    const routes = Object.keys(spec.paths)
    for (const needed of ['/v1/auth/nonce', '/v1/auth/verify', '/v1/auth/logout', '/v1/keys', '/v1/keys/{id}', '/v1/ingest/events', '/v1/ingest/heartbeat', '/v1/me', '/v1/me/services', '/v1/me/summary', '/v1/me/payments', '/v1/me/payments.csv', '/v1/me/buyers', '/v1/me/reputation', '/v1/me/health', '/v1/me/wallets']) {
      expect(routes).toContain(needed)
    }
  })
})

describe('fixtures', () => {
  /** Real values that must not sit in a repo, even when they are from a test secret. */
  function scrub(name: string, body: unknown): unknown {
    const copy = JSON.parse(JSON.stringify(body))
    if (name === 'auth-verify') copy.token = 'eyJhbGciOiJIUzI1NiJ9.EXAMPLE.EXAMPLE'
    if (name === 'keys-create') copy.key = 'cpk_EXAMPLE_shown_once_only_its_hash_is_stored_0000'
    return copy
  }

  it('match openapi.yaml', async () => {
    if (UPDATE) {
      for (const { name, body } of seen) {
        if (/^(auth-nonce-2)$/.test(name)) continue
        fs.writeFileSync(new URL(`${name}.json`, FIXTURES), `${JSON.stringify(scrub(name, body), null, 2)}\n`)
      }
      const csv = await request(h.app).get('/v1/me/payments.csv').set(...auth(pro.token)).expect(200)
      fs.writeFileSync(new URL('payments.csv', FIXTURES), csv.text)
    }
    const byName = new Map(seen.map((s) => [s.name, s.schema]))
    const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(20)
    for (const file of files) {
      const name = file.replace(/\.json$/, '')
      const schema = byName.get(name)
      expect(schema, `${file} corresponds to a tested response`).toBeTruthy()
      check(schema!, JSON.parse(fs.readFileSync(new URL(file, FIXTURES), 'utf-8')))
    }
  })
})
