/** Avalanche C-Chain network the SDK operates on. */
export type ChainPeNetwork = 'fuji' | 'avalanche'

/**
 * Error thrown when an x402 payment fails on-chain (e.g. insufficient USDC,
 * settlement revert). Provides `.txHash` and `.reason` for debugging.
 */
export class ChainPePaymentError extends Error {
  readonly txHash?: string
  readonly reason?: string

  constructor(
    message: string,
    { txHash, reason }: { txHash?: string; reason?: string } = {}
  ) {
    super(message)
    this.name = 'ChainPePaymentError'
    this.txHash = txHash
    this.reason = reason
  }
}

export type ReputationRefusal = 'unavailable' | 'unknown_service' | 'not_enough_reviews' | 'below_minimum'

/**
 * Thrown BEFORE a payment is signed when the provider's verified record does not meet `minReputation` /
 * `minPaidReviews`. Nothing was signed and no money moved.
 */
export class ReputationTooLow extends Error {
  readonly reason: ReputationRefusal
  readonly payTo: string
  readonly url: string
  readonly paidScore: number | null
  readonly paidReviews: number
  readonly minReputation: number
  readonly minPaidReviews: number

  constructor(info: {
    reason: ReputationRefusal
    payTo: string
    url: string
    paidScore: number | null
    paidReviews: number
    minReputation: number
    minPaidReviews: number
  }) {
    const record =
      info.reason === 'unavailable'
        ? 'the payment-verified reputation service could not be reached, so the record cannot be checked'
        : info.reason === 'unknown_service'
          ? 'it is not in the ChainPe registry'
          : info.paidScore === null
            ? 'it has no verified paid reviews yet'
            : info.reason === 'not_enough_reviews'
            ? `it has ${info.paidReviews} verified paid review(s), fewer than the ${info.minPaidReviews} required`
            : `its verified paid score is ${info.paidScore}/100, below the minimum ${info.minReputation}`
    super(`Refused to pay ${info.url} (${info.payTo}): ${record}. Nothing was signed and no money moved.`)
    this.name = 'ReputationTooLow'
    this.reason = info.reason
    this.payTo = info.payTo
    this.url = info.url
    this.paidScore = info.paidScore
    this.paidReviews = info.paidReviews
    this.minReputation = info.minReputation
    this.minPaidReviews = info.minPaidReviews
  }
}

/** Options for constructing a {@link ChainPe} client. */
export interface ChainPeOptions {
  /** EOA private key (0x-prefixed or bare hex) used to sign payments + feedback. */
  privateKey: string
  /**
   * Avalanche network. Defaults to `'avalanche'` (mainnet).
   * Pass `'fuji'` explicitly to target testnet.
   */
  network?: ChainPeNetwork
  /** ChainPeRegistry address. Defaults to the deployed registry for the network. */
  registryAddress?: string
  /** ERC-8004 Reputation Registry address. Defaults to the deployed one for the network. */
  reputationRegistry?: string
  /**
   * Optional facilitator URL. Settlement is performed by the provider's proxy,
   * so payers normally don't need this; it is reserved for facilitator-routed
   * flows and provider-side helpers, and exposed via {@link ChainPe.config}.
   */
  facilitatorUrl?: string
  /**
   * Max USDC to auto-pay for a single 402 (human units, e.g. `"1.00"`).
   * The payment is refused on-chain if a 402 demands more. Defaults to `"1"`.
   */
  maxPerCall?: string
  /**
   * When true, `.fetch()`/`.pay()` post positive ERC-8004 feedback to the
   * provider's agent after a successful paid call. Defaults to `false`
   * (opt-in, since resolving the agent scans the registry). `.pay()` returns
   * the feedback result; use `.giveFeedback()` for explicit control.
   */
  autoFeedback?: boolean
  /**
   * Refuse to pay a provider whose verified paid score is below this (0–100). The check runs BEFORE signing and throws
   * {@link ReputationTooLow}. Based on chainpe-cloud's payment-verified score, never the raw on-chain average. If the
   * score cannot be read the call is refused too. Defaults to 0 (no minimum).
   */
  minReputation?: number
  /** Verified paid reviews a provider needs before `minReputation` is trusted. Defaults to 3. With 0, a provider still needs a verified paid score (at least one paid review) that meets `minReputation`; providers chainpe-cloud does not know are always refused. */
  minPaidReviews?: number
  /** chainpe-cloud base URL for payment-verified scores. `false` disables it. Defaults to the hosted service. */
  cloudUrl?: string | false
}

/** Per-request options for {@link ChainPe.fetch} / {@link ChainPe.pay}. */
export interface FetchOptions extends RequestInit {
  /** Override the constructor `autoFeedback` for this call. */
  autoFeedback?: boolean
  /**
   * Request timeout in milliseconds. Aborts the fetch if the server does not
   * respond within this window. Defaults to 30 000 ms (30 s).
   */
  timeout?: number
}

/** A resolved on-chain service registration. */
export interface ChainPeService {
  /** Stable id (`developer:name`). */
  id: string
  name: string
  description: string
  tags: string[]
  endpoint: string
  pricePerRequest: string
  paymentToken: 'USDC'
  /** Address that receives payment (the 402 `payTo`). */
  walletAddress: string
  network: ChainPeNetwork
  developer: string
  /** ERC-8004 agent id, when the service is linked to an identity. */
  agentId?: string
  createdAt?: string
  updatedAt?: string
}

/** Filters for {@link ChainPe.discover}. */
export interface DiscoverOptions {
  /** Free-text match over name/description/tags. */
  query?: string
  tags?: string[]
  /** Max price per request (human USDC units). */
  maxPrice?: string
}

/** Aggregated ERC-8004 reputation for an agent. */
export interface ReputationSummary {
  /** Number of distinct clients that left feedback. */
  count: number
  /** Aggregate score (typically 0–100), or null when unscored. */
  score: number | null
  /**
   * `paid`: only ratings backed by a verified x402 payment, weighted by USDC paid (chainpe-cloud).
   * `unverified`: plain on-chain average of every rating, which anyone can post. Treat as a hint, not evidence.
   */
  source?: 'paid' | 'unverified'
  /** Plain average of every rating, paid or not, for contrast (source `paid` only). */
  rawScore?: number | null
  rawCount?: number
}

/** A service annotated with its reputation (returned by {@link ChainPe.discover}). */
export interface RankedService extends ChainPeService {
  reputation: ReputationSummary | null
}

/** Settlement details decoded from the `X-PAYMENT-RESPONSE` header. */
export interface PaymentInfo {
  amount: string
  recipient: string
  network: ChainPeNetwork
  /** On-chain settlement tx hash, when the provider reported one. */
  txHash?: string
  settlement?: unknown
}

/** Result of {@link ChainPe.pay} — a parsed, structured paid response. */
export interface PaidResult<T = unknown> {
  status: number
  ok: boolean
  headers: Record<string, string>
  /** Parsed body (JSON when the content-type is JSON, else text). */
  data: T
  /** Present when a payment was made + settled. */
  payment?: PaymentInfo
  /** Present when feedback was posted (autoFeedback). */
  reputation?: { agentId: string; score: number; txHash: string }
}

/** Wallet balances (human units). */
export interface Balances {
  usdc: string
  avax: string
}
