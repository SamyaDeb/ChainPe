/**
 * Local Facilitator Client
 * 
 * Wraps the x402Facilitator class to provide a FacilitatorClient interface
 * that can be used directly with x402ResourceServer without needing an
 * external HTTP facilitator server.
 */

import { x402Facilitator } from "@x402-avm/core/facilitator";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/facilitator";
import { toFacilitatorAvmSigner } from "@x402-avm/avm";
import type { 
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
  Network
} from "@x402-avm/core/types";
import { mnemonicToSecretKey } from "algosdk";
import { 
  ALGORAND_TESTNET_CAIP2, 
  ALGORAND_MAINNET_CAIP2,
} from "../types.js";

/**
 * Converts an Algorand mnemonic to a Base64-encoded private key
 * that the x402-avm library expects.
 * 
 * The algosdk mnemonicToSecretKey returns a 64-byte secret key where:
 * - First 32 bytes: seed
 * - Last 32 bytes: public key
 */
function mnemonicToBase64PrivateKey(mnemonic: string): string {
  const account = mnemonicToSecretKey(mnemonic);
  // algosdk v3 returns { addr, sk } where sk is a Uint8Array
  return Buffer.from(account.sk).toString("base64");
}

/**
 * FacilitatorClient interface that x402ResourceServer expects
 */
export interface FacilitatorClient {
  getSupported(): Promise<SupportedResponse>;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

/**
 * Local facilitator client that uses an in-process x402Facilitator
 * instead of making HTTP requests to an external server.
 */
export class LocalFacilitatorClient implements FacilitatorClient {
  private facilitator: x402Facilitator;
  private networks: Network[];
  
  /**
   * Creates a new LocalFacilitatorClient
   * 
   * @param mnemonic - 25-word Algorand mnemonic for signing fee-payer transactions
   * @param network - "testnet" or "mainnet"
   */
  constructor(mnemonic: string, network: "testnet" | "mainnet" = "testnet") {
    this.facilitator = new x402Facilitator();
    
    // Determine network CAIP2 identifier
    const networkCaip2 = (network === "testnet" 
      ? ALGORAND_TESTNET_CAIP2 
      : ALGORAND_MAINNET_CAIP2) as Network;
    
    this.networks = [networkCaip2];
    
    // Convert mnemonic to Base64 private key
    const privateKeyBase64 = mnemonicToBase64PrivateKey(mnemonic);
    
    // Create AVM signer using the x402-avm helper
    const signer = toFacilitatorAvmSigner(privateKeyBase64);
    
    // Register the exact AVM scheme with the facilitator
    registerExactAvmScheme(this.facilitator, {
      signer,
      networks: this.networks
    });
  }
  
  /**
   * Get supported payment kinds
   */
  async getSupported(): Promise<SupportedResponse> {
    return this.facilitator.getSupported() as unknown as SupportedResponse;
  }
  
  /**
   * Verify a payment payload
   */
  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.facilitator.verify(payload, requirements);
  }
  
  /**
   * Settle a payment
   */
  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return this.facilitator.settle(payload, requirements);
  }
}

/**
 * Creates a local facilitator client from a mnemonic
 */
export function createLocalFacilitator(
  mnemonic: string, 
  network: "testnet" | "mainnet" = "testnet"
): FacilitatorClient {
  return new LocalFacilitatorClient(mnemonic, network);
}
