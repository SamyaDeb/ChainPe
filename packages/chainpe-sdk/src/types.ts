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
