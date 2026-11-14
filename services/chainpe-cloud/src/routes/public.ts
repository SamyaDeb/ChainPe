/**
 * Public, read-only reputation and settlement data. No session, no keys: anyone (an agent deciding whom to pay,
 * the explorer page) can read it. Everything here comes from the chain, so nothing in it is private.
 *
 * Revenue shown is verified and excludes self-pay, so a provider cannot inflate its own numbers by paying itself.
 */
import { sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import type { Db } from '../db.js'
import { PAID_SCORE, RAW_SCORE, SCORE } from '../reputation.js'
import { checksum, HttpError, parse, zBytes32 } from '../util.js'

const SETTLED = sql`(e.status = 'completed' AND e.verification = 'verified' AND NOT e.self_pay)`
const num = (v: string | null): number | null => (v === null ? null : Number(v))

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) })
const feedQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) })

export function publicRoutes({ db, limit }: { db: Db; limit: import('express').RequestHandler }): Router {
  const router = Router()
  router.use(limit)
  router.use((_req, res, next) => {
    // Short shared cache: the explorer polls, and a CDN can absorb the rest.
    res.set('Cache-Control', 'public, max-age=5')
    next()
  })

  router.get('/services', async (_req, res) => {
    const rows = await db.execute<{
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
        (SELECT COALESCE(SUM(e.amount_atomic), 0) FROM payment_events e WHERE e.service_key = s.key AND ${SETTLED})::text AS total_settled,
        (SELECT COUNT(*) FROM payment_events e WHERE e.service_key = s.key AND ${SETTLED})::text AS paid_calls,
        EXISTS (SELECT 1 FROM services o WHERE o.active AND o.pay_to = s.pay_to AND (o.created_block, o.key) < (s.created_block, s.key)) AS pay_to_shared
      FROM services s WHERE s.active ORDER BY s.created_block, s.key
    `)
    res.json({
      services: rows.rows.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        tags: r.tags,
        endpoint: r.endpoint,
        price: r.price,
        payTo: checksum(r.pay_to),
        provider: checksum(r.provider),
        agentId: r.agent_id,
        // Null with no verified paid ratings yet. Never fall back to the raw score: that is the whole point.
        paidScore: num(r.paid_score),
        paidReviews: Number(r.paid_reviews),
        rawScore: num(r.raw_score),
        rawReviews: Number(r.raw_reviews),
        totalSettledAtomic: r.total_settled,
        paidCalls: Number(r.paid_calls),
        // True when an earlier service already uses this payTo: this one is not credited with its payments or ratings.
        payToShared: r.pay_to_shared,
      })),
    })
  })

  router.get('/services/:key/reviews', async (req, res) => {
    const key = parse(zBytes32, req.params.key).toLowerCase()
    const { limit: take, offset } = parse(listQuery, req.query)
    const found = await db.execute<{ agent_id: string | null; pay_to: string }>(
      sql`SELECT agent_id::text AS agent_id, pay_to FROM services WHERE key = ${key} AND active`
    )
    const svc = found.rows[0]
    if (!svc) throw new HttpError(404, 'not_found', 'No such service.')
    if (!svc.agent_id) {
      res.json({ reviews: [], total: 0, limit: take, offset })
      return
    }
    // A verified rating belongs to the payTo it paid; unverified ones cannot be attributed, so they show on the agent.
    const scope = sql`f.agent_id = ${svc.agent_id} AND (f.paid_to IS NULL OR f.paid_to = ${svc.pay_to})`
    const total = (await db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM feedback f WHERE ${scope}`)).rows[0].n
    const rows = await db.execute<{
      client: string
      feedback_index: string
      score: string
      tag1: string | null
      endpoint: string | null
      verified: boolean
      verification_reason: string | null
      next_verify_at: Date | string | null
      payment_tx: string | null
      paid_atomic: string | null
      revoked: boolean
      block_ts: Date | string
      tx_hash: string
    }>(sql`
      SELECT f.client, f.feedback_index::text AS feedback_index, ${SCORE}::text AS score, f.tag1, f.endpoint, f.verified, f.verification_reason,
        f.next_verify_at, f.payment_tx, f.paid_atomic::text AS paid_atomic, f.revoked, f.block_ts, f.tx_hash
      FROM feedback f WHERE ${scope}
      ORDER BY f.block DESC, f.feedback_index DESC, f.client LIMIT ${take} OFFSET ${offset}
    `)
    res.json({
      reviews: rows.rows.map((r) => ({
        client: checksum(r.client),
        feedbackIndex: r.feedback_index,
        score: Number(r.score),
        tag1: r.tag1,
        endpoint: r.endpoint,
        // verified: counted in the paid score. pending: still being checked. unverified: never counted, see the reason.
        status: r.verified ? 'verified' : r.next_verify_at ? 'pending' : 'unverified',
        verified: r.verified,
        verificationReason: r.verification_reason,
        paymentTx: r.payment_tx,
        paidAtomic: r.paid_atomic,
        revoked: r.revoked,
        blockTs: new Date(r.block_ts).toISOString(),
        txHash: r.tx_hash,
      })),
      total: Number(total),
      limit: take,
      offset,
    })
  })

  router.get('/feed', async (req, res) => {
    const { limit: take } = parse(feedQuery, req.query)
    const rows = await db.execute<{ tx_hash: string | null; service_key: string; name: string; amount_atomic: string; payer: string; ts: Date | string }>(sql`
      SELECT e.tx_hash, e.service_key, s.name, e.amount_atomic::text AS amount_atomic, e.payer, e.effective_ts AS ts
      FROM payment_events e JOIN services s ON s.key = e.service_key
      WHERE ${SETTLED} AND e.tx_hash IS NOT NULL
      ORDER BY e.effective_ts DESC, e.id DESC LIMIT ${take}
    `)
    res.json({
      settlements: rows.rows.map((r) => ({
        txHash: r.tx_hash,
        serviceKey: r.service_key,
        service: r.name,
        amountAtomic: r.amount_atomic,
        payer: checksum(r.payer),
        ts: new Date(r.ts).toISOString(),
      })),
    })
  })

  router.get('/stats', async (_req, res) => {
    const { rows } = await db.execute<{ settled: string; calls: string; services: string; reviews: string; raw_reviews: string }>(sql`
      SELECT
        (SELECT COALESCE(SUM(e.amount_atomic), 0) FROM payment_events e WHERE ${SETTLED})::text AS settled,
        (SELECT COUNT(*) FROM payment_events e WHERE ${SETTLED})::text AS calls,
        (SELECT COUNT(*) FROM services WHERE active)::text AS services,
        (SELECT COUNT(*) FROM feedback f WHERE f.verified AND NOT f.revoked)::text AS reviews,
        (SELECT COUNT(*) FROM feedback f WHERE NOT f.revoked)::text AS raw_reviews
    `)
    const s = rows[0]
    res.json({
      totalSettledAtomic: s.settled,
      paidCalls: Number(s.calls),
      services: Number(s.services),
      verifiedReviews: Number(s.reviews),
      totalReviews: Number(s.raw_reviews),
    })
  })

  return router
}
