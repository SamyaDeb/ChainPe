import { eq, sql } from 'drizzle-orm'
import { SignJWT } from 'jose'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { ingestKeys, siweNonces } from '../src/schema.js'
import { hashKey } from '../src/session.js'
import { auth, CHAIN_ID, CLI_DOMAIN, DASH_DOMAIN, db, event, harness, newAccount, newKey, resetDb, SECRET, signIn, type Harness } from './helpers.js'

let h: Harness
beforeEach(async () => {
  await resetDb()
  h = harness()
})

async function challenge(address: string, client: 'dashboard' | 'cli' = 'dashboard') {
  const { body } = await request(h.app).post('/v1/auth/nonce').send({ address, client }).expect(200)
  return body as { nonce: string; message: string }
}

describe('SIWE sign-in', () => {
  it('issues a 12 h session bound to the checksummed address', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const { message } = await challenge(a.address)
    expect(message).toContain(`${DASH_DOMAIN} wants you to sign in`)
    expect(message).toContain(`Chain ID: ${CHAIN_ID}`)
    expect(message).toContain('Expiration Time:')
    const res = await request(h.app)
      .post('/v1/auth/verify')
      .send({ message, signature: await a.signMessage({ message }) })
      .expect(200)
    expect(res.body.address).toBe(a.address)
    expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(11.9 * 3600 * 1000)
    expect(res.headers['set-cookie']).toBeUndefined()
    await request(h.app).get('/v1/me').set(...auth(res.body.token)).expect(200)
  })

  it.each([
    ['wrong domain', (m: string) => m.replace(DASH_DOMAIN, 'evil.example')],
    ['wrong uri', (m: string) => m.replace(`URI: https://${DASH_DOMAIN}`, 'URI: https://evil.example')],
    ['wrong chain', (m: string) => m.replace(`Chain ID: ${CHAIN_ID}`, 'Chain ID: 1')],
  ])('refuses a %s with 401, even when correctly signed', async (_name, edit) => {
    const a = newAccount()
    h.chain.register(a.address)
    const { message } = await challenge(a.address)
    const edited = edit(message)
    expect(edited).not.toBe(message)
    const res = await request(h.app)
      .post('/v1/auth/verify')
      .send({ message: edited, signature: await a.signMessage({ message: edited }) })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_siwe')
  })

  it('refuses another address signing with this nonce', async () => {
    const a = newAccount()
    const b = newAccount()
    h.chain.register(a.address)
    h.chain.register(b.address)
    const { message } = await challenge(a.address)
    const edited = message.replace(a.address, b.address)
    const res = await request(h.app).post('/v1/auth/verify').send({ message: edited, signature: await b.signMessage({ message: edited }) })
    expect(res.status).toBe(401)
  })

  it('refuses an expired nonce with 401', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const { message } = await challenge(a.address)
    h.clock.offset = 5 * 60 * 1000 + 1000
    const res = await request(h.app).post('/v1/auth/verify').send({ message, signature: await a.signMessage({ message }) })
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/expired/i)
  })

  it('refuses a reused nonce with 401', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const { message } = await challenge(a.address)
    const signature = await a.signMessage({ message })
    await request(h.app).post('/v1/auth/verify').send({ message, signature }).expect(200)
    const res = await request(h.app).post('/v1/auth/verify').send({ message, signature })
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/nonce/i)
  })

  it('lets only one of two concurrent requests use a nonce', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const { message } = await challenge(a.address)
    const signature = await a.signMessage({ message })
    const results = await Promise.all([1, 2, 3].map(() => request(h.app).post('/v1/auth/verify').send({ message, signature })))
    expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401])
  })

  it('refuses a bad signature with 401, and burns the nonce', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const { message, nonce } = await challenge(a.address)
    const res = await request(h.app).post('/v1/auth/verify').send({ message, signature: await newAccount().signMessage({ message }) })
    expect(res.status).toBe(401)
    expect(await db.select().from(siweNonces).where(eq(siweNonces.nonce, nonce))).toEqual([])
  })

  it('gives an unregistered address 403 not_registered', async () => {
    const stranger = newAccount()
    const { message } = await challenge(stranger.address)
    const res = await request(h.app).post('/v1/auth/verify').send({ message, signature: await stranger.signMessage({ message }) })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('not_registered')
  })

  it('answers 503 when Arc cannot be read, never as not registered', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const { message } = await challenge(a.address)
    const signature = await a.signMessage({ message })
    h.chain.down = true
    const res = await request(h.app).post('/v1/auth/verify').send({ message, signature })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('chain_unavailable')
  })

  it('accepts a smart account through the ERC-1271 path (mocked)', async () => {
    const wallet = newAccount().address
    h.chain.register(wallet)
    h.chain.smartAccounts.add(wallet.toLowerCase())
    const { message } = await challenge(wallet)
    await request(h.app).post('/v1/auth/verify').send({ message, signature: '0xdeadbeef' }).expect(200)
  })

  it('issues the CLI its own domain, so a dashboard challenge cannot be relayed to a CLI', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const { message } = await challenge(a.address, 'cli')
    expect(message).toContain(`${CLI_DOMAIN} wants you to sign in`)
    expect(message).not.toContain(DASH_DOMAIN)
  })

  it('answers invalid bodies with 400 and a JSON error', async () => {
    const bad = await request(h.app).post('/v1/auth/nonce').send({ address: 'nope' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('invalid_request')
    const json = await request(h.app).post('/v1/auth/nonce').set('Content-Type', 'application/json').send('{bad')
    expect(json.status).toBe(400)
    expect(json.body.error).toBe('invalid_request')
  })
})

describe('sessions', () => {
  const forged = (alg: string, secret: string, sub: string) =>
    new SignJWT({})
      .setProtectedHeader({ alg })
      .setIssuer('chainpe-cloud')
      .setSubject(sub)
      .setJti('x')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

  it('requires a token', async () => {
    const res = await request(h.app).get('/v1/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('unauthorized')
  })

  it('refuses a token signed with another secret, or another algorithm', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    await request(h.app).get('/v1/me').set(...auth(await forged('HS256', 'x'.repeat(40), a.address))).expect(401)
    await request(h.app).get('/v1/me').set(...auth(await forged('HS512', SECRET + SECRET, a.address))).expect(401)
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: a.address, iss: 'chainpe-cloud', jti: 'x', exp: 9_999_999_999 })).toString('base64url')}.`
    await request(h.app).get('/v1/me').set(...auth(none)).expect(401)
  })

  it('refuses a token after 12 h', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const token = await signIn(h, a)
    h.clock.offset = 12 * 3600 * 1000 + 1000
    await request(h.app).get('/v1/me').set(...auth(token)).expect(401)
  })

  it('ends a session on logout', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const token = await signIn(h, a)
    await request(h.app).post('/v1/auth/logout').set(...auth(token)).expect(200)
    const res = await request(h.app).get('/v1/me').set(...auth(token))
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/ended/i)
  })

  it('lets the dashboard read Retry-After on a cross-origin 429', async () => {
    const res = await request(h.app).post('/v1/auth/nonce').set('Origin', 'https://app.chainpe.test').send({ address: newAccount().address })
    expect(res.headers['access-control-expose-headers']).toBe('Retry-After')
  })

  it('sends CORS headers only to the allowed origin, without credentials', async () => {
    const allowed = await request(h.app).get('/health').set('Origin', `https://${DASH_DOMAIN}`)
    expect(allowed.headers['access-control-allow-origin']).toBe(`https://${DASH_DOMAIN}`)
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined()
    const other = await request(h.app).get('/health').set('Origin', 'https://evil.example')
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('ingest keys', () => {
  it('shows a key once and stores only its SHA-256', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const token = await signIn(h, a)
    const key = await newKey(h, token)
    expect(key).toMatch(/^cpk_[\w-]{43}$/)
    const [row] = await db.select().from(ingestKeys)
    expect(row.keyHash).toBe(hashKey(key))
    const dump = await db.execute(sql`SELECT row_to_json(k)::text AS j FROM ingest_keys k`)
    expect(JSON.stringify(dump.rows)).not.toContain(key)
    const list = await request(h.app).get('/v1/keys').set(...auth(token)).expect(200)
    expect(JSON.stringify(list.body)).not.toContain(key)
    expect(list.body.keys[0].prefix).toBe(key.slice(0, 10))
  })

  it('stops a revoked key working', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const token = await signIn(h, a)
    const key = await newKey(h, token)
    await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [event(a.address)] }).expect(200)
    const [{ id }] = await db.select().from(ingestKeys)
    await request(h.app).delete(`/v1/keys/${id}`).set(...auth(token)).expect(200)
    await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [event(a.address)] }).expect(401)
    await request(h.app).delete(`/v1/keys/${id}`).set(...auth(token)).expect(404)
  })

  it('caps active keys at 10', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const token = await signIn(h, a)
    for (let i = 0; i < 10; i++) await newKey(h, token)
    const res = await request(h.app).post('/v1/keys').set(...auth(token)).send({})
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('too_many_keys')
  })

  it('keeps keys and sessions apart', async () => {
    const a = newAccount()
    h.chain.register(a.address)
    const token = await signIn(h, a)
    const key = await newKey(h, token)
    await request(h.app).get('/v1/me').set(...auth(key)).expect(401)
    await request(h.app).post('/v1/ingest/events').set(...auth(token)).send({ events: [event(a.address)] }).expect(401)
  })
})
