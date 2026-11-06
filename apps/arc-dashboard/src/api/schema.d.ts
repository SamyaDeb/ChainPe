/**
 * Types for chainpe-cloud, written by hand from context/services/chainpe-cloud/openapi.yaml.
 * Every `*Atomic` field is a string of atomic USDC (6 decimals). Never parse one into a JS number.
 */

export type Atomic = string
export type Rail = 'exact' | 'gateway'
export type Range = '24h' | '7d' | '30d' | '90d' | 'all'
export type Verification = 'unverified' | 'verified' | 'failed'
export type VerificationReason =
  | 'no_transfer_yet'
  | 'not_completed'
  | 'no_tx_hash'
  | 'no_transfer_id'
  | 'amount_mismatch'
  | 'payer_mismatch'
  | 'recipient_mismatch'
  | 'asset_mismatch'
  | 'already_claimed'
  | 'gateway_failed'
  | null
export type AgentIdStatus = 'owned' | 'not_owner' | 'none' | 'unknown'
export type PlanName = 'free' | 'pro'

export interface ApiErrorBody {
  error: string
  message: string
}

export interface NonceRequest {
  address: string
  client?: 'dashboard' | 'cli'
}
export interface NonceResponse {
  nonce: string
  message: string
  expiresAt: string
}
export interface VerifyRequest {
  message: string
  signature: string
}
export interface SessionResponse {
  token: string
  tokenType: 'Bearer'
  address: string
  expiresAt: string
}
export interface Ok {
  ok: true
}

export interface Me {
  address: string
  agentId: string | null
  agentIdStatus: AgentIdStatus
  plan: PlanName
  paidUntil: string | null
  createdAt: string | null
}

export interface ServiceDoctorSummary {
  ok: boolean
  passed: number
  total: number
}
export interface ServiceItem {
  key: string
  name: string
  description: string
  tags: string
  endpoint: string
  endpointHttps: string | null
  price: string
  priceAtomic: Atomic | null
  network: string
  payTo: string
  acceptsExact: boolean
  acceptsGateway: boolean
  active: boolean
  lastHeartbeatAt: string | null
  version: string | null
  rails: string[] | null
  gatewayBalanceAtomic: Atomic | null
  doctor: ServiceDoctorSummary | null
}
export interface Services {
  truncated: boolean
  services: ServiceItem[]
}

export interface SummaryPoint {
  t: string
  revenueAtomic: Atomic
  calls: number
}
export interface Summary {
  range: Range
  since: string | null
  revenue: {
    totalVerifiedAtomic: Atomic
    exactAtomic: Atomic
    gateway: { settledAtomic: Atomic; pendingBatchAtomic: Atomic }
  }
  notRevenue: {
    unverifiedAtomic: Atomic
    failedAtomic: Atomic
    selfPayAtomic: Atomic
    unattributedInflowAtomic: Atomic
  }
  calls: {
    total: number
    completed: number
    failed: number
    verified: number
    successRate: number | null
  }
  uniqueBuyers: number
  series: { unit: 'hour' | 'day'; points: SummaryPoint[] }
}

export interface Payment {
  id: string
  ts: string
  effectiveTs: string
  serviceKey: string | null
  route: string
  method: string
  rail: Rail
  network: string
  amountAtomic: Atomic
  /** A checksummed address, or the string "unknown". */
  payer: string
  payTo: string
  txHash: string | null
  paymentId: string | null
  status: 'completed' | 'failed' | 'pending'
  latencyMs: number
  backendStatus: number | null
  error: string | null
  verification: Verification
  verificationReason: VerificationReason
  selfPay: boolean
  gateway: { status: string; txHash: string | null } | null
}
export interface Payments {
  payments: Payment[]
  nextCursor: string | null
}
export interface PaymentFilters {
  rail?: Rail
  route?: string
  verification?: Verification
}
export interface PaymentsQuery extends PaymentFilters {
  cursor?: string
  limit?: number
}

export interface Buyer {
  address: string
  spendAtomic: Atomic
  calls: number
  firstSeen: string
  lastSeen: string
}
export interface Buyers {
  range: Range
  totalBuyers: number
  truncated: boolean
  buyers: Buyer[]
}

export interface ReputationItem {
  client: string
  feedbackIndex: string
  value: string
  valueDecimals: number
  tag1: string | null
  tag2: string | null
  endpoint: string | null
  feedbackUri: string | null
  blockTs: string
  txHash: string
  fromPayer: boolean
}
export interface Reputation {
  agentId: string | null
  agentIdStatus: AgentIdStatus
  payerAverage: string | null
  payerCount: number
  allAverage: string | null
  allCount: number
  items: ReputationItem[] | null
}

export interface HealthEntry {
  serviceKey: string
  ts: string
  version: string
  network: string
  rails: string[]
  gatewayBalanceAtomic: Atomic | null
  /** The `chainpe doctor --json` report. Parse it with parseDoctor before use. */
  doctor: Record<string, unknown> | null
}
export interface Health {
  latestOnly: boolean
  history: HealthEntry[]
}

export interface Wallets {
  wallets: string[]
}

export interface CreatedKey {
  id: string
  key: string
  prefix: string
  name: string | null
  createdAt: string
}
export interface KeyListItem {
  id: string
  prefix: string
  name: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}
export interface KeyList {
  owner: string
  keys: KeyListItem[]
}
export interface RevokedKey {
  ok: true
  id: string
}
