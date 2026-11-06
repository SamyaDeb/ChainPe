import fs from 'node:fs'
import path from 'node:path'
import type { BudgetConfig, SpendingRecord } from '@/types.js'

const HISTORY_KEPT = 50

interface SavedSpending {
  day: string
  spentToday: number
  history: SpendingRecord[]
}

/**
 * Enforces the per-call and daily limits. With a file, today's total survives a
 * restart, so restarting the server does not reset the daily budget.
 */
export class SpendingTracker {
  private readonly config: BudgetConfig
  private readonly file?: string
  private spentToday = 0
  private spentSession = 0
  private lastReset: string = today()
  private history: SpendingRecord[] = []

  constructor(config: BudgetConfig, file?: string) {
    this.config = config
    this.file = file
    this.load()
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
    this.resetDailyIfNeeded()
    const amount = parseFloat(amountUsdc)
    this.spentToday += amount
    this.spentSession += amount
    this.history.push({
      recipient,
      amount: amountUsdc,
      network,
      timestamp: new Date().toISOString()
    })
    this.history = this.history.slice(-HISTORY_KEPT)
    this.save()
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
    const day = today()
    if (day !== this.lastReset) {
      this.spentToday = 0
      this.lastReset = day
    }
  }

  /** A missing or unreadable file starts at zero; it never stops the server. */
  private load(): void {
    if (!this.file) return
    try {
      const saved = JSON.parse(
        fs.readFileSync(this.file, 'utf-8')
      ) as SavedSpending
      this.history = Array.isArray(saved.history)
        ? saved.history.slice(-HISTORY_KEPT)
        : []
      if (saved.day === today() && Number.isFinite(saved.spentToday)) {
        this.spentToday = saved.spentToday
      }
    } catch {
      /* Start fresh. */
    }
  }

  private save(): void {
    if (!this.file) return
    const saved: SavedSpending = {
      day: this.lastReset,
      spentToday: this.spentToday,
      history: this.history
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
      const temp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify(saved, null, 2), { mode: 0o600 })
      fs.renameSync(temp, this.file)
    } catch (err) {
      console.error(
        `Could not save spending to ${this.file}: ${(err as Error).message}`
      )
    }
  }
}

/** The UTC calendar day, which is what the daily limit counts. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}
