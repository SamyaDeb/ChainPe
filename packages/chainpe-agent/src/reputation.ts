/**
 * ERC-8004 Reputation — read scores + post feedback on-chain (Avalanche).
 *
 * A provider's score is aggregated by the ERC-8004 Reputation Registry contract.
 * After a successful paid call the agent posts `giveFeedback(agentId, …)`, and
 * discovery reads `getSummary`. Self-feedback is rejected on-chain.
 */
import { createWalletClient, http, getAddress, type Hex } from "viem";
import { avalanche, avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainPeNetwork } from "./types.js";
import { RPC_URLS } from "./types.js";
import { createClient } from "./wallet.js";

const CHAINS = { fuji: avalancheFuji, avalanche } as const;
const ZERO_HASH: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Deployed ERC-8004 Reputation Registry per network (override via env/config).
const DEFAULT_REPUTATION: Record<ChainPeNetwork, `0x${string}` | undefined> = {
  fuji: "0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4",
  avalanche: undefined,
};

const REPUTATION_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "getClients",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
] as const;

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

export function resolveReputationRegistry(
  network: ChainPeNetwork,
  explicit?: string
): `0x${string}` | undefined {
  const candidate = explicit ?? process.env.ERC8004_REPUTATION_REGISTRY ?? DEFAULT_REPUTATION[network];
  return candidate ? getAddress(candidate) : undefined;
}

export interface ReputationSummary {
  count: number;
  /** Aggregate score (e.g. 0–100), or null when there is no feedback yet. */
  score: number | null;
}

/** Reads a provider's on-chain reputation (count 0 when unscored). */
export async function getReputation(
  network: ChainPeNetwork,
  agentId: string,
  reputationRegistry?: string
): Promise<ReputationSummary | null> {
  if (!agentId || agentId === "0") return null;
  const registry = resolveReputationRegistry(network, reputationRegistry);
  if (!registry) return null;
  try {
    const client = createClient(network);
    const id = BigInt(agentId);
    const clients = (await client.readContract({
      address: registry,
      abi: REPUTATION_ABI,
      functionName: "getClients",
      args: [id],
    })) as readonly `0x${string}`[];
    if (clients.length === 0) return { count: 0, score: null };

    const [count, summaryValue, decimals] = (await client.readContract({
      address: registry,
      abi: REPUTATION_ABI,
      functionName: "getSummary",
      args: [id, clients as `0x${string}`[], "", ""],
    })) as readonly [bigint, bigint, number];

    return { count: Number(count), score: Number(summaryValue) / 10 ** Number(decimals) };
  } catch {
    return null;
  }
}

/** Posts an on-chain feedback score (0–100, valueDecimals 0) for an agent. */
export async function giveFeedback(
  privateKey: string,
  network: ChainPeNetwork,
  agentId: string,
  value: number,
  opts: { endpoint?: string; tag?: string; reputationRegistry?: string; waitConfirm?: boolean } = {}
): Promise<string> {
  const registry = resolveReputationRegistry(network, opts.reputationRegistry);
  if (!registry) throw new Error("Reputation registry address not configured");

  const account = privateKeyToAccount(normalizeKey(privateKey));
  const wallet = createWalletClient({ account, chain: CHAINS[network], transport: http(RPC_URLS[network]) });

  const hash = await wallet.writeContract({
    address: registry,
    abi: REPUTATION_ABI,
    functionName: "giveFeedback",
    args: [
      BigInt(agentId),
      BigInt(Math.round(value)),
      0,
      "x402",
      opts.tag ?? "paid-call",
      opts.endpoint ?? "",
      "",
      ZERO_HASH,
    ],
  });

  if (opts.waitConfirm) {
    await createClient(network).waitForTransactionReceipt({ hash });
  }
  return hash;
}
