/**
 * Sample data for mock mode. Fixtures in ./fixtures are served verbatim: no field is edited or invented.
 * They are copied from services/chainpe-cloud/fixtures, which the backend's contract test writes from real
 * responses. Loaded only through a dynamic import from src/api/client.ts.
 */

import { ApiError, type Transport, type TransportRequest } from '@/api/client'
import type { Me } from '@/api/schema'
import type { Session } from '@/lib/session'

/** Avalanche has no paid plan, so there is one sample provider (the "-pro" fixtures) and one unregistered wallet. */
export type MockScenario = 'pro' | 'unregistered'

const JSON_FIXTURES: Record<string, () => Promise<{ default: unknown }>> = {
  'auth-logout': () => import('./fixtures/auth-logout.json'),
  'auth-nonce': () => import('./fixtures/auth-nonce.json'),
  'buyers-pro': () => import('./fixtures/buyers-pro.json'),
  'error-not-registered': () => import('./fixtures/error-not-registered.json'),
  'fees-disabled': () => import('./fixtures/fees-disabled.json'),
  'health-pro': () => import('./fixtures/health-pro.json'),
  'keys-create': () => import('./fixtures/keys-create.json'),
  'keys-list': () => import('./fixtures/keys-list.json'),
  'keys-revoke': () => import('./fixtures/keys-revoke.json'),
  'me-pro': () => import('./fixtures/me-pro.json'),
  'payments-pro': () => import('./fixtures/payments-pro.json'),
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
  if (token !== `${TOKEN_PREFIX}pro`) throw new ApiError('unauthorized', 'Sample session is not signed in.', 401)
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

export function createMockTransport(getToken: () => string | null): Transport {
  return async ({ method, path, query }: TransportRequest) => {
    const key = `${method} ${path}`
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
      case 'GET /v1/me/fees':
        return fixture('fees-disabled')
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
