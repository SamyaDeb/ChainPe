/**
 * EVM helpers for the ChainPe provider (Avalanche C-Chain).
 *
 * Replaces the Algorand `facilitator/algorand-client.ts` helpers: address
 * validation, account balances (AVAX + USDC), and amount formatting — all via
 * viem instead of algosdk.
 */
import {
  createPublicClient,
  http,
  isAddress,
  getAddress,
  formatUnits,
  parseUnits,
  erc20Abi,
  type PublicClient,
} from "viem";
import { getNetwork, USDC_DECIMALS, type ChainPeNetwork } from "./chains.js";

/** Creates a read-only viem public client for the given network. */
export function createClient(network: ChainPeNetwork): PublicClient {
  const info = getNetwork(network);
  return createPublicClient({ chain: info.chain, transport: http(info.rpcUrl) });
}

/** Validates an EVM address (0x + 40 hex, checksum-tolerant). */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/** Normalises to a checksummed address; throws if invalid. */
export function toChecksum(address: string): `0x${string}` {
  return getAddress(address);
}

export interface AccountBalances {
  avax: bigint; // wei (18 decimals)
  usdc: bigint; // atomic (6 decimals)
}

/** Fetches native AVAX and USDC balances for an address. */
export async function getAccountBalances(
  network: ChainPeNetwork,
  address: string
): Promise<AccountBalances> {
  const client = createClient(network);
  const info = getNetwork(network);
  const addr = getAddress(address);

  const [avax, usdc] = await Promise.all([
    client.getBalance({ address: addr }),
    client.readContract({
      address: info.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    }) as Promise<bigint>,
  ]);

  return { avax, usdc };
}

/** Formats atomic USDC (6 decimals) to a human string. */
export function formatUsdc(atomic: bigint): string {
  return formatUnits(atomic, USDC_DECIMALS);
}

/** Formats wei AVAX (18 decimals) to a human string. */
export function formatAvax(wei: bigint): string {
  return formatUnits(wei, 18);
}

/** Parses a human USDC string to atomic units. */
export function parseUsdc(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}
