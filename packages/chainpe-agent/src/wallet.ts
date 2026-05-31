/**
 * Wallet Module
 * Handles Algorand wallet operations and creates signers for x402 payments
 * 
 * SECURITY: Wallet mnemonics are retrieved from OS keychain, never stored in files.
 */

import algosdk from "algosdk";
import { toClientAvmSigner, type ClientAvmSigner } from "@x402-avm/avm";

import type { WalletConfig, PaymentToken } from "./types.js";
import {
  ALGOD_TESTNET_URL,
  ALGOD_MAINNET_URL,
  USDC_TESTNET_ASA_ID,
  USDC_MAINNET_ASA_ID,
} from "./types.js";
import { getMnemonic } from "./keychain.js";

// ============================================================================
// Wallet Creation
// ============================================================================

export interface WalletInstance {
  address: string;
  secretKey: Uint8Array;
  signer: ClientAvmSigner;
}

/**
 * Creates a wallet instance from a mnemonic
 * The wallet can sign x402 payment transactions
 */
export function createWalletFromMnemonic(mnemonic: string): WalletInstance {
  const account = algosdk.mnemonicToSecretKey(mnemonic);

  // Convert secret key (Uint8Array) to base64 for x402 signer
  // algosdk returns a 64-byte key (32-byte seed + 32-byte public key)
  const privateKeyBase64 = Buffer.from(account.sk).toString("base64");
  
  // Create the x402 AVM signer
  const signer = toClientAvmSigner(privateKeyBase64);

  return {
    address: account.addr.toString(),
    secretKey: account.sk,
    signer,
  };
}

/**
 * Creates a wallet instance from config by retrieving mnemonic from OS keychain
 * This is the secure way to create a wallet - mnemonic is never stored in files
 * 
 * @throws Error if mnemonic is not found in keychain
 */
export async function createWalletFromConfig(config: WalletConfig): Promise<WalletInstance> {
  const mnemonic = await getMnemonic(config.address);
  
  if (!mnemonic) {
    throw new Error(
      `Wallet mnemonic not found in OS keychain for address: ${config.address}\n` +
      `Run 'chainpe-agent init' to set up your wallet, or 'chainpe-agent migrate-keychain' ` +
      `to migrate from legacy plaintext storage.`
    );
  }
  
  return createWalletFromMnemonic(mnemonic);
}

/**
 * Creates a wallet instance from address by retrieving mnemonic from OS keychain
 * Convenience function when you only have the address
 * 
 * @throws Error if mnemonic is not found in keychain
 */
export async function createWalletFromAddress(address: string): Promise<WalletInstance> {
  const mnemonic = await getMnemonic(address);
  
  if (!mnemonic) {
    throw new Error(
      `Wallet mnemonic not found in OS keychain for address: ${address}\n` +
      `Run 'chainpe-agent init' to set up your wallet.`
    );
  }
  
  return createWalletFromMnemonic(mnemonic);
}

// ============================================================================
// Algod Client
// ============================================================================

/**
 * Creates an Algod client for network operations
 */
export function createAlgodClient(network: "testnet" | "mainnet"): algosdk.Algodv2 {
  const url = network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL;
  return new algosdk.Algodv2("", url, "");
}

// ============================================================================
// Balance Operations
// ============================================================================

export interface WalletBalance {
  algo: bigint;
  usdc: bigint;
  minBalance: bigint;
  optedIntoUsdc: boolean;
}

/**
 * Gets the wallet balance from the Algorand network
 */
export async function getWalletBalance(
  address: string,
  network: "testnet" | "mainnet"
): Promise<WalletBalance> {
  const algod = createAlgodClient(network);
  const usdcAsaId = network === "testnet" ? USDC_TESTNET_ASA_ID : USDC_MAINNET_ASA_ID;

  try {
    const info = await algod.accountInformation(address).do();

    let usdcBalance = 0n;
    let optedIntoUsdc = false;

    // Find USDC asset (algosdk v3 uses assetId property)
    const assets = info.assets || [];
    for (const asset of assets) {
      if (asset.assetId === BigInt(usdcAsaId)) {
        usdcBalance = asset.amount;
        optedIntoUsdc = true;
        break;
      }
    }

    return {
      algo: info.amount,
      usdc: usdcBalance,
      minBalance: info.minBalance,
      optedIntoUsdc,
    };
  } catch (error) {
    // Account may not exist yet (0 balance)
    return {
      algo: 0n,
      usdc: 0n,
      minBalance: 100000n, // Default minimum balance
      optedIntoUsdc: false,
    };
  }
}

/**
 * Checks if wallet has sufficient balance for a payment
 */
export function hasSufficientBalance(
  balance: WalletBalance,
  amount: bigint,
  token: PaymentToken
): boolean {
  if (token === "ALGO") {
    // Need amount + min balance + some buffer for fees
    const required = amount + balance.minBalance + 1000n;
    return balance.algo >= required;
  } else {
    // USDC - just need the amount (ALGO for fees checked separately)
    return balance.usdc >= amount && balance.algo >= balance.minBalance + 1000n;
  }
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Formats microunits to human-readable amount
 */
export function formatAmount(microunits: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const whole = microunits / divisor;
  const fraction = microunits % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fractionStr}`;
}

/**
 * Parses human-readable amount to microunits
 */
export function parseAmount(amount: string, decimals: number = 6): bigint {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0");
  const fractionStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const fraction = BigInt(fractionStr);

  return whole * BigInt(10 ** decimals) + fraction;
}

/**
 * Formats wallet balance for display
 */
export function formatBalance(balance: WalletBalance): {
  algo: string;
  usdc: string;
  available: string;
} {
  const algoFormatted = formatAmount(balance.algo);
  const usdcFormatted = balance.optedIntoUsdc ? formatAmount(balance.usdc) : "0 (not opted in)";
  const available = formatAmount(balance.algo - balance.minBalance);

  return {
    algo: algoFormatted,
    usdc: usdcFormatted,
    available,
  };
}
