/**
 * Decides which proxy events are real. Status always comes from the source record
 * (a Transfer log or Circle's transfer), never from what the proxy reported.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db.js'
import { gatewayTransfers, onchainTransfers, paymentEvents } from '../schema.js'
import { safeMessage } from '../util.js'
import { SYSTEM_EMITTER, type IndexerRpc, transferFromReceiptLog, upsertTransfers } from './indexer.js'

const OPEN_WINDOW = sql`now() - interval '7 days'`
const RECEIPT_AFTER_MS = 30_000
const BATCH = 500

type Event = typeof paymentEvents.$inferSelect

export interface ReconcilerOptions {
  db: Db
  rpc?: Pick<IndexerRpc, 'getTransactionReceipt' | 'blockTimestamp'>
  caip2: string
  now?: () => number
  log?: (message: string) => void
}

const isUniqueViolation = (err: unknown): boolean => {
  const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
  return code === '23505'
}

export function createReconciler(options: ReconcilerOptions) {
  const { db, rpc, caip2, now = Date.now, log = console.warn } = options

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
        .where(and(eq(onchainTransfers.txHash, event.txHash), eq(onchainTransfers.to, event.provider)))
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
        .select({ claim: paymentEvents.matchedTransfer })
        .from(paymentEvents)
        .where(inArray(paymentEvents.matchedTransfer, claims))
      const takenSet = new Set(taken.map((row) => row.claim))
      const free = samePayer.find((t) => !takenSet.has(`exact:${t.txHash}:${t.logIndex}`))
      if (!free) {
        await settle(event, { verificationReason: 'already_claimed' })
        continue
      }
      await settle(event, {
        verification: 'verified',
        verificationReason: null,
        matchedTransfer: `exact:${free.txHash}:${free.logIndex}`,
        effectiveTs: free.blockTs,
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
      .where(and(eq(onchainTransfers.txHash, event.txHash), eq(onchainTransfers.to, event.provider)))
      .limit(1)
    if (known !== undefined) return
    try {
      const receipt = await rpc.getTransactionReceipt(event.txHash as `0x${string}`)
      if (receipt) {
        const matching = receipt.logs.filter((l) => l.address.toLowerCase() === SYSTEM_EMITTER)
        const rows = []
        for (const entry of matching) {
          const row = transferFromReceiptLog(entry, await rpc.blockTimestamp(receipt.blockNumber))
          if (row && row.to === event.provider) rows.push(row)
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

  async function reconcileGateway(): Promise<void> {
    const rows = await db
      .select({ event: paymentEvents, transfer: gatewayTransfers })
      .from(paymentEvents)
      .leftJoin(gatewayTransfers, eq(paymentEvents.paymentId, gatewayTransfers.id))
      .where(
        and(
          eq(paymentEvents.rail, 'gateway'),
          eq(paymentEvents.status, 'completed'),
          gt(paymentEvents.receivedAt, OPEN_WINDOW),
          sql`(
            (${paymentEvents.verification} = 'unverified' AND ${paymentEvents.verificationReason} IN ('no_transfer_yet', 'not_completed'))
            OR (${paymentEvents.verification} = 'verified' AND ${gatewayTransfers.status} = 'failed')
            OR (${paymentEvents.verification} = 'failed' AND ${gatewayTransfers.status} <> 'failed')
          )`
        )
      )
      .orderBy(paymentEvents.receivedAt, paymentEvents.id)
      .limit(BATCH)

    for (const { event, transfer } of rows) {
      if (!event.paymentId) {
        await settle(event, { verificationReason: 'no_transfer_id' })
      } else if (!transfer) {
        await settle(event, { verificationReason: 'no_transfer_yet' })
      } else if (transfer.to !== event.provider) {
        await settle(event, { verification: 'unverified', verificationReason: 'recipient_mismatch', matchedTransfer: null })
      } else if (transfer.amountAtomic !== event.amountAtomic) {
        await settle(event, { verification: 'unverified', verificationReason: 'amount_mismatch', matchedTransfer: null })
      } else if (transfer.from !== event.payer) {
        await settle(event, { verification: 'unverified', verificationReason: 'payer_mismatch', matchedTransfer: null })
      } else if (transfer.token !== 'USDC' || transfer.network !== caip2) {
        await settle(event, { verification: 'unverified', verificationReason: 'asset_mismatch', matchedTransfer: null })
      } else if (transfer.status === 'failed') {
        // The Phase 2 gap: served, then the batch failed. It leaves revenue and shows as unpaid.
        await settle(event, { verification: 'failed', verificationReason: 'gateway_failed', matchedTransfer: null })
      } else {
        await settle(event, {
          verification: 'verified',
          verificationReason: null,
          matchedTransfer: `gateway:${transfer.id}`,
          effectiveTs: transfer.createdAt,
        })
      }
    }
  }

  return {
    async run(): Promise<void> {
      await reconcileExact()
      await reconcileGateway()
    },
  }
}

export type Reconciler = ReturnType<typeof createReconciler>
