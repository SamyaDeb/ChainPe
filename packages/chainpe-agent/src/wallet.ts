/**
 * Wallet helpers on Arc. On Arc, gas is also paid in USDC.
 */
import { erc20Abi, formatUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ChainPe, getUsdcAddress, normalizeKey, publicClientFor, USDC_DECIMALS } from "@chainpearc/sdk";
import type { ChainPeNetwork } from "./types.js";

export interface WalletBalance {
  /** USDC in the wallet, human units. */
  usdc: string;
  /** USDC in Circle Gateway, human units. Only known when the key is given. */
  gateway?: string;
}

export function addressFromPrivateKey(privateKey: string): string {
  return privateKeyToAccount(normalizeKey(privateKey)).address;
}

/** Reads the wallet's USDC, and its Gateway deposit when the key is given. */
export async function getWalletBalance(address: string, network: ChainPeNetwork, privateKey?: string): Promise<WalletBalance> {
  if (privateKey) return new ChainPe({ privateKey, network }).balance();
  const raw = (await publicClientFor(network).readContract({
    address: getUsdcAddress(network),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(address)],
  })) as bigint;
  return { usdc: formatUnits(raw, USDC_DECIMALS) };
}

export function formatBalance(balance: WalletBalance): { usdc: string; gateway?: string } {
  const fmt = (value: string) => Number(value).toFixed(4);
  return { usdc: fmt(balance.usdc), gateway: balance.gateway === undefined ? undefined : fmt(balance.gateway) };
}
