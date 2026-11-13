/**
 * ERC-8004 identity registry helpers.
 *
 * Used during `chainpe register` to automatically mint a seller identity so
 * every registered service gets an on-chain reputation token without a
 * separate manual step.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getNetwork, type ChainPeNetwork } from "./chains.js";

// ─── ABI (minimal) ──────────────────────────────────────────────────────────

export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

// ─── Address resolution ──────────────────────────────────────────────────────

const KNOWN_IDENTITY_REGISTRY: Partial<Record<ChainPeNetwork, string>> = {
  fuji: "0x56FEc2359fcDfFa6FA1D3a8AB3b708Ff698161D5",
};

export function resolveIdentityRegistry(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` | null {
  const addr =
    explicit ??
    process.env.ERC8004_IDENTITY_REGISTRY ??
    KNOWN_IDENTITY_REGISTRY[network];
  if (!addr) return null;
  return getAddress(addr);
}

// ─── Mint ────────────────────────────────────────────────────────────────────

export interface MintResult {
  agentId: string;
  txHash: string;
}

/**
 * Mint a new ERC-8004 agent identity and return the agentId.
 * Costs a little gas (no token fee). The agentId is the ERC-721 tokenId.
 */
export async function mintAgentIdentity(params: {
  network: ChainPeNetwork;
  privateKey: string;
  identityRegistry: `0x${string}`;
  agentURI?: string;
}): Promise<MintResult> {
  const { network, privateKey, identityRegistry, agentURI = "chainpe://seller-agent" } = params;
  const info = getNetwork(network);
  const normalizedKey = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
  const account = privateKeyToAccount(normalizedKey);

  const publicClient = createPublicClient({ chain: info.chain, transport: http(info.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: info.chain, transport: http(info.rpcUrl) });

  const hash = await walletClient.writeContract({
    account,
    chain: info.chain,
    address: identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [agentURI],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  let agentId: bigint | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== identityRegistry.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({
        abi: IDENTITY_REGISTRY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (ev.eventName === "Registered") {
        agentId = (ev.args as { agentId: bigint }).agentId;
      }
    } catch {
      /* not our event */
    }
  }

  if (agentId === undefined) {
    throw new Error(`Minted identity but could not decode agentId from logs. tx: ${hash}`);
  }

  return { agentId: String(agentId), txHash: hash };
}

/**
 * True if the address already owns at least one identity token.
 * Used to skip auto-mint when the wallet already has a reputation token.
 */
export async function hasIdentity(params: {
  network: ChainPeNetwork;
  identityRegistry: `0x${string}`;
  ownerAddress: string;
}): Promise<boolean> {
  const info = getNetwork(params.network);
  const publicClient = createPublicClient({ chain: info.chain, transport: http(info.rpcUrl) });
  try {
    const balance = (await publicClient.readContract({
      address: params.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "balanceOf",
      args: [getAddress(params.ownerAddress)],
    })) as bigint;
    return balance > 0n;
  } catch {
    return false;
  }
}
