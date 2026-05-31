/**
 * ALGO Native Client Scheme
 * 
 * Creates signed native ALGO payment transactions for x402 payments.
 * Builds payment groups with user's wallet signer.
 */

import algosdk from "algosdk";
import type {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult,
} from "@x402-avm/core/types";
import type { ClientAvmSigner } from "@x402-avm/avm";

/**
 * Payload format for algo-exact scheme
 */
interface AlgoExactPayload {
  paymentGroup: string[]; // Array of base64-encoded signed transactions
  paymentIndex: number;   // Index of the payment transaction in the group
}

/**
 * Configuration for ALGO client scheme
 */
export interface AlgoNativeClientConfig {
  /** Algorand client for getting transaction params */
  algodClient: algosdk.Algodv2;
  /** Wallet signer (x402 AVM signer) */
  signer: ClientAvmSigner;
  /** Sender wallet address */
  address: string;
}

/**
 * ALGO Native Client Scheme
 * Builds signed native ALGO payment transactions
 */
export class AlgoNativeClientScheme implements SchemeNetworkClient {
  readonly scheme = "algo-exact";

  constructor(private readonly config: AlgoNativeClientConfig) {}

  /**
   * Creates a payment payload for the algo-exact scheme
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ): Promise<PaymentPayloadResult> {
    const { amount, payTo, network } = paymentRequirements;

    // Get suggested params from algod
    const suggestedParams = await this.config.algodClient.getTransactionParams().do();

    // Build native ALGO payment transaction
    const paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.config.address,
      receiver: payTo,
      amount: BigInt(amount), // Amount already in microALGO
      note: new Uint8Array(Buffer.from(`x402-payment-v${x402Version}-${Date.now()}`)),
      suggestedParams,
    });

    // Encode transaction for signing
    const encodedTxn = algosdk.encodeUnsignedTransaction(paymentTxn);

    console.log("[x402 ALGO Client] Creating payment:", {
      sender: this.config.address,
      receiver: payTo,
      amount: amount.toString(),
      network,
      txnType: "pay",
    });

    // Sign transaction using AVM signer (which expects array of transactions)
    const signedTxns = await this.config.signer.signTransactions([encodedTxn], [0]);
    const signedTxn = signedTxns[0];

    if (!signedTxn) {
      throw new Error("Failed to sign ALGO payment transaction");
    }

    console.log("[x402 ALGO Client] Transaction signed successfully");

    // Build payment group (single transaction in this case)
    const paymentGroup = [Buffer.from(signedTxn).toString("base64")];

    const payload: AlgoExactPayload = {
      paymentGroup,
      paymentIndex: 0, // Always 0 for single payment
    };

    return {
      x402Version,
      payload: payload as unknown as Record<string, unknown>,
    };
  }
}

/**
 * Helper to create algod client for a given network
 */
export function createAlgodClient(network: string): algosdk.Algodv2 {
  const isTestnet =
    network.includes("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=") ||
    network.includes("testnet");
  const algodUrl = isTestnet
    ? "https://testnet-api.algonode.cloud"
    : "https://mainnet-api.algonode.cloud";

  return new algosdk.Algodv2("", algodUrl, "");
}
