/**
 * Analytics Module
 * Tracks payment events and request statistics
 */

import type { PaymentEvent, RequestStats, PaymentToken } from "../types.js";

const MAX_RECENT_PAYMENTS = 100;

class Analytics {
  private stats: RequestStats;
  private recentPayments: PaymentEvent[];
  private minuteRequests: number[];
  private currentMinute: number;

  constructor() {
    this.stats = {
      totalRequests: 0,
      paidRequests: 0,
      failedPayments: 0,
      totalRevenue: 0n,
      revenueByToken: {
        ALGO: 0n,
        USDC: 0n,
      },
      requestsPerMinute: [],
      lastHourRequests: 0,
    };
    this.recentPayments = [];
    this.minuteRequests = new Array(60).fill(0);
    this.currentMinute = new Date().getMinutes();
  }

  /**
   * Records a request (paid or unpaid)
   */
  recordRequest(): void {
    this.stats.totalRequests++;
    this.updateMinuteStats();
  }

  /**
   * Records a successful payment
   */
  recordPayment(event: PaymentEvent): void {
    if (event.success) {
      this.stats.paidRequests++;

      // Parse amount to bigint (assuming microunits)
      const amount = BigInt(event.amount);
      this.stats.totalRevenue += amount;
      this.stats.revenueByToken[event.token] =
        (this.stats.revenueByToken[event.token] || 0n) + amount;
    } else {
      this.stats.failedPayments++;
    }

    // Add to recent payments
    this.recentPayments.unshift(event);
    if (this.recentPayments.length > MAX_RECENT_PAYMENTS) {
      this.recentPayments.pop();
    }
  }

  /**
   * Updates per-minute request tracking
   */
  private updateMinuteStats(): void {
    const now = new Date();
    const minute = now.getMinutes();

    if (minute !== this.currentMinute) {
      // Clear old minutes and update current
      const diff = (minute - this.currentMinute + 60) % 60;
      for (let i = 1; i <= diff; i++) {
        const clearMinute = (this.currentMinute + i) % 60;
        this.minuteRequests[clearMinute] = 0;
      }
      this.currentMinute = minute;
    }

    this.minuteRequests[minute]++;

    // Calculate last hour requests
    this.stats.lastHourRequests = this.minuteRequests.reduce((a, b) => a + b, 0);
    this.stats.requestsPerMinute = [...this.minuteRequests];
  }

  /**
   * Gets current statistics
   */
  getStats(): RequestStats {
    return { ...this.stats };
  }

  /**
   * Gets recent payment events
   */
  getRecentPayments(): PaymentEvent[] {
    return [...this.recentPayments];
  }

  /**
   * Gets formatted revenue summary
   */
  getRevenueSummary(): Record<PaymentToken, string> {
    const format = (amount: bigint, decimals: number): string => {
      const divisor = BigInt(10 ** decimals);
      const whole = amount / divisor;
      const fraction = amount % divisor;

      if (fraction === 0n) {
        return whole.toString();
      }

      const fractionStr = fraction
        .toString()
        .padStart(decimals, "0")
        .replace(/0+$/, "");

      return `${whole}.${fractionStr}`;
    };

    return {
      ALGO: format(this.stats.revenueByToken.ALGO || 0n, 6),
      USDC: format(this.stats.revenueByToken.USDC || 0n, 6),
    };
  }

  /**
   * Resets all statistics
   */
  reset(): void {
    this.stats = {
      totalRequests: 0,
      paidRequests: 0,
      failedPayments: 0,
      totalRevenue: 0n,
      revenueByToken: {
        ALGO: 0n,
        USDC: 0n,
      },
      requestsPerMinute: [],
      lastHourRequests: 0,
    };
    this.recentPayments = [];
    this.minuteRequests = new Array(60).fill(0);
  }
}

// Singleton instance
export const analytics = new Analytics();

export { Analytics };
