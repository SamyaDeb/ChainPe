/**
 * Proxy telemetry. Treated as a claim, never as fact: nothing here marks an event
 * verified, and strict schemas mean a signature cannot be stored even by accident.
 */
import { and, eq, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import type { ChainReader } from '../chain.js'
import type { Db } from '../db.js'
import { heartbeats, myWallets, paymentEvents, services } from '../schema.js'
import { HttpError, parse, zAddress, zBytes32 } from '../util.js'

export const MAX_EVENTS = 500
const MAX_DOCTOR_BYTES = 64 * 1024
const MAX_FUTURE_MS = 5 * 60 * 1000

const atomicString = z.string().regex(/^\d{1,78}$/, 'must be an atomic integer string')

const eventSchema = z
  .object({
    id: z.string().regex(/^chainpe_[0-9a-f]{48}$/, 'must be chainpe_<48 hex>'),
    ts: z.number().int().positive(),
    route: z.string().min(1).max(512),
    method: z.string().min(1).max(16),
    rail: z.enum(['exact', 'gateway']),
    network: z.string().regex(/^eip155:\d+$/),
    amountAtomic: atomicString,
    payer: z.union([zAddress, z.literal('unknown')]),
    payTo: zAddress,
    serviceKey: zBytes32.transform((v) => v.toLowerCase()).optional(),
    txHash: zBytes32.transform((v) => v.toLowerCase()).optional(),
    paymentId: z.string().regex(/^[\w-]{1,128}$/, 'must be a transfer id').optional(),
    status: z.enum(['completed', 'failed', 'pending']),
    latencyMs: z.number().int().min(0).max(2_147_483_647),
    backendStatus: z.number().int().min(100).max(599).optional(),
    error: z.string().max(256).optional(),
  })
  .strict()

type IngestEvent = z.output<typeof eventSchema>

const heartbeatSchema = z
  .object({
    serviceKey: zBytes32.transform((v) => v.toLowerCase()),
    version: z.string().min(1).max(64),
    network: z.string().regex(/^eip155:\d+$/),
    rails: z.array(z.enum(['exact', 'gateway'])).max(2),
    gatewayBalanceAtomic: atomicString.optional(),
    doctor: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const RANK: Record<IngestEvent['status'], number> = { failed: 0, pending: 0, completed: 1 }

/** Duplicates inside one batch would make the upsert touch a row twice, which Postgres refuses. Keeps the strongest. */
function dedupe(events: IngestEvent[]): IngestEvent[] {
  const byId = new Map<string, IngestEvent>()
  for (const event of events) {
    const seen = byId.get(event.id)
    if (!seen || RANK[event.status] > RANK[seen.status]) byId.set(event.id, event)
  }
  return [...byId.values()]
}

export interface IngestOptions {
  db: Db
  chain: ChainReader
  caip2: string
  requireKey: import('express').RequestHandler
  onEvents?: () => void
  now?: () => number
}

export function ingestRoutes({ db, chain, caip2, requireKey, onEvents, now = Date.now }: IngestOptions): Router {
  const router = Router()

  router.post('/ingest/events', requireKey, async (req, res) => {
    const provider = req.provider!
    const envelope = parse(z.object({ events: z.array(z.unknown()).min(1) }).strict(), req.body)
    if (envelope.events.length > MAX_EVENTS) {
      throw new HttpError(413, 'payload_too_large', `At most ${MAX_EVENTS} events per request.`)
    }
    const events = dedupe(parse(z.array(eventSchema), envelope.events))

    for (const event of events) {
      if (event.payTo !== provider) {
        throw new HttpError(403, 'pay_to_mismatch', `Event ${event.id} pays ${event.payTo}, which is not this key's provider.`)
      }
      if (event.network !== caip2) {
        throw new HttpError(400, 'wrong_network', `This API serves ${caip2}, not ${event.network}.`)
      }
      if (event.ts > now() + MAX_FUTURE_MS) {
        throw new HttpError(400, 'invalid_request', `Event ${event.id} is dated in the future.`)
      }
    }

    const wallets = await db.select({ address: myWallets.address }).from(myWallets).where(eq(myWallets.provider, provider))
    const own = new Set([provider, ...wallets.map((w) => w.address)])

    // A completed event never changes, or a replay's failed event could erase a real payment.
    // pending and failed may still improve, because a retried payment keeps its id.
    const rows = await db
      .insert(paymentEvents)
      .values(
        events.map((event) => ({
          provider,
          id: event.id,
          serviceKey: event.serviceKey ?? null,
          ts: new Date(event.ts),
          effectiveTs: new Date(event.ts),
          route: event.route,
          method: event.method,
          rail: event.rail,
          network: event.network,
          amountAtomic: event.amountAtomic,
          payer: event.payer,
          payTo: event.payTo,
          txHash: event.txHash ?? null,
          paymentId: event.paymentId ?? null,
          status: event.status,
          latencyMs: event.latencyMs,
          backendStatus: event.backendStatus ?? null,
          error: event.error ?? null,
          verificationReason: initialReason(event),
          selfPay: own.has(event.payer),
        }))
      )
      .onConflictDoUpdate({
        target: [paymentEvents.provider, paymentEvents.id],
        set: {
          status: sql`excluded.status`,
          amountAtomic: sql`excluded.amount_atomic`,
          payer: sql`excluded.payer`,
          txHash: sql`excluded.tx_hash`,
          paymentId: sql`excluded.payment_id`,
          latencyMs: sql`excluded.latency_ms`,
          backendStatus: sql`excluded.backend_status`,
          error: sql`excluded.error`,
          selfPay: sql`excluded.self_pay`,
          verificationReason: sql`excluded.verification_reason`,
        },
        where: sql`${paymentEvents.status} <> 'completed'
          AND (excluded.status = 'completed' OR (${paymentEvents.status} = 'pending' AND excluded.status = 'failed'))`,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` })

    const accepted = rows.filter((row) => row.inserted).length
    const updated = rows.length - accepted
    if (rows.length > 0) onEvents?.()
    res.json({ accepted, updated, duplicates: events.length - rows.length })
  })

  router.post('/ingest/heartbeat', requireKey, async (req, res) => {
    const provider = req.provider!
    const body = parse(heartbeatSchema, req.body)
    if (body.network !== caip2) throw new HttpError(400, 'wrong_network', `This API serves ${caip2}, not ${body.network}.`)
    if (body.doctor && Buffer.byteLength(JSON.stringify(body.doctor)) > MAX_DOCTOR_BYTES) {
      throw new HttpError(413, 'payload_too_large', 'The doctor report is over 64 KB.')
    }
    if (!(await ownsService(db, chain, provider, body.serviceKey))) {
      throw new HttpError(403, 'service_not_owned', "That service key is not this key's provider's.")
    }
    await db.insert(heartbeats).values({
      serviceKey: body.serviceKey,
      ts: new Date(now()),
      provider,
      version: body.version,
      network: body.network,
      rails: body.rails,
      gatewayBalanceAtomic: body.gatewayBalanceAtomic ?? null,
      doctorJson: body.doctor ?? null,
    })
    res.json({ ok: true })
  })

  return router
}

function initialReason(event: IngestEvent): string {
  return event.status === 'completed' ? 'no_transfer_yet' : 'not_completed'
}

/** The index may not have seen a brand-new service, so a miss asks the chain. */
async function ownsService(db: Db, chain: ChainReader, provider: string, key: string): Promise<boolean> {
  const [row] = await db
    .select({ key: services.key })
    .from(services)
    .where(and(eq(services.key, key), eq(services.provider, provider)))
  if (row) return true
  try {
    return (await chain.serviceProvider(key as `0x${string}`)) === provider
  } catch {
    throw new HttpError(503, 'chain_unavailable', 'Could not read Arc. Try again shortly.')
  }
}
