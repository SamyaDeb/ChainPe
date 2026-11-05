/**
 * Network definitions for ChainPe on Circle's Arc.
 *
 * Arc pays gas in USDC. The native balance has 18 decimals while the ERC-20
 * interface at `usdc` has 6, so amounts always go through the ERC-20.
 */
import { arc, arcTestnet } from "viem/chains";
import type { Chain } from "viem";

export type ChainPeNetwork = "arc-testnet" | "arc";

export type GasToken = "USDC";

export interface NetworkInfo {
  /** ChainPe-facing network name. */
  name: ChainPeNetwork;
  /** Human-readable network name. */
  displayName: string;
  /** EVM chain id. */
  chainId: number;
  /** CAIP-2 network id, used by x402 v2. */
  caip2: `eip155:${number}`;
  /** viem chain object, pointing at the RPC and explorer below. */
  chain: Chain;
  /** RPC URL (env override, else the public default). */
  rpcUrl: string;
  /** Canonical Circle USDC ERC-20 (6 decimals). */
  usdc: `0x${string}`;
  /** Explorer base URL (no trailing slash). */
  explorer: string;
  /** Token that pays gas on this network. */
  gasToken: GasToken;
  /** Circle Gateway SDK name of this chain. */
  gatewayChain: "arcTestnet" | "arc";
  /** Gateway API for this network; undefined uses the SDK default (mainnet). */
  gatewayUrl?: string;
}

const ARC_USDC = "0x3600000000000000000000000000000000000000";

function withEndpoints(chain: Chain, rpcUrl: string, explorer: string): Chain {
  return {
    ...chain,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arc Explorer", url: explorer } },
  };
}

const ARC_TESTNET_RPC = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.io";
const ARC_TESTNET_EXPLORER = "https://explorer.testnet.arc.io";
const ARC_RPC = process.env.ARC_RPC_URL ?? "https://rpc.mainnet.arc.io";
const ARC_EXPLORER = "https://explorer.arc.io";

export const NETWORKS: Record<ChainPeNetwork, NetworkInfo> = {
  "arc-testnet": {
    name: "arc-testnet",
    displayName: "Arc Testnet",
    chainId: 5042002,
    caip2: "eip155:5042002",
    chain: withEndpoints(arcTestnet, ARC_TESTNET_RPC, ARC_TESTNET_EXPLORER),
    rpcUrl: ARC_TESTNET_RPC,
    usdc: ARC_USDC,
    explorer: ARC_TESTNET_EXPLORER,
    gasToken: "USDC",
    gatewayChain: "arcTestnet",
    gatewayUrl: "https://gateway-api-testnet.circle.com",
  },
  arc: {
    name: "arc",
    displayName: "Arc",
    chainId: 5042,
    caip2: "eip155:5042",
    chain: withEndpoints(arc, ARC_RPC, ARC_EXPLORER),
    rpcUrl: ARC_RPC,
    usdc: ARC_USDC,
    explorer: ARC_EXPLORER,
    gasToken: "USDC",
    gatewayChain: "arc",
  },
};

export const USDC_DECIMALS = 6;

export function getNetwork(network: ChainPeNetwork): NetworkInfo {
  const info = NETWORKS[network];
  if (!info) throw new Error(`Unknown network: ${network}`);
  return info;
}

/** Validates a user-supplied network name. */
export function parseNetwork(value: string): ChainPeNetwork {
  if (Object.hasOwn(NETWORKS, value)) return value as ChainPeNetwork;
  throw new Error(`Invalid network "${value}" (expected ${Object.keys(NETWORKS).join(" or ")}).`);
}

/** Maps an x402 network id (CAIP-2) or ChainPe name to the ChainPe network name. */
export function fromX402Network(x402: string): ChainPeNetwork | undefined {
  return Object.values(NETWORKS).find((n) => n.caip2 === x402 || n.name === x402)?.name;
}

export function explorerTxUrl(network: ChainPeNetwork, txHash: string): string {
  return `${getNetwork(network).explorer}/tx/${txHash}`;
}
