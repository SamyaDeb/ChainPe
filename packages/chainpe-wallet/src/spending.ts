import type { BudgetConfig, SpendingRecord } from '@/types.js'

const DEFAULT_MAX_PER_CALL = 0.1
const DEFAULT_MAX_PER_DAY = 1.0
const DEFAULT_MAX_AVAX_PER_TRANSFER = 0.1
const DEFAULT_MAX_AVAX_PER_DAY = 0.5

/**
 * Parse a limit. A blank / NaN / non-positive value must never mean "no limit"
 * (every comparison against NaN is false), so fall back to a safe default.
 */
function parseLimit(raw: string | undefined, fallback: number, name: string): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  if (Number.isFinite(n) && n > 0) return n
  if (raw !== undefined && raw.trim() !== '') {
    // stderr only — stdout is the MCP stdio channel.
    console.error(`[chainpe-wallet] Invalid ${name}="${raw}"; using safe default ${fallback}`)
  }
  return fallback
}

export class SpendingTracker {
  private readonly config: BudgetConfig
  private readonly maxPerCall: number
  private readonly maxPerDay: number
  private readonly maxAvaxPerTransfer: number
  private readonly maxAvaxPerDay: number
  private spentAvaxToday = 0
  private spentToday = 0
  private spentSession = 0
  private lastReset: string = new Date().toISOString().slice(0, 10)
  private readonly history: SpendingRecord[] = []

  constructor(config: BudgetConfig) {
    this.config = config
    this.maxPerCall = parseLimit(config.maxPerCall, DEFAULT_MAX_PER_CALL, 'MAX_PER_CALL')
    this.maxPerDay = parseLimit(config.maxPerDay, DEFAULT_MAX_PER_DAY, 'MAX_PER_DAY')
    this.maxAvaxPerTransfer = parseLimit(
      config.maxAvaxPerTransfer,
      DEFAULT_MAX_AVAX_PER_TRANSFER,
      'MAX_AVAX_PER_TRANSFER'
    )
    this.maxAvaxPerDay = parseLimit(config.maxAvaxPerDay, DEFAULT_MAX_AVAX_PER_DAY, 'MAX_AVAX_PER_DAY')
  }

  /** Native AVAX transfer guard (separate from the USDC budget). */
  checkAvax(amountAvax: string): void {
    this.resetDailyIfNeeded()
    const amount = Number(amountAvax)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid AVAX amount "${amountAvax}"`)
    }
    if (amount > this.maxAvaxPerTransfer) {
      throw new Error(`Amount ${amountAvax} AVAX exceeds per-transfer limit of ${this.maxAvaxPerTransfer} AVAX`)
    }
    if (this.spentAvaxToday + amount > this.maxAvaxPerDay) {
      throw new Error(
        `Transfer would exceed daily AVAX limit of ${this.maxAvaxPerDay} AVAX (sent today: ${this.spentAvaxToday})`
      )
    }
  }

  recordAvax(amountAvax: string): void {
    this.resetDailyIfNeeded()
    this.spentAvaxToday += Number(amountAvax)
  }

  check(amountUsdc: string): void {
    this.resetDailyIfNeeded()
    const amount = parseFloat(amountUsdc)
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Invalid payment amount "${amountUsdc}"`)
    }

    if (amount > this.maxPerCall) {
      throw new Error(
        `Amount $${amountUsdc} exceeds per-call limit of $${this.maxPerCall}`
      )
    }

    if (this.spentToday + amount > this.maxPerDay) {
      throw new Error(
        `Payment would exceed daily limit of $${this.maxPerDay} (spent today: $${this.spentToday.toFixed(4)})`
      )
    }
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
        // Show the configured text when it was valid, else the default actually in force.
        maxPerCall: Number(this.config.maxPerCall) === this.maxPerCall ? this.config.maxPerCall : String(this.maxPerCall),
        maxPerDay: Number(this.config.maxPerDay) === this.maxPerDay ? this.config.maxPerDay : String(this.maxPerDay)
      },
      recentPayments: this.history.slice(-10)
    }
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.lastReset) {
      this.spentToday = 0
      this.spentAvaxToday = 0
      this.lastReset = today
    }
  }
}
