/**
 * Verifies the payment behind each ERC-8004 rating (Phase 3).
 *
 * A rating carries `feedbackHash`, the x402 settlement tx the rater says it paid with. A rating counts as a
 * "paid review" only if that tx, read straight from the chain:
 *
 *   1. succeeded,
 *   2. moved USDC from the rater to the payTo of a service linked to the rated agent,
 *   3. was an EIP-3009 payment: USDC emitted `AuthorizationUsed` with the rater as authorizer,
 *   4. is at or before the block the rating was posted in,
 *   5. has not already backed another verified rating (one payment, one review),
 *   6. was not paid by the provider itself (its registering wallet or a declared my_wallet).
 *
 * Anything else is stored with a reason and never counted. A rating whose tx or service is not visible yet is
 * retried with exponential backoff, because the indexer or the node may simply be behind.
 */
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm'
import { decodeEventLog } from 'viem'
import type { Db } from '../db.js'
import { feedback, services } from '../schema.js'
import {
  AUTHORIZATION_USED_TOPIC,
  NEW_FEEDBACK_EVENT,
  NEW_FEEDBACK_TOPIC,
  TRANSFER_EVENT,
  TRANSFER_TOPIC,
  type IndexerRpc,
  type RawLog,
} from './indexer.js'
import { ownWallets } from './payments.js'

export type RejectReason =
  | 'no_proof'
  | 'no_payment'
  | 'wrong_payee'
  | 'not_x402'
  | 'reused'
  | 'self_rating'
  | 'payment_after_feedback'
  | 'tx_failed'
  | 'receipt_not_found'
  | 'service_unknown'
  | 'rpc_error'
  | 'below_minimum'

/** A single payment counts for at most this much weight in a score, so one whale cannot dominate. */
export const PAID_WEIGHT_CAP_ATOMIC = 1_000_000n

const BASE_DELAY_MS = 30_000
const MAX_DELAY_MS = 3_600_000
/** A payment below this (0.001 USDC) is too small to back a review, matching the facilitator's MIN_AMOUNT default. */
export const MIN_PAID_ATOMIC = 1_000n

/** About 6 hours of retrying (60s doubling, capped at 1h) before "not found" becomes final. */
export const MAX_ATTEMPTS = 12
const BATCH = 50

export const retryDelayMs = (attempts: number): number => Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS)

type Verdict =
  | { kind: 'verified'; paidAtomic: bigint; paidTo: string; paymentTx: string }
  | { kind: 'rejected'; reason: RejectReason }
  | { kind: 'retry'; reason: RejectReason }

export interface VerifierOptions {
  db: Db
  rpc: Pick<IndexerRpc, 'getTransactionReceipt'>
  usdc: string
  now?: () => number
  log?: (message: string) => void
}

const addr = (topic: string): string => `0x${topic.slice(-40)}`.toLowerCase()

export function createFeedbackVerifier(options: VerifierOptions) {
  const { db, rpc, now = Date.now } = options
  const usdc = options.usdc.toLowerCase()

  /**
   * Ratings indexed before migration 0002 have no stored feedbackHash. Read it back from the NewFeedback log in the
   * rating's own tx. Returns null if the rating carried no proof.
   */
  async function recoverHash(row: typeof feedback.$inferSelect): Promise<string | null | 'retry'> {
    const receipt = await rpc.getTransactionReceipt(row.txHash as `0x${string}`)
    if (!receipt) return 'retry'
    for (const l of receipt.logs) {
      if (l.topics[0] !== NEW_FEEDBACK_TOPIC || l.topics.length < 3) continue
      if (BigInt(l.topics[1]) !== BigInt(row.agentId) || addr(l.topics[2]) !== row.client.toLowerCase()) continue
      try {
        const { args } = decodeEventLog({ abi: [NEW_FEEDBACK_EVENT], topics: l.topics as [`0x${string}`, ...`0x${string}`[]], data: l.data as `0x${string}` })
        if (BigInt(args.feedbackIndex) !== BigInt(row.feedbackIndex)) continue
        const hash = String(args.feedbackHash).toLowerCase()
        return /^0x0{64}$/.test(hash) ? null : hash
      } catch {
        continue
      }
    }
    return null
  }

  async function judge(row: typeof feedback.$inferSelect): Promise<Verdict> {
    const txHash = row.feedbackHash as `0x${string}`
    const client = row.client.toLowerCase()

    const linked = await db.select().from(services).where(and(eq(services.agentId, row.agentId), eq(services.active, true)))
    if (linked.length === 0) return { kind: 'retry', reason: 'service_unknown' }

    // A provider cannot review itself, even through a wallet it declared (the registry also blocks the agent's owner).
    const own = await ownWallets(db, [...new Set(linked.map((s) => s.provider))])
    if (linked.some((s) => s.payTo === client || own.get(s.provider)?.has(client))) return { kind: 'rejected', reason: 'self_rating' }

    const receipt = await rpc.getTransactionReceipt(txHash)
    if (!receipt) return { kind: 'retry', reason: 'receipt_not_found' }
    if (receipt.status !== undefined && receipt.status !== 'success') return { kind: 'rejected', reason: 'tx_failed' }

    const transfers = receiptTransfers(receipt.logs, usdc)
    const fromClient = transfers.filter((t) => t.from === client)
    if (fromClient.length === 0) return { kind: 'rejected', reason: 'no_payment' }

    // Attributed like payments: a payTo belongs to its earliest registrant, so a copycat service earns nothing.
    const payees = new Set<string>()
    for (const payTo of new Set(linked.map((s) => s.payTo))) {
      const [first] = await db
        .select({ agentId: services.agentId })
        .from(services)
        .where(and(eq(services.payTo, payTo), eq(services.active, true)))
        .orderBy(asc(services.createdBlock), asc(services.key))
        .limit(1)
      if (first?.agentId === row.agentId) payees.add(payTo)
    }
    const paid = fromClient.filter((t) => payees.has(t.to))
    if (paid.length === 0) return { kind: 'rejected', reason: 'wrong_payee' }

    // The authorization must belong to the paying transfer itself: USDC emits AuthorizationUsed right next to the
    // Transfer it authorizes, so an unrelated authorization elsewhere in the same tx does not count.
    const authIdx = receipt.logs
      .filter((l) => l.address.toLowerCase() === usdc && l.topics[0] === AUTHORIZATION_USED_TOPIC && l.topics.length === 3 && addr(l.topics[1]) === client)
      .map((l) => l.logIndex)
    const authorizedPaid = paid.filter((t) => authIdx.some((i) => Math.abs(i - t.logIndex) === 1))
    if (authorizedPaid.length === 0) return { kind: 'rejected', reason: 'not_x402' }

    if (receipt.blockNumber > row.block) return { kind: 'rejected', reason: 'payment_after_feedback' }

    // The largest single payee wins if one tx paid several of the agent's addresses.
    const byPayee = new Map<string, bigint>()
    for (const t of authorizedPaid) byPayee.set(t.to, (byPayee.get(t.to) ?? 0n) + t.value)
    const [paidTo, paidAtomic] = [...byPayee.entries()].sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1))[0]
    if (paidAtomic < MIN_PAID_ATOMIC) return { kind: 'rejected', reason: 'below_minimum' }
    return { kind: 'verified', paidAtomic, paidTo, paymentTx: txHash.toLowerCase() }
  }

  async function settle(row: typeof feedback.$inferSelect, verdict: Verdict): Promise<void> {
    const key = and(eq(feedback.agentId, row.agentId), eq(feedback.client, row.client), eq(feedback.feedbackIndex, row.feedbackIndex))
    const attempts = row.verifyAttempts + 1

    if (verdict.kind === 'retry') {
      if (attempts >= MAX_ATTEMPTS) {
        await db.update(feedback).set({ verificationReason: verdict.reason, verifyAttempts: attempts, nextVerifyAt: null }).where(key)
      } else {
        await db
          .update(feedback)
          .set({ verificationReason: verdict.reason, verifyAttempts: attempts, nextVerifyAt: new Date(now() + retryDelayMs(attempts)) })
          .where(key)
      }
      return
    }
    if (verdict.kind === 'rejected') {
      await db.update(feedback).set({ verificationReason: verdict.reason, verifyAttempts: attempts, nextVerifyAt: null }).where(key)
      return
    }

    // The unique index on payment_tx (verified rows) is the arbiter: first rating to claim a payment keeps it.
    try {
      const claimed = await db
        .update(feedback)
        .set({
          verified: true,
          verificationReason: null,
          paidAtomic: verdict.paidAtomic.toString(),
          paidTo: verdict.paidTo,
          paymentTx: verdict.paymentTx,
          verifyAttempts: attempts,
          nextVerifyAt: null,
        })
        .where(and(key, sql`NOT EXISTS (SELECT 1 FROM ${feedback} o WHERE o.payment_tx = ${verdict.paymentTx} AND o.verified)`))
        .returning({ client: feedback.client })
      if (claimed.length === 0) await settle(row, { kind: 'rejected', reason: 'reused' })
    } catch (err) {
      if ((err as { code?: string }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505') {
        await settle(row, { kind: 'rejected', reason: 'reused' })
        return
      }
      throw err
    }
  }

  return {
    /** Verifies every due rating, oldest first so the earliest rating claims a shared payment. Returns true if more are due. */
    async run(): Promise<boolean> {
      const due = await db
        .select()
        .from(feedback)
        .where(and(isNotNull(feedback.nextVerifyAt), lte(feedback.nextVerifyAt, new Date(now())), eq(feedback.verified, false)))
        .orderBy(asc(feedback.block), asc(feedback.feedbackIndex), asc(feedback.client))
        .limit(BATCH)
      for (const row of due) {
        let verdict: Verdict
        try {
          if (!row.feedbackHash) {
            // A rating from before migration 0002: recover its proof from the chain first.
            const recovered = await recoverHash(row)
            if (recovered === 'retry') {
              verdict = { kind: 'retry', reason: 'receipt_not_found' }
            } else if (recovered === null) {
              verdict = { kind: 'rejected', reason: 'no_proof' }
            } else {
              await db
                .update(feedback)
                .set({ feedbackHash: recovered })
                .where(and(eq(feedback.agentId, row.agentId), eq(feedback.client, row.client), eq(feedback.feedbackIndex, row.feedbackIndex)))
              verdict = await judge({ ...row, feedbackHash: recovered })
            }
          } else {
            verdict = await judge(row)
          }
        } catch (err) {
          // An RPC failure (rate limit, timeout) counts as an attempt so one bad row cannot stall the queue.
          options.log?.(`verifyFeedback: rpc error on ${row.txHash}: ${(err as Error).message}`)
          verdict = { kind: 'retry', reason: 'rpc_error' }
        }
        await settle(row, verdict)
      }
      return due.length === BATCH
    },
  }
}

export type FeedbackVerifier = ReturnType<typeof createFeedbackVerifier>

function receiptTransfers(logs: readonly RawLog[], usdc: string): { from: string; to: string; value: bigint; logIndex: number }[] {
  const out: { from: string; to: string; value: bigint; logIndex: number }[] = []
  for (const l of logs) {
    if (l.address.toLowerCase() !== usdc || l.topics[0] !== TRANSFER_TOPIC || l.topics.length !== 3) continue
    const { args } = decodeEventLog({
      abi: [TRANSFER_EVENT],
      topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
      data: l.data as `0x${string}`,
    })
    out.push({ from: args.from.toLowerCase(), to: args.to.toLowerCase(), value: args.value, logIndex: l.logIndex })
  }
  return out
}
