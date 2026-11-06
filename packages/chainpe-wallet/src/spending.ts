import type { BudgetConfig, SpendingRecord } from '@/types.js'

export class SpendingTracker {
  private readonly config: BudgetConfig
  private spentToday = 0
  private spentSession = 0
  private lastReset: string = new Date().toISOString().slice(0, 10)
  private readonly history: SpendingRecord[] = []

  constructor(config: BudgetConfig) {
    this.config = config
  }

  check(amountUsdc: string): void {
    this.resetDailyIfNeeded()
    const amount = parseFloat(amountUsdc)
    const maxPerCall = parseFloat(this.config.maxPerCall)
    const maxPerDay = parseFloat(this.config.maxPerDay)

    if (amount > maxPerCall) {
      throw new Error(
        `Amount $${amountUsdc} exceeds per-call limit of $${this.config.maxPerCall}`
      )
    }

    if (this.spentToday + amount > maxPerDay) {
      throw new Error(
        `Payment would exceed daily limit of $${this.config.maxPerDay} (spent today: $${this.spentToday.toFixed(4)})`
      )
    }
  }

  /**
   * The most one payment may cost right now, as a USDC amount for the SDK's
   * limit, which refuses a higher price before signing. Rounded down to USDC's
   * 6 decimals. Throws when the daily budget is used up.
   */
  paymentCap(): string {
    this.resetDailyIfNeeded()
    const remaining = parseFloat(this.config.maxPerDay) - this.spentToday
    const cap = Math.min(parseFloat(this.config.maxPerCall), remaining)
    const atomic = Math.floor(cap * 1_000_000 + 1e-6)
    if (atomic <= 0) {
      throw new Error(
        `Daily limit of $${this.config.maxPerDay} reached (spent today: $${this.spentToday.toFixed(4)})`
      )
    }
    return (atomic / 1_000_000).toFixed(6)
  }

  record(amountUsdc: string, recipient: string, network: string): void {
    const amount = parseFloat(amountUsdc)
    this.spentToday += amount
    this.spentSession += amount
    this.history.push({
      recipient,
      amount: amountUsdc,
      network,
      timestamp: new Date().toISOString()
    })
  }

  getSummary() {
    this.resetDailyIfNeeded()
    return {
      spentToday: this.spentToday.toFixed(4),
      spentSession: this.spentSession.toFixed(4),
      limits: {
        maxPerCall: this.config.maxPerCall,
        maxPerDay: this.config.maxPerDay
      },
      recentPayments: this.history.slice(-10)
    }
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.lastReset) {
      this.spentToday = 0
      this.lastReset = today
    }
  }
}
