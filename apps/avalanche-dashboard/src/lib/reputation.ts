/**
 * Public reputation display. A rating is value / 10^valueDecimals on a 0 to 100 scale (the dashboard's own
 * "Try it" rates 20, 40, 60, 80 or 100), shown as 0 to 5 stars.
 */
import type { PublicReview } from '@/api/schema'

/** 0 to 100 as stars with one decimal, e.g. 92 → "4.6". Null or a non-number shows a dash. */
export function stars(score: number | null | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '—'
  const clamped = Math.min(100, Math.max(0, score))
  return (Math.round(clamped / 2) / 10).toFixed(1)
}

/** What each verification_reason from chainpe-cloud's verifyFeedback worker means, in plain words. */
const REASONS: Record<string, string> = {
  no_proof: 'No payment proof was attached to this rating.',
  no_payment: 'The attached transaction has no USDC payment from this rater.',
  wrong_payee: "The payment went to a different address than this service's payTo.",
  not_x402: 'A plain USDC transfer, not an x402 (EIP-3009) payment.',
  payment_after_feedback: 'The payment came after the rating was posted.',
  reused: 'That payment was already used for another rating.',
  self_rating: 'The provider rated its own service.',
  tx_failed: 'The attached transaction failed on Avalanche.',
  receipt_not_found: 'The attached transaction was not found on Avalanche.',
  service_unknown: 'No registered service matched this agent.',
}

export function reviewReason(review: Pick<PublicReview, 'status' | 'verificationReason'>): string {
  if (review.status === 'verified') return 'Matched to an x402 USDC payment from this rater to this service.'
  if (review.status === 'pending') return 'Still checking the payment. This can take a minute.'
  const reason = review.verificationReason
  if (reason && REASONS[reason]) return REASONS[reason]
  if (reason) return `Not counted (${reason}).`
  return 'Not counted.'
}
