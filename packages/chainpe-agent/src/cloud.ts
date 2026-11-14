/**
 * (Same logic as packages/chainpe-sdk/src/cloud.ts; this package does not depend on the SDK.)
 *
 * chainpe-cloud public API client: payment-gated reputation.
 *
 * `paidScore` counts only ratings whose x402 payment the indexer verified on-chain, weighted by USDC paid.
 * Anyone can write any rating to the ERC-8004 registry, so a plain on-chain average is not evidence of quality;
 * this is. Reads are cached briefly so a burst of calls costs one request.
 */

export const DEFAULT_CLOUD_URL = "https://chainpe-cloud-production-1d71cb77.up.railway.app"

/** One entry of `GET /v1/public/services`. */
export interface CloudService {
  key: string
  name: string
  endpoint: string
  price: string
  payTo: string
  agentId: string | null
  paidScore: number | null
  paidReviews: number
  rawScore: number | null
  rawReviews: number
  totalSettledAtomic: string
  paidCalls: number
  /** An earlier service already uses this payTo, so this one is not credited with its payments or ratings. */
  payToShared: boolean
}

export interface CloudClientOptions {
  /** Base URL of chainpe-cloud. `false` disables it (reads fall back to on-chain, the spend gate refuses). */
  baseUrl?: string | false
  timeoutMs?: number
  /** How long a fetched service list is reused. Defaults to 30 s. */
  ttlMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
}

export class CloudClient {
  readonly baseUrl: string | undefined
  private readonly timeoutMs: number
  private readonly ttlMs: number
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private cache?: { at: number; services: CloudService[] }

  constructor(options: CloudClientOptions = {}) {
    this.baseUrl = options.baseUrl === false ? undefined : (options.baseUrl ?? DEFAULT_CLOUD_URL).replace(/\/+$/, "")
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.ttlMs = options.ttlMs ?? 30_000
    this.fetchImpl = options.fetchImpl ?? ((...a) => fetch(...a))
    this.now = options.now ?? Date.now
  }

  get enabled(): boolean {
    return this.baseUrl !== undefined
  }

  /** Every active service with its scores. Throws if chainpe-cloud is disabled, unreachable or answers an error. */
  async services(): Promise<CloudService[]> {
    if (!this.baseUrl) throw new Error("chainpe-cloud is disabled")
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.services
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/public/services`, { signal: ctrl.signal, headers: { accept: "application/json" } })
      if (!res.ok) throw new Error(`chainpe-cloud answered HTTP ${res.status}`)
      const body = (await res.json()) as { services?: CloudService[] }
      if (!Array.isArray(body.services)) throw new Error("chainpe-cloud sent an unexpected response")
      this.cache = { at: this.now(), services: body.services }
      return body.services
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * The service paid at `payTo`. A payTo shared by several services belongs to the earliest (the others are
   * flagged `payToShared`); when the URL names one of several, that one wins. Null if none is registered.
   * Throws if chainpe-cloud cannot be read.
   */
  async serviceFor(payTo: string, url?: string): Promise<CloudService | null> {
    const wanted = payTo.toLowerCase()
    const matches = (await this.services()).filter(s => s.payTo.toLowerCase() === wanted && !s.payToShared)
    return (url && matches.find(s => url.startsWith(s.endpoint))) || matches[0] || null
  }
}

/** Reputation as shown to the user. `paid` = verified x402 payments only; `unverified` = plain on-chain average. */
export interface ReputationSummary {
  count: number;
  score: number | null;
  source?: "paid" | "unverified";
  rawScore?: number | null;
  rawCount?: number;
}

/** The paid score as a {@link ReputationSummary}; `rawScore` is kept only for contrast. */
export function toPaidSummary(s: CloudService | null): ReputationSummary {
  return {
    count: s?.paidReviews ?? 0,
    score: s?.paidScore ?? null,
    source: "paid",
    rawScore: s?.rawScore ?? null,
    rawCount: s?.rawReviews ?? 0
  }
}

export type RefusalReason = "unavailable" | "unknown_service" | "not_enough_reviews" | "below_minimum"

/** Pure: why a service fails the minimum, or null when it passes. */
export function checkMinimum(
  service: CloudService | null,
  minReputation: number,
  minPaidReviews: number
): RefusalReason | null {
  if (!service) return "unknown_service"
  if (service.paidReviews < minPaidReviews) return "not_enough_reviews"
  if (service.paidScore === null) return minReputation > 0 ? "not_enough_reviews" : null
  return service.paidScore < minReputation ? "below_minimum" : null
}

/** Thrown BEFORE a payment is signed when the provider's verified record is below the configured minimum. */
export class ReputationTooLow extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly payTo: string,
    readonly url: string,
    readonly paidScore: number | null,
    readonly paidReviews: number,
    readonly minReputation: number,
    readonly minPaidReviews: number
  ) {
    const why: Record<RefusalReason, string> = {
      unavailable: "its payment-verified reputation could not be checked (reputation service unreachable)",
      unknown_service: "it is not in the ChainPe registry, so it has no verified record",
      not_enough_reviews: `it has ${paidReviews} verified paid review(s), fewer than the ${minPaidReviews} required`,
      below_minimum: `its payment-verified score is ${paidScore}/100, below the minimum ${minReputation}`,
    };
    super(`Refused to pay ${url} (${payTo}): ${why[reason]}. Nothing was signed and no money moved.`);
    this.name = "ReputationTooLow";
  }
}

/** Throws {@link ReputationTooLow} unless `payTo` meets the minimum. A no-op when `minReputation` is 0. */
export async function enforceMinimum(
  cloud: CloudClient,
  payTo: string,
  url: string,
  minReputation: number,
  minPaidReviews: number
): Promise<void> {
  if (!(minReputation > 0)) return;
  let service: CloudService | null;
  try {
    service = await cloud.serviceFor(payTo, url);
  } catch {
    throw new ReputationTooLow("unavailable", payTo, url, null, 0, minReputation, minPaidReviews);
  }
  const reason = checkMinimum(service, minReputation, minPaidReviews);
  if (reason) {
    throw new ReputationTooLow(reason, payTo, url, service?.paidScore ?? null, service?.paidReviews ?? 0, minReputation, minPaidReviews);
  }
}
