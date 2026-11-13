/**
 * Wallet Module (Avalanche C-Chain)
 *
 * Derives an EVM account from a private key and builds an x402 signer for
 * payments. Replaces the Algorand algosdk + @x402-avm implementation with viem.
 *
 * SECURITY: Private keys are retrieved from the OS keychain, never stored in files.
 */

import {
  createPublicClient,
  http,
  erc20Abi,
  formatUnits,
  parseUnits,
  getAddress,
  type PublicClient,
} from "viem";
import { avalanche, avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSigner } from "x402-fetch";

import type { ChainPeNetwork } from "./types.js";
import { RPC_URLS, USDC_ADDRESS, USDC_DECIMALS, X402_NETWORK } from "./types.js";
import { getPrivateKey } from "./keychain.js";

const CHAINS = { fuji: avalancheFuji, avalanche } as const;

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

// ============================================================================
// Wallet Creation
// ============================================================================

export interface WalletInstance {
  address: string;
  /** x402 EVM signer (viem wallet client) for the given network. */
  signer: unknown;
  network: ChainPeNetwork;
}

/** Creates a wallet instance from a private key for the given network. */
export async function createWalletFromPrivateKey(
  privateKey: string,
  network: ChainPeNetwork = "fuji"
): Promise<WalletInstance> {
  const key = normalizeKey(privateKey);
  const account = privateKeyToAccount(key);
  const signer = await createSigner(X402_NETWORK[network], key);
  return { address: account.address, signer, network };
}

/** Creates a wallet instance by retrieving the private key from the OS keychain. */
export async function createWalletFromAddress(
  address: string,
  network: ChainPeNetwork = "fuji"
): Promise<WalletInstance> {
  const privateKey = await getPrivateKey(address);
  if (!privateKey) {
    throw new Error(
      `Wallet private key not found in OS keychain for address: ${address}\n` +
        `Run 'chainpe-agent init' to set up your wallet.`
    );
  }
  return createWalletFromPrivateKey(privateKey, network);
}

/** Derives the EVM address from a private key. */
export function addressFromPrivateKey(privateKey: string): string {
  return privateKeyToAccount(normalizeKey(privateKey)).address;
}

// ============================================================================
// Clients
// ============================================================================

export function createClient(network: ChainPeNetwork): PublicClient {
  return createPublicClient({ chain: CHAINS[network], transport: http(RPC_URLS[network]) });
}

// ============================================================================
// Balances
// ============================================================================

export interface WalletBalance {
  avax: bigint; // wei (18 decimals)
  usdc: bigint; // atomic (6 decimals)
}

export async function getWalletBalance(
  address: string,
  network: ChainPeNetwork
): Promise<WalletBalance> {
  const client = createClient(network);
  const addr = getAddress(address);
  try {
    const [avax, usdc] = await Promise.all([
      client.getBalance({ address: addr }),
      client.readContract({
        address: USDC_ADDRESS[network],
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [addr],
      }) as Promise<bigint>,
    ]);
    return { avax, usdc };
  } catch {
    return { avax: 0n, usdc: 0n };
  }
}

export function hasSufficientUsdc(balance: WalletBalance, amountAtomic: bigint): boolean {
  return balance.usdc >= amountAtomic;
}

// ============================================================================
// Formatting
// ============================================================================

/** Formats atomic USDC (6 decimals) to a human string. */
export function formatAmount(atomic: bigint, decimals: number = USDC_DECIMALS): string {
  return formatUnits(atomic, decimals);
}

/** Parses a human USDC string to atomic units. */
export function parseAmount(amount: string, decimals: number = USDC_DECIMALS): bigint {
  return parseUnits(amount, decimals);
}

export function formatBalance(balance: WalletBalance): { avax: string; usdc: string } {
  return {
    avax: formatUnits(balance.avax, 18),
    usdc: formatUnits(balance.usdc, USDC_DECIMALS),
  };
}
