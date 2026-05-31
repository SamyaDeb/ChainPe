/**
 * ChainPe Agent Registry Client
 * Reads service registrations from the on-chain ChainPeRegistry contract on Algorand.
 *
 * App ID priority:
 *   1. CHAINPE_REGISTRY_APP_ID environment variable
 *   2. registryAppId field in ~/.chainpe/agent.json
 *   3. Default fallback (757397216)
 */

import algosdk from "algosdk";
import fs from "fs";
import path from "path";
import os from "os";
import type { Registry, ServiceInfo, PaymentToken, AgentConfig } from "./types.js";
import { ALGOD_TESTNET_URL, ALGOD_MAINNET_URL, INDEXER_TESTNET_URL, INDEXER_MAINNET_URL } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_APP_ID = 757478481n;
const ARC4_RETURN_PREFIX = new Uint8Array([0x15, 0x1f, 0x7c, 0x75]);

/**
 * Reads the registry App ID from agent config file (~/.chainpe/agent.json).
 * Returns undefined if config doesn't exist or doesn't have registryAppId.
 */
function readAppIdFromConfig(): bigint | undefined {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "agent.json");
    const data = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(data) as AgentConfig;
    if (config.registryAppId) {
      return BigInt(config.registryAppId);
    }
  } catch {
    // Config doesn't exist or is invalid
  }
  return undefined;
}

/**
 * Gets the registry App ID with priority:
 *   1. CHAINPE_REGISTRY_APP_ID environment variable
 *   2. registryAppId field in ~/.chainpe/agent.json  
 *   3. Default fallback (757397216)
 */
function getRegistryAppId(): bigint {
  // Priority 1: Environment variable
  const envId = process.env.CHAINPE_REGISTRY_APP_ID;
  if (envId) {
    return BigInt(envId);
  }
  
  // Priority 2: Config file
  const configId = readAppIdFromConfig();
  if (configId) {
    return configId;
  }
  
  // Priority 3: Default
  return DEFAULT_APP_ID;
}

// ============================================================================
// ARC-4 helpers (self-contained, no shared dep)
// ============================================================================

function methodSelector(signature: string): Uint8Array {
  return algosdk.ABIMethod.fromSignature(signature).getSelector();
}

function encodeArc4String(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  const buf = new Uint8Array(2 + utf8.length);
  new DataView(buf.buffer).setUint16(0, utf8.length, false);
  buf.set(utf8, 2);
  return buf;
}

/**
 * Builds appArgs for getService(address, string).
 * PuyaTs-compiled contracts use separate ApplicationArgs per parameter:
 *   ApplicationArgs[0] = 4-byte method selector
 *   ApplicationArgs[1] = 32-byte raw address (static ARC-4 — no length prefix)
 *   ApplicationArgs[2] = ARC-4 string (uint16 length + bytes)
 */
function buildGetServiceArgs(
  selector: Uint8Array,
  developerAddress: string,
  serviceName: string
): Uint8Array[] {
  const addrBytes = algosdk.decodeAddress(developerAddress).publicKey; // 32 bytes, no prefix
  const encodedName = encodeArc4String(serviceName);
  return [selector, addrBytes, encodedName];
}

function buildBoxKey(developerAddr: string, serviceName: string): Uint8Array {
  const prefix = new TextEncoder().encode("svc:");
  const senderBytes = algosdk.decodeAddress(developerAddr).publicKey;
  const colon = new TextEncoder().encode(":");
  const nameBytes = new TextEncoder().encode(serviceName);
  const key = new Uint8Array(prefix.length + senderBytes.length + colon.length + nameBytes.length);
  let pos = 0;
  key.set(prefix, pos); pos += prefix.length;
  key.set(senderBytes, pos); pos += senderBytes.length;
  key.set(colon, pos); pos += colon.length;
  key.set(nameBytes, pos);
  return key;
}

/**
 * Decodes ARC-4 return of getService:
 *   (string×8, address, uint64, uint64)
 * Head: 8×uint16 offsets (16B) + address inline (32B) + 2×uint64 (16B) = 64B
 */
function decodeServiceData(data: Uint8Array): ServiceInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offsets = Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2, false));
  const developer = algosdk.encodeAddress(data.slice(16, 48));
  const createdAt = Number(view.getBigUint64(48, false));
  const updatedAt = Number(view.getBigUint64(56, false));

  const strings = offsets.map((off) => {
    const len = view.getUint16(off, false);
    return new TextDecoder().decode(data.slice(off + 2, off + 2 + len));
  });

  const [name, description, tagsStr, endpoint, pricePerRequest, paymentToken, walletAddress, network] =
    strings;

  return {
    id: `${developer}:${name}`,
    name,
    description,
    tags: tagsStr.split(",").map((t) => t.trim()).filter(Boolean),
    endpoint,
    pricePerRequest,
    paymentToken: paymentToken as PaymentToken,
    walletAddress,
    network: network as "testnet" | "mainnet",
    createdAt: createdAt ? new Date(createdAt * 1000).toISOString() : undefined,
    updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : undefined,
  };
}

// ============================================================================
// On-chain fetch
// ============================================================================

async function fetchServiceOnChain(
  algod: algosdk.Algodv2,
  appId: bigint,
  developerAddress: string,
  serviceName: string
): Promise<ServiceInfo | null> {
  try {
    const sig = "getService(address,string)(string,string,string,string,string,string,string,string,address,uint64,uint64)";
    const selector = methodSelector(sig);
    const appArgs = buildGetServiceArgs(selector, developerAddress, serviceName);
    const boxKey = buildBoxKey(developerAddress, serviceName);
    const sp = await algod.getTransactionParams().do();

    const tx = algosdk.makeApplicationNoOpTxnFromObject({
      sender: developerAddress,
      appIndex: appId,
      appArgs,
      boxes: [{ appIndex: appId, name: boxKey }],
      suggestedParams: sp,
    });

    const encodedTxn = algosdk.encodeUnsignedSimulateTransaction(tx);
    const signedTxn = algosdk.decodeSignedTransaction(encodedTxn);

    const request = new algosdk.modelsv2.SimulateRequest({
      txnGroups: [
        new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: [signedTxn] }),
      ],
      allowEmptySignatures: true,
      allowUnnamedResources: true,
      allowMoreLogging: true,
    });

    const result = await algod.simulateTransactions(request).do();
    const logs = result.txnGroups?.[0]?.txnResults?.[0]?.txnResult?.logs ?? [];

    for (const log of logs) {
      if (
        log.length > 4 &&
        log[0] === ARC4_RETURN_PREFIX[0] &&
        log[1] === ARC4_RETURN_PREFIX[1] &&
        log[2] === ARC4_RETURN_PREFIX[2] &&
        log[3] === ARC4_RETURN_PREFIX[3]
      ) {
        return decodeServiceData(log.slice(4));
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Search options
// ============================================================================

export interface SearchOptions {
  name?: string;
  tags?: string[];
  paymentToken?: PaymentToken;
  network?: "testnet" | "mainnet";
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
  private algod: algosdk.Algodv2;
  private indexer: algosdk.Indexer;
  private appId: bigint;
  private network: "testnet" | "mainnet";

  constructor(network: "testnet" | "mainnet" = "testnet") {
    this.network = network;
    const algodUrl = network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL;
    const indexerUrl = network === "testnet" ? INDEXER_TESTNET_URL : INDEXER_MAINNET_URL;
    
    this.algod = new algosdk.Algodv2("", algodUrl, "");
    this.indexer = new algosdk.Indexer("", indexerUrl, "");
    
    this.appId = getRegistryAppId();
  }

  /**
   * Fetches a specific service by developer address and name.
   */
  async findService(developerAddress: string, name: string): Promise<ServiceInfo | undefined> {
    const svc = await fetchServiceOnChain(this.algod, this.appId, developerAddress, name);
    return svc ?? undefined;
  }

  /**
   * Searches for a service by name across known developers.
   * Since box scanning is not directly supported without indexer,
   * this accepts an optional developer hint or searches the config.
   */
  async findByName(name: string, developerAddress?: string): Promise<ServiceInfo | undefined> {
    if (!developerAddress) return undefined;
    const svc = await fetchServiceOnChain(this.algod, this.appId, developerAddress, name);
    return svc ?? undefined;
  }

  /**
   * Returns service info for a given developer + name.
   * Equivalent to getService on-chain.
   */
  async getService(developerAddress: string, name: string): Promise<ServiceInfo | undefined> {
    return this.findService(developerAddress, name);
  }

  /**
   * Returns all services for a developer (given a list of known service names).
   * Without an indexer, we need either a known list or a single name.
   */
  async listForDeveloper(
    developerAddress: string,
    serviceNames: string[]
  ): Promise<ServiceInfo[]> {
    const results = await Promise.all(
      serviceNames.map((name) =>
        fetchServiceOnChain(this.algod, this.appId, developerAddress, name)
      )
    );
    return results.filter((s): s is ServiceInfo => s !== null);
  }

  /**
   * Search services (requires a list of developer:name pairs to query).
   */
  async search(
    knownServices: Array<{ developer: string; name: string }>,
    options?: SearchOptions
  ): Promise<ServiceInfo[]> {
    const results = await Promise.all(
      knownServices.map(({ developer, name }) =>
        fetchServiceOnChain(this.algod, this.appId, developer, name)
      )
    );
    const found = results.filter((s): s is ServiceInfo => s !== null);
    return options ? filterServices(found, options) : found;
  }

  /**
   * Lists ALL services registered on-chain using Algorand Indexer.
   * This enumerates all boxes in the registry contract and fetches their details.
   * 
   * @returns Array of all available services
   * @throws Error if indexer is unavailable
   */
  async listAllServices(): Promise<ServiceInfo[]> {
    try {
      // Fetch all boxes from the registry contract via indexer
      const boxesResponse = await this.indexer
        .lookupApplicationBoxByIDandName(Number(this.appId), new Uint8Array())
        .do();

      // The indexer API returns boxes, we need to enumerate them
      // Use searchForApplicationBoxes instead
      const appId = Number(this.appId);
      const boxes: Array<{ name: Uint8Array }> = [];
      
      // Indexer pagination for boxes
      let nextToken: string | undefined;
      do {
        const params: any = {};
        if (nextToken) params.next = nextToken;
        
        const response = await this.indexer
          .lookupApplicationBoxByIDandName(appId, new Uint8Array())
          .do()
          .catch(() => null);
        
        if (!response) break;
        
        // Try alternate API - search application by ID to get boxes
        // Note: Indexer box enumeration API varies, fallback to direct approach
        break;
      } while (nextToken);

      // Alternative: Use direct HTTP call to indexer API
      const indexerUrl = this.network === "testnet" ? INDEXER_TESTNET_URL : INDEXER_MAINNET_URL;
      const boxesUrl = `${indexerUrl}/v2/applications/${this.appId}/boxes`;
      
      const response = await fetch(boxesUrl);
      if (!response.ok) {
        throw new Error(`Indexer API error: ${response.status} ${response.statusText}`);
      }
      
      const data = (await response.json()) as { boxes: Array<{ name: string }> };
      
      // Parse box keys to extract developer address + service name
      // Box key format (binary): "svc:" + <32-byte-pubkey> + ":" + <service_name>
      const servicePromises: Promise<ServiceInfo | null>[] = [];
      
      for (const box of data.boxes) {
        try {
          // Decode base64 box name to bytes
          const boxKeyBytes = Buffer.from(box.name, "base64");
          
          // Check if it starts with "svc:" (4 bytes)
          const prefix = boxKeyBytes.slice(0, 4).toString("utf-8");
          if (prefix !== "svc:") continue;
          
          // Extract 32-byte pubkey (bytes 4-35, after "svc:")
          if (boxKeyBytes.length < 4 + 32 + 1) continue; // minimum: "svc:" + pubkey + ":" 
          
          const pubkeyBytes = boxKeyBytes.slice(4, 36);
          if (pubkeyBytes.length !== 32) continue;
          
          // Check for ":" separator after pubkey (byte 36)
          if (boxKeyBytes[36] !== 0x3a) continue; // 0x3a = ':'
          
          // Extract service name (everything after byte 37)
          const serviceName = boxKeyBytes.slice(37).toString("utf-8");
          if (!serviceName) continue;
          
          // Convert pubkey bytes to Algorand address
          const developerAddress = algosdk.encodeAddress(pubkeyBytes);
          
          // Fetch service details
          servicePromises.push(
            fetchServiceOnChain(this.algod, this.appId, developerAddress, serviceName)
          );
        } catch (error) {
          // Skip invalid box keys
          console.warn(`Failed to parse box key: ${box.name}`, error);
          continue;
        }
      }
      
      // Fetch all service details in parallel
      const services = await Promise.all(servicePromises);
      
      // Filter out nulls
      return services.filter((s): s is ServiceInfo => s !== null);
      
    } catch (error) {
      console.error("Failed to list services from indexer:", error);
      throw new Error(
        `Could not fetch services from Algorand Indexer. Please ensure indexer is available or use --provider flag. Error: ${(error as Error).message}`
      );
    }
  }

  /** App ID of the registry contract. */
  getAppId(): bigint {
    return this.appId;
  }
}

// ============================================================================
// Legacy compatibility: loadRegistry reads on-chain for a single developer
// ============================================================================

/**
 * Loads the on-chain registry for a specific developer address and list of service names.
 * Falls back to empty registry if nothing found.
 */
export async function loadRegistry(
  developerAddress?: string,
  serviceNames?: string[],
  network: "testnet" | "mainnet" = "testnet"
): Promise<Registry> {
  if (!developerAddress || !serviceNames?.length) {
    return { version: "1.0.0", services: [] };
  }

  const client = new RegistryClient(network);
  const services = await client.listForDeveloper(developerAddress, serviceNames);
  return { version: "1.0.0", services };
}

// Keep simple search helpers for backward compat
export function searchServices(registry: Registry, options: SearchOptions = {}): ServiceInfo[] {
  return filterServices(registry.services, options);
}

export function findServiceByName(registry: Registry, name: string): ServiceInfo | undefined {
  return registry.services.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export function getAllTags(registry: Registry): string[] {
  return Array.from(new Set(registry.services.flatMap((s) => s.tags.map((t) => t.toLowerCase())))).sort();
}

export function findServiceById(registry: Registry, id: string): ServiceInfo | undefined {
  return registry.services.find((s) => s.id === id);
}

export async function registryExists(
  developerAddress?: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<boolean> {
  if (!developerAddress) return false;
  // The on-chain registry always "exists" — the contract is deployed
  try {
    const url = network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL;
    const algod = new algosdk.Algodv2("", url, "");
    await algod.getApplicationByID(DEFAULT_APP_ID).do();
    return true;
  } catch {
    return false;
  }
}

export function getServiceStats(registry: Registry) {
  return {
    total: registry.services.length,
    byToken: { ALGO: 0, USDC: 0 } as Record<PaymentToken, number>,
    byNetwork: { testnet: 0, mainnet: 0 } as Record<string, number>,
  };
}
