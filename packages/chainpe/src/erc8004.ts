/**
 * ERC-8004 identity on Arc's canonical IdentityRegistry.
 *
 * A wallet gets one identity. The registry is not enumerable and the public RPC
 * refuses long log ranges, so an identity whose id was lost is found through the
 * explorer. When we cannot tell whether a wallet has an identity we stop rather
 * than mint: a duplicate splits its reputation.
 */
import { getAddress, parseEventLogs, type Abi, type Address } from "viem";
import { getNetwork, type ChainPeNetwork } from "./chains.js";
import { revertName, type ChainReader, type ChainWriter, type SentTx } from "./onchain.js";

/** Only `register(string)`: the registry has three overloads and viem resolves them by arguments. */
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
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
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
  {
    type: "error",
    name: "ERC721NonexistentToken",
    inputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const satisfies Abi;

export const AGENT_CARD_PATH = "/.well-known/agent.json";

export function agentCardUrl(publicUrl: string): string {
  return `${publicUrl}${AGENT_CARD_PATH}`;
}

/** The owner of an agentId, or null only when the registry says the token does not exist. */
export async function ownerOfAgent(chain: ChainReader, registry: Address, agentId: bigint): Promise<Address | null> {
  try {
    return await chain.read<Address>({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [agentId] });
  } catch (err) {
    if (revertName(err) === "ERC721NonexistentToken") return null;
    throw err;
  }
}

/** Lists the agentIds a wallet holds, from the explorer. Throws if the explorer cannot answer. */
export type AgentIdLookup = (owner: Address) => Promise<bigint[]>;

const MAX_EXPLORER_PAGES = 10;

export function explorerAgentIdLookup(network: ChainPeNetwork, fetchImpl: typeof fetch = fetch): AgentIdLookup {
  const { explorer, identityRegistry } = getNetwork(network);
  return async (owner) => {
    const ids: bigint[] = [];
    let query = "type=ERC-721";
    for (let page = 0; page < MAX_EXPLORER_PAGES; page++) {
      const res = await fetchImpl(`${explorer}/api/v2/addresses/${owner}/nft?${query}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Explorer answered ${res.status}.`);
      const body = (await res.json()) as {
        items: Array<{ id: string; token: { address_hash?: string; address?: string } }>;
        next_page_params?: Record<string, string | number | null> | null;
      };
      for (const item of body.items) {
        const token = item.token.address_hash ?? item.token.address ?? "";
        if (token.toLowerCase() === identityRegistry.toLowerCase()) ids.push(BigInt(item.id));
      }
      if (!body.next_page_params) return ids;
      const next = new URLSearchParams({ type: "ERC-721" });
      for (const [key, value] of Object.entries(body.next_page_params)) {
        if (value !== null) next.set(key, String(value));
      }
      query = next.toString();
    }
    throw new Error(`Explorer listed more than ${MAX_EXPLORER_PAGES} pages of NFTs for this wallet.`);
  };
}

export interface EnsureIdentityOptions {
  chain: ChainWriter;
  registry: Address;
  /** Where the agent card lives. Validated by the caller. */
  publicUrl: string;
  /** The agentId in the config, if any. */
  configuredAgentId?: string;
  /** `--agent-id`: use this one. */
  explicitAgentId?: string;
  /** `--new`: mint another token even though the wallet may already have one. */
  mintNew?: boolean;
  /** `--update-uri`: point the token at the expected URL. */
  updateUri?: boolean;
  lookup: AgentIdLookup;
  /** Called as soon as a token is minted, before anything else can fail. */
  onMinted?: (agentId: bigint) => void | Promise<void>;
}

export interface IdentityResult {
  agentId: bigint;
  source: "configured" | "recovered" | "minted";
  agentUri: string;
  /** False when the token points somewhere else and `--update-uri` was not given. */
  uriMatches: boolean;
  actualUri: string;
  txs: SentTx[];
}

function parseAgentId(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid agentId "${value}".`);
  const id = BigInt(value);
  if (id === 0n) throw new Error('agentId 0 means "no identity" in ChainPeAccounts, so token 0 cannot be linked.');
  return id;
}

async function requireOwned(chain: ChainWriter, registry: Address, agentId: bigint, source: string): Promise<void> {
  const owner = await ownerOfAgent(chain, registry, agentId);
  if (owner === null) {
    throw new Error(`${source} agentId ${agentId} does not exist on this network. Fix or remove it, or pass --agent-id.`);
  }
  if (getAddress(owner) !== getAddress(chain.account)) {
    throw new Error(`${source} agentId ${agentId} is owned by ${owner}, not ${chain.account}. Fix or remove it, or pass --agent-id.`);
  }
}

async function recoverAgentId(chain: ChainWriter, registry: Address, lookup: AgentIdLookup): Promise<bigint> {
  const stop = "This wallet already holds an ERC-8004 identity";
  let candidates: bigint[];
  try {
    candidates = await lookup(chain.account);
  } catch (err) {
    throw new Error(`${stop}, but the explorer could not list it (${(err as Error).message}). Pass --agent-id <id>.`, { cause: err });
  }
  const owned: bigint[] = [];
  for (const id of candidates) {
    if (id === 0n) continue;
    const owner = await ownerOfAgent(chain, registry, id);
    if (owner && getAddress(owner) === getAddress(chain.account)) owned.push(id);
  }
  if (owned.length === 0) throw new Error(`${stop}, but the explorer does not show it yet. Pass --agent-id <id>.`);
  if (owned.length > 1) throw new Error(`${stop} more than once (${owned.join(", ")}). Pass --agent-id <id>.`);
  return owned[0];
}

async function mint(chain: ChainWriter, registry: Address, agentUri: string): Promise<{ agentId: bigint; tx: SentTx }> {
  const tx = await chain.send("IdentityRegistry.register", {
    address: registry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [agentUri],
  });
  const fromRegistry = tx.receipt.logs.filter((log) => log.address.toLowerCase() === registry.toLowerCase());
  const [event] = parseEventLogs({ abi: IDENTITY_REGISTRY_ABI, eventName: "Registered", logs: fromRegistry });
  if (!event) throw new Error(`Minted an identity but found no Registered event. Find the id in tx ${tx.hash} and pass --agent-id.`);
  return { agentId: event.args.agentId, tx };
}

/** Finds this wallet's identity, minting one only when the wallet provably has none. */
export async function ensureIdentity(options: EnsureIdentityOptions): Promise<IdentityResult> {
  const { chain, registry, publicUrl, configuredAgentId, explicitAgentId, mintNew, updateUri, lookup, onMinted } = options;
  const agentUri = agentCardUrl(publicUrl);
  const txs: SentTx[] = [];
  let agentId: bigint;
  let source: IdentityResult["source"];

  const wanted = mintNew ? undefined : (explicitAgentId ?? configuredAgentId);
  if (wanted !== undefined) {
    agentId = parseAgentId(wanted);
    await requireOwned(chain, registry, agentId, explicitAgentId ? "That" : "The configured");
    source = "configured";
  } else {
    const balance = mintNew
      ? 0n
      : await chain.read<bigint>({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "balanceOf", args: [chain.account] });
    if (balance > 0n) {
      agentId = await recoverAgentId(chain, registry, lookup);
      source = "recovered";
    } else {
      const minted = await mint(chain, registry, agentUri);
      txs.push(minted.tx);
      agentId = minted.agentId;
      source = "minted";
      await onMinted?.(agentId);
    }
  }

  let actualUri = await chain.read<string>({ address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [agentId] });
  if (actualUri !== agentUri && updateUri) {
    txs.push(
      await chain.send("IdentityRegistry.setAgentURI", {
        address: registry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "setAgentURI",
        args: [agentId, agentUri],
      })
    );
    actualUri = agentUri;
  }
  return { agentId, source, agentUri, uriMatches: actualUri === agentUri, actualUri, txs };
}
