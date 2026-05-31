/**
 * ChainPe On-Chain Registry Client
 *
 * Reads from and writes to the deployed ChainPeRegistry smart contract on Algorand.
 * Uses raw algosdk v3 — no algokit-utils required.
 *
 * App ID priority:
 *   1. CHAINPE_REGISTRY_APP_ID environment variable
 *   2. registryAppId field in ~/.chainpe/config.json
 *   3. Default fallback (757397216)
 */

import algosdk from "algosdk";
import fs from "fs";
import path from "path";
import os from "os";
import { createAlgodClient } from "./facilitator/index.js";
import type { ServiceRegistration, PaymentToken, ChainPeConfig } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

// Default admin address - receives registration fees
// This can be overridden via CHAINPE_ADMIN_ADDRESS environment variable
const DEFAULT_ADMIN_ADDRESS = "CIQZP6I73Q5527QWZHZLZBIDSOHVV5LMP5IEQNQYVRXYOZTQSYB7X57PBE";
const ADMIN_ADDRESS = process.env.CHAINPE_ADMIN_ADDRESS || DEFAULT_ADMIN_ADDRESS;

const REGISTRATION_FEE = 1_000_000n; // 1 ALGO in microALGO

function formatAlgoFromMicro(micro: bigint): string {
  return (Number(micro) / 1_000_000).toFixed(6);
}

// Default App ID — can be overridden via env var or config file
const DEFAULT_APP_ID = 757478481n;

/**
 * Reads the registry App ID from config file (~/.chainpe/config.json).
 * Returns undefined if config doesn't exist or doesn't have registryAppId.
 */
function readAppIdFromConfig(): bigint | undefined {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "config.json");
    const data = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(data) as ChainPeConfig;
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
 *   2. registryAppId field in ~/.chainpe/config.json  
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

// ABI method signatures (canonical ARC-4 format)
const REGISTER_SIG =
  "register(pay,string,string,string,string,string,string,string,string)void";
const UPDATE_SIG =
  "update(pay,string,string,string,string,string,string,string,string)void";
const GET_SERVICE_SIG =
  "getService(address,string)(string,string,string,string,string,string,string,string,address,uint64,uint64)";

// ARC-4 return prefix (first 4 bytes of the logged return value)
const ARC4_RETURN_PREFIX = new Uint8Array([0x15, 0x1f, 0x7c, 0x75]);

// ============================================================================
// Public result types
// ============================================================================

export interface RegistrationResult {
  txnHash: string;
  appId: bigint;
  appAddress: string;
}

export interface OnChainService {
  name: string;
  description: string;
  tags: string[];
  endpoint: string;
  pricePerRequest: string;
  paymentToken: PaymentToken;
  walletAddress: string;
  network: "testnet" | "mainnet";
  developer: string; // Algorand address (base32)
  createdAt: number; // Unix seconds
  updatedAt: number; // Unix seconds
}

// ============================================================================
// ABI / ARC-4 encoding helpers
// ============================================================================

/** Computes the 4-byte ARC-4 method selector from a canonical signature string. */
function methodSelector(signature: string): Uint8Array {
  return algosdk.ABIMethod.fromSignature(signature).getSelector();
}

/** Encodes a single ARC-4 string: uint16 big-endian length prefix + UTF-8 bytes. */
function encodeArc4String(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  const buf = new Uint8Array(2 + utf8.length);
  new DataView(buf.buffer).setUint16(0, utf8.length, false);
  buf.set(utf8, 2);
  return buf;
}

/**
 * Builds appArgs for register/update methods.
 *
 * PuyaTs-compiled contracts use separate ApplicationArgs per parameter:
 *   ApplicationArgs[0] = 4-byte method selector
 *   ApplicationArgs[1] = ARC-4 encoded string (param 1)
 *   ApplicationArgs[2] = ARC-4 encoded string (param 2)
 *   ...
 *
 * The `pay` transaction is in the atomic group (not encoded in appArgs).
 */
function buildAppArgs(selector: Uint8Array, ...strings: string[]): Uint8Array[] {
  return [selector, ...strings.map(encodeArc4String)];
}

/**
 * Builds appArgs for getService(address, string):
 *   ApplicationArgs[0] = 4-byte selector
 *   ApplicationArgs[1] = 32-byte raw address (static ARC-4 array — no length prefix)
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

// ============================================================================
// ARC-4 return value decoding
// ============================================================================

/**
 * Decodes the ARC-4 return value of getService:
 *   (string×8, address, uint64, uint64)
 *
 * ARC-4 tuple layout (mixed static/dynamic):
 *   [0..15]   8 × uint16 offsets → each dynamic string (8 × 2 = 16 bytes)
 *   [16..47]  address static inline (32 bytes)
 *   [48..55]  uint64 createdAt static inline (8 bytes)
 *   [56..63]  uint64 updatedAt static inline (8 bytes)
 *   [64..]    tails: the 8 ARC-4 strings
 */
function decodeServiceData(data: Uint8Array): OnChainService {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Read 8 string offsets
  const offsets = Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2, false));

  // Read address (static, inline at byte 16)
  const developer = algosdk.encodeAddress(data.slice(16, 48));

  // Read uint64s (static, at bytes 48 and 56)
  const createdAt = Number(view.getBigUint64(48, false));
  const updatedAt = Number(view.getBigUint64(56, false));

  // Read all 8 dynamic strings
  const strings = offsets.map((off) => {
    const len = view.getUint16(off, false);
    return new TextDecoder().decode(data.slice(off + 2, off + 2 + len));
  });

  const [name, description, tagsStr, endpoint, pricePerRequest, paymentToken, walletAddress, network] =
    strings;

  return {
    name,
    description,
    tags: tagsStr.split(",").map((t) => t.trim()).filter(Boolean),
    endpoint,
    pricePerRequest,
    paymentToken: paymentToken as PaymentToken,
    walletAddress,
    network: network as "testnet" | "mainnet",
    developer,
    createdAt,
    updatedAt,
  };
}

// ============================================================================
// Box key builder
// ============================================================================

function buildBoxKey(senderAddr: string, serviceName: string): Uint8Array {
  const prefix = new TextEncoder().encode("svc:");
  const senderBytes = algosdk.decodeAddress(senderAddr).publicKey;
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

// ============================================================================
// ChainPe On-Chain Registry Client
// ============================================================================

export class ChainPeRegistryClient {
  private algod: algosdk.Algodv2;
  readonly appId: bigint;
  readonly appAddress: string;

  constructor(network: "testnet" | "mainnet" = "testnet") {
    this.algod = createAlgodClient(network);
    this.appId = getRegistryAppId();
    this.appAddress = algosdk.getApplicationAddress(this.appId).toString();
  }

  /**
   * Registers (or updates) a service on-chain.
   *
   * Step 1: Fund the app address with enough ALGO to cover box MBR (standalone tx).
   * Step 2: Atomic group:
   *   [0] PaymentTxn  → ADMIN (1 ALGO registration fee) — this is `payTx`
   *   [1] AppCallTxn  → register() or update()
   */
  async registerService(params: {
    mnemonic: string;
    name: string;
    description: string;
    tags: string[];
    endpoint: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    network: "testnet" | "mainnet";
    isUpdate?: boolean;
  }): Promise<RegistrationResult> {
    const { mnemonic, isUpdate = false, ...service } = params;

    const account = algosdk.mnemonicToSecretKey(mnemonic);
    const senderAddr = account.addr.toString() as string;

    const sp = await this.algod.getTransactionParams().do();

    const nameBytes = new TextEncoder().encode(service.name);

    // Box MBR: 2500 + 400 × (keyLen + valueLen) microALGO
    // Key: "svc:" + pubkey(32) + ":" + name_bytes
    const boxKeySize = 4 + 32 + 1 + nameBytes.length;
    const boxValueSize = 1024; // generous estimate for ServiceData
    const boxMbr = BigInt(2500 + 400 * (boxKeySize + boxValueSize));

    // Preflight balance check for clearer errors before any tx submission
    const senderInfo = await this.algod.accountInformation(senderAddr).do();
    const senderBalance = BigInt(senderInfo.amount ?? 0);
    const minFee = BigInt(sp.minFee ?? 1000);
    const estimatedFees = isUpdate ? (minFee + 2000n) : (minFee + minFee + 2000n);
    const totalRequired = (isUpdate ? 0n : boxMbr) + REGISTRATION_FEE + estimatedFees;

    if (senderBalance < totalRequired) {
      const shortfall = totalRequired - senderBalance;
      throw new Error(
        `Insufficient ALGO for registration. Need ${formatAlgoFromMicro(totalRequired)} ALGO (fee to admin ${formatAlgoFromMicro(REGISTRATION_FEE)} + storage ${formatAlgoFromMicro(isUpdate ? 0n : boxMbr)} + tx fees ${formatAlgoFromMicro(estimatedFees)}), have ${formatAlgoFromMicro(senderBalance)} ALGO, short by ${formatAlgoFromMicro(shortfall)} ALGO.`
      );
    }

    // Step 1: Fund app address for box MBR (standalone transaction, only if registering new)
    if (!isUpdate) {
      const fundTx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: senderAddr,
        receiver: this.appAddress,
        amount: boxMbr,
        suggestedParams: { ...sp },
      });
      const signedFund = fundTx.signTxn(account.sk);
      const { txid: fundTxid } = await this.algod.sendRawTransaction([signedFund]).do();
      await algosdk.waitForConfirmation(this.algod, fundTxid, 8);
      // Refresh params after first tx
      Object.assign(sp, await this.algod.getTransactionParams().do());
    }

    const sig = isUpdate ? UPDATE_SIG : REGISTER_SIG;
    const selector = methodSelector(sig);
    const appArgs = buildAppArgs(
      selector,
      service.name,
      service.description,
      service.tags.join(", "),
      service.endpoint,
      service.pricePerRequest,
      service.paymentToken,
      service.walletAddress,
      service.network
    );

    const boxKey = buildBoxKey(senderAddr, service.name);

    // Step 2: Atomic group — [payAdmin, appCall]
    // payAdmin is at GroupIndex - 1 = 0 when appCall is at index 1
    const payAdminTx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: senderAddr,
      receiver: ADMIN_ADDRESS,
      amount: REGISTRATION_FEE,
      suggestedParams: { ...sp },
    });

    const appCallTx = algosdk.makeApplicationNoOpTxnFromObject({
      sender: senderAddr,
      appIndex: this.appId,
      appArgs,
      boxes: [{ appIndex: this.appId, name: boxKey }],
      suggestedParams: { ...sp, fee: 2000n, flatFee: true },
    });

    algosdk.assignGroupID([payAdminTx, appCallTx]);
    const signedTxns = [payAdminTx, appCallTx].map((tx) =>
      tx.signTxn(account.sk)
    );

    const { txid } = await this.algod.sendRawTransaction(signedTxns).do();
    await algosdk.waitForConfirmation(this.algod, txid, 8);

    return {
      txnHash: txid,
      appId: this.appId,
      appAddress: this.appAddress,
    };
  }

  /**
   * Fetches a service from on-chain using algod simulate (read-only, no fee).
   * Returns null if the service does not exist.
   */
  async getService(
    developerAddress: string,
    serviceName: string
  ): Promise<OnChainService | null> {
    try {
      const selector = methodSelector(GET_SERVICE_SIG);
      const appArgs = buildGetServiceArgs(selector, developerAddress, serviceName);
      const boxKey = buildBoxKey(developerAddress, serviceName);
      const sp = await this.algod.getTransactionParams().do();

      const dryrunTx = algosdk.makeApplicationNoOpTxnFromObject({
        sender: developerAddress,
        appIndex: this.appId,
        appArgs,
        boxes: [{ appIndex: this.appId, name: boxKey }],
        suggestedParams: sp,
      });

      // Encode as unsigned simulate transaction
      const encodedTxn = algosdk.encodeUnsignedSimulateTransaction(dryrunTx);
      const signedTxn = algosdk.decodeSignedTransaction(encodedTxn);

      const request = new algosdk.modelsv2.SimulateRequest({
        txnGroups: [
          new algosdk.modelsv2.SimulateRequestTransactionGroup({
            txns: [signedTxn],
          }),
        ],
        allowEmptySignatures: true,
        allowUnnamedResources: true,
        allowMoreLogging: true,
      });

      const result = await this.algod.simulateTransactions(request).do();
      const txnResult = result.txnGroups?.[0]?.txnResults?.[0];
      if (!txnResult) return null;

      const logs = txnResult.txnResult?.logs ?? [];
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

  /** Returns true if a service exists for the given developer+name. */
  async hasService(developerAddress: string, serviceName: string): Promise<boolean> {
    return (await this.getService(developerAddress, serviceName)) !== null;
  }

  /** Contract info for display. */
  getContractInfo(): { appId: bigint; appAddress: string } {
    return { appId: this.appId, appAddress: this.appAddress };
  }
}

// ============================================================================
// Utility: OnChainService → ServiceRegistration
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
    network: svc.network,
    createdAt: svc.createdAt ? new Date(svc.createdAt * 1000).toISOString() : new Date().toISOString(),
    updatedAt: svc.updatedAt ? new Date(svc.updatedAt * 1000).toISOString() : new Date().toISOString(),
  };
}
