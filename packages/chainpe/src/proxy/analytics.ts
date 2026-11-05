/**
 * Analytics Module
 * Tracks payment events and request statistics (USDC on Arc).
 */

import type { PaymentEvent, PaymentRail, RequestStats } from "../types.js";
import { USDC_DECIMALS } from "../chains.js";

const MAX_RECENT_PAYMENTS = 100;

export interface RevenueSummary {
  USDC: string;
  byRail: Record<PaymentRail, string>;
  byNetwork: Record<string, string>;
}

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
      chargedButBackendFailed: 0,
      totalRevenue: 0n,
      revenueByToken: { USDC: 0n },
      revenueByRail: { exact: 0n, gateway: 0n },
      revenueByNetwork: {},
      requestsPerMinute: [],
      lastHourRequests: 0,
    };
  }

  recordRequest(): void {
    this.stats.totalRequests++;
    this.updateMinuteStats();
  }

  recordPayment(event: PaymentEvent): void {
    if (event.status === "completed") {
      const atomic = BigInt(event.amountAtomic);
      this.stats.paidRequests++;
      this.stats.totalRevenue += atomic;
      this.stats.revenueByToken.USDC += atomic;
      this.stats.revenueByRail[event.rail] += atomic;
      this.stats.revenueByNetwork[event.network] = (this.stats.revenueByNetwork[event.network] ?? 0n) + atomic;
      if ((event.backendStatus ?? 0) >= 500) this.stats.chargedButBackendFailed++;
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

  getRevenueSummary(): RevenueSummary {
    const { revenueByToken, revenueByRail, revenueByNetwork } = this.stats;
    return {
      USDC: format(revenueByToken.USDC),
      byRail: { exact: format(revenueByRail.exact), gateway: format(revenueByRail.gateway) },
      byNetwork: Object.fromEntries(Object.entries(revenueByNetwork).map(([n, v]) => [n, format(v)])),
    };
  }

  reset(): void {
    this.stats = this.emptyStats();
    this.recentPayments = [];
    this.minuteRequests = new Array(60).fill(0);
  }
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
