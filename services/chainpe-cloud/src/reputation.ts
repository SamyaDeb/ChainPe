/**
 * Score maths, in one place. A rating's score is value / 10^valueDecimals.
 *
 *   paid score = Σ(score × min(paid, cap)) / Σ min(paid, cap)  over verified, non-revoked ratings
 *   raw score  = plain average over every non-revoked rating, verified or not
 *
 * The cap stops one large payment from dominating. Needs the alias `f` for `feedback`.
 */
import { sql } from 'drizzle-orm'
import { PAID_WEIGHT_CAP_ATOMIC } from './workers/verifyFeedback.js'

export const SCORE = sql`(f.value / POWER(10::numeric, f.value_decimals))`
const WEIGHT = sql`LEAST(f.paid_atomic, ${PAID_WEIGHT_CAP_ATOMIC.toString()}::numeric)`

/** Weighted mean over verified rows. Pair with `WHERE f.verified AND NOT f.revoked`. */
export const PAID_SCORE = sql`ROUND(SUM(${SCORE} * ${WEIGHT}) / NULLIF(SUM(${WEIGHT}), 0), 2)`
export const RAW_SCORE = sql`ROUND(AVG(${SCORE}), 2)`
