/**
 * Sample data for mock mode. Fixtures in ./fixtures are served verbatim: no field is edited or invented.
 * Loaded only through a dynamic import from src/api/client.ts.
 */

import { ApiError, type Transport, type TransportRequest } from '@/api/client'
import type { Me } from '@/api/schema'
import type { Session } from '@/lib/session'

export type MockScenario = 'pro' | 'free' | 'unregistered'
type Plan = 'pro' | 'free'

const JSON_FIXTURES: Record<string, () => Promise<{ default: unknown }>> = {
  'auth-logout': () => import('./fixtures/auth-logout.json'),
  'auth-nonce': () => import('./fixtures/auth-nonce.json'),
  'buyers-free': () => import('./fixtures/buyers-free.json'),
  'buyers-pro': () => import('./fixtures/buyers-pro.json'),
  'error-not-registered': () => import('./fixtures/error-not-registered.json'),
  'error-plan-required': () => import('./fixtures/error-plan-required.json'),
  'fees-active': () => import('./fixtures/fees-active.json'),
  'health-free': () => import('./fixtures/health-free.json'),
  'health-pro': () => import('./fixtures/health-pro.json'),
  'keys-create': () => import('./fixtures/keys-create.json'),
  'keys-list': () => import('./fixtures/keys-list.json'),
  'keys-revoke': () => import('./fixtures/keys-revoke.json'),
  'me-free': () => import('./fixtures/me-free.json'),
  'me-pro': () => import('./fixtures/me-pro.json'),
  'payments-pro': () => import('./fixtures/payments-pro.json'),
  'reputation-free': () => import('./fixtures/reputation-free.json'),
  'reputation-pro': () => import('./fixtures/reputation-pro.json'),
  'services-free': () => import('./fixtures/services-free.json'),
  'services-pro': () => import('./fixtures/services-pro.json'),
  'summary-24h': () => import('./fixtures/summary-24h.json'),
  'summary-free': () => import('./fixtures/summary-free.json'),
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

function planOf(token: string | null): Plan {
  if (token === `${TOKEN_PREFIX}pro`) return 'pro'
  if (token === `${TOKEN_PREFIX}free`) return 'free'
  throw new ApiError('unauthorized', 'Sample session is not signed in.', 401)
}

/** Sign in without a wallet. Unregistered fails exactly as the API does. */
export async function mockSignIn(scenario: MockScenario): Promise<Session> {
  if (scenario === 'unregistered') throw await fixtureError('error-not-registered', 403)
  const me = (await fixture(`me-${scenario}`)) as Me
  return {
    token: `${TOKEN_PREFIX}${scenario}`,
    address: me.address,
    expiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
  }
}

async function summaryFor(plan: Plan, range: string | undefined): Promise<unknown> {
  if (range === '24h') return fixture('summary-24h')
  if (range === '7d' || range === undefined) return fixture('summary-free')
  if (plan === 'free') throw await fixtureError('error-plan-required', 403)
  return fixture('summary-pro')
}

async function csvFor(plan: Plan): Promise<Blob> {
  if (plan === 'free') throw await fixtureError('error-plan-required', 403)
  const csv = (await import('./fixtures/payments.csv?raw')).default
  return new Blob([csv], { type: 'text/csv' })
}

export function createMockTransport(getToken: () => string | null): Transport {
  return async ({ method, path, query }: TransportRequest) => {
    const key = `${method} ${path}`
    if (key === 'POST /v1/auth/nonce') return fixture('auth-nonce')
    if (key === 'POST /v1/auth/logout') return fixture('auth-logout')
    const plan = planOf(getToken())
    switch (key) {
      case 'GET /v1/me':
        return fixture(`me-${plan}`)
      case 'GET /v1/me/services':
        return fixture(`services-${plan}`)
      case 'GET /v1/me/summary':
        return summaryFor(plan, typeof query?.range === 'string' ? query.range : undefined)
      case 'GET /v1/me/payments':
        return fixture('payments-pro')
      case 'GET /v1/me/payments.csv':
        return csvFor(plan)
      case 'GET /v1/me/buyers': {
        const range = query?.range
        if (plan === 'free' && range !== undefined && range !== '24h' && range !== '7d') {
          throw await fixtureError('error-plan-required', 403)
        }
        return fixture(`buyers-${plan}`)
      }
      case 'GET /v1/me/reputation':
        return fixture(`reputation-${plan}`)
      case 'GET /v1/me/health':
        return fixture(`health-${plan}`)
      case 'GET /v1/me/fees':
        return fixture('fees-active')
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
