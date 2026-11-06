/**
 * Copies Circle's Gateway transfer records. On-chain logs cannot verify this rail: a
 * batch has no Transfer to the seller. The SDK's client needs a private key and this
 * service holds none, so it uses the public REST API directly.
 */
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db.js'
import { gatewayTransfers, paymentEvents } from '../schema.js'

const PAGE_SIZE = 100
const MAX_PAGES = 5
const LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000

export const TERMINAL_STATUSES = ['completed', 'failed']

const recordSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  token: z.string().min(1),
  recipientNetwork: z.string().min(1),
  fromAddress: z.string().min(1),
  toAddress: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  nonce: z.string().nullish(),
  txHash: z.string().nullish(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export type GatewayRecord = z.output<typeof recordSchema>

export interface GatewayApi {
  /** Yields every record for this recipient since `since`, following pages. */
  listByRecipient(to: string, since: Date): Promise<unknown[]>
  /** Null when Circle has no such transfer. */
  getById(id: string): Promise<unknown | null>
}

export function createGatewayApi(baseUrl: string, network: string, fetchImpl: typeof fetch = fetch): GatewayApi {
  const base = baseUrl.replace(/\/+$/, '')
  async function get(url: string): Promise<Response> {
    return fetchImpl(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
  }
  return {
    async listByRecipient(to, since) {
      const records: unknown[] = []
      let pageAfter: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ to, network, token: 'USDC', pageSize: String(PAGE_SIZE), startDate: since.toISOString() })
        if (pageAfter) query.set('pageAfter', pageAfter)
        const response = await get(`${base}/v1/x402/transfers?${query.toString().replaceAll('%3A', ':')}`)
        if (!response.ok) throw new Error(`Gateway answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
        const body = (await response.json()) as { transfers?: unknown[] }
        records.push(...(body.transfers ?? []))
        pageAfter = nextPage(response.headers.get('link'))
        if (!pageAfter) break
      }
      return records
    },
    async getById(id) {
      const response = await get(`${base}/v1/x402/transfers/${encodeURIComponent(id)}`)
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Gateway answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
      return response.json()
    },
  }
}

function nextPage(link: string | null): string | undefined {
  const match = link?.match(/<([^>]+)>\s*;\s*rel="next"/)
  if (!match) return undefined
  try {
    return new URL(match[1]).searchParams.get('pageAfter') ?? undefined
  } catch {
    return undefined
  }
}

export interface PollerOptions {
  db: Db
  api: GatewayApi
  now?: () => number
  log?: (message: string) => void
}

export function createGatewayPoller({ db, api, now = Date.now, log = console.warn }: PollerOptions) {
  async function store(raw: unknown): Promise<void> {
    const parsed = recordSchema.safeParse(raw)
    if (!parsed.success) {
      log(`Gateway record with an unexpected shape was skipped: ${parsed.error.issues[0]?.path.join('.')}`)
      return
    }
    const r = parsed.data
    const row = {
      id: r.id,
      from: r.fromAddress.toLowerCase(),
      to: r.toAddress.toLowerCase(),
      amountAtomic: r.amount,
      token: r.token,
      status: r.status,
      nonce: r.nonce ?? null,
      txHash: r.txHash?.toLowerCase() ?? null,
      network: r.recipientNetwork,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
      polledAt: new Date(now()),
    }
    await db.insert(gatewayTransfers).values(row).onConflictDoUpdate({ target: gatewayTransfers.id, set: row })
  }

  return {
    async run(): Promise<void> {
      const active = await db.execute<{ provider: string }>(sql`
        SELECT DISTINCT e.provider
        FROM ${paymentEvents} e
        LEFT JOIN ${gatewayTransfers} g ON g.id = e.payment_id
        WHERE e.rail = 'gateway' AND e.status = 'completed'
          AND (e.received_at > now() - interval '7 days'
               OR g.id IS NULL
               OR g.status NOT IN ('completed', 'failed'))
      `)
      const since = new Date(now() - LOOKBACK_MS)
      for (const { provider } of active.rows) {
        try {
          for (const record of await api.listByRecipient(provider, since)) await store(record)
        } catch (err) {
          log(`Gateway poll failed for ${provider}: ${(err as Error).message}`)
        }
      }
      // An event newer than the list's page limit, or older than its window, is looked up directly.
      const missing = await db.execute<{ payment_id: string }>(sql`
        SELECT DISTINCT e.payment_id
        FROM ${paymentEvents} e
        LEFT JOIN ${gatewayTransfers} g ON g.id = e.payment_id
        WHERE e.rail = 'gateway' AND e.status = 'completed' AND e.payment_id IS NOT NULL AND g.id IS NULL
        LIMIT 100
      `)
      for (const { payment_id: id } of missing.rows) {
        try {
          const record = await api.getById(id)
          if (record) await store(record)
        } catch (err) {
          log(`Gateway lookup failed for ${id}: ${(err as Error).message}`)
        }
      }
    },
  }
}

export type GatewayPoller = ReturnType<typeof createGatewayPoller>
