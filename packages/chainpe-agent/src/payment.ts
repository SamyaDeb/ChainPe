/**
 * Payment Client
 * Handles x402 payment flow: detect 402, sign payment, retry request
 */

import { x402Client } from "@x402-avm/core/client";
import { x402HTTPClient } from "@x402-avm/core/http";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/client";
import type { PaymentRequired } from "@x402-avm/core/types";
import algosdk from "algosdk";

import type {
  PaymentReceipt,
  PaymentToken,
  HttpRequestOptions,
  HttpResponse,
  ServiceInfo,
} from "./types.js";
import {
  ALGORAND_TESTNET_CAIP2,
  ALGORAND_MAINNET_CAIP2,
} from "./types.js";
import {
  createWalletFromMnemonic,
  formatAmount,
  type WalletInstance,
} from "./wallet.js";
import { AlgoNativeClientScheme, createAlgodClient } from "./x402/algo/client-scheme.js";

// ============================================================================
// Payment Client
// ============================================================================

export interface PaymentClientOptions {
  mnemonic: string;
  network?: "testnet" | "mainnet";
  onPayment?: (receipt: PaymentReceipt) => void;
}

/**
 * Client for making x402 payments on Algorand
 */
export class PaymentClient {
  private wallet: WalletInstance;
  private coreClient: x402Client;
  private httpClient: x402HTTPClient;
  private network: "testnet" | "mainnet";
  private onPayment?: (receipt: PaymentReceipt) => void;
  private receipts: PaymentReceipt[] = [];
  private totalSpent: Record<PaymentToken, bigint> = {
    ALGO: 0n,
    USDC: 0n,
  };

  constructor(options: PaymentClientOptions) {
    this.wallet = createWalletFromMnemonic(options.mnemonic);
    this.network = options.network || "testnet";
    this.onPayment = options.onPayment;

    // Initialize x402 client
    this.coreClient = new x402Client();

    // Register the ALGO native payment scheme (algo-exact)
    // This handles native ALGO payments
    const networkCaip2 = this.network === "testnet" 
      ? ALGORAND_TESTNET_CAIP2 
      : ALGORAND_MAINNET_CAIP2;
    
    const algodClient = createAlgodClient(networkCaip2);
    const algoScheme = new AlgoNativeClientScheme({
      algodClient,
      signer: this.wallet.signer,
      address: this.wallet.address,
    });
    this.coreClient.register(networkCaip2, algoScheme);

    // Register the Algorand exact payment scheme (for ASA/USDC)
    // By default, this registers wildcard support (algorand:*)
    registerExactAvmScheme(this.coreClient, {
      signer: this.wallet.signer,
    });

    // Create HTTP client
    this.httpClient = new x402HTTPClient(this.coreClient);
  }

  /**
   * Gets the wallet address
   */
  getAddress(): string {
    return this.wallet.address;
  }

  /**
   * Makes an HTTP request with automatic x402 payment handling
   */
  async fetch<T = unknown>(
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const { method = "GET", headers = {}, body, timeout = 30000 } = options;

    // Build fetch options
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      signal: AbortSignal.timeout(timeout),
    };

    if (body && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    // Make initial request
    let response = await fetch(url, fetchOptions);

    // Check for 402 Payment Required
    if (response.status === 402) {
      // Use x402HTTPClient to parse the 402 response
      const paymentRequired = this.httpClient.getPaymentRequiredResponse(
        (name: string) => response.headers.get(name),
        await response.clone().json().catch(() => undefined)
      );

      // Create payment payload using the x402 client
      const paymentPayload = await this.httpClient.createPaymentPayload(paymentRequired);

      // Get the payment headers
      const paymentHeaders = this.httpClient.encodePaymentSignatureHeader(paymentPayload);

      // Retry request with payment
      const retryOptions: RequestInit = {
        ...fetchOptions,
        headers: {
          ...fetchOptions.headers as Record<string, string>,
          ...paymentHeaders,
        },
      };

      response = await fetch(url, retryOptions);
      // Debug logging (can be removed for production)
      // console.log(`[Payment] Response status: ${response.status}, Content-Type: ${response.headers.get('Content-Type')}`);

      // Record the payment
      const receipt = this.recordPayment(url, paymentRequired);

      // Parse response
      const data = await this.parseResponse<T>(response);
      // console.log(`[Payment] Response data:`, JSON.stringify(data).substring(0, 200));

      return {
        status: response.status,
        statusText: response.statusText,
        headers: this.headersToObject(response.headers),
        data,
        paid: true,
        paymentReceipt: receipt,
      };
    }

    // No payment needed
    const data = await this.parseResponse<T>(response);

    return {
      status: response.status,
      statusText: response.statusText,
      headers: this.headersToObject(response.headers),
      data,
      paid: false,
    };
  }

  /**
   * Makes a request to a known paid service
   */
  async callService<T = unknown>(
    service: ServiceInfo,
    path: string = "/",
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const url = new URL(path, service.endpoint).toString();
    return this.fetch<T>(url, options);
  }

  /**
   * Records a payment
   */
  private recordPayment(
    url: string,
    paymentRequired: PaymentRequired
  ): PaymentReceipt {
    // Extract payment info from the accepts array
    const accepts = paymentRequired.accepts;
    const firstOption = Array.isArray(accepts) ? accepts[0] : accepts;
    
    // Determine token type from scheme
    // algo-exact = native ALGO payments
    // exact = ASA/USDC payments
    const scheme = (firstOption as { scheme?: string }).scheme || "exact";
    const token: PaymentToken = scheme === "algo-exact" ? "ALGO" : "USDC";
    
    // Get amount - handle both v1 and v2 formats
    // v2 uses 'amount' field, v1 uses 'maxAmountRequired'
    const amount = (firstOption as { amount?: string }).amount
      || (firstOption as { maxAmountRequired?: string }).maxAmountRequired 
      || (firstOption as { value?: string }).value 
      || "0";

    const receipt: PaymentReceipt = {
      amount: formatAmount(BigInt(amount)),
      token,
      recipient: (firstOption as { payTo?: string }).payTo || "unknown",
      timestamp: new Date(),
      service: (firstOption as { description?: string }).description || "Unknown Service",
      path: new URL(url).pathname,
    };

    // Update totals
    this.totalSpent[token] += BigInt(amount);
    this.receipts.push(receipt);

    // Callback
    if (this.onPayment) {
      this.onPayment(receipt);
    }

    return receipt;
  }

  /**
   * Gets all payment receipts
   */
  getReceipts(): PaymentReceipt[] {
    return [...this.receipts];
  }

  /**
   * Gets total spent by token
   */
  getTotalSpent(): Record<PaymentToken, string> {
    return {
      ALGO: formatAmount(this.totalSpent.ALGO),
      USDC: formatAmount(this.totalSpent.USDC),
    };
  }

  /**
   * Gets transaction count
   */
  getTransactionCount(): number {
    return this.receipts.length;
  }

  /**
   * Resets payment tracking
   */
  reset(): void {
    this.receipts = [];
    this.totalSpent = { ALGO: 0n, USDC: 0n };
  }

  /**
   * Parses response body
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("Content-Type") || "";

    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    return (await response.text()) as unknown as T;
  }

  /**
   * Converts Headers to plain object
   */
  private headersToObject(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a payment client
 */
export function createPaymentClient(
  mnemonic: string,
  options: Partial<PaymentClientOptions> = {}
): PaymentClient {
  return new PaymentClient({
    mnemonic,
    ...options,
  });
}
