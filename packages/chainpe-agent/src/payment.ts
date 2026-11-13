/**
 * Payment Client (Avalanche C-Chain)
 *
 * Handles the x402 payment flow using Coinbase's x402-fetch: it wraps `fetch`
 * with a viem signer so that a 402 response is automatically paid (USDC via
 * EIP-3009) and the request retried. Replaces the Algorand @x402-avm client.
 */

import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

import type {
  PaymentReceipt,
  PaymentToken,
  HttpRequestOptions,
  HttpResponse,
  ServiceInfo,
  ChainPeNetwork,
} from "./types.js";
import { addressFromPrivateKey, createWalletFromPrivateKey, parseAmount } from "./wallet.js";

export interface PaymentClientOptions {
  privateKey: string;
  network?: ChainPeNetwork;
  onPayment?: (receipt: PaymentReceipt) => void;
  /** Max USDC per payment (human string). Defaults to "10". */
  maxPerPayment?: string;
}

export class PaymentClient {
  private readonly privateKey: string;
  private readonly network: ChainPeNetwork;
  private readonly onPayment?: (receipt: PaymentReceipt) => void;
  private readonly maxValueAtomic: bigint;
  private readonly address: string;

  private wrappedFetch?: typeof fetch;
  private receipts: PaymentReceipt[] = [];
  private totalSpent: Record<PaymentToken, bigint> = { USDC: 0n };

  constructor(options: PaymentClientOptions) {
    this.privateKey = options.privateKey;
    this.network = options.network || "fuji";
    this.onPayment = options.onPayment;
    this.maxValueAtomic = parseAmount(options.maxPerPayment ?? "10");
    this.address = addressFromPrivateKey(options.privateKey);
  }

  /** Lazily builds the x402-wrapped fetch (signer creation is async). */
  private async ensureReady(): Promise<typeof fetch> {
    if (!this.wrappedFetch) {
      const wallet = await createWalletFromPrivateKey(this.privateKey, this.network);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.wrappedFetch = wrapFetchWithPayment(fetch, wallet.signer as any, this.maxValueAtomic);
    }
    return this.wrappedFetch;
  }

  getAddress(): string {
    return this.address;
  }

  /** Makes an HTTP request with automatic x402 payment handling. */
  async fetch<T = unknown>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const { method = "GET", headers = {}, body, timeout = 30000 } = options;
    const wrapped = await this.ensureReady();

    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      signal: AbortSignal.timeout(timeout),
    };
    if (body && method !== "GET") fetchOptions.body = JSON.stringify(body);

    const response = await wrapped(url, fetchOptions);

    // x402-fetch sets X-PAYMENT-RESPONSE when a payment was made & settled.
    const settleHeader = response.headers.get("X-PAYMENT-RESPONSE");
    const paid = !!settleHeader;
    let receipt: PaymentReceipt | undefined;
    if (paid) {
      receipt = this.recordPayment(url, settleHeader);
    }

    const data = await this.parseResponse<T>(response);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: this.headersToObject(response.headers),
      data,
      paid,
      paymentReceipt: receipt,
    };
  }

  /** Makes a request to a known paid service. */
  async callService<T = unknown>(
    service: ServiceInfo,
    path: string = "/",
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const url = new URL(path, service.endpoint).toString();
    const response = await this.fetch<T>(url, options);
    // Enrich the receipt with the service's metadata when available.
    if (response.paymentReceipt) {
      response.paymentReceipt.service = service.name;
      response.paymentReceipt.recipient = service.walletAddress || response.paymentReceipt.recipient;
      if (!response.paymentReceipt.amount || response.paymentReceipt.amount === "0") {
        response.paymentReceipt.amount = service.pricePerRequest;
      }
    }
    return response;
  }

  private recordPayment(url: string, settleHeader: string): PaymentReceipt {
    let amount = "0";
    let recipient = "unknown";
    let txId: string | undefined;
    try {
      const decoded = decodeXPaymentResponse(settleHeader) as Record<string, unknown>;
      txId = (decoded.transaction as string) ?? (decoded.txHash as string);
      recipient = (decoded.payer as string) ?? recipient;
    } catch {
      /* header not decodable — keep defaults */
    }

    const receipt: PaymentReceipt = {
      txId,
      amount,
      token: "USDC",
      recipient,
      timestamp: new Date(),
      service: "Unknown Service",
      path: safePath(url),
    };

    this.receipts.push(receipt);
    return receipt;
  }

  getReceipts(): PaymentReceipt[] {
    return [...this.receipts];
  }

  getTotalSpent(): Record<PaymentToken, string> {
    // Sum from receipt amounts (human strings) for an accurate total.
    let sum = 0n;
    for (const r of this.receipts) {
      try {
        sum += parseAmount(r.amount || "0");
      } catch {
        /* ignore */
      }
    }
    this.totalSpent.USDC = sum;
    return { USDC: formatAtomic(sum) };
  }

  getTransactionCount(): number {
    return this.receipts.length;
  }

  reset(): void {
    this.receipts = [];
    this.totalSpent = { USDC: 0n };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  private headersToObject(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
}

function formatAtomic(atomic: bigint): string {
  const divisor = 1_000_000n;
  const whole = atomic / divisor;
  const frac = atomic % divisor;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Creates a payment client. */
export function createPaymentClient(
  privateKey: string,
  options: Partial<PaymentClientOptions> = {}
): PaymentClient {
  return new PaymentClient({ privateKey, ...options });
}
