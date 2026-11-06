/**
 * The usage fee, spec 12. Records a fee for each verified payment, then collects in batches from
 * the provider's allowance to ChainPeFees. Runs on one instance, like the other workers.
 */
import { randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getAddress } from 'viem'
import type { FeeChain } from './chain.js'
import type { Db } from './db.js'
import type { ProviderViews } from './plan.js'
import { feeAccounts, feeAccruals, feeBatches, gatewayTransfers, paymentEvents, providers } from './schema.js'
import { safeMessage } from './util.js'

const DAY_MS = 24 * 60 * 60 * 1000
const BATCH_PROVIDERS = 200

export interface FeeConfig {
  contract: string
  freeBps: number
  proBps: number
  collectAtAtomic: bigint
  collectMinAtomic: bigint
  lockAtAtomic: bigint
  /** Providers registered from this time on are charged without opting in. Null means everyone opts in. */
  startAt: Date | null
}

export interface FeesOptions {
  db: Db
  views: ProviderViews
  chain: FeeChain
  config: FeeConfig
  now?: () => number
  log?: (message: string) => void
}

export interface Fees {
  accrue(): Promise<void>
  collect(): Promise<void>
  run(): Promise<void>
  isLocked(provider: string): Promise<boolean>
  summary(provider: string): Promise<unknown>
}

/** A payment the fee applies to. Gateway counts only once its batch has landed. */
const CHARGEABLE = sql`(e.status = 'completed' AND e.verification = 'verified' AND NOT e.self_pay
  AND (e.rail = 'exact' OR g.status = 'completed'))`

export function createFees(options: FeesOptions): Fees {
  const { db, views, chain, config, now = Date.now, log = console.warn } = options

  const account = (provider: string) => provider as `0x${string}`

  /** When charging starts for this provider, or null if it has not started. An allowance is the opt-in. */
  async function chargingFrom(provider: string): Promise<Date | null> {
    const [row] = await db.select().from(feeAccounts).where(eq(feeAccounts.provider, provider))
    if (row) return row.enrolledAt
    if ((await chain.allowance(account(provider))) > 0n) {
      const enrolledAt = new Date(now())
      await db.insert(feeAccounts).values({ provider, enrolledAt }).onConflictDoNothing()
      return enrolledAt
    }
    if (config.startAt) {
      const [registered] = await db.select({ createdAt: providers.createdAt }).from(providers).where(eq(providers.address, provider))
      if (registered && registered.createdAt >= config.startAt) return config.startAt
    }
    return null
  }

  async function accrue(): Promise<void> {
    // A fee not yet collected follows its payment: adding the payer to "my wallets" drops it.
    await db.execute(sql`
      DELETE FROM ${feeAccruals} a USING ${paymentEvents} e
      WHERE a.provider = e.provider AND a.event_id = e.id AND a.batch_id IS NULL
        AND (e.self_pay OR e.verification <> 'verified' OR e.status <> 'completed')
    `)

    const due = await db.execute<{ provider: string }>(sql`
      SELECT DISTINCT e.provider
      FROM ${paymentEvents} e
      LEFT JOIN ${gatewayTransfers} g ON g.id = e.payment_id AND e.rail = 'gateway'
      LEFT JOIN ${feeAccruals} a ON a.provider = e.provider AND a.event_id = e.id
      WHERE ${CHARGEABLE} AND a.event_id IS NULL
      LIMIT ${BATCH_PROVIDERS}
    `)

    for (const { provider } of due.rows) {
      try {
        const from = await chargingFrom(provider)
        if (!from) continue
        const { plan } = await views.get(provider)
        const bps = plan === 'pro' ? config.proBps : config.freeBps
        const at = new Date(now())
        await db.execute(sql`
          INSERT INTO ${feeAccruals} (provider, event_id, revenue_atomic, fee_bps, fee_atomic, accrued_at)
          SELECT e.provider, e.id, e.amount_atomic, ${bps}, FLOOR(e.amount_atomic * ${bps} / 10000), ${at.toISOString()}::timestamptz
          FROM ${paymentEvents} e
          LEFT JOIN ${gatewayTransfers} g ON g.id = e.payment_id AND e.rail = 'gateway'
          WHERE e.provider = ${provider} AND ${CHARGEABLE} AND e.effective_ts >= ${from.toISOString()}::timestamptz
          ON CONFLICT DO NOTHING
        `)
      } catch (err) {
        log(`fee accrual failed for ${provider}: ${safeMessage(err)}`)
      }
    }
  }

  async function release(batchId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(feeAccruals).set({ batchId: null }).where(eq(feeAccruals.batchId, batchId))
      await tx.update(feeBatches).set({ status: 'failed', updatedAt: new Date(now()) }).where(eq(feeBatches.id, batchId))
    })
  }

  async function markCollected(batchId: string, txHash?: string): Promise<void> {
    await db
      .update(feeBatches)
      .set({ status: 'collected', updatedAt: new Date(now()), ...(txHash ? { txHash } : {}) })
      .where(eq(feeBatches.id, batchId))
  }

  async function send(batch: typeof feeBatches.$inferSelect): Promise<void> {
    const hash = await chain.collect({
      provider: account(batch.provider),
      revenueAtomic: BigInt(batch.revenueAtomic),
      feeAtomic: BigInt(batch.feeAtomic),
      batchId: batch.id as `0x${string}`,
    })
    await db.update(feeBatches).set({ txHash: hash, updatedAt: new Date(now()) }).where(eq(feeBatches.id, batch.id))
    if ((await chain.receiptStatus(hash)) === 'success') await markCollected(batch.id, hash)
    else await release(batch.id)
  }

  /** A batch left pending by a crash or a lost connection. The chain says whether it landed. */
  async function resume(batch: typeof feeBatches.$inferSelect): Promise<void> {
    if (await chain.batchCollected(batch.id as `0x${string}`)) {
      await markCollected(batch.id)
      return
    }
    if ((await chain.allowance(account(batch.provider))) < BigInt(batch.feeAtomic)) {
      await release(batch.id)
      return
    }
    await send(batch)
  }

  async function collect(): Promise<void> {
    if (!chain.canCollect) return

    const pending = await db.select().from(feeBatches).where(eq(feeBatches.status, 'pending'))
    const busy = new Set<string>()
    for (const batch of pending) {
      try {
        await resume(batch)
      } catch (err) {
        busy.add(batch.provider)
        log(`fee batch ${batch.id} is still pending: ${safeMessage(err)}`)
      }
    }

    const open = await db
      .select({
        provider: feeAccruals.provider,
        fee: sql<string>`SUM(${feeAccruals.feeAtomic})::text`,
        revenue: sql<string>`SUM(${feeAccruals.revenueAtomic})::text`,
        oldest: sql<string>`MIN(${feeAccruals.accruedAt})::text`,
      })
      .from(feeAccruals)
      .where(isNull(feeAccruals.batchId))
      .groupBy(feeAccruals.provider)

    for (const row of open) {
      if (busy.has(row.provider)) continue
      const fee = BigInt(row.fee)
      const dayOld = now() - new Date(row.oldest).getTime() >= DAY_MS
      if (fee < config.collectAtAtomic && !(dayOld && fee >= config.collectMinAtomic)) continue
      try {
        const provider = account(row.provider)
        // Short of either one, the fee stays owed and counts toward the lock.
        if ((await chain.allowance(provider)) < fee || (await chain.balance(provider)) < fee) continue
        const id = `0x${randomBytes(32).toString('hex')}`
        const at = new Date(now())
        const batch = await db.transaction(async (tx) => {
          const claimed = await tx
            .update(feeAccruals)
            .set({ batchId: id })
            .where(and(eq(feeAccruals.provider, row.provider), isNull(feeAccruals.batchId)))
            .returning({ revenue: feeAccruals.revenueAtomic, fee: feeAccruals.feeAtomic })
          const [created] = await tx
            .insert(feeBatches)
            .values({
              id,
              provider: row.provider,
              revenueAtomic: claimed.reduce((sum, c) => sum + BigInt(c.revenue), 0n).toString(),
              feeAtomic: claimed.reduce((sum, c) => sum + BigInt(c.fee), 0n).toString(),
              status: 'pending',
              createdAt: at,
              updatedAt: at,
            })
            .returning()
          return created
        })
        await send(batch)
      } catch (err) {
        log(`fee collection failed for ${row.provider}: ${safeMessage(err)}`)
      }
    }
  }

  async function owedAndCollected(provider: string): Promise<{ owed: bigint; collected: bigint }> {
    const [row] = (
      await db.execute<{ owed: string; collected: string }>(sql`
        SELECT COALESCE(SUM(a.fee_atomic) FILTER (WHERE b.status IS DISTINCT FROM 'collected'), 0)::text AS owed,
               COALESCE(SUM(a.fee_atomic) FILTER (WHERE b.status = 'collected'), 0)::text AS collected
        FROM ${feeAccruals} a
        LEFT JOIN ${feeBatches} b ON b.id = a.batch_id
        WHERE a.provider = ${provider}
      `)
    ).rows
    return { owed: BigInt(row.owed), collected: BigInt(row.collected) }
  }

  return {
    accrue,
    collect,
    async run() {
      await accrue()
      await collect()
    },
    async isLocked(provider) {
      return (await owedAndCollected(provider)).owed >= config.lockAtAtomic
    },
    async summary(provider) {
      let allowance: bigint | null = null
      try {
        allowance = await chain.allowance(account(provider))
        // The dashboard reloads this right after an approval, so charging starts then, not at the next payment.
        if (allowance > 0n) await db.insert(feeAccounts).values({ provider, enrolledAt: new Date(now()) }).onConflictDoNothing()
      } catch {
        // An outage must not read as "no allowance".
      }
      const [{ owed, collected }, view, [enrolled], batches] = await Promise.all([
        owedAndCollected(provider),
        views.get(provider),
        db.select().from(feeAccounts).where(eq(feeAccounts.provider, provider)),
        db
          .select()
          .from(feeBatches)
          .where(and(eq(feeBatches.provider, provider), inArray(feeBatches.status, ['pending', 'collected', 'failed'])))
          .orderBy(desc(feeBatches.createdAt))
          .limit(20),
      ])
      return {
        enabled: true,
        contract: getAddress(config.contract),
        status: enrolled || owed > 0n || collected > 0n ? 'active' : 'not_enrolled',
        enrolledAt: enrolled ? enrolled.enrolledAt.toISOString() : null,
        rateBps: view.plan === 'pro' ? config.proBps : config.freeBps,
        rates: { freeBps: config.freeBps, proBps: config.proBps },
        owedAtomic: owed.toString(),
        collectedAtomic: collected.toString(),
        allowanceAtomic: allowance === null ? null : allowance.toString(),
        lockAtAtomic: config.lockAtAtomic.toString(),
        locked: owed >= config.lockAtAtomic,
        batches: batches.map((b) => ({
          id: b.id,
          revenueAtomic: b.revenueAtomic,
          feeAtomic: b.feeAtomic,
          status: b.status,
          txHash: b.txHash,
          createdAt: b.createdAt.toISOString(),
        })),
      }
    },
  }
}
