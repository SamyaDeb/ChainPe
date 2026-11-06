import type { ChainPeNetwork, PaymentRail } from '@chainpearc/sdk'

export type PaymentNetwork = ChainPeNetwork

export interface AppConfig {
  privateKey?: string
  network: PaymentNetwork
  /** Payment rails, in order of preference. */
  rails: PaymentRail[]
  accountsAddress?: string
  reputationRegistry?: string
  budget: BudgetConfig
  canPay: boolean
  mode: 'READ_ONLY' | 'ARC'
  reload(): void
}

export interface BudgetConfig {
  maxPerCall: string
  maxPerDay: string
}

export interface WalletFileConfig {
  privateKey?: string
  network?: string
  accountsAddress?: string
  reputationRegistry?: string
  createdAt?: string
}

export interface SpendingRecord {
  recipient: string
  amount: string
  network: string
  timestamp: string
}
