/**
 * ChainPe Agent Registry Client (Avalanche C-Chain, read-only)
 *
 * Reads service registrations from the deployed ChainPeRegistry Solidity contract
 * via viem. Replaces the Algorand algosdk box-enumeration reader with a paginated
 * `getServices` view.
 *
 * Registry address priority:
 *   1. CHAINPE_REGISTRY_ADDRESS environment variable
 *   2. registryAddress field in ~/.chainpe/agent.json
 */

import { createPublicClient, http, getAddress, type PublicClient } from "viem";
import { avalanche, avalancheFuji } from "viem/chains";
import fs from "fs";
import path from "path";
import os from "os";
import type { Registry, ServiceInfo, PaymentToken, AgentConfig, ChainPeNetwork } from "./types.js";
import { RPC_URLS } from "./types.js";

const CHAINS = { fuji: avalancheFuji, avalanche } as const;

// ============================================================================
// ABI (read-only subset)
// ============================================================================

const SERVICE_COMPONENTS = [
  { name: "name", type: "string" },
  { name: "description", type: "string" },
  { name: "tags", type: "string" },
  { name: "endpoint", type: "string" },
  { name: "pricePerRequest", type: "string" },
  { name: "paymentToken", type: "string" },
  { name: "network", type: "string" },
  { name: "payTo", type: "address" },
  { name: "developer", type: "address" },
  { name: "agentId", type: "uint256" },
  { name: "createdAt", type: "uint64" },
  { name: "updatedAt", type: "uint64" },
  { name: "exists", type: "bool" },
] as const;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getServiceCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getServices",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ name: "page", type: "tuple[]", components: SERVICE_COMPONENTS }],
  },
  {
    type: "function",
    name: "getService",
    stateMutability: "view",
    inputs: [
      { name: "developer", type: "address" },
      { name: "name", type: "string" },
    ],
    outputs: [{ name: "", type: "tuple", components: SERVICE_COMPONENTS }],
  },
] as const;

interface RawService {
  name: string;
  description: string;
  tags: string;
  endpoint: string;
  pricePerRequest: string;
  paymentToken: string;
  network: string;
  payTo: string;
  developer: string;
  agentId: bigint;
  createdAt: bigint;
  updatedAt: bigint;
  exists: boolean;
}

function decodeService(raw: RawService): ServiceInfo {
  const createdAt = Number(raw.createdAt);
  const updatedAt = Number(raw.updatedAt);
  return {
    id: `${raw.developer}:${raw.name}`,
    name: raw.name,
    description: raw.description,
    tags: raw.tags.split(",").map((t) => t.trim()).filter(Boolean),
    endpoint: raw.endpoint,
    pricePerRequest: raw.pricePerRequest,
    paymentToken: (raw.paymentToken || "USDC") as PaymentToken,
    walletAddress: raw.payTo,
    network: (raw.network as ChainPeNetwork) ?? "fuji",
    agentId: raw.agentId > 0n ? raw.agentId.toString() : undefined,
    createdAt: createdAt ? new Date(createdAt * 1000).toISOString() : undefined,
    updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : undefined,
  };
}

// ============================================================================
// Address resolution
// ============================================================================

function readAddressFromConfig(): string | undefined {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "agent.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as AgentConfig;
    return config.registryAddress;
  } catch {
    return undefined;
  }
}

function resolveRegistryAddress(explicit?: string): `0x${string}` {
  const candidate = explicit ?? process.env.CHAINPE_REGISTRY_ADDRESS ?? readAddressFromConfig();
  if (!candidate) {
    throw new Error(
      "ChainPeRegistry address not set. Provide CHAINPE_REGISTRY_ADDRESS, set registryAddress in " +
        "~/.chainpe/agent.json, or deploy the contract first."
    );
  }
  return getAddress(candidate);
}

// ============================================================================
// Search
// ============================================================================

export interface SearchOptions {
  name?: string;
  tags?: string[];
  paymentToken?: PaymentToken;
  network?: ChainPeNetwork;
  maxPrice?: string;
}

function filterServices(services: ServiceInfo[], options: SearchOptions): ServiceInfo[] {
  let results = [...services];
  if (options.name) {
    const nl = options.name.toLowerCase();
    results = results.filter(
      (s) => s.name.toLowerCase().includes(nl) || s.description.toLowerCase().includes(nl)
    );
  }
  if (options.tags?.length) {
    const tl = options.tags.map((t) => t.toLowerCase());
    results = results.filter((s) => s.tags.some((tag) => tl.includes(tag.toLowerCase())));
  }
  if (options.paymentToken) {
    results = results.filter((s) => s.paymentToken === options.paymentToken);
  }
  if (options.network) {
    results = results.filter((s) => s.network === options.network);
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice);
    results = results.filter((s) => parseFloat(s.pricePerRequest) <= max);
  }
  return results;
}

// ============================================================================
// RegistryClient — on-chain reads
// ============================================================================

export class RegistryClient {
  private publicClient: PublicClient;
  private network: ChainPeNetwork;
  private address: `0x${string}`;

  constructor(network: ChainPeNetwork = "fuji", registryAddress?: string) {
    this.network = network;
    this.publicClient = createPublicClient({
      chain: CHAINS[network],
      transport: http(RPC_URLS[network]),
    });
    this.address = resolveRegistryAddress(registryAddress);
  }

  getAddress(): string {
    return this.address;
  }

  async findService(developerAddress: string, name: string): Promise<ServiceInfo | undefined> {
    try {
      const raw = (await this.publicClient.readContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: "getService",
        args: [getAddress(developerAddress), name],
      })) as unknown as RawService;
      return raw.exists ? decodeService(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Finds a service by name; an explicit developer hint avoids a full scan. */
  async findByName(name: string, developerAddress?: string): Promise<ServiceInfo | undefined> {
    if (developerAddress) {
      const direct = await this.findService(developerAddress, name);
      if (direct) return direct;
    }
    const all = await this.listAllServices();
    return all.find((s) => s.name.toLowerCase() === name.toLowerCase());
  }

  async getService(developerAddress: string, name: string): Promise<ServiceInfo | undefined> {
    return this.findService(developerAddress, name);
  }

  /** Lists ALL services via the paginated on-chain view (page size 100). */
  async listAllServices(): Promise<ServiceInfo[]> {
    const count = (await this.publicClient.readContract({
      address: this.address,
      abi: REGISTRY_ABI,
      functionName: "getServiceCount",
    })) as bigint;

    const total = Number(count);
    if (total === 0) return [];

    const pageSize = 100;
    const out: ServiceInfo[] = [];
    for (let offset = 0; offset < total; offset += pageSize) {
      const limit = Math.min(pageSize, total - offset);
      const page = (await this.publicClient.readContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: "getServices",
        args: [BigInt(offset), BigInt(limit)],
      })) as unknown as RawService[];
      for (const raw of page) out.push(decodeService(raw));
    }
    return out;
  }

  async search(options: SearchOptions = {}): Promise<ServiceInfo[]> {
    const all = await this.listAllServices();
    return filterServices(all, { ...options, network: options.network ?? this.network });
  }
}

// ============================================================================
// Helpers (registry-as-data)
// ============================================================================

/** Loads all on-chain services into a Registry object. */
export async function loadRegistry(
  network: ChainPeNetwork = "fuji",
  registryAddress?: string
): Promise<Registry> {
  try {
    const client = new RegistryClient(network, registryAddress);
    const services = await client.listAllServices();
    return { version: "1.0.0", services };
  } catch {
    return { version: "1.0.0", services: [] };
  }
}

export function searchServices(registry: Registry, options: SearchOptions = {}): ServiceInfo[] {
  return filterServices(registry.services, options);
}

export function findServiceByName(registry: Registry, name: string): ServiceInfo | undefined {
  return registry.services.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export function findServiceById(registry: Registry, id: string): ServiceInfo | undefined {
  return registry.services.find((s) => s.id === id);
}

export function getAllTags(registry: Registry): string[] {
  return Array.from(
    new Set(registry.services.flatMap((s) => s.tags.map((t) => t.toLowerCase())))
  ).sort();
}

export async function registryExists(
  network: ChainPeNetwork = "fuji",
  registryAddress?: string
): Promise<boolean> {
  try {
    const client = new RegistryClient(network, registryAddress);
    await client.listAllServices();
    return true;
  } catch {
    return false;
  }
}

export function getServiceStats(registry: Registry) {
  return {
    total: registry.services.length,
    byToken: { USDC: registry.services.length } as Record<PaymentToken, number>,
    byNetwork: registry.services.reduce(
      (acc, s) => {
        acc[s.network] = (acc[s.network] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
  };
}
