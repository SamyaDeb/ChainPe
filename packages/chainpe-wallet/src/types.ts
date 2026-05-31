export type PaymentNetwork = 'algorand' | 'algorand-testnet'

export interface AppConfig {
  algorandMnemonic?: string
  network: PaymentNetwork
  registryAppId?: string
  budget: BudgetConfig
  canPay: boolean
  canPayAlgorand: boolean
  mode: 'READ_ONLY' | 'ALGORAND_ONLY'
  reload(): void
}

export interface BudgetConfig {
  maxPerCall: string
  maxPerDay: string
}

export interface WalletFileConfig {
  algorandMnemonic?: string
  network?: string
  registryAppId?: string
  createdAt?: string
}

export interface SpendingRecord {
  recipient: string
  amount: string
  network: string
  timestamp: string
}
