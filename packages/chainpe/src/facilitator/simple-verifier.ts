/**
 * Simple Payment Verifier (facilitator-less)
 *
 * Lets `chainpe start` accept USDC/ASA payments WITHOUT a facilitator mnemonic.
 *
 * How it works:
 *  - getSupported() advertises the `exact` (USDC/ASA) and `algo-exact` (native
 *    ALGO) schemes in the shape the current @x402-avm route validator expects
 *    ({ kinds: [{ x402Version: 2, scheme, network }], ... }). It deliberately
 *    does NOT advertise a `feePayer`, so the client fully signs and self-pays
 *    the tiny Algorand fee — no facilitator signing key is needed.
 *  - verify() decodes the client-signed transaction group and checks the
 *    receiver, amount, and asset statelessly (the txn is not on-chain yet).
 *  - settle() broadcasts the already-signed group to Algorand and waits for
 *    confirmation. No mnemonic required: the transactions are signed by the
 *    paying client; the verifier only relays them.
 */

import algosdk from "algosdk";
import { createAlgodClient } from "./index.js";
import {
  ALGORAND_TESTNET_CAIP2,
  ALGORAND_MAINNET_CAIP2,
  USDC_TESTNET_ASA_ID,
  USDC_MAINNET_ASA_ID,
} from "../types.js";

/**
 * FacilitatorClient interface that x402ResourceServer expects
 */
export interface FacilitatorClient {
  getSupported(): Promise<any>;
  verify(payload: any, requirements: any): Promise<any>;
  settle(payload: any, requirements: any): Promise<any>;
}

interface DecodedPayment {
  payer: string;
  receiver: string | undefined;
  amount: bigint;
  assetId: bigint | undefined;
  type: string;
  txId: string;
}

/**
 * Simple payment verifier that relays client-signed Algorand transactions.
 * No mnemonic required.
 */
export class SimplePaymentVerifier implements FacilitatorClient {
  private algod: algosdk.Algodv2;
  private network: "testnet" | "mainnet";
  private walletAddress: string;

  constructor(walletAddress: string, network: "testnet" | "mainnet" = "testnet") {
    this.walletAddress = walletAddress;
    this.network = network;
    this.algod = createAlgodClient(network);
  }

  private get networkCaip2(): string {
    return this.network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;
  }

  private get usdcAsaId(): bigint {
    return BigInt(this.network === "testnet" ? USDC_TESTNET_ASA_ID : USDC_MAINNET_ASA_ID);
  }

  /**
   * Get supported payment kinds in the shape the x402 route validator expects.
   * Each kind: { x402Version: 2, scheme, network }. No feePayer advertised, so
   * the client fully signs and self-pays the network fee.
   */
  async getSupported(): Promise<any> {
    const networkCaip2 = this.networkCaip2;
    const schemes = ["exact", "algo-exact"];
    return {
      kinds: schemes.map((scheme) => ({
        x402Version: 2,
        scheme,
        network: networkCaip2,
      })),
      extensions: [],
      signers: {},
    };
  }

  /**
   * Verify the client-signed payment transaction WITHOUT requiring it to be
   * on-chain yet (it is broadcast in settle()).
   */
  async verify(payload: any, requirements: any): Promise<any> {
    try {
      const decoded = this.decodePayment(payload);
      if (!decoded) {
        return { isValid: false, invalidReason: "Could not decode signed payment transaction" };
      }

      const check = this.validate(decoded, requirements);
      if (!check.valid) {
        return { isValid: false, invalidReason: check.reason };
      }

      return { isValid: true, payer: decoded.payer };
    } catch (error) {
      return { isValid: false, invalidReason: `Verification error: ${(error as Error).message}` };
    }
  }

  /**
   * Settle by broadcasting the already-signed transaction group to Algorand.
   */
  async settle(payload: any, requirements: any): Promise<any> {
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        transaction: "",
        network: this.networkCaip2,
        errorMessage: verifyResult.invalidReason,
      };
    }

    try {
      const group = this.extractGroup(payload);
      if (!group) {
        return {
          success: false,
          transaction: "",
          network: this.networkCaip2,
          errorMessage: "No payment transaction group found in payload",
        };
      }

      const blobs = group.entries.map((b64) => new Uint8Array(Buffer.from(b64, "base64")));
      const paymentTxId = algosdk
        .decodeSignedTransaction(blobs[group.index])
        .txn.txID();

      // Broadcast the signed group. Tolerate the case where it was already
      // submitted (e.g. a retry) and is already in / pending the ledger.
      try {
        await this.algod.sendRawTransaction(blobs).do();
      } catch (err) {
        const msg = (err as Error).message || "";
        if (!/already in ledger|transaction already|already committed/i.test(msg)) {
          throw err;
        }
      }

      await algosdk.waitForConfirmation(this.algod, paymentTxId, 10);

      return {
        success: true,
        transaction: paymentTxId,
        network: this.networkCaip2,
      };
    } catch (error) {
      return {
        success: false,
        transaction: "",
        network: this.networkCaip2,
        errorMessage: `Settlement (broadcast) failed: ${(error as Error).message}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * Pulls the AVM payment group ({ paymentGroup, paymentIndex }) out of the
   * payload, handling both the wrapped PaymentPayload and the inner shape.
   */
  private extractGroup(
    payload: any
  ): { entries: string[]; index: number } | null {
    const candidates = [payload?.payload, payload];
    for (const c of candidates) {
      if (c && Array.isArray(c.paymentGroup) && c.paymentGroup.length > 0) {
        return { entries: c.paymentGroup, index: Number(c.paymentIndex ?? 0) };
      }
    }
    return null;
  }

  /**
   * Decodes the signed payment transaction (at paymentIndex) into its key fields.
   */
  private decodePayment(payload: any): DecodedPayment | null {
    const group = this.extractGroup(payload);
    if (!group) return null;

    const entry = group.entries[group.index] ?? group.entries[0];
    const bytes = new Uint8Array(Buffer.from(entry, "base64"));
    const stxn = algosdk.decodeSignedTransaction(bytes);
    const txn: any = stxn.txn;

    const payer = txn.sender ? txn.sender.toString() : "unknown";
    let receiver: string | undefined;
    let amount = 0n;
    let assetId: bigint | undefined;

    if (txn.type === "axfer" && txn.assetTransfer) {
      receiver = txn.assetTransfer.receiver?.toString();
      amount = BigInt(txn.assetTransfer.amount ?? 0);
      assetId = BigInt(txn.assetTransfer.assetIndex ?? 0);
    } else if (txn.type === "pay" && txn.payment) {
      receiver = txn.payment.receiver?.toString();
      amount = BigInt(txn.payment.amount ?? 0);
    }

    return { payer, receiver, amount, assetId, type: txn.type, txId: txn.txID() };
  }

  /**
   * Validates the decoded payment against the route requirements.
   */
  private validate(
    decoded: DecodedPayment,
    requirements: any
  ): { valid: boolean; reason?: string } {
    // Receiver must be the provider's wallet.
    const expectedPayTo = requirements?.payTo || this.walletAddress;
    if (decoded.receiver !== expectedPayTo) {
      return {
        valid: false,
        reason: `Payment receiver ${decoded.receiver} does not match expected ${expectedPayTo}`,
      };
    }

    // Amount must cover the required price (when specified).
    const requiredRaw =
      requirements?.maxAmountRequired ?? requirements?.amount ?? requirements?.maxAmount;
    if (requiredRaw !== undefined && requiredRaw !== null) {
      let required: bigint;
      try {
        required = BigInt(requiredRaw);
      } catch {
        required = 0n;
      }
      if (decoded.amount < required) {
        return { valid: false, reason: `Paid ${decoded.amount}, required ${required}` };
      }
    }

    // For ASA (USDC) payments, ensure the correct asset was transferred.
    if (decoded.type === "axfer") {
      const expectedAsset = this.assetIdFromRequirements(requirements);
      if (expectedAsset !== undefined && decoded.assetId !== expectedAsset) {
        return {
          valid: false,
          reason: `Wrong asset: paid asset ${decoded.assetId}, expected ${expectedAsset}`,
        };
      }
    }

    return { valid: true };
  }

  private assetIdFromRequirements(requirements: any): bigint | undefined {
    const candidate =
      requirements?.extra?.assetId ??
      (typeof requirements?.asset === "string" && /^\d+$/.test(requirements.asset)
        ? requirements.asset
        : undefined);
    if (candidate === undefined || candidate === null) {
      // Fall back to the network's USDC ASA id.
      return this.usdcAsaId;
    }
    try {
      return BigInt(candidate);
    } catch {
      return this.usdcAsaId;
    }
  }
}

/**
 * Creates a simple payment verifier from wallet address and network.
 * No mnemonic required.
 */
export function createSimpleVerifier(
  walletAddress: string,
  network: "testnet" | "mainnet" = "testnet"
): FacilitatorClient {
  return new SimplePaymentVerifier(walletAddress, network);
}
