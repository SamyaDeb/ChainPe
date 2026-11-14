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

const DEFAULT_MAX_PER_PAYMENT = "0.10";

/** What the payer actually signed (EIP-3009 authorization inside the X-PAYMENT header). */
interface SignedAuthorization {
  to: string;
  value: string;
}

export interface PaymentClientOptions {
  privateKey: string;
  network?: ChainPeNetwork;
  onPayment?: (receipt: PaymentReceipt) => void;
  /** Max USDC per payment (human string). Defaults to "0.10". */
  maxPerPayment?: string;
  /**
   * Called with each 402 offer's payTo BEFORE anything is signed. Throw to refuse the payment (e.g. ReputationTooLow).
   */
  gate?: (payTo: string, url: string) => Promise<void>;
}

export class PaymentClient {
  private readonly privateKey: string;
  private readonly network: ChainPeNetwork;
  private readonly onPayment?: (receipt: PaymentReceipt) => void;
  private readonly maxValueAtomic: bigint;
  private readonly address: string;
  private readonly gate?: (payTo: string, url: string) => Promise<void>;

  private wrappedFetch?: typeof fetch;
  /** Authorization signed during each in-flight request, keyed by that request's AbortSignal. */
  private readonly signed = new WeakMap<AbortSignal, SignedAuthorization>();
  private receipts: PaymentReceipt[] = [];
  private totalSpent: Record<PaymentToken, bigint> = { USDC: 0n };

  constructor(options: PaymentClientOptions) {
    this.privateKey = options.privateKey;
    this.network = options.network || "avalanche";
    this.onPayment = options.onPayment;
    this.maxValueAtomic = parseAmount(options.maxPerPayment?.trim() || DEFAULT_MAX_PER_PAYMENT);
    this.address = addressFromPrivateKey(options.privateKey);
    this.gate = options.gate;
  }

  /** Lazily builds the x402-wrapped fetch (signer creation is async). */
  private async ensureReady(): Promise<typeof fetch> {
    if (!this.wrappedFetch) {
      const wallet = await createWalletFromPrivateKey(this.privateKey, this.network);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // x402-fetch builds the payment on the retry; we tap the base fetch to read the
      // authorization that was really signed (amount + recipient), since the server's
      // settlement header only carries the payer and tx hash.
      const capturingFetch: typeof fetch = async (input, init) => {
        const header = new Headers(init?.headers).get("X-PAYMENT");
        if (header && init?.signal) {
          const auth = decodeAuthorization(header);
          if (auth) this.signed.set(init.signal, auth);
        }
        const response = await fetch(input, init);
        // The unpaid probe came back 402: run the gate on who would be paid BEFORE x402-fetch signs anything.
        if (this.gate && response.status === 402 && !header) {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
          for (const payTo of await offeredPayees(response.clone(), x402NetworkOf(this.network))) await this.gate(payTo, url);
        }
        return response;
      };
      this.wrappedFetch = wrapFetchWithPayment(capturingFetch, wallet.signer as any, this.maxValueAtomic);
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

    const signal = AbortSignal.timeout(timeout);
    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      signal,
    };
    if (body && method !== "GET") fetchOptions.body = JSON.stringify(body);

    const response = await wrapped(url, fetchOptions);

    // x402-fetch sets X-PAYMENT-RESPONSE when a payment was made & settled.
    const settleHeader = response.headers.get("X-PAYMENT-RESPONSE");
    const paid = !!settleHeader;
    let receipt: PaymentReceipt | undefined;
    if (paid) {
      receipt = this.recordPayment(url, settleHeader, this.signed.get(signal));
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
      // Amount and recipient stay as signed — never overwrite them with the registry's claims.
    }
    return response;
  }

  private recordPayment(url: string, settleHeader: string, auth?: SignedAuthorization): PaymentReceipt {
    // Real amount/recipient come from the authorization we signed.
    let amount = "0";
    let recipient = "unknown";
    if (auth) {
      try {
        amount = formatAtomic(BigInt(auth.value));
        recipient = auth.to;
      } catch {
        /* malformed value — keep defaults */
      }
    }
    let txId: string | undefined;
    try {
      const decoded = decodeXPaymentResponse(settleHeader) as Record<string, unknown>;
      txId = (decoded.transaction as string) ?? (decoded.txHash as string);
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

/** The payTo of every offer in a 402 body. */
/** The x402 network id the wallet pays on; offers for any other network are never signed, so they are not gated. */
function x402NetworkOf(network: ChainPeNetwork): string {
  return network === "fuji" ? "avalanche-fuji" : "avalanche";
}

async function offeredPayees(response: Response, network: string): Promise<string[]> {
  try {
    const body = (await response.json()) as { accepts?: { payTo?: string; network?: string }[] };
    const offers = (body.accepts ?? []).filter((a) => !a.network || a.network === network);
    return [...new Set(offers.map((a) => a.payTo).filter((p): p is string => !!p))];
  } catch {
    return [];
  }
}

function decodeAuthorization(xPayment: string): SignedAuthorization | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(xPayment, "base64").toString("utf-8")) as {
      payload?: { authorization?: SignedAuthorization };
    };
    const a = parsed.payload?.authorization;
    return a?.to && a.value !== undefined ? { to: a.to, value: String(a.value) } : undefined;
  } catch {
    return undefined;
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
