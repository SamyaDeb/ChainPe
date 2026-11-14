/**
 * ChainPe x402 Facilitator — standalone, non-custodial settlement service.
 *
 * Implements the x402 facilitator HTTP contract (`/verify`, `/settle`,
 * `/supported`) for USDC (EIP-3009) payments on Avalanche. Point a ChainPe
 * provider proxy at it with `CHAINPE_FACILITATOR_URL`.
 *
 * NON-CUSTODIAL: the facilitator key only pays gas and relays the payer's
 * already-signed `transferWithAuthorization`. It never holds user funds and
 * cannot move money the payer did not authorize.
 *
 * Env:
 *   FACILITATOR_PRIVATE_KEY  (required) gas-paying key that submits settlements
 *   NETWORK                  "fuji" | "avalanche"  (default: fuji)
 *   RPC_URL                  optional RPC override
 *   PORT                     HTTP port (Railway injects this)
 *   ALLOWED_ORIGINS          comma-separated list of allowed CORS origins
 *                            (default: deny all cross-origin browser requests)
 *   MIN_AMOUNT               minimum payment in USDC atomic units (default 1000 = 0.001 USDC)
 *   REGISTRY_ADDRESS         ChainPeRegistry used for the payTo allowlist
 *                            (default: the deployed proxy for the selected network)
 *   ALLOW_ANY_PAYTO         "true" skips the payTo allowlist (local dev only)
 */
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import {
  parseAbi,
  createPublicClient,
  createWalletClient,
  http,
  publicActions,
  formatEther,
  type PublicClient,
  type WalletClient,
} from "viem";
import { avalanche, avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { verify as x402Verify, settle as x402Settle } from "x402/facilitator";
import {
  PaymentPayloadSchema,
  PaymentRequirementsSchema,
  type PaymentPayload,
  type PaymentRequirements,
} from "x402/types";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

type Network = "fuji" | "avalanche";

const NETWORK = (process.env.NETWORK === "avalanche" ? "avalanche" : "fuji") as Network;
const X402_NETWORK = NETWORK === "avalanche" ? "avalanche" : "avalanche-fuji";
const CHAIN = NETWORK === "avalanche" ? avalanche : avalancheFuji;
const RPC_URL =
  process.env.RPC_URL ??
  (NETWORK === "avalanche"
    ? "https://api.avax.network/ext/bc/C/rpc"
    : "https://api.avax-test.network/ext/bc/C/rpc");
const PORT = parseInt(process.env.PORT ?? "4500", 10);

// ─── Payment guards (what this facilitator is willing to settle) ────────────

const USDC_ADDRESS = (
  NETWORK === "avalanche"
    ? "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
    : "0x5425890298aed601595a70AB815c96711a31Bc65"
).toLowerCase();
// EIP-712 domain of Circle's native USDC (name()/version() confirmed on mainnet).
const USDC_DOMAIN_NAME = "USD Coin";
const USDC_DOMAIN_VERSION = "2";

function parseMinAmount(): bigint {
  try {
    const v = BigInt(process.env.MIN_AMOUNT ?? "1000");
    return v >= 0n ? v : 1000n;
  } catch {
    return 1000n;
  }
}
const MIN_AMOUNT = parseMinAmount();

const REGISTRY_ADDRESS = (
  process.env.REGISTRY_ADDRESS ??
  (NETWORK === "avalanche"
    ? "0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E"
    : "0x91677a35599f052E99Ed0ab9E45c17E736a22Bf6")
).toLowerCase();
const ALLOW_ANY_PAYTO = process.env.ALLOW_ANY_PAYTO === "true";
const PAYTO_CACHE_MS = 60_000;
const PAYTO_MISS_REFRESH_MS = 10_000; // don't let unknown payTos hammer the RPC
const SETTLED_CACHE_MAX = 10_000;

const registryAbi = parseAbi([
  "struct Service { string name; string description; string tags; string endpoint; string pricePerRequest; string paymentToken; string network; address payTo; address developer; uint256 agentId; uint64 createdAt; uint64 updatedAt; bool exists; }",
  "function getServiceCount() view returns (uint256)",
  "function getServices(uint256 offset, uint256 limit) view returns (Service[])",
]);
const usdcAbi = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/** Message-only error text so RPC URLs (which may carry keys) never reach the logs. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface Deps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  verify: typeof x402Verify;
  settle: typeof x402Settle;
}

const rawKey = process.env.FACILITATOR_PRIVATE_KEY;
if (!rawKey) {
  log.fatal("FACILITATOR_PRIVATE_KEY is required (gas-paying settlement key).");
  process.exit(1);
}
const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`);

const publicClient: PublicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });
// settle() calls verify() which needs public actions (verifyTypedData) too.
const walletClient: WalletClient = createWalletClient({
  account,
  chain: CHAIN,
  transport: http(RPC_URL),
}).extend(publicActions) as unknown as WalletClient;

// ─── Rate limiter: 60 requests / minute per IP ──────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" },
});

// ─── CORS config ────────────────────────────────────────────────────────────

function buildCorsOptions() {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    // No origins configured → deny all browser cross-origin requests.
    // Server-to-server calls (no Origin header) still work fine.
    return cors({ origin: false });
  }
  return cors({ origin: origins, credentials: true });
}

// ─── In-memory Prometheus-style counters ────────────────────────────────────
// Intentionally simple: no external dep. Reset on process restart (acceptable
// for a single-instance Railway service — use Railway metrics for persistence).
const counters = {
  verify_success: 0,
  verify_error: 0,
  settle_success: 0,
  settle_error: 0,
};

// ─── Background gas-balance cache (refreshes every 60 s) ────────────────────
// Module-level so both /health and /metrics can read it without live RPC.
let cachedGasBalance: bigint | null = null;
const LOW_GAS_THRESHOLD = 5n * 10n ** 16n; // 0.05 AVAX

async function refreshGasBalance() {
  try {
    cachedGasBalance = await publicClient.getBalance({ address: account.address });
  } catch {
    // Keep stale value on transient RPC errors; warn but don't crash.
  }
}
void refreshGasBalance();
setInterval(() => { void refreshGasBalance(); }, 60_000);

export function createApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = { publicClient, walletClient, verify: x402Verify, settle: x402Settle, ...overrides };

  // payTo allowlist = payTo of every service currently in ChainPeRegistry.
  // Cached 60s; an unknown payTo triggers one (throttled) refresh so a freshly
  // registered service works without waiting for the cache to expire.
  let payToSet = new Set<string>();
  let payToLoadedAt = 0;
  let payToRefreshing: Promise<void> | null = null;

  async function loadPayTos(): Promise<void> {
    if (!REGISTRY_ADDRESS) throw new Error("REGISTRY_ADDRESS not set");
    const registry = REGISTRY_ADDRESS as `0x${string}`;
    const count = (await deps.publicClient.readContract({
      address: registry, abi: registryAbi, functionName: "getServiceCount",
    })) as bigint;
    const next = new Set<string>();
    for (let offset = 0n; offset < count; offset += 100n) {
      const page = (await deps.publicClient.readContract({
        address: registry, abi: registryAbi, functionName: "getServices", args: [offset, 100n],
      })) as readonly { payTo: string; exists: boolean }[];
      for (const svc of page) if (svc.exists) next.add(svc.payTo.toLowerCase());
    }
    payToSet = next;
    payToLoadedAt = Date.now();
  }

  function refreshPayTos(): Promise<void> {
    payToRefreshing ??= loadPayTos().finally(() => { payToRefreshing = null; });
    return payToRefreshing;
  }

  async function isRegisteredPayTo(payTo: string): Promise<boolean> {
    if (ALLOW_ANY_PAYTO) return true;
    const key = payTo.toLowerCase();
    const age = Date.now() - payToLoadedAt;
    if (age > PAYTO_CACHE_MS) await refreshPayTos();
    if (payToSet.has(key)) return true;
    // Miss: refresh once (unless we just did) in case it was registered a moment ago.
    if (Date.now() - payToLoadedAt > PAYTO_MISS_REFRESH_MS) await refreshPayTos();
    return payToSet.has(key);
  }

  /** Synchronous checks on the requirements/payload shape. Returns a reason or null. */
  function checkStatic(payload: PaymentPayload, req: PaymentRequirements): string | null {
    if (req.network !== X402_NETWORK || payload.network !== X402_NETWORK) return "wrong_network";
    if (req.scheme !== "exact" || payload.scheme !== "exact") return "wrong_scheme";
    if (req.asset.toLowerCase() !== USDC_ADDRESS) return "wrong_asset";
    if (req.extra?.name !== USDC_DOMAIN_NAME || req.extra?.version !== USDC_DOMAIN_VERSION) {
      return "wrong_asset_domain";
    }
    try {
      if (BigInt(req.maxAmountRequired) < MIN_AMOUNT) return "amount_below_minimum";
    } catch {
      return "bad_amount";
    }
    const auth = (payload.payload as { authorization?: { to?: string } }).authorization;
    if (!auth?.to || auth.to.toLowerCase() !== req.payTo.toLowerCase()) return "pay_to_mismatch";
    return null;
  }

  // Nonces whose settle is running right now, and ones that already settled.
  const inFlight = new Set<string>();
  const settled = new Map<string, true>(); // insertion-ordered → simple LRU
  function rememberSettled(key: string) {
    settled.delete(key);
    settled.set(key, true);
    if (settled.size > SETTLED_CACHE_MAX) settled.delete(settled.keys().next().value as string);
  }
  const nonceKey = (payload: PaymentPayload) => {
    const a = (payload.payload as { authorization: { from: string; nonce: string } }).authorization;
    return `${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`;
  };
  async function nonceUsedOnChain(payload: PaymentPayload): Promise<boolean> {
    const a = (payload.payload as { authorization: { from: string; nonce: string } }).authorization;
    return (await deps.publicClient.readContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: usdcAbi,
      functionName: "authorizationState",
      args: [a.from as `0x${string}`, a.nonce as `0x${string}`],
    })) as boolean;
  }

  const app = express();
  // Railway puts exactly one proxy in front; needed so the rate limiter sees real client IPs.
  app.set("trust proxy", 1);
  app.use(buildCorsOptions());
  // Reduced from 1 MB — x402 payloads are well under 10 KB.
  app.use(express.json({ limit: "50kb" }));

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "chainpe-facilitator",
      description: "Non-custodial x402 verify + settle for USDC on Avalanche.",
      network: NETWORK,
      custodial: false,
      endpoints: ["/health", "/status", "/supported", "/metrics", "/verify", "/settle"],
    });
  });

  // Liveness probe — always 200 while the process is running.
  // Gas warnings are in /status so Railway doesn't crash-loop on low balance.
  app.get("/health", (_req: Request, res: Response) => {
    const lowGas = cachedGasBalance !== null && cachedGasBalance < LOW_GAS_THRESHOLD;
    if (lowGas) {
      log.warn(
        { facilitator: account.address, gasBalanceAvax: formatEther(cachedGasBalance!) },
        "health check: AVAX balance critically low — top up required"
      );
    }
    res.json({
      status: lowGas ? "degraded" : "ok",
      service: "chainpe-facilitator",
      network: NETWORK,
      x402Network: X402_NETWORK,
      facilitator: account.address,
      custodial: false,
      ...(lowGas ? { warning: "low_gas" } : {}),
    });
  });

  // Operational status incl. the gas balance (reads the chain — use sparingly).
  app.get("/status", apiLimiter, async (_req: Request, res: Response) => {
    const balance = await publicClient
      .getBalance({ address: account.address })
      .catch(() => null);
    res.json({
      service: "chainpe-facilitator",
      network: NETWORK,
      x402Network: X402_NETWORK,
      facilitator: account.address,
      gasBalanceAvax: balance != null ? formatEther(balance) : "unavailable",
      lowGas: balance != null ? balance < 10n ** 16n : null,
    });
  });

  app.get("/supported", (_req: Request, res: Response) => {
    res.json({ kinds: [{ x402Version: 1, scheme: "exact", network: X402_NETWORK }] });
  });

  // Prometheus text-format metrics — scrape with Railway metrics or an external
  // Prometheus instance. Counters reset on restart; use Railway's built-in
  // service metrics for long-term trends.
  app.get("/metrics", (_req: Request, res: Response) => {
    const gasAvax = cachedGasBalance !== null ? Number(formatEther(cachedGasBalance)) : 0;
    const lines = [
      "# HELP chainpe_verify_total Total /verify requests handled",
      "# TYPE chainpe_verify_total counter",
      `chainpe_verify_total{result="success"} ${counters.verify_success}`,
      `chainpe_verify_total{result="error"} ${counters.verify_error}`,
      "# HELP chainpe_settle_total Total /settle requests handled",
      "# TYPE chainpe_settle_total counter",
      `chainpe_settle_total{result="success"} ${counters.settle_success}`,
      `chainpe_settle_total{result="error"} ${counters.settle_error}`,
      "# HELP chainpe_gas_balance_avax Current gas key AVAX balance",
      "# TYPE chainpe_gas_balance_avax gauge",
      `chainpe_gas_balance_avax{network="${NETWORK}",facilitator="${account.address}"} ${gasAvax}`,
    ].join("\n") + "\n";
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines);
  });

  app.post("/verify", apiLimiter, async (req: Request, res: Response) => {
    try {
      const payload = PaymentPayloadSchema.parse(req.body.paymentPayload);
      const requirements = PaymentRequirementsSchema.parse(req.body.paymentRequirements);
      const reason = checkStatic(payload, requirements);
      if (reason || !(await isRegisteredPayTo(requirements.payTo))) {
        log.warn({ event: "verify_rejected", reason: reason ?? "pay_to_not_registered" }, "verify rejected");
        res.status(400).json({ isValid: false, invalidReason: "unsupported_requirements" });
        return;
      }
      const key = nonceKey(payload);
      if (settled.has(key) || (await nonceUsedOnChain(payload))) {
        res.status(400).json({ isValid: false, invalidReason: "nonce_used" });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await deps.verify(deps.publicClient as any, payload, requirements);
      counters.verify_success++;
      log.info({ event: "verify", isValid: result.isValid }, "verify");
      res.json(result);
    } catch (err) {
      counters.verify_error++;
      log.error({ event: "verify_error", err: errMsg(err) }, "verify failed");
      res.status(400).json({ isValid: false, invalidReason: "verify_failed" });
    }
  });

  app.post("/settle", apiLimiter, async (req: Request, res: Response) => {
    const fail = (status: number, errorReason: string) =>
      res.status(status).json({ success: false, errorReason, transaction: "", network: X402_NETWORK });
    let claimed: string | null = null;
    try {
      const payload = PaymentPayloadSchema.parse(req.body.paymentPayload);
      const requirements = PaymentRequirementsSchema.parse(req.body.paymentRequirements);
      const reason = checkStatic(payload, requirements);
      if (reason) {
        log.warn({ event: "settle_rejected", reason }, "settle rejected");
        return void fail(400, "unsupported_requirements");
      }
      // Claim the nonce synchronously (before any await) so concurrent
      // duplicates can't both reach settle().
      const key = nonceKey(payload);
      if (settled.has(key)) return void fail(400, "nonce_used");
      if (inFlight.has(key)) return void fail(409, "settle_in_progress");
      inFlight.add(key);
      claimed = key;

      if (!(await isRegisteredPayTo(requirements.payTo))) {
        log.warn({ event: "settle_rejected", reason: "pay_to_not_registered" }, "settle rejected");
        return void fail(400, "unsupported_requirements");
      }
      if (await nonceUsedOnChain(payload)) {
        rememberSettled(key);
        return void fail(400, "nonce_used");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await deps.settle(deps.walletClient as any, payload, requirements);
      if (result.success) rememberSettled(key);
      counters.settle_success++;
      log.info(
        { event: "settle", success: result.success, transaction: (result as Record<string, unknown>).transaction },
        "settle"
      );
      res.json(result);
    } catch (err) {
      counters.settle_error++;
      log.error({ event: "settle_error", err: errMsg(err) }, "settle failed");
      fail(400, "settle_failed");
    } finally {
      if (claimed) inFlight.delete(claimed);
    }
  });

  return app;
}

async function main() {
  const balance = await publicClient.getBalance({ address: account.address }).catch(() => 0n);
  createApp().listen(PORT, () => {
    log.info(
      { network: NETWORK, x402Network: X402_NETWORK, facilitator: account.address, gasBalanceAvax: formatEther(balance) },
      `ChainPe facilitator listening on :${PORT}`
    );
    if (balance < 10n ** 16n) {
      log.warn("Low AVAX balance — top up the facilitator so it can pay settlement gas.");
    }
  });
}

// Only auto-start when run directly (not when imported by tests).
if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    log.fatal({ err: errMsg(e) }, "fatal startup error");
    process.exit(1);
  });
}
