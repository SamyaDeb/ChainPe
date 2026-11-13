/**
 * ChainPe On-Chain Registry Client (Avalanche C-Chain)
 *
 * Reads from / writes to the deployed `ChainPeRegistry` Solidity contract via
 * viem. Replaces the Algorand algosdk implementation (atomic groups, ARC-4
 * encoding, box enumeration) with plain contract calls:
 *   - writes: USDC `approve` (registration fee) + `register`/`update`/`deregister`
 *   - reads:  `getService`, `hasService`, paginated `getServices`
 *
 * Registry address priority:
 *   1. explicit constructor arg
 *   2. CHAINPE_REGISTRY_ADDRESS env var
 *   3. registryAddress in ~/.chainpe/config.json
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  erc20Abi,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";
import os from "os";
import { getNetwork, type ChainPeNetwork } from "./chains.js";
import type { ServiceRegistration, PaymentToken } from "./types.js";

// ============================================================================
// ABI (minimal — only what the client uses)
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

const SERVICE_INPUT_COMPONENTS = [
  { name: "name", type: "string" },
  { name: "description", type: "string" },
  { name: "tags", type: "string" },
  { name: "endpoint", type: "string" },
  { name: "pricePerRequest", type: "string" },
  { name: "paymentToken", type: "string" },
  { name: "network", type: "string" },
  { name: "payTo", type: "address" },
  { name: "agentId", type: "uint256" },
] as const;

export const CHAINPE_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "input", type: "tuple", components: SERVICE_INPUT_COMPONENTS }],
    outputs: [{ name: "key", type: "bytes32" }],
  },
  {
    type: "function",
    name: "update",
    stateMutability: "nonpayable",
    inputs: [{ name: "input", type: "tuple", components: SERVICE_INPUT_COMPONENTS }],
    outputs: [{ name: "key", type: "bytes32" }],
  },
  {
    type: "function",
    name: "deregister",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }],
    outputs: [],
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
  {
    type: "function",
    name: "hasService",
    stateMutability: "view",
    inputs: [
      { name: "developer", type: "address" },
      { name: "name", type: "string" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
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
    name: "registrationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "feeToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ============================================================================
// Address resolution
// ============================================================================

function readAddressFromConfig(): string | undefined {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "config.json");
    const data = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(data) as { registryAddress?: string };
    return config.registryAddress;
  } catch {
    return undefined;
  }
}

export function resolveRegistryAddress(explicit?: string): `0x${string}` {
  const candidate = explicit ?? process.env.CHAINPE_REGISTRY_ADDRESS ?? readAddressFromConfig();
  if (!candidate) {
    throw new Error(
      "ChainPeRegistry address not set. Provide it via config (registryAddress), " +
        "CHAINPE_REGISTRY_ADDRESS, or deploy the contract first."
    );
  }
  return getAddress(candidate);
}

// ============================================================================
// Types
// ============================================================================

export interface RegistrationResult {
  txnHash: string;
  registryAddress: string;
}

export interface OnChainService {
  name: string;
  description: string;
  tags: string[];
  endpoint: string;
  pricePerRequest: string;
  paymentToken: PaymentToken;
  walletAddress: string;
  network: ChainPeNetwork;
  developer: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
}

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

function decodeService(raw: RawService): OnChainService {
  return {
    name: raw.name,
    description: raw.description,
    tags: raw.tags.split(",").map((t) => t.trim()).filter(Boolean),
    endpoint: raw.endpoint,
    pricePerRequest: raw.pricePerRequest,
    paymentToken: (raw.paymentToken || "USDC") as PaymentToken,
    walletAddress: raw.payTo,
    network: (raw.network as ChainPeNetwork) ?? "fuji",
    developer: raw.developer,
    agentId: raw.agentId.toString(),
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
  };
}

// ============================================================================
// Client
// ============================================================================

export class ChainPeRegistryClient {
  private publicClient: PublicClient;
  private network: ChainPeNetwork;
  readonly address: `0x${string}`;

  constructor(network: ChainPeNetwork = "fuji", registryAddress?: string) {
    this.network = network;
    const info = getNetwork(network);
    this.publicClient = createPublicClient({ chain: info.chain, transport: http(info.rpcUrl) });
    this.address = resolveRegistryAddress(registryAddress);
  }

  getContractInfo(): { address: string; network: ChainPeNetwork } {
    return { address: this.address, network: this.network };
  }

  // -- reads ------------------------------------------------------------------

  async registrationFee(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: CHAINPE_REGISTRY_ABI,
      functionName: "registrationFee",
    });
  }

  async getService(developer: string, name: string): Promise<OnChainService | null> {
    try {
      const raw = (await this.publicClient.readContract({
        address: this.address,
        abi: CHAINPE_REGISTRY_ABI,
        functionName: "getService",
        args: [getAddress(developer), name],
      })) as unknown as RawService;
      if (!raw.exists) return null;
      return decodeService(raw);
    } catch {
      // getService reverts (ServiceNotFound) when absent.
      return null;
    }
  }

  async hasService(developer: string, name: string): Promise<boolean> {
    try {
      return (await this.publicClient.readContract({
        address: this.address,
        abi: CHAINPE_REGISTRY_ABI,
        functionName: "hasService",
        args: [getAddress(developer), name],
      })) as boolean;
    } catch {
      return false;
    }
  }

  /** Lists all services via the paginated view (page size 100). */
  async listServices(): Promise<OnChainService[]> {
    const count = (await this.publicClient.readContract({
      address: this.address,
      abi: CHAINPE_REGISTRY_ABI,
      functionName: "getServiceCount",
    })) as bigint;

    const total = Number(count);
    if (total === 0) return [];

    const pageSize = 100;
    const out: OnChainService[] = [];
    for (let offset = 0; offset < total; offset += pageSize) {
      const limit = Math.min(pageSize, total - offset);
      const page = (await this.publicClient.readContract({
        address: this.address,
        abi: CHAINPE_REGISTRY_ABI,
        functionName: "getServices",
        args: [BigInt(offset), BigInt(limit)],
      })) as unknown as RawService[];
      for (const raw of page) out.push(decodeService(raw));
    }
    return out;
  }

  // -- writes -----------------------------------------------------------------

  /**
   * Registers (or updates) a service. Approves the USDC registration fee first
   * if the contract requires one and allowance is insufficient.
   */
  async registerService(params: {
    privateKey: string;
    name: string;
    description: string;
    tags: string[];
    endpoint: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    network: ChainPeNetwork;
    agentId?: string;
    isUpdate?: boolean;
  }): Promise<RegistrationResult> {
    const { privateKey, isUpdate = false } = params;
    const info = getNetwork(params.network);
    const account: Account = privateKeyToAccount(normalizeKey(privateKey));
    const walletClient: WalletClient = createWalletClient({
      account,
      chain: info.chain,
      transport: http(info.rpcUrl),
    });

    // 1. Approve the USDC fee if needed.
    const [fee, feeToken] = await Promise.all([
      this.registrationFee(),
      this.publicClient.readContract({
        address: this.address,
        abi: CHAINPE_REGISTRY_ABI,
        functionName: "feeToken",
      }) as Promise<`0x${string}`>,
    ]);

    if (fee > 0n) {
      const allowance = (await this.publicClient.readContract({
        address: feeToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, this.address],
      })) as bigint;

      if (allowance < fee) {
        const approveHash = await walletClient.writeContract({
          account,
          chain: info.chain,
          address: feeToken,
          abi: erc20Abi,
          functionName: "approve",
          args: [this.address, fee],
        });
        await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
    }

    // 2. register / update
    const input = {
      name: params.name,
      description: params.description,
      tags: params.tags.join(", "),
      endpoint: params.endpoint,
      pricePerRequest: params.pricePerRequest,
      paymentToken: params.paymentToken,
      network: params.network,
      payTo: getAddress(params.walletAddress),
      agentId: BigInt(params.agentId ?? "0"),
    };

    const hash = await walletClient.writeContract({
      account,
      chain: info.chain,
      address: this.address,
      abi: CHAINPE_REGISTRY_ABI,
      functionName: isUpdate ? "update" : "register",
      args: [input],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });

    return { txnHash: hash, registryAddress: this.address };
  }

  /** Deregisters a service (no fee). */
  async deregisterService(privateKey: string, name: string): Promise<RegistrationResult> {
    const info = getNetwork(this.network);
    const account = privateKeyToAccount(normalizeKey(privateKey));
    const walletClient = createWalletClient({ account, chain: info.chain, transport: http(info.rpcUrl) });
    const hash = await walletClient.writeContract({
      account,
      chain: info.chain,
      address: this.address,
      abi: CHAINPE_REGISTRY_ABI,
      functionName: "deregister",
      args: [name],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txnHash: hash, registryAddress: this.address };
  }
}

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

// ============================================================================
// OnChainService -> ServiceRegistration
// ============================================================================

export function onChainToServiceRegistration(svc: OnChainService): ServiceRegistration {
  return {
    id: `${svc.developer}:${svc.name}`,
    name: svc.name,
    description: svc.description,
    tags: svc.tags,
    endpoint: svc.endpoint,
    pricePerRequest: svc.pricePerRequest,
    paymentToken: svc.paymentToken,
    walletAddress: svc.walletAddress,
    developer: svc.developer,
    network: svc.network,
    agentId: svc.agentId !== "0" ? svc.agentId : undefined,
    createdAt: svc.createdAt ? new Date(svc.createdAt * 1000).toISOString() : new Date().toISOString(),
    updatedAt: svc.updatedAt ? new Date(svc.updatedAt * 1000).toISOString() : new Date().toISOString(),
  };
}
