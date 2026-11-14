/**
 * Shared helpers for the Phase 5 portable-reputation scripts (Fuji C-Chain -> a Fuji L1).
 *
 * The scripts talk to TWO chains at once, so they build their own providers instead of using
 * hardhat's single --network. They refuse to run against Avalanche mainnet.
 *
 * Env:
 *   DEPLOYER_PRIVATE_KEY  key used on both chains (never printed)
 *   FUJI_RPC_URL          default https://api.avax-test.network/ext/bc/C/rpc
 *   L1_RPC_URL            default Echo: https://subnets.avax.network/echo/testnet/rpc
 *   L1_CHAIN_ID           default Echo: 173750
 *   L1_NAME               default "echo" (label + explorer path)
 *   L1_EXPLORER_URL       default https://explorer-test.avax.network/echo
 *   TELEPORTER_MESSENGER  default canonical 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf
 */
import { artifacts } from "hardhat";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: path.join(__dirname, "..", "..", "..", ".env") });

export const TELEPORTER = process.env.TELEPORTER_MESSENGER ?? "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf";
/** Warp precompile: getBlockchainID() returns this chain's 32-byte Avalanche blockchain ID. */
export const WARP_PRECOMPILE = "0x0200000000000000000000000000000000000005";
export const FUJI_CHAIN_ID = 43113n;
const MAINNET_CHAIN_ID = 43114n;

export const FUJI_RPC_URL = process.env.FUJI_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";
export const L1_RPC_URL = process.env.L1_RPC_URL ?? "https://subnets.avax.network/echo/testnet/rpc";
export const L1_CHAIN_ID = BigInt(process.env.L1_CHAIN_ID ?? "173750");
export const L1_NAME = process.env.L1_NAME ?? "echo";
export const FUJI_EXPLORER = "https://testnet.snowtrace.io";
export const L1_EXPLORER = (process.env.L1_EXPLORER_URL ?? "https://explorer-test.avax.network/echo").replace(/\/+$/, "");

export const DEPLOYMENT_FILE = path.join(__dirname, "..", "..", "deployments", "fuji-icm-reputation.json");

export const fujiTx = (h: string) => `${FUJI_EXPLORER}/tx/${h}`;
export const fujiAddr = (a: string) => `${FUJI_EXPLORER}/address/${a}`;
export const l1Tx = (h: string) => `${L1_EXPLORER}/tx/${h}`;
export const l1Addr = (a: string) => `${L1_EXPLORER}/address/${a}`;

export const isExecute = () => process.env.EXECUTE === "1";

export interface Chains {
  fuji: ethers.Wallet;
  l1: ethers.Wallet;
}

/** Connects to both chains and checks they are Fuji C-Chain and a non-mainnet L1. */
export async function connect(): Promise<Chains> {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set (contracts/.env or repo-root .env)");

  const fujiProvider = new ethers.JsonRpcProvider(FUJI_RPC_URL);
  const l1Provider = new ethers.JsonRpcProvider(L1_RPC_URL);
  const [fujiNet, l1Net] = await Promise.all([fujiProvider.getNetwork(), l1Provider.getNetwork()]);

  if (fujiNet.chainId !== FUJI_CHAIN_ID) throw new Error(`FUJI_RPC_URL is chain ${fujiNet.chainId}, expected Fuji ${FUJI_CHAIN_ID}`);
  if (l1Net.chainId === MAINNET_CHAIN_ID || l1Net.chainId === FUJI_CHAIN_ID) throw new Error(`L1_RPC_URL points at chain ${l1Net.chainId}; it must be a separate Fuji L1`);
  if (l1Net.chainId !== L1_CHAIN_ID) throw new Error(`L1_RPC_URL is chain ${l1Net.chainId}, but L1_CHAIN_ID=${L1_CHAIN_ID}`);

  return { fuji: new ethers.Wallet(key, fujiProvider), l1: new ethers.Wallet(key, l1Provider) };
}

/** Reads the chain's Avalanche blockchain ID from the Warp precompile (never hardcoded). */
export async function blockchainIdOf(provider: ethers.Provider): Promise<string> {
  const iface = new ethers.Interface(["function getBlockchainID() view returns (bytes32)"]);
  const raw = await provider.call({ to: WARP_PRECOMPILE, data: iface.encodeFunctionData("getBlockchainID") });
  const [id] = iface.decodeFunctionResult("getBlockchainID", raw);
  if (id === ethers.ZeroHash) throw new Error("Warp precompile returned zero blockchain ID");
  return id as string;
}

/** CB58 encoding of a 32-byte ID (what the relayer config and P-Chain APIs use). */
export function toCb58(hex: string): string {
  const b = ethers.getBytes(hex);
  const checksum = ethers.getBytes(ethers.sha256(b)).slice(-4);
  return ethers.encodeBase58(ethers.concat([b, checksum]));
}

export async function assertTeleporter(provider: ethers.Provider, label: string) {
  const code = await provider.getCode(TELEPORTER);
  if (code === "0x") throw new Error(`No TeleporterMessenger at ${TELEPORTER} on ${label}`);
}

export async function contractAt(name: string, address: string, runner: ethers.ContractRunner) {
  const a = await artifacts.readArtifact(name);
  return new ethers.Contract(address, a.abi, runner) as any;
}

export async function factory(name: string, signer: ethers.Signer) {
  const a = await artifacts.readArtifact(name);
  return new ethers.ContractFactory(a.abi, a.bytecode, signer);
}

export async function printBalances(c: Chains) {
  const [fb, lb] = await Promise.all([c.fuji.provider!.getBalance(c.fuji.address), c.l1.provider!.getBalance(c.l1.address)]);
  console.log(`  Wallet:            ${c.fuji.address}`);
  console.log(`  Fuji C-Chain AVAX: ${ethers.formatEther(fb)}`);
  console.log(`  ${L1_NAME} gas token:   ${ethers.formatEther(lb)}`);
  return { fuji: fb, l1: lb };
}

export interface ReputationDeployment {
  note?: string;
  teleporterMessenger: string;
  deployer: string;
  fuji: {
    chainId: number;
    blockchainID?: string;
    blockchainIDCb58?: string;
    reputationOracle: string;
    reputationOracleDeployTx?: string | null;
    chainPeICMSender: string;
    chainPeICMSenderDeployTx?: string;
    registry: string;
  };
  l1: {
    name: string;
    chainId: number;
    rpcUrl: string;
    explorer: string;
    blockchainID?: string;
    blockchainIDCb58?: string;
    chainPeReputationMirror: string;
    chainPeReputationMirrorDeployTx?: string;
    trustedSenderTx?: string;
  };
  deployedAt: string;
  demoSends?: unknown[];
}

export function loadDeployment(): ReputationDeployment {
  if (!fs.existsSync(DEPLOYMENT_FILE)) throw new Error(`No ${path.basename(DEPLOYMENT_FILE)}; run deploy-icm-reputation.ts first`);
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

export function saveDeployment(d: ReputationDeployment) {
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(d, null, 2) + "\n");
}
