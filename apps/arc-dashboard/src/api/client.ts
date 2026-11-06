import type {
  Buyers,
  CreatedKey,
  Health,
  KeyList,
  Me,
  NonceResponse,
  Ok,
  PaymentFilters,
  Payments,
  PaymentsQuery,
  Range,
  Reputation,
  RevokedKey,
  Services,
  SessionResponse,
  Summary,
  Wallets,
} from './schema'
import { CLOUD_URL, USE_MOCK } from '@/lib/env'

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryAfterSec: number | null

  constructor(code: string, message: string, status: number, retryAfterSec: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryAfterSec = retryAfterSec
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

export type Query = Record<string, string | number | undefined>

export interface TransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: Query
  body?: unknown
  expect?: 'json' | 'blob'
}

/** One request in, parsed body out. Throws ApiError on any failure. */
export type Transport = (req: TransportRequest) => Promise<unknown>

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return `${CLOUD_URL}${path}${qs ? `?${qs}` : ''}`
}

function retryAfter(res: Response): number | null {
  const header = res.headers.get('Retry-After')
  if (!header) return null
  const n = Number.parseInt(header, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

async function toError(res: Response): Promise<ApiError> {
  let code = res.status === 401 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : 'internal_error'
  let message = `Request failed with status ${res.status}.`
  try {
    const body: unknown = await res.json()
    if (typeof body === 'object' && body !== null) {
      const { error, message: m } = body as { error?: unknown; message?: unknown }
      if (typeof error === 'string') code = error
      if (typeof m === 'string') message = m
    }
  } catch {
    /* body was not JSON: keep the defaults */
  }
  return new ApiError(code, message, res.status, retryAfter(res))
}

const REQUEST_TIMEOUT_MS = 20000

function isTimeout(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'TimeoutError'
}

function createFetchTransport(getToken: () => string | null): Transport {
  return async ({ method, path, query, body, expect = 'json' }) => {
    const headers: Record<string, string> = { Accept: expect === 'blob' ? 'text/csv' : 'application/json' }
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(buildUrl(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
        signal,
      })
      if (!res.ok) throw await toError(res)
      return expect === 'blob' ? await res.blob() : ((await res.json()) as unknown)
    } catch (e) {
      if (e instanceof ApiError) throw e
      if (isTimeout(e)) throw new ApiError('network_error', 'The ChainPe service did not answer in time.', 0)
      throw new ApiError('network_error', 'Could not reach the ChainPe service.', 0)
    }
  }
}

export interface ChainPeApi {
  nonce(address: string): Promise<NonceResponse>
  verify(message: string, signature: string): Promise<SessionResponse>
  logout(): Promise<Ok>
  me(): Promise<Me>
  services(): Promise<Services>
  summary(range: Range): Promise<Summary>
  payments(query: PaymentsQuery): Promise<Payments>
  paymentsCsv(filters: PaymentFilters): Promise<Blob>
  buyers(range?: Range): Promise<Buyers>
  reputation(): Promise<Reputation>
  health(): Promise<Health>
  wallets(): Promise<Wallets>
  putWallets(wallets: string[]): Promise<Wallets>
  keys(): Promise<KeyList>
  createKey(name?: string): Promise<CreatedKey>
  revokeKey(id: string): Promise<RevokedKey>
}

function build(transport: Transport): ChainPeApi {
  const json = async <T>(req: TransportRequest): Promise<T> => (await transport(req)) as T
  return {
    nonce: (address) =>
      json({ method: 'POST', path: '/v1/auth/nonce', body: { address, client: 'dashboard' } }),
    verify: (message, signature) =>
      json({ method: 'POST', path: '/v1/auth/verify', body: { message, signature } }),
    logout: () => json({ method: 'POST', path: '/v1/auth/logout' }),
    me: () => json({ method: 'GET', path: '/v1/me' }),
    services: () => json({ method: 'GET', path: '/v1/me/services' }),
    summary: (range) => json({ method: 'GET', path: '/v1/me/summary', query: { range } }),
    payments: (q) =>
      json({
        method: 'GET',
        path: '/v1/me/payments',
        query: { cursor: q.cursor, limit: q.limit, rail: q.rail, route: q.route, verification: q.verification },
      }),
    paymentsCsv: async (f) =>
      (await transport({
        method: 'GET',
        path: '/v1/me/payments.csv',
        query: { rail: f.rail, route: f.route, verification: f.verification },
        expect: 'blob',
      })) as Blob,
    buyers: (range) => json({ method: 'GET', path: '/v1/me/buyers', query: { range } }),
    reputation: () => json({ method: 'GET', path: '/v1/me/reputation' }),
    health: () => json({ method: 'GET', path: '/v1/me/health' }),
    wallets: () => json({ method: 'GET', path: '/v1/me/wallets' }),
    putWallets: (wallets) => json({ method: 'PUT', path: '/v1/me/wallets', body: { wallets } }),
    keys: () => json({ method: 'GET', path: '/v1/keys' }),
    createKey: (name) => json({ method: 'POST', path: '/v1/keys', body: name ? { name } : {} }),
    revokeKey: (id) => json({ method: 'DELETE', path: `/v1/keys/${encodeURIComponent(id)}` }),
  }
}

/** Mock fixtures load on first use, so a live build never fetches them. */
function createLazyMockTransport(getToken: () => string | null): Transport {
  let loaded: Promise<Transport> | null = null
  return async (req) => {
    loaded ??= import('@/mock/mockApi').then((m) => m.createMockTransport(getToken))
    return (await loaded)(req)
  }
}

export function createApi(getToken: () => string | null): ChainPeApi {
  return build(USE_MOCK ? createLazyMockTransport(getToken) : createFetchTransport(getToken))
}
