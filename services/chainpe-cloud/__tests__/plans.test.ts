import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { feedback, heartbeats, paymentEvents, services } from '../src/schema.js'
import { upsertTransfers, createIndexer } from '../src/workers/indexer.js'
import { createReconciler } from '../src/workers/reconciler.js'
import { csvCell } from '../src/routes/me.js'
import { ACCOUNTS, auth, BUYER, CAIP2, db, event, eventLog, harness, hex32, newAccount, newKey, REPUTATION, resetDb, signIn, SimChain, type Harness } from './helpers.js'

let h: Harness
let seller: ReturnType<typeof newAccount>
let address: string
let token: string
let key: string

beforeEach(async () => {
  await resetDb()
  h = harness()
  seller = newAccount()
  address = seller.address.toLowerCase()
  h.chain.register(seller.address)
  token = await signIn(h, seller)
  key = await newKey(h, token)
})

const get = (path: string) => request(h.app).get(path).set(...auth(token))
const makePro = () => {
  h.chain.plans.set(address, 1)
  h.views.invalidate(address)
}

async function expectPlanRequired(path: string): Promise<void> {
  const res = await get(path)
  expect(res.status).toBe(403)
  expect(res.body.error).toBe('plan_required')
  expect(res.body.message).toBeTruthy()
}

/** Revenue from `count` distinct buyers, each transfer on-chain. */
async function seedBuyers(count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    const payer = `0x${i.toString(16).padStart(40, 'a')}`
    const e = event(seller.address, { payer, amountAtomic: String(i * 10_000) })
    await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [e] }).expect(200)
    await upsertTransfers(db, [
      {
        txHash: String(e.txHash),
        logIndex: 0,
        block: 1n,
        blockTs: new Date(),
        from: payer,
        to: address,
        valueRaw: `${i * 10_000}000000000000`,
        amountAtomic: String(i * 10_000),
      },
    ])
  }
  await createReconciler({ db, caip2: CAIP2, log: () => {} }).run()
}

describe('Free', () => {
  it.each(['30d', '90d', 'all'])('refuses summary range=%s with plan_required', async (range) => {
    await expectPlanRequired(`/v1/me/summary?range=${range}`)
  })

  it.each(['24h', '7d'])('allows summary range=%s', async (range) => {
    await get(`/v1/me/summary?range=${range}`).expect(200)
  })

  it('refuses CSV and buyers beyond the window', async () => {
    await expectPlanRequired('/v1/me/payments.csv')
    await expectPlanRequired('/v1/me/buyers?range=30d')
  })

  it('sees payments from the last 7 days only', async () => {
    const recent = event(seller.address)
    const old = event(seller.address, { ts: Date.now() - 8 * 86400_000 })
    await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [recent, old] }).expect(200)
    const res = await get('/v1/me/payments').expect(200)
    expect(res.body.payments.map((p: { id: string }) => p.id)).toEqual([recent.id])
    makePro()
    expect((await get('/v1/me/payments').expect(200)).body.payments).toHaveLength(2)
  })

  it('sees the top 5 buyers, by spend', async () => {
    await seedBuyers(7)
    const res = await get('/v1/me/buyers').expect(200)
    expect(res.body.buyers).toHaveLength(5)
    expect(res.body.truncated).toBe(true)
    expect(res.body.totalBuyers).toBe(7)
    expect(res.body.buyers[0].spendAtomic).toBe('70000')
    makePro()
    const pro = await get('/v1/me/buyers').expect(200)
    expect(pro.body.buyers).toHaveLength(7)
    expect(pro.body.truncated).toBe(false)
  })

  it('sees one service, the oldest active', async () => {
    const base = { provider: address, description: '', tags: '', endpoint: 'https://a.example', price: '0.01', network: CAIP2, payTo: address, acceptsExact: true, acceptsGateway: true, updatedBlock: 1n }
    await db.insert(services).values([
      { ...base, key: hex32(1), name: 'gone', active: false, createdBlock: 1n },
      { ...base, key: hex32(2), name: 'old', createdBlock: 2n },
      { ...base, key: hex32(3), name: 'new', createdBlock: 3n },
    ])
    const free = await get('/v1/me/services').expect(200)
    expect(free.body.services.map((s: { name: string }) => s.name)).toEqual(['old'])
    expect(free.body.truncated).toBe(true)
    makePro()
    expect((await get('/v1/me/services').expect(200)).body.services).toHaveLength(3)
  })

  it('sees the average ratings only, with no review list', async () => {
    h.chain.register(seller.address, { agentId: 7n })
    h.views.invalidate(address)
    const row = { agentId: '7', client: BUYER, valueDecimals: 0, block: 1n, blockTs: new Date(), txHash: hex32(1) }
    await db.insert(feedback).values([
      { ...row, feedbackIndex: 1n, value: '80' },
      { ...row, feedbackIndex: 2n, value: '100' },
      { ...row, feedbackIndex: 3n, value: '0', revoked: true },
      { ...row, feedbackIndex: 4n, value: '905', valueDecimals: 1 },
    ])
    const free = await get('/v1/me/reputation').expect(200)
    expect(free.body).toMatchObject({ agentId: '7', allAverage: '90.17', allCount: 3, payerAverage: null, payerCount: 0, items: null })
    makePro()
    const pro = await get('/v1/me/reputation').expect(200)
    expect(pro.body.items).toHaveLength(3)
  })

  describe('reputation by payer', () => {
    const stranger = '0x00000000000000000000000000000000000000e8'
    const selfWallet = '0x00000000000000000000000000000000000000f1'
    const pay = (id: string, payer: string, verification: 'verified' | 'unverified' | 'failed', selfPay = false, provider = address) =>
      db.insert(paymentEvents).values({
        provider,
        id,
        ts: new Date(),
        effectiveTs: new Date(),
        route: '/weather',
        method: 'GET',
        rail: 'exact',
        network: CAIP2,
        amountAtomic: '10000',
        payer,
        payTo: provider,
        status: 'completed',
        latencyMs: 1,
        verification,
        selfPay,
      })
    const rate = (feedbackIndex: bigint, client: string, value: string) =>
      db.insert(feedback).values({ agentId: '7', client, feedbackIndex, value, valueDecimals: 0, block: feedbackIndex, blockTs: new Date(), txHash: hex32(Number(feedbackIndex)) })

    beforeEach(() => {
      h.chain.register(seller.address, { agentId: 7n })
      h.views.invalidate(address)
    })

    it('leads with paying wallets, and leaves out an unsolicited rating', async () => {
      await pay('chainpe_1', BUYER.toLowerCase(), 'verified')
      await rate(1n, BUYER.toLowerCase(), '100')
      await rate(2n, stranger, '80')
      const free = await get('/v1/me/reputation').expect(200)
      expect(free.body).toMatchObject({ payerAverage: '100.00', payerCount: 1, allAverage: '90.00', allCount: 2, items: null })
      makePro()
      const pro = await get('/v1/me/reputation').expect(200)
      const flags = Object.fromEntries(pro.body.items.map((i: { client: string; fromPayer: boolean }) => [i.client.toLowerCase(), i.fromPayer]))
      expect(flags).toEqual({ [BUYER.toLowerCase()]: true, [stranger]: false })
    })

    it('does not count an unverified or failed payment, self-pay, or a payment to someone else', async () => {
      const other = '0x00000000000000000000000000000000000000d1'
      const another = '0x00000000000000000000000000000000000000d2'
      const elsewhere = '0x00000000000000000000000000000000000000d3'
      await pay('chainpe_1', other, 'unverified')
      await pay('chainpe_2', another, 'failed')
      await pay('chainpe_3', selfWallet, 'verified', true)
      await pay('chainpe_4', elsewhere, 'verified', false, '0x00000000000000000000000000000000000000c1')
      await rate(1n, other, '10')
      await rate(2n, another, '20')
      await rate(3n, selfWallet, '100')
      await rate(4n, elsewhere, '30')
      const res = await get('/v1/me/reputation').expect(200)
      expect(res.body).toMatchObject({ payerAverage: null, payerCount: 0, allCount: 4 })
    })
  })

  it('sees the latest health only', async () => {
    const base = { serviceKey: hex32(1), provider: address, version: '1', network: CAIP2, rails: ['exact'] }
    const doctorJson = { ok: true, score: { passed: 1, total: 1 } }
    await db.insert(heartbeats).values([
      { ...base, ts: new Date(Date.now() - 1000), version: 'old', doctorJson },
      { ...base, ts: new Date(), version: 'new', doctorJson },
    ])
    const free = await get('/v1/me/health').expect(200)
    expect(free.body.history.map((b: { version: string }) => b.version)).toEqual(['new'])
    expect(free.body.latestOnly).toBe(true)
    makePro()
    expect((await get('/v1/me/health').expect(200)).body.history).toHaveLength(2)
  })
})

describe('doctor results', () => {
  const key = hex32(1)
  const insert = () =>
    db.insert(services).values({ key, provider: address, name: 'demo', description: '', tags: '', endpoint: 'https://a.example', price: '0.01', network: CAIP2, payTo: address, acceptsExact: true, acceptsGateway: true, createdBlock: 1n, updatedBlock: 1n })

  it('survive a later heartbeat with no report, as a proxy in a container sends', async () => {
    await insert()
    const beat = { serviceKey: key, provider: address, version: '1', network: CAIP2, rails: ['exact'] }
    await db.insert(heartbeats).values([
      { ...beat, ts: new Date(Date.now() - 60_000), doctorJson: { ok: true, score: { passed: 11, total: 11 } } },
      { ...beat, ts: new Date(), gatewayBalanceAtomic: '4500' },
    ])
    const [service] = (await get('/v1/me/services').expect(200)).body.services
    expect(service.doctor).toEqual({ ok: true, passed: 11, total: 11 })
    expect(service.gatewayBalanceAtomic).toBe('4500')
    const { history } = (await get('/v1/me/health').expect(200)).body
    expect(history).toHaveLength(1)
    expect(history[0].doctor.score.passed).toBe(11)
  })

  it('are null when doctor has never reported', async () => {
    await insert()
    await db.insert(heartbeats).values({ serviceKey: key, provider: address, version: '1', network: CAIP2, rails: [] })
    expect((await get('/v1/me/services').expect(200)).body.services[0].doctor).toBeNull()
    expect((await get('/v1/me/health').expect(200)).body.history).toEqual([])
  })
})

describe('Pro', () => {
  it.each(['24h', '7d', '30d', '90d', 'all'])('allows summary range=%s', async (range) => {
    makePro()
    await get(`/v1/me/summary?range=${range}`).expect(200)
  })

  it('exports CSV with formula cells neutralised', async () => {
    makePro()
    const e = event(seller.address, { route: '=HYPERLINK("http://evil")', amountAtomic: '1500000' })
    await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [e] }).expect(200)
    const res = await get('/v1/me/payments.csv').expect(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(res.text).toContain('"1.500000"')
    expect(csvCell('@x')).toBe(`"'@x"`)
    expect(csvCell('-1')).toBe(`"'-1"`)
    expect(csvCell(null)).toBe('""')
  })

  it('paginates the CSV past one page without repeating a row', async () => {
    makePro()
    const now = new Date()
    await db.insert(paymentEvents).values(
      Array.from({ length: 1005 }, (_, i) => ({
        provider: address,
        id: `chainpe_${i.toString(16).padStart(48, '0')}`,
        ts: now,
        effectiveTs: now,
        route: '/x',
        method: 'GET',
        rail: 'exact' as const,
        network: CAIP2,
        amountAtomic: '1',
        payer: BUYER,
        payTo: address,
        status: 'completed' as const,
        latencyMs: 1,
      }))
    )
    const res = await get('/v1/me/payments.csv').expect(200)
    const lines = res.text.trim().split('\n').slice(1)
    expect(lines).toHaveLength(1005)
    expect(new Set(lines).size).toBe(1005)
  })
})

describe('paging', () => {
  it('walks every payment exactly once', async () => {
    const events = Array.from({ length: 5 }, (_, i) => event(seller.address, { ts: Date.now() - i * 1000 }))
    await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events }).expect(200)
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const res: request.Response = await get(`/v1/me/payments?limit=2${cursor ? `&cursor=${cursor}` : ''}`).expect(200)
      seen.push(...res.body.payments.map((p: { id: string }) => p.id))
      cursor = res.body.nextCursor
    } while (cursor)
    expect(seen).toEqual(events.map((e) => e.id))
  })

  it('refuses a malformed cursor', async () => {
    const res = await get('/v1/me/payments?cursor=@@@')
    expect(res.status).toBe(400)
  })

  it('filters by rail, route and verification', async () => {
    const a = event(seller.address, { route: '/a' })
    const b = event(seller.address, { route: '/b', rail: 'gateway', txHash: undefined, paymentId: 't-1' })
    await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [a, b] }).expect(200)
    expect((await get('/v1/me/payments?rail=gateway').expect(200)).body.payments[0].id).toBe(b.id)
    expect((await get('/v1/me/payments?route=/a').expect(200)).body.payments[0].id).toBe(a.id)
    expect((await get('/v1/me/payments?verification=verified').expect(200)).body.payments).toEqual([])
  })
})

describe('plan changes', () => {
  it('flips at once when the indexer sees Subscribed, not after the 60 s cache', async () => {
    const indexer = createIndexer({
      db,
      rpc: (() => {
        const sim = new SimChain()
        sim.head = 200n
        sim.logs = [
          eventLog(ACCOUNTS, 'ProviderRegistered', { provider: address, agentId: 0n }, 100n),
          eventLog(ACCOUNTS, 'Subscribed', { provider: address, periods: 1, amount: 1_000_000n, paidUntil: BigInt(Math.floor(Date.now() / 1000) + 86400) }, 101n),
        ]
        return sim
      })(),
      accounts: ACCOUNTS,
      reputation: REPUTATION,
      startBlock: 1n,
      onSubscribed: (p) => h.views.invalidate(p),
    })
    await expectPlanRequired('/v1/me/summary?range=30d') // caches Free
    h.chain.plans.set(address, 1)
    await expectPlanRequired('/v1/me/summary?range=30d') // the cache still says Free
    await indexer.step()
    await get('/v1/me/summary?range=30d').expect(200)
  })

  it('caches planOf for 60 s, then reads again', async () => {
    await get('/v1/me').expect(200)
    h.chain.plans.set(address, 1)
    expect((await get('/v1/me').expect(200)).body.plan).toBe('free')
    h.clock.offset = 61_000
    expect((await get('/v1/me').expect(200)).body.plan).toBe('pro')
  })

  it('downgrades when Pro lapses, and keeps the data', async () => {
    makePro()
    const e = event(seller.address, { ts: Date.now() - 8 * 86400_000 })
    await request(h.app).post('/v1/ingest/events').set(...auth(key)).send({ events: [e] }).expect(200)
    h.chain.plans.set(address, 0)
    h.views.invalidate(address)
    expect((await get('/v1/me/payments').expect(200)).body.payments).toEqual([])
    makePro()
    expect((await get('/v1/me/payments').expect(200)).body.payments).toHaveLength(1)
  })

  it('does not downgrade a paying provider during an RPC outage', async () => {
    const indexer = createIndexer({
      db,
      rpc: (() => {
        const sim = new SimChain()
        sim.head = 200n
        sim.logs = [
          eventLog(ACCOUNTS, 'ProviderRegistered', { provider: address, agentId: 0n }, 100n),
          eventLog(ACCOUNTS, 'Subscribed', { provider: address, periods: 1, amount: 1_000_000n, paidUntil: BigInt(Math.floor(Date.now() / 1000) + 86400) }, 101n),
        ]
        return sim
      })(),
      accounts: ACCOUNTS,
      reputation: REPUTATION,
      startBlock: 1n,
    })
    await indexer.step()
    h.chain.down = true
    h.views.invalidate(address)
    expect((await get('/v1/me').expect(200)).body.plan).toBe('pro')
    await get('/v1/me/summary?range=30d').expect(200)
  })
})

describe('agentId staleness (review L-1)', () => {
  const addFeedback = () =>
    db.insert(feedback).values({ agentId: '7', client: BUYER, feedbackIndex: 1n, value: '95', valueDecimals: 0, block: 1n, blockTs: new Date(), txHash: hex32(1) })

  it('shows reputation while the provider owns the token, and hides it once transferred', async () => {
    h.chain.register(seller.address, { agentId: 7n })
    h.views.invalidate(address)
    await addFeedback()
    expect((await get('/v1/me/reputation').expect(200)).body).toMatchObject({ agentIdStatus: 'owned', allAverage: '95.00', allCount: 1 })

    h.chain.owners.set('7', newAccount().address.toLowerCase())
    h.clock.offset = 61_000 // the ownerOf cache lapses
    const stale = (await get('/v1/me/reputation').expect(200)).body
    expect(stale).toMatchObject({ agentId: null, agentIdStatus: 'not_owner', payerAverage: null, payerCount: 0, allAverage: null, allCount: 0 })
    expect((await get('/v1/me').expect(200)).body).toMatchObject({ agentId: null, agentIdStatus: 'not_owner' })
  })

  it('reports unknown, not "no ratings", when ownership cannot be read', async () => {
    h.chain.register(seller.address, { agentId: 7n })
    h.views.invalidate(address)
    await addFeedback()
    h.chain.ownerOf = async () => {
      throw new Error('RPC unreachable')
    }
    const res = (await get('/v1/me/reputation').expect(200)).body
    expect(res).toMatchObject({ agentIdStatus: 'unknown', payerAverage: null, allAverage: null })
  })

  it('reports none with no agentId', async () => {
    expect((await get('/v1/me/reputation').expect(200)).body).toMatchObject({ agentIdStatus: 'none', agentId: null })
  })

  it('reports not_owner for a token that no longer exists', async () => {
    h.chain.register(seller.address, { agentId: 7n })
    h.chain.owners.delete('7')
    h.views.invalidate(address)
    expect((await get('/v1/me/reputation').expect(200)).body.agentIdStatus).toBe('not_owner')
  })
})

describe('on-chain strings are untrusted (review L-2)', () => {
  it('offers a link only for https, and null prices that do not parse', async () => {
    const base = { provider: address, description: '', tags: '', network: CAIP2, payTo: address, acceptsExact: true, acceptsGateway: true, createdBlock: 1n, updatedBlock: 1n }
    await db.insert(services).values([
      { ...base, key: hex32(1), name: 'a', endpoint: 'javascript:alert(1)', price: 'a1' },
      { ...base, key: hex32(2), name: 'b', endpoint: 'https://ok.example/x', price: '0.01' },
      { ...base, key: hex32(3), name: 'c', endpoint: 'https://user:pw@ok.example', price: '1.2.3' },
    ])
    makePro()
    const { services: rows } = (await get('/v1/me/services').expect(200)).body
    expect(rows.map((s: { endpointHttps: string | null }) => s.endpointHttps)).toEqual([null, 'https://ok.example/x', null])
    expect(rows.map((s: { priceAtomic: string | null }) => s.priceAtomic)).toEqual([null, '10000', null])
  })
})
