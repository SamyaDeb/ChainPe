/**
 * Avalanche C-Chain network definitions.
 *
 * Replaces the Algorand network constants (CAIP-2 genesis hashes, algod URLs,
 * ASA ids) with EVM equivalents: chainId, RPC, USDC ERC-20 address, the x402
 * network identifier, and the Snowtrace explorer base.
 */
import { avalanche, avalancheFuji } from "viem/chains";
import type { Chain } from "viem";
import type { Network as X402Network } from "x402/types";

export type ChainPeNetwork = "fuji" | "avalanche";

export interface NetworkInfo {
  /** ChainPe-facing network name. */
  name: ChainPeNetwork;
  /** EVM chain id. */
  chainId: number;
  /** viem chain object. */
  chain: Chain;
  /** Default public RPC URL. */
  rpcUrl: string;
  /** Canonical Circle USDC ERC-20 (6 decimals). */
  usdc: `0x${string}`;
  /** x402 network identifier. */
  x402Network: X402Network;
  /** Snowtrace explorer base URL (no trailing slash). */
  explorer: string;
}

export const NETWORKS: Record<ChainPeNetwork, NetworkInfo> = {
  fuji: {
    name: "fuji",
    chainId: 43113,
    chain: avalancheFuji,
    rpcUrl: process.env.FUJI_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc",
    usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
    x402Network: "avalanche-fuji",
    explorer: "https://testnet.snowtrace.io",
  },
  avalanche: {
    name: "avalanche",
    chainId: 43114,
    chain: avalanche,
    rpcUrl: process.env.AVALANCHE_RPC_URL ?? "https://api.avax.network/ext/bc/C/rpc",
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    x402Network: "avalanche",
    explorer: "https://snowtrace.io",
  },
};

export const USDC_DECIMALS = 6;

export function getNetwork(network: ChainPeNetwork): NetworkInfo {
  const info = NETWORKS[network];
  if (!info) throw new Error(`Unknown network: ${network}`);
  return info;
}

/** Maps an x402 network id back to the ChainPe network name. */
export function fromX402Network(x402: string): ChainPeNetwork | undefined {
  if (x402 === "avalanche-fuji") return "fuji";
  if (x402 === "avalanche") return "avalanche";
  return undefined;
}

export function explorerTxUrl(network: ChainPeNetwork, txHash: string): string {
  return `${getNetwork(network).explorer}/tx/${txHash}`;
}
