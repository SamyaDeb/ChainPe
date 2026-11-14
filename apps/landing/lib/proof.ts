/**
 * Verifiable on-chain facts shown on the landing page (proof strip, metrics).
 *
 * Everything here can be checked on Snowtrace. Do not add numbers that cannot be
 * verified. Live counts come from chainpe-cloud's public stats API (`/v1/public/stats`),
 * read in the browser; when it cannot be reached the UI shows no count at all.
 */

export const EXPLORER = "https://snowtrace.io";

export const NETWORK = {
  name: "Avalanche C-Chain mainnet",
  chainId: 43114,
} as const;

export type ProofContract = {
  name: string;
  address: `0x${string}`;
};

/** Mainnet proxies from contracts/deployments/avalanche*.json. */
export const PROOF_CONTRACTS: ProofContract[] = [
  { name: "ChainPeRegistry", address: "0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E" },
  { name: "PolicyVault", address: "0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8" },
  { name: "ERC-8004 Identity", address: "0xB1330d7B1b083ba689C7f56bDf667F1F528a3195" },
  { name: "ERC-8004 Reputation", address: "0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543" },
  { name: "ERC-8004 Validation", address: "0x91477bD9211448a85eFb16ea858432a85d89b833" },
  { name: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
];

export type ProofSettlement = {
  label: string;
  hash: `0x${string}`;
  /** ISO date of the block, for display only. */
  date: string;
};

/** Latest known x402 settlement (USDC transferWithAuthorization) on mainnet. */
export const LATEST_SETTLEMENT: ProofSettlement = {
  label: "x402 USDC settlement",
  hash: "0x953923f2b653953b4f8b0d5ea1925361a0c967a8cb9b2a542814b7d564d92006",
  date: "2026-06-17",
};

/** One-time ChainPeRegistry fee, read from `registrationFee()` (1000000 atomic). */
export const REGISTRATION_FEE_USDC = 1;

/**
 * Gas for one x402 settlement (~75k gas), projected at 1 gwei and AVAX = $40.
 * Source: docs/WHY-AVALANCHE.md. Paid by the hosted facilitator, not the agent.
 */
export const SETTLEMENT_GAS_USD = "~$0.003";

/** chainpe-cloud, which serves the public, read-only stats. NEXT_PUBLIC_ so it is inlined at build time. */
export const CLOUD_URL = (process.env.NEXT_PUBLIC_CHAINPE_CLOUD_URL || "https://chainpe-cloud-production-1d71cb77.up.railway.app").replace(/\/+$/, "");

/** Live counts from GET /v1/public/stats. Verified x402 payments only, self-pay excluded. */
export type ProofStats = {
  /** Atomic USDC (6 decimals), as a decimal string. */
  totalSettledAtomic: string;
  paidCalls: number;
  services: number;
  verifiedReviews: number;
};

const ATOMIC = /^\d+$/;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** The stats, or null when the API is down, slow or answers anything unexpected. Never a made-up number. */
export async function fetchProofStats(signal?: AbortSignal): Promise<ProofStats | null> {
  try {
    const res = await fetch(`${CLOUD_URL}/v1/public/stats`, { signal, credentials: "omit", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return null;
    const b = body as Record<string, unknown>;
    if (typeof b.totalSettledAtomic !== "string" || !ATOMIC.test(b.totalSettledAtomic)) return null;
    if (!isCount(b.paidCalls) || !isCount(b.services) || !isCount(b.verifiedReviews)) return null;
    return { totalSettledAtomic: b.totalSettledAtomic, paidCalls: b.paidCalls, services: b.services, verifiedReviews: b.verifiedReviews };
  } catch {
    return null;
  }
}

/**
 * Atomic USDC for display, without floating point: 2 decimals rounded half up, or up to 6 under one cent
 * (e.g. "1,437.00", "0.005"). Thousands separated.
 */
export function formatUsdc(atomic: string): string {
  // BigInt() calls, not literals: this app targets ES2017.
  const v = BigInt(atomic);
  const cent = BigInt(10000);
  const group = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (v > BigInt(0) && v < cent) return `0.${v.toString().padStart(6, "0").replace(/0+$/, "")}`;
  const cents = (v + cent / BigInt(2)) / cent;
  const hundred = BigInt(100);
  return `${group((cents / hundred).toString())}.${(cents % hundred).toString().padStart(2, "0")}`;
}

export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const shortHex = (hex: string, head = 6, tail = 4) =>
  `${hex.slice(0, head)}…${hex.slice(-tail)}`;
