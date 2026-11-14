export type PaymentNetwork = 'fuji' | 'avalanche'

export interface AppConfig {
  privateKey?: string
  network: PaymentNetwork
  registryAddress?: string
  reputationRegistry?: string
  /** Refuse to pay providers whose payment-verified score is below this (0–100). 0 = no minimum. */
  minReputation: number
  /** Verified paid reviews required before `minReputation` is trusted. */
  minPaidReviews: number
  /** chainpe-cloud base URL; `false` disables it. */
  cloudUrl?: string | false
  budget: BudgetConfig
  canPay: boolean
  mode: 'READ_ONLY' | 'AVALANCHE'
  reload(): void
}

export interface BudgetConfig {
  maxPerCall: string
  maxPerDay: string
  /** Native AVAX transfer caps (transfer_avax). Defaults applied by SpendingTracker. */
  maxAvaxPerTransfer?: string
  maxAvaxPerDay?: string
}

export interface WalletFileConfig {
  privateKey?: string
  network?: string
  registryAddress?: string
  reputationRegistry?: string
  createdAt?: string
}

export interface SpendingRecord {
  recipient: string
  amount: string
  network: string
  timestamp: string
}
