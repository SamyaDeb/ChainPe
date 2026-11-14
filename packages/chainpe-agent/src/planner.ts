/**
 * Picks which service to use. With a minimum reputation, only services whose payment-verified score meets it
 * (backed by enough verified paid reviews) are eligible, and the cheapest eligible one is recommended.
 * Pure, so it is easy to test.
 */
import { checkMinimum, type CloudService, type RefusalReason } from "./cloud.js";

export interface Candidate {
  name: string;
  /** Human USDC price per request, e.g. "0.01". */
  price: string;
  payTo: string;
  /** The service's chainpe-cloud record, or null when it has none. */
  paid: CloudService | null;
}

export interface Plan<T extends Candidate> {
  /** The cheapest eligible service (ties broken by higher score, then name), or undefined if none qualifies. */
  recommended?: T;
  /** Eligible services, cheapest first. */
  eligible: T[];
  /** Services below the minimum, each with the reason. They are never recommended. */
  refused: { service: T; reason: RefusalReason }[];
}

export function planCheapestEligible<T extends Candidate>(
  candidates: T[],
  minReputation: number,
  minPaidReviews: number,
  /** False when chainpe-cloud could not be reached: every candidate is refused as "unavailable". */
  cloudReachable = true
): Plan<T> {
  const eligible: T[] = [];
  const refused: Plan<T>["refused"] = [];
  for (const c of candidates) {
    const reason: RefusalReason | null =
      minReputation > 0 ? (cloudReachable ? checkMinimum(c.paid, minReputation, minPaidReviews) : "unavailable") : null;
    if (reason) refused.push({ service: c, reason });
    else eligible.push(c);
  }
  eligible.sort(
    (a, b) =>
      parseFloat(a.price) - parseFloat(b.price) ||
      (b.paid?.paidScore ?? -1) - (a.paid?.paidScore ?? -1) ||
      a.name.localeCompare(b.name)
  );
  return { recommended: eligible[0], eligible, refused };
}
