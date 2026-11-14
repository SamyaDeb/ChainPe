/**
 * Sample data for mock mode. Fixtures in ./fixtures are served verbatim: no field is edited or invented.
 * They are copied from services/chainpe-cloud/fixtures, which the backend's contract test writes from real
 * responses. Loaded only through a dynamic import from src/api/client.ts.
 *
 * The exception is the public-* fixtures (Explore and sample provider pages): they are hand-written to the shapes in
 * services/chainpe-cloud/src/routes/public.ts and publicProvider.ts. The feed's times and the sample provider's
 * series are moved to just before now, so they look live.
 */

import { ApiError, type Transport, type TransportRequest } from '@/api/client'
import type { Me } from '@/api/schema'
import type { Session } from '@/lib/session'

/** One sample provider (served from the backend's "-pro" fixtures) and one unregistered wallet. */
export type MockScenario = 'sample' | 'unregistered'

const JSON_FIXTURES: Record<string, () => Promise<{ default: unknown }>> = {
  'auth-logout': () => import('./fixtures/auth-logout.json'),
  'auth-nonce': () => import('./fixtures/auth-nonce.json'),
  'buyers-pro': () => import('./fixtures/buyers-pro.json'),
  'error-not-registered': () => import('./fixtures/error-not-registered.json'),
  'health-pro': () => import('./fixtures/health-pro.json'),
  'keys-create': () => import('./fixtures/keys-create.json'),
  'keys-list': () => import('./fixtures/keys-list.json'),
  'keys-revoke': () => import('./fixtures/keys-revoke.json'),
  'me-pro': () => import('./fixtures/me-pro.json'),
  'payments-pro': () => import('./fixtures/payments-pro.json'),
  'public-feed': () => import('./fixtures/public-feed.json'),
  'public-provider-summary': () => import('./fixtures/public-provider-summary.json'),
  'public-reviews-cheap-weather': () => import('./fixtures/public-reviews-cheap-weather.json'),
  'public-reviews-summarize': () => import('./fixtures/public-reviews-summarize.json'),
  'public-reviews-weather': () => import('./fixtures/public-reviews-weather.json'),
  'public-services': () => import('./fixtures/public-services.json'),
  'public-stats': () => import('./fixtures/public-stats.json'),
  'reputation-pro': () => import('./fixtures/reputation-pro.json'),
  'services-pro': () => import('./fixtures/services-pro.json'),
  'summary-24h': () => import('./fixtures/summary-24h.json'),
  'summary-7d': () => import('./fixtures/summary-7d.json'),
  'summary-pro': () => import('./fixtures/summary-pro.json'),
  wallets: () => import('./fixtures/wallets.json'),
  'wallets-put': () => import('./fixtures/wallets-put.json'),
}

async function fixture(name: string): Promise<unknown> {
  const load = JSON_FIXTURES[name]
  if (!load) throw new ApiError('not_found', `No sample data for ${name}.`, 404)
  return (await load()).default
}

async function fixtureError(name: string, status: number): Promise<ApiError> {
  const body = (await fixture(name)) as { error: string; message: string }
  return new ApiError(body.error, body.message, status)
}

const TOKEN_PREFIX = 'mock:'

function requireSession(token: string | null): void {
  if (token !== `${TOKEN_PREFIX}sample`) throw new ApiError('unauthorized', 'Sample session is not signed in.', 401)
}

/** Sign in without a wallet. Unregistered fails exactly as the API does. */
export async function mockSignIn(scenario: MockScenario): Promise<Session> {
  if (scenario === 'unregistered') throw await fixtureError('error-not-registered', 403)
  const me = (await fixture('me-pro')) as Me
  return {
    token: `${TOKEN_PREFIX}${scenario}`,
    address: me.address,
    expiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
  }
}

async function csv(): Promise<Blob> {
  const text = (await import('./fixtures/payments.csv?raw')).default
  return new Blob([text], { type: 'text/csv' })
}

/** The feed with its newest settlement a few seconds ago, keeping the gaps between rows. */
async function liveFeed(limit: number): Promise<unknown> {
  const { settlements } = (await fixture('public-feed')) as { settlements: Array<{ ts: string }> }
  const newest = Date.parse(settlements[0]?.ts ?? '')
  const shift = Number.isNaN(newest) ? 0 : Date.now() - 4_000 - newest
  return { settlements: settlements.slice(0, limit).map((s) => ({ ...s, ts: new Date(Date.parse(s.ts) + shift).toISOString() })) }
}

const DAY_MS = 86_400_000
const RANGE_MS: Record<string, number | null> = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS, '90d': 90 * DAY_MS, all: null }

interface SampleSummary {
  address: string
  calls: { failed: number }
  series: { points: Array<{ t: string; revenueAtomic: string; calls: number }> }
}

/**
 * The sample provider for one range: the series moved so its last day is today, cut to the range, and the totals
 * summed from what is left, so the page's numbers always agree with its chart.
 */
async function sampleSummary(address: string, range: string): Promise<unknown> {
  const base = (await fixture('public-provider-summary')) as SampleSummary
  if (address.toLowerCase() !== base.address.toLowerCase()) throw new ApiError('not_found', 'No such sample provider.', 404)
  const span = RANGE_MS[range]
  if (span === undefined) throw new ApiError('invalid_request', 'range: invalid option', 400)
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS
  const last = Math.max(...base.series.points.map((p) => Date.parse(p.t)))
  const shifted = base.series.points.map((p) => ({ ...p, t: new Date(Date.parse(p.t) + today - last).toISOString().replace('.000Z', 'Z') }))
  const since = span === null ? null : Date.now() - span
  const points = shifted.filter((p) => since === null || Date.parse(p.t) >= Math.floor(since / DAY_MS) * DAY_MS)
  const revenue = points.reduce((sum, p) => sum + BigInt(p.revenueAtomic), 0n)
  const completed = points.reduce((sum, p) => sum + p.calls, 0)
  const failed = range === '24h' ? 0 : base.calls.failed
  return {
    ...base,
    range,
    since: since === null ? null : new Date(since).toISOString(),
    revenue: { totalVerifiedAtomic: revenue.toString() },
    calls: { completed, failed, verified: completed, successRate: completed + failed === 0 ? null : completed / (completed + failed) },
    series: { unit: 'day', points },
  }
}

/** Public reads need no session. Reviews are looked up by the service's key in public-services. */
async function publicRead(path: string, query: TransportRequest['query']): Promise<unknown> {
  if (path === '/v1/public/stats') return fixture('public-stats')
  if (path === '/v1/public/services') return fixture('public-services')
  if (path === '/v1/public/feed') return liveFeed(Number(query?.limit ?? 50))
  const sample = /^\/v1\/public\/providers\/([^/]+)\/summary$/.exec(path)
  if (sample) return sampleSummary(decodeURIComponent(sample[1] ?? ''), String(query?.range ?? '7d'))
  const reviews = /^\/v1\/public\/services\/([^/]+)\/reviews$/.exec(path)
  if (reviews) {
    const key = decodeURIComponent(reviews[1] ?? '').toLowerCase()
    const { services } = (await fixture('public-services')) as { services: Array<{ key: string; name: string }> }
    const found = services.find((s) => s.key === key)
    if (!found) throw new ApiError('not_found', 'No such service.', 404)
    return fixture(`public-reviews-${found.name}`)
  }
  throw new ApiError('not_found', 'No such endpoint.', 404)
}

export function createMockTransport(getToken: () => string | null): Transport {
  return async ({ method, path, query }: TransportRequest) => {
    const key = `${method} ${path}`
    if (method === 'GET' && path.startsWith('/v1/public/')) return publicRead(path, query)
    if (key === 'POST /v1/auth/nonce') return fixture('auth-nonce')
    if (key === 'POST /v1/auth/logout') return fixture('auth-logout')
    requireSession(getToken())
    switch (key) {
      case 'GET /v1/me':
        return fixture('me-pro')
      case 'GET /v1/me/services':
        return fixture('services-pro')
      case 'GET /v1/me/summary':
        return fixture(query?.range === '24h' ? 'summary-24h' : query?.range === '7d' || query?.range === undefined ? 'summary-7d' : 'summary-pro')
      case 'GET /v1/me/payments':
        return fixture('payments-pro')
      case 'GET /v1/me/payments.csv':
        return csv()
      case 'GET /v1/me/buyers':
        return fixture('buyers-pro')
      case 'GET /v1/me/reputation':
        return fixture('reputation-pro')
      case 'GET /v1/me/health':
        return fixture('health-pro')
      case 'GET /v1/me/wallets':
        return fixture('wallets')
      case 'PUT /v1/me/wallets':
        return fixture('wallets-put')
      case 'GET /v1/keys':
        return fixture('keys-list')
      case 'POST /v1/keys':
        return fixture('keys-create')
      default:
        if (method === 'DELETE' && path.startsWith('/v1/keys/')) return fixture('keys-revoke')
        throw new ApiError('not_found', `No sample data for ${key}.`, 404)
    }
  }
}
