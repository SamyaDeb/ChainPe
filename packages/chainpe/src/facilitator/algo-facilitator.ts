/**
 * ALGO Native Facilitator
 * 
 * Verifies and settles x402 payments using native ALGO payment transactions.
 * Broadcasts signed transactions to Algorand and returns real transaction IDs.
 * 
 * No mnemonic required - only verifies and broadcasts already-signed transactions.
 */

import algosdk from "algosdk";
import { createAlgodClient } from "./index.js";
import { 
  ALGORAND_TESTNET_CAIP2, 
  ALGORAND_MAINNET_CAIP2,
  ALGO_DECIMALS,
} from "../types.js";
import type { 
  PaymentPayload, 
  PaymentRequirements, 
  VerifyResponse, 
  SettleResponse,
  SupportedResponse,
} from "@x402-avm/core/types";

/**
 * FacilitatorClient interface that x402ResourceServer expects
 */
export interface FacilitatorClient {
  getSupported(): Promise<SupportedResponse>;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

/**
 * Payload format for algo-exact scheme
 */
interface AlgoExactPayload {
  paymentGroup: string[]; // Array of base64-encoded signed transactions
  paymentIndex: number;   // Index of the payment transaction in the group
}

/**
 * ALGO Native Facilitator
 * Verifies native ALGO payment transactions and broadcasts them to the network
 */
export class AlgoNativeFacilitator implements FacilitatorClient {
  private algod: algosdk.Algodv2;
  private indexer: algosdk.Indexer;
  private network: "testnet" | "mainnet";
  private walletAddress: string;
  
  constructor(walletAddress: string, network: "testnet" | "mainnet" = "testnet") {
    this.walletAddress = walletAddress;
    this.network = network;
    this.algod = createAlgodClient(network);
    
    // Create indexer for transaction lookups
    this.indexer = new algosdk.Indexer(
      "",
      network === "testnet" 
        ? "https://testnet-idx.algonode.cloud" 
        : "https://mainnet-idx.algonode.cloud",
      ""
    );
  }
  
  /**
   * Get supported payment kinds (x402 v2 format)
   */
  async getSupported(): Promise<SupportedResponse> {
    const networkCaip2 = this.network === "testnet" 
      ? ALGORAND_TESTNET_CAIP2 
      : ALGORAND_MAINNET_CAIP2;
    
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: "algo-exact",
          network: networkCaip2,
          extra: {
            decimals: ALGO_DECIMALS,
            tokenName: "ALGO",
          },
        },
      ],
      extensions: [],
      signers: {},
    };
  }
  
  /**
   * Verify a payment by decoding and validating the signed transaction
   */
  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    try {
      // Extract and validate payload format
      const algoPayload = this.extractAlgoPayload(payload);
      if (!algoPayload) {
        return {
          isValid: false,
          invalidReason: "Invalid payload format for algo-exact scheme",
        };
      }

      // Validate group structure
      const { paymentGroup, paymentIndex } = algoPayload;
      
      if (!Array.isArray(paymentGroup) || paymentGroup.length === 0) {
        return {
          isValid: false,
          invalidReason: "Payment group is empty or invalid",
        };
      }

      if (paymentIndex < 0 || paymentIndex >= paymentGroup.length) {
        return {
          isValid: false,
          invalidReason: `Invalid payment index: ${paymentIndex}`,
        };
      }

      // Decode the payment transaction
      const paymentTxnBase64 = paymentGroup[paymentIndex];
      const signedTxnBytes = Buffer.from(paymentTxnBase64, "base64");
      const signedTxn = algosdk.decodeSignedTransaction(signedTxnBytes);

      // Verify signature exists
      if (!signedTxn.sig && !signedTxn.msig && !signedTxn.lsig) {
        return {
          isValid: false,
          invalidReason: "Transaction is not signed",
        };
      }

      const txn = signedTxn.txn;

      // Verify transaction type is payment
      if (txn.type !== algosdk.TransactionType.pay) {
        return {
          isValid: false,
          invalidReason: `Expected payment transaction, got ${txn.type}`,
        };
      }

      // Verify payment fields exist
      if (!txn.payment) {
        return {
          isValid: false,
          invalidReason: "Transaction missing payment fields",
        };
      }

      // Verify receiver matches payTo
      const receiver = txn.payment.receiver.toString();
      if (receiver !== requirements.payTo) {
        return {
          isValid: false,
          invalidReason: `Payment receiver ${receiver} does not match required ${requirements.payTo}`,
        };
      }

      // Verify amount
      const paidAmount = txn.payment.amount;
      const requiredAmount = BigInt(requirements.amount);
      
      if (paidAmount < requiredAmount) {
        return {
          isValid: false,
          invalidReason: `Insufficient payment: ${paidAmount} < ${requiredAmount} microALGO`,
        };
      }

      // Verify network (genesis hash)
      const txnGenesisHash = txn.genesisHash 
        ? Buffer.from(txn.genesisHash).toString("base64")
        : "";
      const expectedGenesisHash = this.network === "testnet"
        ? "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="
        : "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";

      if (txnGenesisHash !== expectedGenesisHash) {
        return {
          isValid: false,
          invalidReason: `Transaction is for wrong network (genesis hash mismatch)`,
        };
      }

      // Get payer address
      const payer = txn.sender.toString();

      return {
        isValid: true,
        payer,
      };
      
    } catch (error) {
      return {
        isValid: false,
        invalidReason: `Verification error: ${(error as Error).message}`,
      };
    }
  }
  
  /**
   * Settle a payment by broadcasting it to the Algorand network
   */
  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    const networkCaip2 = this.network === "testnet" 
      ? ALGORAND_TESTNET_CAIP2 
      : ALGORAND_MAINNET_CAIP2;

    try {
      // First verify the payment
      const verifyResult = await this.verify(payload, requirements);
      
      if (!verifyResult.isValid) {
        return {
          success: false,
          errorReason: "verification_failed",
          errorMessage: verifyResult.invalidReason,
          transaction: "",
          network: networkCaip2,
        };
      }

      // Extract payload
      const algoPayload = this.extractAlgoPayload(payload);
      if (!algoPayload) {
        return {
          success: false,
          errorReason: "invalid_payload",
          errorMessage: "Could not extract payment group",
          transaction: "",
          network: networkCaip2,
        };
      }

      // Convert base64 transactions to bytes
      const signedTxns = algoPayload.paymentGroup.map(base64Txn => 
        Buffer.from(base64Txn, "base64")
      );

      // Broadcast to network
      const response = await this.algod.sendRawTransaction(signedTxns).do();
      const txId = response.txid;

      // Wait for confirmation (optional - makes sure tx is accepted)
      try {
        await algosdk.waitForConfirmation(this.algod, txId, 4);
      } catch (confirmError) {
        // Transaction was broadcast but confirmation timed out
        // Still return success with txId - it may confirm later
        console.warn(`Transaction ${txId} broadcast but confirmation timed out:`, confirmError);
      }

      return {
        success: true,
        transaction: txId,
        network: networkCaip2,
        payer: verifyResult.payer,
      };
      
    } catch (error) {
      return {
        success: false,
        errorReason: "broadcast_failed",
        errorMessage: `Failed to broadcast transaction: ${(error as Error).message}`,
        transaction: "",
        network: networkCaip2,
      };
    }
  }
  
  /**
   * Extract AlgoExactPayload from generic PaymentPayload
   */
  private extractAlgoPayload(payload: PaymentPayload): AlgoExactPayload | null {
    try {
      const rawPayload = payload.payload;
      
      if (!rawPayload || typeof rawPayload !== "object") {
        return null;
      }

      const { paymentGroup, paymentIndex } = rawPayload as any;

      if (!paymentGroup || !Array.isArray(paymentGroup)) {
        return null;
      }

      if (typeof paymentIndex !== "number") {
        return null;
      }

      return { paymentGroup, paymentIndex };
    } catch {
      return null;
    }
  }
}

/**
 * Creates an ALGO native facilitator from wallet address and network
 * No mnemonic required - only verifies and broadcasts signed transactions
 */
export function createAlgoNativeFacilitator(
  walletAddress: string,
  network: "testnet" | "mainnet" = "testnet"
): FacilitatorClient {
  return new AlgoNativeFacilitator(walletAddress, network);
}
