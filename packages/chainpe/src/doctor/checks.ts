/**
 * The checks behind `chainpe doctor`. They only read. A check that could not get
 * an answer is `unknown`: never a pass, and never reported as "not registered".
 */
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { isBatchPayment } from "@circle-fin/x402-batching";
import { getAddress, isAddress, type Address } from "viem";
import { AccountsReader, serviceKey } from "../accounts.js";
import { getNetwork, type ChainPeNetwork } from "../chains.js";
import { agentCardUrl, IDENTITY_REGISTRY_ABI, ownerOfAgent } from "../erc8004.js";
import { parseUsdc } from "../evm.js";
import { assertPublicUrl, buildServiceInput, isPrivateHost } from "../listing.js";
import { describeChainError, type ChainReader } from "../onchain.js";
import { listingMatches } from "../registration.js";
import type { ChainPeConfig, PaymentRail } from "../types.js";
import { documentedRoutes, type DocumentedRoute, type X402Document } from "./documents.js";

export type CheckStatus = "pass" | "warn" | "fail" | "unknown" | "skip" | "info";

export interface CheckResult {
  id: number;
  name: string;
  status: CheckStatus;
  /** A required check that fails or is unknown makes doctor exit 1. */
  required: boolean;
  detail: string;
  diff?: string[];
}

export interface DoctorReport {
  version: 1;
  generatedAt: string;
  network: ChainPeNetwork;
  endpoint: string;
  service: string;
  ok: boolean;
  /** No fail, warn or unknown among the checks that ran. */
  allGreen: boolean;
  score: { passed: number; total: number };
  checks: CheckResult[];
}

/** What `--pay` found. Doctor never spends anything itself. */
export interface PaidCall {
  key: string;
  status: number;
}

export interface DoctorContext {
  config: ChainPeConfig;
  network: ChainPeNetwork;
  baseUrl: string;
  chain: ChainReader;
  fetch?: typeof fetch;
  paid?: PaidCall[];
}

const TIMEOUT_MS = 15_000;
const MIN_DESCRIPTION = 160;
const DISCOVERY_URL = "https://api.circle.com/v2/x402/discovery/resources";
const DISCOVERY_PAGE = 200;
const MAX_DISCOVERY_PAGES = 5;

interface LiveOption {
  scheme?: string;
  network?: string;
  payTo?: string;
  amount?: string;
  extra?: Record<string, unknown>;
}

interface Probe {
  key: string;
  url: string;
  status?: number;
  accepts?: LiveOption[];
  error?: string;
}

const railOf = (option: LiveOption): PaymentRail => (isBatchPayment(option as never) ? "gateway" : "exact");

function liveRails(accepts: LiveOption[]): PaymentRail[] {
  return [...new Set(accepts.map(railOf))].sort();
}

async function probeRoute(http: typeof fetch, baseUrl: string, key: string, method: string, path: string): Promise<Probe> {
  const url = `${baseUrl}${path}`;
  try {
    const res = await http(url, { method, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const header = res.headers.get("PAYMENT-REQUIRED");
    await res.body?.cancel();
    if (res.status !== 402 || !header) return { key, url, status: res.status };
    return { key, url, status: res.status, accepts: decodePaymentRequiredHeader(header).accepts as LiveOption[] };
  } catch (err) {
    return { key, url, error: (err as Error).message };
  }
}

async function readJson(http: typeof fetch, url: string): Promise<{ status: number; body?: unknown; error?: string }> {
  try {
    const res = await http(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      await res.body?.cancel();
      return { status: res.status };
    }
    return { status: res.status, body: await res.json() };
  } catch (err) {
    return { status: 0, error: (err as Error).message };
  }
}

export function concreteRoutes(routes: DocumentedRoute[]): DocumentedRoute[] {
  return routes.filter((route) => !route.path.includes("*") && !route.path.includes(":"));
}

async function checkReachable(http: typeof fetch, baseUrl: string): Promise<CheckResult> {
  const base = { id: 1, name: "Endpoint reachable over HTTPS", required: true };
  const url = new URL(baseUrl);
  try {
    const res = await http(`${baseUrl}/health`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.body?.cancel();
  } catch (err) {
    return { ...base, status: "fail", detail: `${baseUrl} did not answer: ${(err as Error).message}` };
  }
  if (url.protocol !== "https:") return { ...base, status: "warn", detail: `${baseUrl} answers, but over ${url.protocol.replace(":", "")}` };
  if (isPrivateHost(url.hostname)) return { ...base, status: "warn", detail: `${baseUrl} answers, but only from this network` };
  return { ...base, status: "pass", detail: baseUrl };
}

function check402(probes: Probe[]): CheckResult {
  const base = { id: 2, name: "Unpaid request returns a decodable 402", required: true };
  const bad = probes.filter((probe) => !probe.accepts);
  if (bad.length === 0) return { ...base, status: "pass", detail: `${probes.length} route(s) answer 402 with PAYMENT-REQUIRED` };
  const diff = bad.map((probe) => `${probe.key}: ${probe.error ?? `status ${probe.status}, no decodable PAYMENT-REQUIRED`}`);
  return { ...base, status: "fail", detail: `${bad.length} of ${probes.length} route(s) do not`, diff };
}

function checkAccepts(probes: Probe[]): CheckResult {
  const base = { id: 3, name: "Every accepts entry has network, payTo and price", required: true };
  const diff: string[] = [];
  for (const probe of probes) {
    for (const option of probe.accepts ?? []) {
      if (!/^[a-z0-9-]+:[a-zA-Z0-9]+$/.test(option.network ?? "")) diff.push(`${probe.key}: network "${option.network}" is not CAIP-2`);
      if (!isAddress(option.payTo ?? "", { strict: false })) diff.push(`${probe.key}: payTo "${option.payTo}" is not an address`);
      if (!/^[1-9]\d*$/.test(option.amount ?? "")) diff.push(`${probe.key}: amount "${option.amount}" is not a positive integer`);
    }
  }
  if (!probes.some((probe) => probe.accepts?.length)) return { ...base, status: "fail", detail: "No 402 to inspect" };
  return diff.length ? { ...base, status: "fail", detail: `${diff.length} problem(s)`, diff } : { ...base, status: "pass", detail: "All entries are complete" };
}

function checkArc(probes: Probe[], caip2: string): CheckResult {
  const base = { id: 4, name: "Arc option present", required: true };
  const missing = probes.filter((probe) => !probe.accepts?.some((option) => option.network === caip2));
  if (missing.length === 0) return { ...base, status: "pass", detail: caip2 };
  return { ...base, status: "fail", detail: `No ${caip2} option on ${missing.map((probe) => probe.key).join(", ")}` };
}

function checkGateway(probes: Probe[]): CheckResult {
  const base = { id: 5, name: "Gateway option present", required: false };
  const missing = probes.filter((probe) => !probe.accepts?.some((option) => railOf(option) === "gateway"));
  if (missing.length === 0) return { ...base, status: "pass", detail: "Buyers can pay with nanopayments" };
  return { ...base, status: "warn", detail: `No Gateway option on ${missing.map((probe) => probe.key).join(", ")}` };
}

async function checkDrift(http: typeof fetch, baseUrl: string, probes: Map<string, Probe>, routes: DocumentedRoute[]): Promise<CheckResult> {
  const base = { id: 6, name: "/.well-known/x402 matches the live 402", required: true };
  const { status, body, error } = await readJson(http, `${baseUrl}/.well-known/x402`);
  if (error) return { ...base, status: "fail", detail: `Could not read it: ${error}` };
  if (status !== 200) return { ...base, status: "fail", detail: `Answered ${status}. Run \`chainpe doctor --regenerate\` where the proxy runs.` };
  const document = body as Partial<X402Document>;
  if (!Array.isArray(document.resources)) return { ...base, status: "fail", detail: "It has no resources list" };

  const diff: string[] = [];
  const served = new Map(document.resources.map((resource) => [`${resource.method} ${resource.path}`, resource]));
  for (const route of routes) if (!served.has(route.key)) diff.push(`${route.key}: in config, missing from the document`);
  for (const [key, resource] of served) {
    const live = probes.get(key);
    if (!live) {
      diff.push(`${key}: in the document, not in config`);
      continue;
    }
    if (!live.accepts?.length) {
      diff.push(`${key}: the document lists it, but it has no live 402`);
      continue;
    }
    const [first] = live.accepts;
    const compare = (field: string, documented: unknown, actual: unknown) => {
      if (String(documented).toLowerCase() !== String(actual).toLowerCase()) diff.push(`${key} ${field}: document ${documented}, live ${actual}`);
    };
    compare("amountAtomic", resource.amountAtomic, first.amount);
    compare("network", resource.network, first.network);
    compare("payTo", resource.payTo, first.payTo);
    compare("rails", [...(resource.rails ?? [])].sort().join(","), liveRails(live.accepts).join(","));
  }
  return diff.length
    ? { ...base, status: "fail", detail: `${diff.length} difference(s). Run \`chainpe doctor --regenerate\` if the config is right.`, diff }
    : { ...base, status: "pass", detail: `${served.size} route(s) match` };
}

async function checkOpenApi(http: typeof fetch, baseUrl: string, routes: DocumentedRoute[]): Promise<CheckResult> {
  const base = { id: 7, name: "/openapi.json documents every paid route", required: true };
  if (routes.length === 0) return { ...base, status: "fail", detail: "Only the catch-all route exists, which cannot be documented. Add `routes` to the config." };
  const { status, body, error } = await readJson(http, `${baseUrl}/openapi.json`);
  if (error) return { ...base, status: "fail", detail: `Could not read it: ${error}` };
  if (status !== 200) return { ...base, status: "fail", detail: `Answered ${status}. Run \`chainpe doctor --regenerate\` where the proxy runs.` };
  const paths = (body as { paths?: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: { properties?: object; items?: object } }> }> }>> }).paths ?? {};
  const diff: string[] = [];
  for (const route of routes) {
    if (route.path.includes("*")) {
      diff.push(`${route.key}: a wildcard route cannot be documented`);
      continue;
    }
    const operation = paths[route.path]?.[route.method.toLowerCase()];
    if (!operation) {
      diff.push(`${route.key}: not documented`);
      continue;
    }
    const schema = operation.responses?.["200"]?.content?.["application/json"]?.schema;
    if (!schema?.properties && !schema?.items) diff.push(`${route.key}: response schema has no field names. Use --sample <file> or --pay.`);
  }
  return diff.length ? { ...base, status: "fail", detail: `${diff.length} problem(s)`, diff } : { ...base, status: "pass", detail: `${routes.length} route(s) documented with field names` };
}

function checkDescription(config: ChainPeConfig): CheckResult {
  const base = { id: 8, name: `Description has at least ${MIN_DESCRIPTION} characters`, required: false };
  const length = config.serviceDescription.length;
  return length >= MIN_DESCRIPTION
    ? { ...base, status: "pass", detail: `${length} characters` }
    : { ...base, status: "warn", detail: `${length} characters. Say what a buyer gets, in the buyer's words.` };
}

/** Runs an on-chain check, turning an RPC failure into `unknown`. */
async function onChain(base: Omit<CheckResult, "status" | "detail">, body: () => Promise<Pick<CheckResult, "status" | "detail" | "diff">>): Promise<CheckResult> {
  try {
    return { ...base, ...(await body()) };
  } catch (err) {
    return { ...base, status: "unknown", detail: `Could not check: ${describeChainError(err)}` };
  }
}

function checkIdentity(ctx: DoctorContext): Promise<CheckResult> {
  return onChain({ id: 9, name: "ERC-8004 agentId set and owned by the provider", required: true }, async () => {
    const { config, network, chain } = ctx;
    if (!config.agentId || config.agentId === "0") return { status: "fail", detail: "No agentId in the config. Run `chainpe identity`." };
    if (!/^\d+$/.test(config.agentId)) return { status: "fail", detail: `agentId "${config.agentId}" is not a number.` };
    const info = getNetwork(network);
    const seller = getAddress(config.walletAddress);
    const agentId = BigInt(config.agentId);
    const owner = await ownerOfAgent(chain, info.identityRegistry, agentId);
    if (owner === null) return { status: "fail", detail: `agentId ${agentId} does not exist on ${network}.` };
    const diff: string[] = [];
    if (getAddress(owner) !== seller) diff.push(`ownerOf(${agentId}) is ${owner}, not the seller ${seller}`);
    const expectedUri = config.publicUrl ? agentCardUrl(config.publicUrl.replace(/\/+$/, "")) : undefined;
    const uri = await chain.read<string>({ address: info.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [agentId] });
    if (expectedUri && uri !== expectedUri) diff.push(`tokenURI is ${uri}, expected ${expectedUri}. Run \`chainpe identity --update-uri\`.`);
    if (info.accountsAddress) {
      const accounts = new AccountsReader(chain, info.accountsAddress);
      const provider = await accounts.provider(seller);
      if (provider.exists && provider.agentId !== agentId) diff.push(`ChainPeAccounts links agentId ${provider.agentId}, config has ${agentId}. Run \`chainpe register\`.`);
      const service = await accounts.service(serviceKey(seller, config.serviceName));
      if (service && service.agentId !== agentId) diff.push(`The listing's agentId snapshot is ${service.agentId}, config has ${agentId}. Run \`chainpe register\`.`);
    }
    return diff.length ? { status: "fail", detail: `${diff.length} problem(s)`, diff } : { status: "pass", detail: `agentId ${agentId}, owned by ${seller}` };
  });
}

function checkRegistered(ctx: DoctorContext, probes: Probe[]): Promise<CheckResult> {
  return onChain({ id: 10, name: "Registered in ChainPeAccounts and matching", required: true }, async () => {
    const { config, network, chain } = ctx;
    const address: Address | undefined = getNetwork(network).accountsAddress;
    if (!address) return { status: "fail", detail: `ChainPeAccounts is not deployed on ${network} yet.` };
    const accounts = new AccountsReader(chain, address);
    await accounts.assertDeployment(network);
    const seller = getAddress(config.walletAddress);
    const provider = await accounts.provider(seller);
    if (!provider.exists) return { status: "fail", detail: "No provider account. Run `chainpe register`." };
    const key = serviceKey(seller, config.serviceName);
    const service = await accounts.service(key);
    if (!service) return { status: "fail", detail: `"${config.serviceName}" is not registered. Run \`chainpe register\`.` };
    if (!service.active) return { status: "fail", detail: `"${config.serviceName}" is inactive. Run \`chainpe register\`.` };

    let publicUrl: string;
    try {
      publicUrl = assertPublicUrl(config.publicUrl, { network, targetUrl: config.targetUrl, allowHttp: true });
    } catch (err) {
      return { status: "fail", detail: (err as Error).message };
    }
    const input = buildServiceInput(config, network, publicUrl);
    const diff: string[] = [];
    if (!listingMatches(service, input, service.agentId)) {
      for (const field of ["endpoint", "pricePerRequest", "network", "payTo", "acceptsExact", "acceptsGateway", "description", "tags"] as const) {
        if (String(service[field]).toLowerCase() !== String(input[field]).toLowerCase()) diff.push(`${field}: on-chain ${service[field]}, config ${input[field]}`);
      }
    }
    const listedAmount = parseUsdc(input.pricePerRequest).toString();
    const listedRails = [input.acceptsExact && "exact", input.acceptsGateway && "gateway"].filter(Boolean).sort().join(",");
    for (const probe of probes) {
      if (!probe.accepts?.length || probe.accepts[0].amount !== listedAmount) continue;
      if (liveRails(probe.accepts).join(",") !== listedRails) diff.push(`${probe.key}: live rails ${liveRails(probe.accepts).join(",")}, listed ${listedRails}`);
      if (getAddress(probe.accepts[0].payTo ?? seller) !== getAddress(service.payTo)) diff.push(`${probe.key}: live payTo ${probe.accepts[0].payTo}, listed ${service.payTo}`);
    }
    if (diff.length) return { status: "fail", detail: `Listing differs. Run \`chainpe register\` if the config is right.`, diff };
    return { status: "pass", detail: `Active, key ${key}` };
  });
}

function checkPaid(paid: PaidCall[] | undefined): CheckResult {
  const base = { id: 11, name: "Test payment settles and backend answers 2xx", required: false };
  if (!paid) return { ...base, status: "skip", detail: "Run with --pay to spend a real payment from the buyer key" };
  const bad = paid.filter((call) => call.status < 200 || call.status >= 300);
  if (bad.length === 0) return { ...base, required: true, status: "pass", detail: `${paid.length} paid call(s) answered 2xx` };
  return { ...base, required: true, status: "fail", detail: `${bad.length} of ${paid.length} paid call(s) failed`, diff: bad.map((call) => `${call.key}: status ${call.status}`) };
}

async function checkDiscovery(http: typeof fetch, ctx: DoctorContext, urls: Set<string>): Promise<CheckResult> {
  const base = { id: 12, name: "Visible in Circle Discovery API", required: false };
  try {
    for (let page = 0; page < MAX_DISCOVERY_PAGES; page++) {
      const query = new URLSearchParams({ payTo: ctx.config.walletAddress, limit: String(DISCOVERY_PAGE), offset: String(page * DISCOVERY_PAGE) });
      const res = await http(`${DISCOVERY_URL}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return { ...base, status: "unknown", detail: `Discovery API answered ${res.status}` };
      const { items } = (await res.json()) as { items: Array<{ resource: string }> };
      if (items.some((item) => urls.has(item.resource))) return { ...base, status: "pass", detail: "Listed" };
      if (items.length < DISCOVERY_PAGE) break;
    }
    return { ...base, status: "info", detail: "Not listed yet. Listing is manual: submit the Get listed form." };
  } catch (err) {
    return { ...base, status: "unknown", detail: `Could not check: ${(err as Error).message}` };
  }
}

export async function runChecks(ctx: DoctorContext): Promise<DoctorReport> {
  const { config, network, baseUrl } = ctx;
  const http = ctx.fetch ?? fetch;
  const routes = documentedRoutes(config);
  const targets = concreteRoutes(routes);

  const probeList = await Promise.all(
    targets.length > 0
      ? targets.map((route) => probeRoute(http, baseUrl, route.key, route.method, route.path))
      : [probeRoute(http, baseUrl, "* /*", "GET", "/")]
  );
  const probes = new Map(probeList.map((probe) => [probe.key, probe]));
  const resourceUrls = new Set([baseUrl, ...(config.publicUrl ? [config.publicUrl.replace(/\/+$/, "")] : [])].flatMap((base) => [base, ...targets.map((route) => `${base}${route.path}`)]));

  const checks = await Promise.all([
    checkReachable(http, baseUrl),
    check402(probeList),
    checkAccepts(probeList),
    checkArc(probeList, getNetwork(network).caip2),
    checkGateway(probeList),
    checkDrift(http, baseUrl, probes, routes),
    checkOpenApi(http, baseUrl, routes),
    checkDescription(config),
    checkIdentity(ctx),
    checkRegistered(ctx, probeList),
    checkPaid(ctx.paid),
    checkDiscovery(http, ctx, resourceUrls),
  ]);

  const ran = checks.filter((check) => check.status !== "skip" && check.status !== "info");
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    network,
    endpoint: baseUrl,
    service: config.serviceName,
    ok: !checks.some((check) => check.required && (check.status === "fail" || check.status === "unknown")),
    allGreen: ran.every((check) => check.status === "pass"),
    score: { passed: ran.filter((check) => check.status === "pass").length, total: ran.length },
    checks,
  };
}
