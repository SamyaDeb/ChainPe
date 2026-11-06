/**
 * Provider-scoped reads. The provider always comes from the session, never from
 * input, and every query filters on it. Spec 08a sections 3 and 6.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { Router, type Request } from 'express'
import { getAddress } from 'viem'
import { z } from 'zod'
import type { Db } from '../db.js'
import type { Fees } from '../fees.js'
import type { Plan, ProviderViews } from '../plan.js'
import { feedback, gatewayTransfers, heartbeats, myWallets, onchainTransfers, paymentEvents, services } from '../schema.js'
import type { Sessions } from '../session.js'
import { checksum, formatUsdc, httpsOnly, HttpError, iso, parse, planRequired, priceToAtomic, zAddress } from '../util.js'

const DAY_MS = 24 * 60 * 60 * 1000
const FREE_WINDOW_MS = 7 * DAY_MS
const FREE_BUYERS = 5
const MAX_WALLETS = 50
const CSV_PAGE = 1000

const RANGES = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS, '90d': 90 * DAY_MS, all: null } as const
type Range = keyof typeof RANGES
const FREE_RANGES: Range[] = ['24h', '7d']
const zRange = z.enum(['24h', '7d', '30d', '90d', 'all'])

const paymentsQuery = z
  .object({
    cursor: z.string().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    rail: z.enum(['exact', 'gateway']).optional(),
    route: z.string().max(512).optional(),
    verification: z.enum(['unverified', 'verified', 'failed']).optional(),
  })
  .strict()
const walletsBody = z.object({ wallets: z.array(zAddress).max(MAX_WALLETS) }).strict()

const cursorSchema = z.object({ t: z.string().datetime(), id: z.string().max(128) })
const encodeCursor = (t: Date, id: string) => Buffer.from(JSON.stringify({ t: t.toISOString(), id })).toString('base64url')
function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const { t, id } = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
    return { t: new Date(t), id }
  } catch {
    throw new HttpError(400, 'invalid_request', 'cursor: not a valid cursor')
  }
}

export interface MeOptions {
  db: Db
  views: ProviderViews
  sessions: Sessions
  fees?: Fees
  readLimit: import('express').RequestHandler
  now?: () => number
}

export function meRoutes({ db, views, sessions, fees, readLimit, now = Date.now }: MeOptions): Router {
  const router = Router()
  router.use('/me', sessions.requireSession, readLimit)

  // Past the limit, the data stops. /me and /me/fees stay open so the provider can see why and pay. Spec 12.
  router.use('/me', (req, _res, next) => {
    if (!fees || req.path === '/' || req.path === '/fees') {
      next()
      return
    }
    fees.isLocked(req.provider!).then(
      (locked) => next(locked ? new HttpError(403, 'fees_due', 'Unpaid ChainPe fees have reached the limit. Approve USDC in Billing to continue.') : undefined),
      next
    )
  })

  router.get('/me/fees', async (req, res) => {
    res.json(fees ? await fees.summary(req.provider!) : DISABLED_FEES)
  })

  const planOf = async (req: Request): Promise<Plan> => (await views.get(req.provider!)).plan

  /** Range to a start time, refusing what the plan does not include. */
  function since(range: Range, plan: Plan): Date | null {
    if (plan === 'free' && !FREE_RANGES.includes(range)) {
      throw planRequired(`range=${range} needs Pro. Free covers ${FREE_RANGES.join(' and ')}.`)
    }
    const span = RANGES[range]
    return span === null ? null : new Date(now() - span)
  }

  router.get('/me', async (req, res) => {
    const view = await views.get(req.provider!)
    res.json({
      address: checksum(req.provider!),
      // A stale link is not shown as this provider's identity (review L-1).
      agentId: view.agentIdStatus === 'owned' ? view.agentId : null,
      agentIdStatus: view.agentIdStatus,
      plan: view.plan,
      paidUntil: iso(view.paidUntil),
      createdAt: iso(view.createdAt),
    })
  })

  router.get('/me/services', async (req, res) => {
    const provider = req.provider!
    const plan = await planOf(req)
    const rows = await db
      .select()
      .from(services)
      .where(and(eq(services.provider, provider), plan === 'free' ? eq(services.active, true) : undefined))
      .orderBy(asc(services.createdBlock), asc(services.key))
    const shown = plan === 'free' ? rows.slice(0, 1) : rows
    const keys = shown.map((s) => s.key)
    const beats = keys.length
      ? await db
          .selectDistinctOn([heartbeats.serviceKey])
          .from(heartbeats)
          .where(and(eq(heartbeats.provider, provider), inArray(heartbeats.serviceKey, keys)))
          .orderBy(heartbeats.serviceKey, desc(heartbeats.ts))
      : []
    const beatOf = new Map(beats.map((b) => [b.serviceKey, b]))
    // A proxy's own heartbeat carries no report in a container, so the latest beat must not hide the latest result.
    const reports = keys.length
      ? await db
          .selectDistinctOn([heartbeats.serviceKey])
          .from(heartbeats)
          .where(and(eq(heartbeats.provider, provider), inArray(heartbeats.serviceKey, keys), isNotNull(heartbeats.doctorJson)))
          .orderBy(heartbeats.serviceKey, desc(heartbeats.ts))
      : []
    const reportOf = new Map(reports.map((b) => [b.serviceKey, b.doctorJson]))
    res.json({
      services: shown.map((s) => {
        const beat = beatOf.get(s.key)
        return {
          key: s.key,
          name: s.name,
          description: s.description,
          tags: s.tags,
          endpoint: s.endpoint,
          endpointHttps: httpsOnly(s.endpoint),
          price: s.price,
          priceAtomic: priceToAtomic(s.price),
          network: s.network,
          payTo: getAddress(s.payTo),
          acceptsExact: s.acceptsExact,
          acceptsGateway: s.acceptsGateway,
          active: s.active,
          lastHeartbeatAt: iso(beat?.ts),
          version: beat?.version ?? null,
          rails: beat?.rails ?? null,
          gatewayBalanceAtomic: beat?.gatewayBalanceAtomic ?? null,
          doctor: doctorSummary(reportOf.get(s.key)),
        }
      }),
      truncated: shown.length < rows.length,
    })
  })

  router.get('/me/summary', async (req, res) => {
    const { range } = parse(z.object({ range: zRange.default('7d') }).strict(), req.query)
    const provider = req.provider!
    const start = since(range, await planOf(req))
    const window = start ? sql`AND e.effective_ts >= ${start.toISOString()}::timestamptz` : sql``

    const totals = await db.execute<Record<string, string>>(sql`
      SELECT
        COALESCE(SUM(e.amount_atomic) FILTER (WHERE ${REVENUE} AND e.rail = 'exact'), 0)::text AS exact,
        COALESCE(SUM(e.amount_atomic) FILTER (WHERE ${REVENUE} AND e.rail = 'gateway' AND g.status = 'completed'), 0)::text AS gateway_settled,
        COALESCE(SUM(e.amount_atomic) FILTER (WHERE ${REVENUE} AND e.rail = 'gateway' AND g.status IS DISTINCT FROM 'completed'), 0)::text AS gateway_pending,
        COALESCE(SUM(e.amount_atomic) FILTER (WHERE e.status = 'completed' AND e.verification = 'unverified' AND NOT e.self_pay), 0)::text AS unverified,
        COALESCE(SUM(e.amount_atomic) FILTER (WHERE e.status = 'completed' AND e.verification = 'failed' AND NOT e.self_pay), 0)::text AS failed,
        COALESCE(SUM(e.amount_atomic) FILTER (WHERE e.status = 'completed' AND e.self_pay), 0)::text AS self_pay,
        COUNT(*)::text AS calls_total,
        COUNT(*) FILTER (WHERE e.status = 'completed')::text AS calls_completed,
        COUNT(*) FILTER (WHERE e.status = 'failed')::text AS calls_failed,
        COUNT(*) FILTER (WHERE ${REVENUE})::text AS calls_verified,
        COUNT(DISTINCT e.payer) FILTER (WHERE ${REVENUE})::text AS unique_buyers
      FROM ${paymentEvents} e
      LEFT JOIN ${gatewayTransfers} g ON g.id = e.payment_id AND e.rail = 'gateway'
      WHERE e.provider = ${provider} ${window}
    `)
    const t = totals.rows[0]

    const inflowWindow = start ? sql`AND t.block_ts >= ${start.toISOString()}::timestamptz` : sql``
    const inflow = await db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(t.amount_atomic), 0)::text AS total
      FROM ${onchainTransfers} t
      WHERE t."to" = ${provider} ${inflowWindow}
        AND NOT EXISTS (
          SELECT 1 FROM ${paymentEvents} e
          WHERE e.matched_transfer = 'exact:' || t.tx_hash || ':' || t.log_index
        )
    `)

    const unit = sql.raw(range === '24h' ? `'hour'` : `'day'`)
    const series = await db.execute<{ t: string; revenue: string; calls: string }>(sql`
      SELECT to_char(date_trunc(${unit}, e.effective_ts AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS t,
             COALESCE(SUM(e.amount_atomic) FILTER (WHERE ${REVENUE}), 0)::text AS revenue,
             COUNT(*)::text AS calls
      FROM ${paymentEvents} e
      LEFT JOIN ${gatewayTransfers} g ON g.id = e.payment_id AND e.rail = 'gateway'
      WHERE e.provider = ${provider} ${window}
      GROUP BY 1 ORDER BY 1
    `)

    const completed = Number(t.calls_completed)
    const failed = Number(t.calls_failed)
    res.json({
      range,
      since: iso(start),
      revenue: {
        // Verified only. Gateway pending is accepted by Circle, but its batch has not landed and can still fail.
        totalVerifiedAtomic: (BigInt(t.exact) + BigInt(t.gateway_settled) + BigInt(t.gateway_pending)).toString(),
        exactAtomic: t.exact,
        gateway: { settledAtomic: t.gateway_settled, pendingBatchAtomic: t.gateway_pending },
      },
      notRevenue: {
        unverifiedAtomic: t.unverified,
        failedAtomic: t.failed,
        selfPayAtomic: t.self_pay,
        unattributedInflowAtomic: inflow.rows[0].total,
      },
      calls: {
        total: Number(t.calls_total),
        completed,
        failed,
        verified: Number(t.calls_verified),
        successRate: completed + failed === 0 ? null : completed / (completed + failed),
      },
      uniqueBuyers: Number(t.unique_buyers),
      series: { unit: range === '24h' ? 'hour' : 'day', points: series.rows.map((p) => ({ t: p.t, revenueAtomic: p.revenue, calls: Number(p.calls) })) },
    })
  })

  async function pageOfPayments(provider: string, plan: Plan, filters: SQL[], limit: number, cursor?: { t: Date; id: string }) {
    const conditions: (SQL | undefined)[] = [eq(paymentEvents.provider, provider), ...filters]
    if (plan === 'free') conditions.push(gte(paymentEvents.effectiveTs, new Date(now() - FREE_WINDOW_MS)))
    if (cursor) {
      conditions.push(
        or(lt(paymentEvents.effectiveTs, cursor.t), and(eq(paymentEvents.effectiveTs, cursor.t), lt(paymentEvents.id, cursor.id)))
      )
    }
    return db
      .select({ event: paymentEvents, transfer: { status: gatewayTransfers.status, txHash: gatewayTransfers.txHash } })
      .from(paymentEvents)
      .leftJoin(gatewayTransfers, and(eq(gatewayTransfers.id, paymentEvents.paymentId), eq(paymentEvents.rail, 'gateway')))
      .where(and(...conditions))
      .orderBy(desc(paymentEvents.effectiveTs), desc(paymentEvents.id))
      .limit(limit)
  }

  function paymentFilters(query: z.output<typeof paymentsQuery>): SQL[] {
    const filters: SQL[] = []
    if (query.rail) filters.push(eq(paymentEvents.rail, query.rail))
    if (query.route) filters.push(eq(paymentEvents.route, query.route))
    if (query.verification) filters.push(eq(paymentEvents.verification, query.verification))
    return filters
  }

  router.get('/me/payments', async (req, res) => {
    const query = parse(paymentsQuery, req.query)
    const plan = await planOf(req)
    const rows = await pageOfPayments(
      req.provider!,
      plan,
      paymentFilters(query),
      query.limit + 1,
      query.cursor ? decodeCursor(query.cursor) : undefined
    )
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    res.json({
      payments: page.map(paymentView),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.event.effectiveTs, last.event.id) : null,
    })
  })

  router.get('/me/payments.csv', async (req, res) => {
    if ((await planOf(req)) !== 'pro') throw planRequired('CSV export needs Pro.')
    const query = parse(paymentsQuery.omit({ cursor: true, limit: true }), req.query)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="chainpe-payments.csv"')
    res.write(`${CSV_HEADER.join(',')}\n`)
    let cursor: { t: Date; id: string } | undefined
    for (;;) {
      const rows = await pageOfPayments(req.provider!, 'pro', paymentFilters({ ...query, limit: CSV_PAGE }), CSV_PAGE, cursor)
      for (const row of rows) res.write(`${csvRow(row)}\n`)
      if (rows.length < CSV_PAGE) break
      const last = rows[rows.length - 1].event
      cursor = { t: last.effectiveTs, id: last.id }
    }
    res.end()
  })

  router.get('/me/buyers', async (req, res) => {
    const plan = await planOf(req)
    const { range } = parse(z.object({ range: zRange.default(plan === 'free' ? '7d' : 'all') }).strict(), req.query)
    const start = since(range, plan)
    const window = start ? sql`AND e.effective_ts >= ${start.toISOString()}::timestamptz` : sql``
    const rows = await db.execute<{ payer: string; spend: string; calls: string; first_seen: string; last_seen: string }>(sql`
      SELECT e.payer, SUM(e.amount_atomic)::text AS spend, COUNT(*)::text AS calls,
             MIN(e.effective_ts) AS first_seen, MAX(e.effective_ts) AS last_seen
      FROM ${paymentEvents} e
      LEFT JOIN ${gatewayTransfers} g ON g.id = e.payment_id AND e.rail = 'gateway'
      WHERE e.provider = ${req.provider!} AND ${REVENUE} ${window}
      GROUP BY e.payer
      ORDER BY SUM(e.amount_atomic) DESC, e.payer
    `)
    const shown = plan === 'free' ? rows.rows.slice(0, FREE_BUYERS) : rows.rows
    res.json({
      range,
      buyers: shown.map((b) => ({
        address: checksum(b.payer),
        spendAtomic: b.spend,
        calls: Number(b.calls),
        firstSeen: new Date(b.first_seen).toISOString(),
        lastSeen: new Date(b.last_seen).toISOString(),
      })),
      totalBuyers: rows.rows.length,
      truncated: shown.length < rows.rows.length,
    })
  })

  router.get('/me/reputation', async (req, res) => {
    const view = await views.get(req.provider!)
    const empty = {
      agentId: null,
      agentIdStatus: view.agentIdStatus,
      payerAverage: null,
      payerCount: 0,
      allAverage: null,
      allCount: 0,
      items: view.plan === 'pro' ? [] : null,
    }
    // Attributed only while the token is still this provider's (review L-1).
    if (view.agentIdStatus !== 'owned' || !view.agentId) {
      res.json(empty)
      return
    }
    const agentId = view.agentId
    // Anyone can rate an agent (spec 08a section 12). A rating counts as a payer's only if
    // that wallet has a verified payment here. Self-pay does not count: a provider must not
    // be able to raise this figure by paying itself from a declared wallet.
    const fromPayer = sql<boolean>`EXISTS (
      SELECT 1 FROM ${paymentEvents} p
      WHERE p.provider = ${req.provider!} AND p.payer = f.client AND p.verification = 'verified' AND NOT p.self_pay
    )`
    const score = sql`f.value / POWER(10::numeric, f.value_decimals)`
    const [stats] = (
      await db.execute<{ payer_average: string | null; payer_count: string; all_average: string | null; all_count: string }>(sql`
        SELECT
          ROUND(AVG(${score}) FILTER (WHERE ${fromPayer}), 2)::text AS payer_average,
          (COUNT(*) FILTER (WHERE ${fromPayer}))::text AS payer_count,
          ROUND(AVG(${score}), 2)::text AS all_average,
          COUNT(*)::text AS all_count
        FROM ${feedback} f WHERE f.agent_id = ${agentId} AND NOT f.revoked
      `)
    ).rows
    let items = null
    if (view.plan === 'pro') {
      const rows = await db.execute<{
        client: string
        feedback_index: string
        value: string
        value_decimals: number
        tag1: string | null
        tag2: string | null
        endpoint: string | null
        feedback_uri: string | null
        block_ts: Date | string
        tx_hash: string
        from_payer: boolean
      }>(sql`
        SELECT f.client, f.feedback_index::text AS feedback_index, f.value::text AS value, f.value_decimals, f.tag1, f.tag2,
          f.endpoint, f.feedback_uri, f.block_ts, f.tx_hash, ${fromPayer} AS from_payer
        FROM ${feedback} f WHERE f.agent_id = ${agentId} AND NOT f.revoked
        ORDER BY f.block DESC, f.feedback_index DESC
        LIMIT 200
      `)
      items = rows.rows.map((f) => ({
        client: getAddress(f.client),
        feedbackIndex: f.feedback_index,
        value: f.value,
        valueDecimals: f.value_decimals,
        tag1: f.tag1,
        tag2: f.tag2,
        endpoint: f.endpoint,
        feedbackUri: f.feedback_uri,
        blockTs: new Date(f.block_ts).toISOString(),
        txHash: f.tx_hash,
        fromPayer: f.from_payer,
      }))
    }
    res.json({
      agentId,
      agentIdStatus: view.agentIdStatus,
      payerAverage: stats.payer_average,
      payerCount: Number(stats.payer_count),
      allAverage: stats.all_average,
      allCount: Number(stats.all_count),
      items,
    })
  })

  router.get('/me/health', async (req, res) => {
    const plan = await planOf(req)
    const rows = await db
      .select()
      .from(heartbeats)
      // Doctor history. A heartbeat with no report would push real results out of the window.
      .where(and(eq(heartbeats.provider, req.provider!), isNotNull(heartbeats.doctorJson)))
      .orderBy(desc(heartbeats.ts))
      .limit(plan === 'free' ? 1 : 100)
    res.json({
      history: rows.map((h) => ({
        serviceKey: h.serviceKey,
        ts: h.ts.toISOString(),
        version: h.version,
        network: h.network,
        rails: h.rails,
        gatewayBalanceAtomic: h.gatewayBalanceAtomic,
        doctor: h.doctorJson ?? null,
      })),
      latestOnly: plan === 'free',
    })
  })

  router.get('/me/wallets', async (req, res) => {
    const rows = await db.select().from(myWallets).where(eq(myWallets.provider, req.provider!)).orderBy(asc(myWallets.address))
    res.json({ wallets: rows.map((w) => getAddress(w.address)) })
  })

  router.put('/me/wallets', async (req, res) => {
    const provider = req.provider!
    const wallets = [...new Set(parse(walletsBody, req.body).wallets)]
    await db.transaction(async (tx) => {
      await tx.delete(myWallets).where(eq(myWallets.provider, provider))
      if (wallets.length) await tx.insert(myWallets).values(wallets.map((address) => ({ provider, address })))
      // Past events follow the new list, so revenue changes at once and consistently.
      const own = [provider, ...wallets]
      await tx
        .update(paymentEvents)
        .set({ selfPay: sql`${paymentEvents.payer} IN (${sql.join(own.map((a) => sql`${a}`), sql`, `)})` })
        .where(eq(paymentEvents.provider, provider))
    })
    res.json({ wallets: wallets.sort().map((w) => getAddress(w)) })
  })

  return router
}

const DISABLED_FEES = {
  enabled: false,
  contract: null,
  status: 'not_enrolled',
  enrolledAt: null,
  rateBps: 0,
  rates: { freeBps: 0, proBps: 0 },
  owedAtomic: '0',
  collectedAtomic: '0',
  allowanceAtomic: null,
  lockAtAtomic: '0',
  locked: false,
  batches: [],
}

/** What counts as revenue, in one place. Needs aliases e (events). */
const REVENUE = sql`(e.status = 'completed' AND e.verification = 'verified' AND NOT e.self_pay)`

interface DoctorShape {
  ok?: unknown
  score?: { passed?: unknown; total?: unknown }
}

function doctorSummary(raw: unknown): { ok: boolean; passed: number; total: number } | null {
  const doc = raw as DoctorShape | null | undefined
  if (!doc || typeof doc.ok !== 'boolean') return null
  const { passed, total } = doc.score ?? {}
  return typeof passed === 'number' && typeof total === 'number' ? { ok: doc.ok, passed, total } : null
}

type PaymentRow = {
  event: typeof paymentEvents.$inferSelect
  transfer: { status: string; txHash: string | null } | null
}

function paymentView({ event: e, transfer }: PaymentRow) {
  return {
    id: e.id,
    ts: e.ts.toISOString(),
    effectiveTs: e.effectiveTs.toISOString(),
    serviceKey: e.serviceKey,
    route: e.route,
    method: e.method,
    rail: e.rail,
    network: e.network,
    amountAtomic: e.amountAtomic,
    payer: checksum(e.payer),
    payTo: checksum(e.payTo),
    txHash: e.txHash,
    paymentId: e.paymentId,
    status: e.status,
    latencyMs: e.latencyMs,
    backendStatus: e.backendStatus,
    error: e.error,
    verification: e.verification,
    verificationReason: e.verificationReason,
    selfPay: e.selfPay,
    gateway: e.rail === 'gateway' && transfer ? { status: transfer.status, txHash: transfer.txHash } : null,
  }
}

const CSV_HEADER = [
  'time', 'id', 'rail', 'route', 'method', 'amount_usdc', 'amount_atomic', 'payer', 'pay_to', 'tx_hash', 'payment_id',
  'status', 'verification', 'verification_reason', 'gateway_status', 'self_pay', 'latency_ms', 'backend_status',
]

/** Provider-supplied text reaches a spreadsheet, so a leading formula character is neutralised. */
export function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

function csvRow({ event: e, transfer }: PaymentRow): string {
  return [
    e.effectiveTs.toISOString(), e.id, e.rail, e.route, e.method, formatUsdc(e.amountAtomic), e.amountAtomic, checksum(e.payer),
    checksum(e.payTo), e.txHash, e.paymentId, e.status, e.verification, e.verificationReason, transfer?.status ?? null, e.selfPay,
    e.latencyMs, e.backendStatus,
  ]
    .map(csvCell)
    .join(',')
}
