/** Arc network the SDK operates on. */
export type ChainPeNetwork = 'arc-testnet' | 'arc'

/**
 * How a call is paid. `exact` moves USDC from the wallet for each call. `gateway`
 * pays from a prepaid Circle Gateway deposit, with no gas, and is settled in batches.
 */
export type PaymentRail = 'gateway' | 'exact'

/**
 * Error thrown when an x402 payment fails (e.g. insufficient USDC, settlement
 * refused). Provides `.txHash` and `.reason` for debugging.
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
  /** Arc network. Defaults to `'arc-testnet'`. */
  network?: ChainPeNetwork
  /**
   * Payment rails to use, in order of preference. Defaults to
   * `['gateway', 'exact']`: Gateway when the deposit covers the price, else the wallet.
   */
  rails?: PaymentRail[]
  /** ChainPeAccounts address. Defaults to the deployed contract for the network. */
  accountsAddress?: string
  /** ERC-8004 Reputation Registry address. Defaults to Arc's registry. */
  reputationRegistry?: string
  /**
   * Max USDC to auto-pay for a single 402 (human units, e.g. `"1.00"`). A higher
   * price is refused before anything is signed. Defaults to `"1"`.
   */
  maxPerCall?: string
  /**
   * When true, `.fetch()`/`.pay()` post positive ERC-8004 feedback to the
   * provider's agent after a successful paid call. It costs gas, paid in USDC.
   * Defaults to `false`. `.pay()` returns the feedback result; use
   * `.giveFeedback()` for explicit control.
   */
  autoFeedback?: boolean
}

/** Per-request options for {@link ChainPe.fetch} / {@link ChainPe.pay}. */
export interface FetchOptions extends RequestInit {
  /** Override the constructor `autoFeedback` for this call. */
  autoFeedback?: boolean
  /**
   * Timeout per HTTP attempt in milliseconds. Defaults to 30 000 ms (30 s).
   */
  timeout?: number
}

/** A service found by {@link ChainPe.discover}. */
export interface ChainPeService {
  /** Stable id: the resource URL (Circle) or the service key (ChainPeAccounts). */
  id: string
  name: string
  description: string
  tags: string[]
  /** The URL to call. */
  endpoint: string
  /** The HTTP method, when the listing names one. */
  method?: string
  /** Human USDC units. */
  pricePerRequest: string
  paymentToken: 'USDC'
  /** Address that receives payment (the 402 `payTo`). */
  walletAddress: string
  network: ChainPeNetwork
  /** Payment rails this service accepts on this network. */
  rails: PaymentRail[]
  /** Where the listing came from. */
  source: 'circle' | 'chainpe'
  /** Circle Discovery category, when listed there. */
  category?: string
  /** The provider's address, for services on ChainPeAccounts. */
  developer?: string
  /** ERC-8004 agent id, when the service is linked to an identity. */
  agentId?: string
  createdAt?: string
  updatedAt?: string
}

/** Filters for {@link ChainPe.discover}. */
export interface DiscoverOptions {
  /** Free-text search. */
  query?: string
  tags?: string[]
  /** Max price per request (human USDC units). */
  maxPrice?: string
  /** Circle Discovery category, e.g. `DATA_ENRICHMENT`. */
  category?: string
  /** Only services that accept Circle Gateway. */
  gatewayOnly?: boolean
  /** Max results. Defaults to 20. */
  limit?: number
}

/** Aggregated ERC-8004 reputation for an agent. */
export interface ReputationSummary {
  /** Number of feedback entries counted. */
  count: number
  /** Aggregate score (typically 0–100), or null when unscored. */
  score: number | null
}

/** A service annotated with its reputation (returned by {@link ChainPe.discover}). */
export interface RankedService extends ChainPeService {
  reputation: ReputationSummary | null
}

/** Details of a payment that was made. */
export interface PaymentInfo {
  /** Human USDC units. */
  amount: string
  recipient: string
  network: ChainPeNetwork
  rail: PaymentRail
  /** On-chain tx hash. Set on the exact rail. */
  txHash?: string
  /** Circle transfer id. Set on the Gateway rail, which settles in a later batch. */
  transferId?: string
  /** The provider's decoded settlement response. */
  settlement?: unknown
}

/** Result of {@link ChainPe.request}: a live, unread Response + metadata. */
export interface PaidResponse {
  response: Response
  /** Set when a payment was actually made. */
  payment?: PaymentInfo
  /** The provider's ERC-8004 agent id, when it advertises one. */
  agentId?: string
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

/** Wallet balances (human USDC units). */
export interface Balances {
  /** USDC in the wallet. It also pays gas on Arc. */
  usdc: string
  /** USDC available in Circle Gateway. `'0'` if it could not be read. */
  gateway: string
}
