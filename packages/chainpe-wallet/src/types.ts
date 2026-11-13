export type PaymentNetwork = 'fuji' | 'avalanche'

export interface AppConfig {
  privateKey?: string
  network: PaymentNetwork
  registryAddress?: string
  reputationRegistry?: string
  budget: BudgetConfig
  canPay: boolean
  mode: 'READ_ONLY' | 'AVALANCHE'
  reload(): void
}

export interface BudgetConfig {
  maxPerCall: string
  maxPerDay: string
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
