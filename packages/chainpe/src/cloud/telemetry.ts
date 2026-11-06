/**
 * Sends payment events to chainpe-cloud. It never slows or breaks a paid request: enqueueing
 * is synchronous, and a failure stays here. Events are rebuilt field by field, so nothing
 * else on the object, such as a signature, can leave this process.
 */
import type { PaymentEvent } from "../types.js";
import type { FetchLike } from "./login.js";

/** Spec 08a D4: acceptance is "visible within 5 s", which a 5 s flush could miss. */
export const FLUSH_INTERVAL_MS = 2_000;
export const FLUSH_AT_EVENTS = 50;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUE = 10_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 256;
const MAX_ROUTE_LENGTH = 512;

export interface TelemetryOptions {
  cloudUrl: string;
  ingestKey: string;
  serviceKey?: string;
  fetch?: FetchLike;
  now?: () => number;
  warn?: (message: string) => void;
}

interface Queued {
  body: Record<string, unknown>;
  queuedAt: number;
}

/** Only these fields are ever sent. */
export function toWireEvent(event: PaymentEvent, serviceKey?: string): Record<string, unknown> {
  return {
    id: event.id,
    ts: event.ts,
    route: event.route.slice(0, MAX_ROUTE_LENGTH),
    method: event.method,
    rail: event.rail,
    network: event.network,
    amountAtomic: event.amountAtomic,
    payer: event.payer,
    payTo: event.payTo,
    status: event.status,
    latencyMs: event.latencyMs,
    ...(serviceKey ? { serviceKey } : {}),
    ...(event.txHash ? { txHash: event.txHash } : {}),
    ...(event.paymentId ? { paymentId: event.paymentId } : {}),
    ...(event.backendStatus !== undefined ? { backendStatus: event.backendStatus } : {}),
    ...(event.error ? { error: event.error.slice(0, MAX_ERROR_LENGTH) } : {}),
  };
}

export class TelemetryQueue {
  private queue: Queued[] = [];
  private flushing = false;
  private retryAt = 0;
  private backoffMs = FLUSH_INTERVAL_MS;
  /** Shrinks to isolate an event the server refuses, so it does not take 49 good ones with it. */
  private batchSize = FLUSH_AT_EVENTS;
  private timer?: NodeJS.Timeout;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;

  constructor(private readonly options: TelemetryOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? ((message) => console.warn(`  telemetry: ${message}`));
  }

  get pending(): number {
    return this.queue.length;
  }

  enqueue(event: PaymentEvent): void {
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({ body: toWireEvent(event, this.options.serviceKey), queuedAt: this.now() });
    if (this.queue.length >= FLUSH_AT_EVENTS) void this.flush();
  }

  start(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private dropExpired(): void {
    const cutoff = this.now() - MAX_AGE_MS;
    const before = this.queue.length;
    this.queue = this.queue.filter((item) => item.queuedAt > cutoff);
    if (this.queue.length < before) this.warn(`dropped ${before - this.queue.length} events older than 24 h`);
  }

  private fail(reason: string): void {
    this.warn(`${reason}; retrying in ${Math.round(this.backoffMs / 1000)} s`);
    this.retryAt = this.now() + this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  /** Sends one batch. Safe to call at any time: it does nothing while one is in flight or backing off. */
  async flush(): Promise<void> {
    if (this.flushing || this.now() < this.retryAt) return;
    this.dropExpired();
    if (this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.slice(0, this.batchSize);
    try {
      const res = await this.fetchImpl(`${this.options.cloudUrl}/v1/ingest/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.ingestKey}` },
        body: JSON.stringify({ events: batch.map((item) => item.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        this.queue.splice(0, batch.length);
        this.backoffMs = FLUSH_INTERVAL_MS;
        this.retryAt = 0;
        this.batchSize = FLUSH_AT_EVENTS;
      } else if (res.status === 401 || res.status === 429 || res.status >= 500) {
        this.fail(res.status === 401 ? "ingest key refused, so run `chainpe login`" : `chainpe-cloud answered ${res.status}`);
      } else if (batch.length > 1) {
        // Refused, not failed. Retrying as it is could never work, so narrow down to the bad event.
        this.batchSize = Math.ceil(batch.length / 2);
      } else {
        this.queue.shift();
        this.batchSize = FLUSH_AT_EVENTS;
        this.warn(`chainpe-cloud refused an event (${res.status}), so it was dropped`);
      }
    } catch (err) {
      this.fail(`could not reach chainpe-cloud (${(err as Error).name})`);
    } finally {
      this.flushing = false;
    }
  }
}
