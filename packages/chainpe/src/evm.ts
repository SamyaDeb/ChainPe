/**
 * EVM helpers for the ChainPe provider: address validation, USDC balances and
 * amount formatting, all via viem.
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

/** Fetches the ERC-20 USDC balance (6 decimals). On Arc this also pays gas. */
export async function getUsdcBalance(network: ChainPeNetwork, address: string): Promise<bigint> {
  return createClient(network).readContract({
    address: getNetwork(network).usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(address)],
  }) as Promise<bigint>;
}

/** Formats atomic USDC (6 decimals) to a human string. */
export function formatUsdc(atomic: bigint): string {
  return formatUnits(atomic, USDC_DECIMALS);
}

/** Parses a human USDC string to atomic units. */
export function parseUsdc(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}
