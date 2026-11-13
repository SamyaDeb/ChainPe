/**
 * Analytics Module
 * Tracks payment events and request statistics (USDC on Avalanche).
 */

import type { PaymentEvent, RequestStats, PaymentToken } from "../types.js";
import { USDC_DECIMALS } from "../chains.js";

const MAX_RECENT_PAYMENTS = 100;

class Analytics {
  private stats: RequestStats;
  private recentPayments: PaymentEvent[];
  private minuteRequests: number[];
  private currentMinute: number;

  constructor() {
    this.stats = this.emptyStats();
    this.recentPayments = [];
    this.minuteRequests = new Array(60).fill(0);
    this.currentMinute = new Date().getMinutes();
  }

  private emptyStats(): RequestStats {
    return {
      totalRequests: 0,
      paidRequests: 0,
      failedPayments: 0,
      totalRevenue: 0n,
      revenueByToken: { USDC: 0n },
      requestsPerMinute: [],
      lastHourRequests: 0,
    };
  }

  recordRequest(): void {
    this.stats.totalRequests++;
    this.updateMinuteStats();
  }

  recordPayment(event: PaymentEvent): void {
    if (event.success) {
      this.stats.paidRequests++;
      // event.amount is human USDC; store atomic units for precision.
      const atomic = toAtomic(event.amount);
      this.stats.totalRevenue += atomic;
      this.stats.revenueByToken[event.token] =
        (this.stats.revenueByToken[event.token] || 0n) + atomic;
    } else {
      this.stats.failedPayments++;
    }

    this.recentPayments.unshift(event);
    if (this.recentPayments.length > MAX_RECENT_PAYMENTS) {
      this.recentPayments.pop();
    }
  }

  private updateMinuteStats(): void {
    const now = new Date();
    const minute = now.getMinutes();
    if (minute !== this.currentMinute) {
      const diff = (minute - this.currentMinute + 60) % 60;
      for (let i = 1; i <= diff; i++) {
        this.minuteRequests[(this.currentMinute + i) % 60] = 0;
      }
      this.currentMinute = minute;
    }
    this.minuteRequests[minute]++;
    this.stats.lastHourRequests = this.minuteRequests.reduce((a, b) => a + b, 0);
    this.stats.requestsPerMinute = [...this.minuteRequests];
  }

  getStats(): RequestStats {
    return { ...this.stats };
  }

  getRecentPayments(): PaymentEvent[] {
    return [...this.recentPayments];
  }

  getRevenueSummary(): Record<PaymentToken, string> {
    return { USDC: format(this.stats.revenueByToken.USDC || 0n) };
  }

  reset(): void {
    this.stats = this.emptyStats();
    this.recentPayments = [];
    this.minuteRequests = new Array(60).fill(0);
  }
}

function toAtomic(human: string): bigint {
  const clean = human.replace(/[^0-9.]/g, "");
  const [whole = "0", frac = ""] = clean.split(".");
  const fracPadded = frac.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fracPadded || "0");
}

function format(atomic: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const whole = atomic / divisor;
  const fraction = atomic % divisor;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "")}`;
}

export const analytics = new Analytics();
export { Analytics };
