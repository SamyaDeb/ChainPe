/**
 * Algorand Facilitator Client
 * Connects to the GoPlausible x402 facilitator for Algorand payments
 */

import { HTTPFacilitatorClient } from "@x402-avm/core/server";
import {
  FACILITATOR_URL,
  ALGOD_TESTNET_URL,
  ALGOD_MAINNET_URL,
} from "../types.js";
import algosdk from "algosdk";

export interface AlgorandFacilitatorOptions {
  network: "testnet" | "mainnet";
  facilitatorUrl?: string;
}

/**
 * Creates an HTTP facilitator client for x402 payment verification
 */
export function createFacilitatorClient(
  options: AlgorandFacilitatorOptions
): HTTPFacilitatorClient {
  const url = options.facilitatorUrl || FACILITATOR_URL;

  return new HTTPFacilitatorClient({ url });
}

/**
 * Creates an Algod client for interacting with the Algorand network
 */
export function createAlgodClient(
  network: "testnet" | "mainnet"
): algosdk.Algodv2 {
  const url = network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL;

  return new algosdk.Algodv2("", url, "");
}

/**
 * Validates an Algorand wallet address (58-char base32)
 */
export function isValidAlgorandAddress(address: string): boolean {
  if (!address || address.length !== 58) {
    return false;
  }

  try {
    // algosdk will throw if the address is invalid
    algosdk.decodeAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a 25-word Algorand mnemonic
 */
export function isValidMnemonic(mnemonic: string): boolean {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 25) {
    return false;
  }

  try {
    algosdk.mnemonicToSecretKey(mnemonic);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derives wallet address from mnemonic
 */
export function addressFromMnemonic(mnemonic: string): string {
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  return account.addr.toString();
}

/**
 * Gets account info from the Algorand network
 */
export async function getAccountInfo(
  algod: algosdk.Algodv2,
  address: string
): Promise<{
  balance: bigint;
  minBalance: bigint;
  assets: Array<{ assetId: bigint; amount: bigint }>;
}> {
  const info = await algod.accountInformation(address).do();

  return {
    balance: info.amount,
    minBalance: info.minBalance,
    assets: (info.assets || []).map((a) => ({
      assetId: a.assetId,
      amount: a.amount,
    })),
  };
}

/**
 * Formats microAlgos to ALGO with proper decimals
 */
export function formatAlgo(microAlgos: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const whole = microAlgos / divisor;
  const fraction = microAlgos % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction.toString().padStart(decimals, "0");
  const trimmedFraction = fractionStr.replace(/0+$/, "");

  return `${whole}.${trimmedFraction}`;
}

/**
 * Parses a human-readable amount to microunits
 */
export function parseAmount(amount: string, decimals: number = 6): bigint {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0");
  const fractionStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const fraction = BigInt(fractionStr);

  return whole * BigInt(10 ** decimals) + fraction;
}
