/**
 * Decides which proxy events are real. Status always comes from the source record
 * (a USDC Transfer log on Avalanche), never from what the proxy reported.
 *
 * Most Avalanche payments never pass through here: the indexer records them straight from the
 * transfer (workers/payments.ts). This handles events a proxy reports, which carry the route and
 * latency. When one matches a transfer the indexer already recorded, it takes that claim over.
 */
import { and, eq, gt, inArray, like, sql } from 'drizzle-orm'
import type { Db } from '../db.js'
import { onchainTransfers, paymentEvents } from '../schema.js'
import { safeMessage } from '../util.js'
import { type IndexerRpc, toTransfer, upsertTransfers } from './indexer.js'
import { ONCHAIN_ID_PREFIX } from './payments.js'

const OPEN_WINDOW = sql`now() - interval '7 days'`
const RECEIPT_AFTER_MS = 30_000
const BATCH = 500

type Event = typeof paymentEvents.$inferSelect

export interface ReconcilerOptions {
  db: Db
  rpc?: Pick<IndexerRpc, 'getTransactionReceipt' | 'blockTimestamp'>
  usdc: string
  now?: () => number
  log?: (message: string) => void
}

const isUniqueViolation = (err: unknown): boolean => {
  const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
  return code === '23505'
}

export function createReconciler(options: ReconcilerOptions) {
  const { db, rpc, usdc, now = Date.now, log = console.warn } = options

  async function settle(event: Event, fields: Partial<Event>): Promise<void> {
    try {
      await db
        .update(paymentEvents)
        .set(fields)
        .where(and(eq(paymentEvents.provider, event.provider), eq(paymentEvents.id, event.id)))
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      await db
        .update(paymentEvents)
        .set({ verification: 'unverified', verificationReason: 'already_claimed', matchedTransfer: null })
        .where(and(eq(paymentEvents.provider, event.provider), eq(paymentEvents.id, event.id)))
    }
  }

  async function reconcileExact(): Promise<void> {
    const open = await db
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.rail, 'exact'),
          eq(paymentEvents.status, 'completed'),
          eq(paymentEvents.verification, 'unverified'),
          // Logs never change, so a mismatch is final. Only a transfer that has not shown up can still resolve.
          inArray(paymentEvents.verificationReason, ['no_transfer_yet', 'not_completed']),
          gt(paymentEvents.receivedAt, OPEN_WINDOW)
        )
      )
      .orderBy(paymentEvents.receivedAt, paymentEvents.id)
      .limit(BATCH)

    for (const event of open) {
      if (!event.txHash) {
        await settle(event, { verificationReason: 'no_tx_hash' })
        continue
      }
      await receiptFallback(event)
      const transfers = await db
        .select()
        .from(onchainTransfers)
        .where(and(eq(onchainTransfers.txHash, event.txHash), eq(onchainTransfers.to, event.payTo)))
        .orderBy(onchainTransfers.logIndex)
      if (transfers.length === 0) {
        await settle(event, { verificationReason: 'no_transfer_yet' })
        continue
      }
      const sameAmount = transfers.filter((t) => t.amountAtomic === event.amountAtomic)
      if (sameAmount.length === 0) {
        await settle(event, { verificationReason: 'amount_mismatch' })
        continue
      }
      const samePayer = sameAmount.filter((t) => t.from === event.payer)
      if (samePayer.length === 0) {
        await settle(event, { verificationReason: 'payer_mismatch' })
        continue
      }
      const claims = samePayer.map((t) => `exact:${t.txHash}:${t.logIndex}`)
      const taken = await db
        .select({ claim: paymentEvents.matchedTransfer, provider: paymentEvents.provider, id: paymentEvents.id })
        .from(paymentEvents)
        .where(inArray(paymentEvents.matchedTransfer, claims))
      const takenSet = new Set(taken.map((row) => row.claim))
      let claim = claims.find((c) => !takenSet.has(c))
      if (!claim) {
        // The indexer's own record of this provider's payment gives way to the proxy's richer one.
        const derived = taken.find((row) => row.provider === event.provider && row.id.startsWith(ONCHAIN_ID_PREFIX))
        if (derived) {
          await db
            .delete(paymentEvents)
            .where(and(eq(paymentEvents.provider, derived.provider), eq(paymentEvents.id, derived.id), like(paymentEvents.id, `${ONCHAIN_ID_PREFIX}%`)))
          claim = derived.claim ?? undefined
        }
      }
      if (!claim) {
        await settle(event, { verificationReason: 'already_claimed' })
        continue
      }
      const transfer = samePayer.find((t) => `exact:${t.txHash}:${t.logIndex}` === claim)!
      await settle(event, {
        verification: 'verified',
        verificationReason: null,
        matchedTransfer: claim,
        effectiveTs: transfer.blockTs,
      })
    }
  }

  /** Closes any gap the log scan left: one receipt read per event, once the scan has had time to pass it. */
  async function receiptFallback(event: Event): Promise<void> {
    if (!rpc || event.receiptCheckedAt || !event.txHash) return
    if (now() - event.receivedAt.getTime() < RECEIPT_AFTER_MS) return
    const [known] = await db
      .select({ log: onchainTransfers.logIndex })
      .from(onchainTransfers)
      .where(and(eq(onchainTransfers.txHash, event.txHash), eq(onchainTransfers.to, event.payTo)))
      .limit(1)
    if (known !== undefined) return
    try {
      const receipt = await rpc.getTransactionReceipt(event.txHash as `0x${string}`)
      if (receipt) {
        const rows = []
        for (const entry of receipt.logs) {
          const row = toTransfer(entry, await rpc.blockTimestamp(receipt.blockNumber), usdc)
          if (row && row.to === event.payTo) rows.push(row)
        }
        await upsertTransfers(db, rows)
      }
      await db
        .update(paymentEvents)
        .set({ receiptCheckedAt: new Date(now()) })
        .where(and(eq(paymentEvents.provider, event.provider), eq(paymentEvents.id, event.id)))
    } catch (err) {
      log(`receipt lookup failed for ${event.txHash}: ${safeMessage(err)}`)
    }
  }

  return {
    async run(): Promise<void> {
      await reconcileExact()
    },
  }
}

export type Reconciler = ReturnType<typeof createReconciler>
