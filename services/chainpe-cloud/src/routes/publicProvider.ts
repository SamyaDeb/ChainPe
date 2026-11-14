/**
 * A read-only, public view of one sample provider, for the dashboard's "View sample provider" page.
 *
 * Only providers listed in SAMPLE_PROVIDERS are served; any other address is a 404, so this cannot be used to look
 * up arbitrary providers. Only aggregates leave here: totals, a revenue series, and the provider's services with their
 * public reputation. No buyer list, no per-buyer figures, no ingest keys, no wallets, no heartbeats or doctor reports.
 *
 * The figures follow GET /v1/me/summary (verified revenue, self-pay excluded) and GET /v1/public/services (scores).
 */
import { sql } from 'drizzle-orm'
import { Router, type RequestHandler } from 'express'
import { getAddress, isAddress } from 'viem'
import { z } from 'zod'
import type { Db } from '../db.js'
import { PAID_SCORE, RAW_SCORE } from '../reputation.js'
import { checksum, HttpError, iso, parse } from '../util.js'

const DAY_MS = 24 * 60 * 60 * 1000
const RANGES = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS, '90d': 90 * DAY_MS, all: null } as const
const summaryQuery = z.object({ range: z.enum(['24h', '7d', '30d', '90d', 'all']).default('7d') }).strict()

/** Verified, completed, not self-pay: the same rule as revenue in /v1/me/summary. */
const REVENUE = sql`(e.status = 'completed' AND e.verification = 'verified' AND NOT e.self_pay)`
const num = (v: string | null): number | null => (v === null ? null : Number(v))

/**
 * A 20-byte hex address. All-lowercase and all-uppercase are accepted as-is; a mixed-case one must carry a valid
 * EIP-55 checksum, so a mistyped address is refused rather than quietly matched.
 */
function parseAddress(raw: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new HttpError(400, 'invalid_request', 'address: must be a 20-byte hex address')
  const body = raw.slice(2)
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase()
  if (mixed && !isAddress(raw, { strict: true })) throw new HttpError(400, 'invalid_request', 'address: bad EIP-55 checksum')
  return raw.toLowerCase()
}

export interface PublicProviderOptions {
  db: Db
  /** Lowercase or checksummed addresses that may be shown publicly. Empty serves nothing. */
  allowlist: string[]
  limit: RequestHandler
  now?: () => number
}

export function publicProviderRoutes({ db, allowlist, limit, now = Date.now }: PublicProviderOptions): Router {
  const allowed = new Set(allowlist.map((a) => a.toLowerCase()))
  const router = Router()
  router.use(limit)

  router.get('/:address/summary', async (req, res) => {
    const provider = parseAddress(req.params.address)
    // Same answer as an unknown route, so the list of sample providers cannot be probed beyond what it publishes.
    if (!allowed.has(provider)) throw new HttpError(404, 'not_found', 'No such sample provider.')
    const { range } = parse(summaryQuery, req.query)
    const span = RANGES[range]
    const start = span === null ? null : new Date(now() - span)
    const window = start ? sql`AND e.effective_ts >= ${start.toISOString()}::timestamptz` : sql``

    // Verified revenue across both rails, as /v1/me/summary's totalVerifiedAtomic (Gateway pending included).
    const totals = await db.execute<Record<string, string>>(sql`
      SELECT
        COALESCE(SUM(e.amount_atomic) FILTER (WHERE ${REVENUE}), 0)::text AS revenue,
        COUNT(*) FILTER (WHERE e.status = 'completed')::text AS completed,
        COUNT(*) FILTER (WHERE e.status = 'failed')::text AS failed,
        COUNT(*) FILTER (WHERE ${REVENUE})::text AS verified,
        COUNT(DISTINCT e.payer) FILTER (WHERE ${REVENUE})::text AS unique_buyers
      FROM payment_events e
      WHERE e.provider = ${provider} ${window}
    `)
    const t = totals.rows[0]

    const unit = range === '24h' ? 'hour' : 'day'
    const series = await db.execute<{ t: string; revenue: string; calls: string }>(sql`
      SELECT to_char(date_trunc(${sql.raw(`'${unit}'`)}, e.effective_ts AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS t,
             COALESCE(SUM(e.amount_atomic) FILTER (WHERE ${REVENUE}), 0)::text AS revenue,
             COUNT(*)::text AS calls
      FROM payment_events e
      WHERE e.provider = ${provider} ${window}
      GROUP BY 1 ORDER BY 1
    `)

    const services = await db.execute<{
      key: string
      name: string
      description: string
      tags: string
      endpoint: string
      price: string
      pay_to: string
      provider: string
      agent_id: string | null
      paid_score: string | null
      paid_reviews: string
      raw_score: string | null
      raw_reviews: string
      total_settled: string
      paid_calls: string
      pay_to_shared: boolean
    }>(sql`
      SELECT s.key, s.name, s.description, s.tags, s.endpoint, s.price, s.pay_to, s.provider, s.agent_id::text AS agent_id,
        (SELECT ${PAID_SCORE} FROM feedback f WHERE f.agent_id = s.agent_id AND f.paid_to = s.pay_to AND f.verified AND NOT f.revoked)::text AS paid_score,
        (SELECT COUNT(*) FROM feedback f WHERE f.agent_id = s.agent_id AND f.paid_to = s.pay_to AND f.verified AND NOT f.revoked)::text AS paid_reviews,
        (SELECT ${RAW_SCORE} FROM feedback f WHERE f.agent_id = s.agent_id AND NOT f.revoked)::text AS raw_score,
        (SELECT COUNT(*) FROM feedback f WHERE f.agent_id = s.agent_id AND NOT f.revoked)::text AS raw_reviews,
        (SELECT COALESCE(SUM(e.amount_atomic), 0) FROM payment_events e WHERE e.service_key = s.key AND ${REVENUE})::text AS total_settled,
        (SELECT COUNT(*) FROM payment_events e WHERE e.service_key = s.key AND ${REVENUE})::text AS paid_calls,
        EXISTS (SELECT 1 FROM services o WHERE o.active AND o.pay_to = s.pay_to AND (o.created_block, o.key) < (s.created_block, s.key)) AS pay_to_shared
      FROM services s WHERE s.active AND s.provider = ${provider} ORDER BY s.created_block, s.key
    `)

    // One score over all of this provider's services: a verified rating counts for the payTo it actually paid.
    const rep = await db.execute<{ paid_score: string | null; paid_reviews: string; raw_score: string | null; raw_reviews: string }>(sql`
      WITH mine AS (SELECT DISTINCT agent_id, pay_to FROM services WHERE active AND provider = ${provider} AND agent_id IS NOT NULL)
      SELECT
        (SELECT ${PAID_SCORE} FROM feedback f WHERE f.verified AND NOT f.revoked AND EXISTS (SELECT 1 FROM mine m WHERE m.agent_id = f.agent_id AND m.pay_to = f.paid_to))::text AS paid_score,
        (SELECT COUNT(*) FROM feedback f WHERE f.verified AND NOT f.revoked AND EXISTS (SELECT 1 FROM mine m WHERE m.agent_id = f.agent_id AND m.pay_to = f.paid_to))::text AS paid_reviews,
        (SELECT ${RAW_SCORE} FROM feedback f WHERE NOT f.revoked AND f.agent_id IN (SELECT agent_id FROM mine))::text AS raw_score,
        (SELECT COUNT(*) FROM feedback f WHERE NOT f.revoked AND f.agent_id IN (SELECT agent_id FROM mine))::text AS raw_reviews
    `)
    const r = rep.rows[0]

    const completed = Number(t.completed)
    const failed = Number(t.failed)
    res.set('Cache-Control', 'public, max-age=15')
    res.json({
      address: getAddress(provider),
      range,
      since: iso(start),
      revenue: { totalVerifiedAtomic: t.revenue },
      calls: { completed, failed, verified: Number(t.verified), successRate: completed + failed === 0 ? null : completed / (completed + failed) },
      uniqueBuyers: Number(t.unique_buyers),
      series: { unit, points: series.rows.map((p) => ({ t: p.t, revenueAtomic: p.revenue, calls: Number(p.calls) })) },
      services: services.rows.map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
        tags: s.tags,
        endpoint: s.endpoint,
        price: s.price,
        payTo: checksum(s.pay_to),
        provider: checksum(s.provider),
        agentId: s.agent_id,
        paidScore: num(s.paid_score),
        paidReviews: Number(s.paid_reviews),
        rawScore: num(s.raw_score),
        rawReviews: Number(s.raw_reviews),
        totalSettledAtomic: s.total_settled,
        paidCalls: Number(s.paid_calls),
        payToShared: s.pay_to_shared,
      })),
      reputation: { paidScore: num(r.paid_score), paidReviews: Number(r.paid_reviews), rawScore: num(r.raw_score), rawReviews: Number(r.raw_reviews) },
    })
  })

  return router
}
