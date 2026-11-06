import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractFunctionRevertedError, encodeErrorResult, type Abi, type Address } from "viem";
import type { FacilitatorClient } from "@x402/core/server";
import { chainPeAccountsAbi } from "../src/abi/ChainPeAccounts.js";
import { serviceKey } from "../src/accounts.js";
import { getNetwork } from "../src/chains.js";
import { runChecks, type DoctorContext, type CheckResult } from "../src/doctor/checks.js";
import { documentPaths, documentedRoutes, generateDocuments, inferSchema } from "../src/doctor/documents.js";
import { IDENTITY_REGISTRY_ABI } from "../src/erc8004.js";
import type { ChainReader, ContractCall } from "../src/onchain.js";
import { SettlementGuard, type CircleClient } from "../src/proxy/circleFacilitator.js";
import { GatewayGuard, type GatewayTerms } from "../src/proxy/gateway.js";
import { RailRouter } from "../src/proxy/railRouter.js";
import { createProxyServer } from "../src/proxy/server.js";
import type { ChainPeConfig } from "../src/types.js";

const NETWORK = "eip155:5042002";
const SELLER = "0x261f058496D81703c858DDFEd201834F0b5f2e73" as Address;
const PUBLIC = "https://api.example.com";
const TERMS: GatewayTerms = { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9" };
const SECRET_BACKEND = "secret-backend.internal";
const SAMPLE = { success: true, data: { city: "London", temperatureC: 14.5, tags: ["a"] } };

const backendCalls: string[] = [];
let backend: Server;
let proxy: Server | undefined;
let dir: string;

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));

const config = (overrides: Partial<ChainPeConfig> = {}): ChainPeConfig => ({
  serviceName: "ChainPe Weather Demo",
  serviceDescription: "x".repeat(160),
  tags: ["weather"],
  targetUrl: `http://localhost:${(backend.address() as AddressInfo).port}`,
  publicUrl: PUBLIC,
  pricePerRequest: "0.01",
  paymentToken: "USDC",
  walletAddress: SELLER,
  proxyPort: 0,
  network: "arc-testnet",
  agentId: "7",
  adminKey: "top-secret",
  routes: [{ path: "GET /weather", pricePerRequest: "0.01", paymentToken: "USDC", query: { city: "City name" } }],
  ...overrides,
});

/** Writes the documents and starts a real proxy that serves them. */
async function start(cfg: ChainPeConfig, write = true): Promise<{ url: string; paths: ReturnType<typeof documentPaths> }> {
  const paths = documentPaths(join(dir, "c.json"));
  if (write) {
    const documents = generateDocuments(cfg, "arc-testnet", PUBLIC, { "GET /weather": SAMPLE });
    writeFileSync(paths.openapi, JSON.stringify(documents.openapi));
    writeFileSync(paths.x402, JSON.stringify(documents.x402));
  }
  const supported = (extra: unknown) => async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra }], extensions: [], signers: {} });
  const exact = new SettlementGuard({ verify: vi.fn(), getSupported: supported({ name: "USDC", version: "2" }) } as unknown as CircleClient);
  const gateway = new GatewayGuard({ verify: vi.fn(), getSupported: supported(TERMS) } as unknown as FacilitatorClient, async () => []);
  proxy = http.createServer(createProxyServer({ config: cfg, facilitator: new RailRouter({ exact, gateway }), gateway: TERMS, documents: paths }));
  return { url: `http://localhost:${await listen(proxy)}`, paths };
}

const revert = (abi: Abi | readonly unknown[], errorName: string, args: readonly unknown[]) =>
  new ContractFunctionRevertedError({ abi: abi as Abi, data: encodeErrorResult({ abi: abi as Abi, errorName, args } as never), functionName: "f" });

/** The chain as a fully registered demo seller sees it. Change a field to break one thing. */
function healthyChain(overrides: { service?: Record<string, unknown> | null; owner?: Address | null; uri?: string; providerAgentId?: bigint; rpcDown?: boolean; providerExists?: boolean } = {}): ChainReader {
  const info = getNetwork("arc-testnet");
  return {
    read: (async (call: ContractCall) => {
      if (overrides.rpcDown) throw new Error("fetch failed");
      switch (call.functionName) {
        case "ownerOf":
          if (overrides.owner === null) throw revert(IDENTITY_REGISTRY_ABI, "ERC721NonexistentToken", [7n]);
          return overrides.owner ?? SELLER;
        case "tokenURI":
          return overrides.uri ?? `${PUBLIC}/.well-known/agent.json`;
        case "usdc":
          return info.usdc;
        case "identityRegistry":
          return info.identityRegistry;
        case "providers":
          return [overrides.providerExists ?? true, overrides.providerAgentId ?? 7n, 1n, 0n, 1];
        case "getService":
          if (overrides.service === null) throw revert(chainPeAccountsAbi, "ServiceNotFound", [`0x${"0".repeat(64)}`]);
          return {
            key: serviceKey(SELLER, "ChainPe Weather Demo"),
            provider: SELLER,
            payTo: SELLER,
            agentId: 7n,
            name: "ChainPe Weather Demo",
            description: "x".repeat(160),
            tags: "weather",
            endpoint: PUBLIC,
            pricePerRequest: "0.01",
            network: NETWORK,
            acceptsExact: true,
            acceptsGateway: true,
            active: true,
            ...overrides.service,
          };
      }
      throw new Error(`unexpected read ${call.functionName}`);
    }) as never,
  };
}

/** Real fetch for the proxy; a canned answer for Circle's Discovery API. */
const withDiscovery = (items: unknown[] = []): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("https://api.circle.com") ? new Response(JSON.stringify({ items })) : fetch(input, init)) as typeof fetch;

const check = (checks: CheckResult[], id: number) => checks.find((c) => c.id === id)!;

const run = (url: string, cfg: ChainPeConfig, overrides: Partial<DoctorContext> = {}) =>
  runChecks({ config: cfg, network: "arc-testnet", baseUrl: url, chain: healthyChain(), fetch: withDiscovery(), ...overrides });

beforeAll(async () => {
  backend = http.createServer((req, res) => {
    backendCalls.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(SAMPLE));
  });
  await listen(backend);
});

afterAll(() => {
  backend.close();
});

beforeEach(() => {
  backendCalls.length = 0;
  dir = mkdtempSync(join(tmpdir(), "chainpe-doctor-"));
});

afterEach(() => {
  proxy?.close();
  proxy = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("free discovery paths", () => {
  const PATHS = ["/.well-known/x402", "/openapi.json", "/.well-known/agent.json"];

  it("are served by the proxy and never reach the backend, for any method", async () => {
    const { url } = await start(config());
    for (const path of PATHS) {
      expect((await fetch(`${url}${path}`)).status, path).toBe(200);
      expect((await fetch(`${url}${path}`, { method: "HEAD" })).status, path).toBe(200);
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        expect((await fetch(`${url}${path}`, { method })).status, `${method} ${path}`).toBe(405);
      }
    }
    expect(backendCalls).toEqual([]);
  });

  it("answer 404 before doctor has generated them, still without reaching the backend", async () => {
    const { url } = await start(config(), false);
    expect((await fetch(`${url}/.well-known/x402`)).status).toBe(404);
    expect((await fetch(`${url}/openapi.json`)).status).toBe(404);
    expect(backendCalls).toEqual([]);
  });

  it("do not open anything next to them: near matches never reach the backend", async () => {
    const near = ["/openapi.json/", "/OPENAPI.JSON", "/openapi.jsonx", "/.well-known/agent.json/x", "/.well-known/x402x"];
    for (const [overrides, status] of [[{}, 404], [{ chargeUnlistedPaths: true }, 402]] as const) {
      const { url } = await start(config(overrides));
      for (const path of near) expect((await fetch(`${url}${path}`)).status, path).toBe(status);
    }
    expect(backendCalls).toEqual([]);
  });

  it("serve the agent card without private config", async () => {
    const { url } = await start(config({ targetUrl: `http://${SECRET_BACKEND}:3001` }));
    const text = await (await fetch(`${url}/.well-known/agent.json`)).text();
    expect(JSON.parse(text)).toMatchObject({ endpoint: PUBLIC, chainpe: { serviceKey: serviceKey(SELLER, "ChainPe Weather Demo") } });
    expect(text).not.toContain(SECRET_BACKEND);
    expect(text).not.toContain("top-secret");
  });
});

describe("generated documents", () => {
  it("contain no backend URL or admin key", () => {
    const cfg = config({ targetUrl: `http://${SECRET_BACKEND}:3001` });
    const text = JSON.stringify(generateDocuments(cfg, "arc-testnet", PUBLIC, { "GET /weather": SAMPLE }));
    expect(text).not.toContain(SECRET_BACKEND);
    expect(text).not.toContain("top-secret");
  });

  it("use the Discovery ServiceListing shape", () => {
    const { discovery } = generateDocuments(config({ category: "DATA" }), "arc-testnet", PUBLIC, { "GET /weather": SAMPLE });
    const [item] = (discovery as { items: any[] }).items;
    expect(item).toMatchObject({ resource: `${PUBLIC}/weather`, type: "http", x402Version: 2 });
    expect(item.accepts).toHaveLength(2);
    expect(item.accepts[0]).toMatchObject({ scheme: "exact", network: NETWORK, amount: "10000", payTo: SELLER });
    expect(item.metadata).toMatchObject({ path: "/weather", method: "GET", supportsVanillax402: true, supportsCircleGateway: true, siwx: false });
    expect(item.metadata.provider).toMatchObject({ category: "DATA", openApiUrl: `${PUBLIC}/openapi.json` });
    expect(item.metadata.output.properties.data.properties.city).toEqual({ type: "string" });
  });

  it("infer real field names and types", () => {
    expect(inferSchema(SAMPLE)).toMatchObject({
      type: "object",
      properties: { success: { type: "boolean" }, data: { properties: { temperatureC: { type: "number" }, tags: { type: "array", items: { type: "string" } } } } },
    });
    expect(inferSchema({ n: 3, x: null })).toMatchObject({ properties: { n: { type: "integer" }, x: { type: "null" } } });
  });

  it("drop examples over 1.5 KB but keep the schema", () => {
    const big = { text: "x".repeat(2000) };
    const { openapi } = generateDocuments(config(), "arc-testnet", PUBLIC, { "GET /weather": big });
    const media = (openapi as any).paths["/weather"].get.responses["200"].content["application/json"];
    expect(media.example).toBeUndefined();
    expect(media.schema.properties.text).toEqual({ type: "string" });
    const small = generateDocuments(config(), "arc-testnet", PUBLIC, { "GET /weather": SAMPLE }).openapi as any;
    expect(small.paths["/weather"].get.responses["200"].content["application/json"].example).toEqual(SAMPLE);
  });

  it("documents query parameters and price", () => {
    const { openapi } = generateDocuments(config(), "arc-testnet", PUBLIC);
    const op = (openapi as any).paths["/weather"].get;
    expect(op["x-x402-price"]).toBe("0.01");
    expect(op.parameters).toEqual([{ name: "city", in: "query", description: "City name", schema: { type: "string" } }]);
  });

  it("list only the rails a route's price allows", () => {
    const routes = documentedRoutes(config({ routes: [{ path: "/cheap", pricePerRequest: "0.001", paymentToken: "USDC" }] }));
    expect(routes[0]).toMatchObject({ key: "GET /cheap", rails: ["gateway"], amountAtomic: "1000" });
  });

  it("are named after the config, so two configs do not collide", () => {
    expect(documentPaths("/a/arc-testnet.json").x402).toBe("/a/arc-testnet.x402.json");
    expect(documentPaths("/a/config.json").openapi).toBe("/a/config.openapi.json");
  });
});

describe("runChecks against a real proxy", () => {
  it("is all green for a healthy service, apart from http on localhost", async () => {
    const cfg = config();
    const { url } = await start(cfg);
    const report = await run(url, cfg);
    const statuses = Object.fromEntries(report.checks.map((c) => [c.id, c.status]));
    expect(statuses).toEqual({ 1: "warn", 2: "pass", 3: "pass", 4: "pass", 5: "pass", 6: "pass", 7: "pass", 8: "pass", 9: "pass", 10: "pass", 11: "skip", 12: "info" });
    expect(report.ok).toBe(true);
    expect(report.allGreen).toBe(false);
    expect(backendCalls).toEqual([]);
  });

  it("produces JSON that validates against the published schema", async () => {
    const cfg = config();
    const { url } = await start(cfg);
    const report = await run(url, cfg);
    const here = dirname(fileURLToPath(import.meta.url));
    const schema = JSON.parse(readFileSync(join(here, "../../../docs/arc/specs/schemas/doctor.schema.json"), "utf-8"));
    delete schema.$schema;
    const validate = new Ajv({ allErrors: true }).compile(schema);
    expect(validate(JSON.parse(JSON.stringify(report))), JSON.stringify(validate.errors)).toBe(true);
  });

  it("fails check 6 with a diff when someone edits the served price", async () => {
    const cfg = config();
    const { url, paths } = await start(cfg);
    const document = JSON.parse(readFileSync(paths.x402, "utf-8"));
    document.resources[0].amountAtomic = "999";
    writeFileSync(paths.x402, JSON.stringify(document));
    const report = await run(url, cfg);
    expect(check(report.checks, 6).status).toBe("fail");
    expect(check(report.checks, 6).diff).toEqual(["GET /weather amountAtomic: document 999, live 10000"]);
    expect(report.ok).toBe(false);
  });

  it("fails check 6 when the documents are missing, and check 7 too", async () => {
    const cfg = config();
    const { url } = await start(cfg, false);
    const report = await run(url, cfg);
    expect(check(report.checks, 6).status).toBe("fail");
    expect(check(report.checks, 7).status).toBe("fail");
  });

  it("fails check 7 when only the catch-all exists", async () => {
    const cfg = config({ routes: [] });
    const { url } = await start(cfg);
    const report = await run(url, cfg);
    expect(check(report.checks, 7).detail).toMatch(/Add `routes`/);
    expect(check(report.checks, 2).status).toBe("pass");
  });

  it("fails check 7 when a response schema has no field names", async () => {
    const cfg = config();
    const { url, paths } = await start(cfg);
    const documents = generateDocuments(cfg, "arc-testnet", PUBLIC);
    writeFileSync(paths.openapi, JSON.stringify(documents.openapi));
    const report = await run(url, cfg);
    expect(check(report.checks, 7).status).toBe("fail");
    expect(check(report.checks, 7).diff?.[0]).toMatch(/--sample/);
  });

  it("warns on a short description, and Gateway-less rails, without failing", async () => {
    const cfg = config({ serviceDescription: "Short", rails: ["exact"] });
    const { url } = await start(cfg);
    const report = await run(url, cfg, { chain: healthyChain({ service: { description: "Short", acceptsGateway: false } }) });
    expect(check(report.checks, 8).status).toBe("warn");
    expect(check(report.checks, 5).status).toBe("warn");
    expect(report.ok).toBe(true);
  });

  it("reports an unreachable endpoint as a failure", async () => {
    const report = await run("http://127.0.0.1:1", config());
    expect(check(report.checks, 1).status).toBe("fail");
    expect(check(report.checks, 2).status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it("treats an RPC outage as unknown: not a pass, and not 'not registered'", async () => {
    const cfg = config();
    const { url } = await start(cfg);
    const report = await run(url, cfg, { chain: healthyChain({ rpcDown: true }) });
    for (const id of [9, 10]) {
      expect(check(report.checks, id).status).toBe("unknown");
      expect(check(report.checks, id).detail).toMatch(/Could not check/);
    }
    expect(report.ok).toBe(false);
  });

  describe("check 9, identity", () => {
    it.each([
      ["no agentId", { config: { agentId: undefined } }, {}, /chainpe identity/],
      ["token that does not exist", {}, { owner: null }, /does not exist/],
      ["token owned by someone else", {}, { owner: "0x24BC730c658201bC51873f7aeAaDE65A545c7A11" }, /ownerOf/],
      ["agent URI that moved", {}, { uri: "https://old.example.com/.well-known/agent.json" }, /tokenURI/],
      ["provider linking another id", {}, { providerAgentId: 8n }, /links agentId 8/],
      ["stale service snapshot", {}, { service: { agentId: 0n } }, /snapshot is 0/],
    ])("fails on %s", async (_name, cfgChange, chainChange, message) => {
      const cfg = config((cfgChange as { config?: Partial<ChainPeConfig> }).config);
      const { url } = await start(cfg);
      const report = await run(url, cfg, { chain: healthyChain(chainChange as never) });
      const result = check(report.checks, 9);
      expect(result.status).toBe("fail");
      expect(`${result.detail} ${result.diff?.join(" ")}`).toMatch(message);
    });
  });

  describe("check 10, listing", () => {
    it.each([
      ["no provider", { providerExists: false }, /No provider account/],
      ["no service", { service: null }, /not registered/],
      ["inactive service", { service: { active: false } }, /inactive/],
      ["another endpoint", { service: { endpoint: "https://example.com/weather" } }, /endpoint: on-chain/],
      ["another price", { service: { pricePerRequest: "0.02" } }, /pricePerRequest/],
      ["listed rail the 402 lacks", { service: { acceptsGateway: false } }, /acceptsGateway/],
    ])("fails on %s", async (_name, chainChange, message) => {
      const cfg = config();
      const { url } = await start(cfg);
      const report = await run(url, cfg, { chain: healthyChain(chainChange as never) });
      const result = check(report.checks, 10);
      expect(result.status).toBe("fail");
      expect(`${result.detail} ${result.diff?.join(" ")}`).toMatch(message);
    });
  });

  it("makes --pay results count only when they ran", async () => {
    const cfg = config();
    const { url } = await start(cfg);
    expect(check((await run(url, cfg, { paid: [{ key: "GET /weather", status: 200 }] })).checks, 11).status).toBe("pass");
    const failed = await run(url, cfg, { paid: [{ key: "GET /weather", status: 502 }] });
    expect(check(failed.checks, 11).status).toBe("fail");
    expect(failed.ok).toBe(false);
  });

  it("matches a Discovery listing exactly, and never fails over it", async () => {
    const cfg = config();
    const { url } = await start(cfg);
    const listed = await run(url, cfg, { fetch: withDiscovery([{ resource: `${PUBLIC}/weather` }]) });
    expect(check(listed.checks, 12).status).toBe("pass");
    const other = await run(url, cfg, { fetch: withDiscovery([{ resource: `${PUBLIC}/weather-extra` }]) });
    expect(check(other.checks, 12).status).toBe("info");
    const down = await run(url, cfg, {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith("https://api.circle.com") ? new Response("", { status: 503 }) : fetch(input, init))) as typeof fetch,
    });
    expect(check(down.checks, 12).status).toBe("unknown");
    expect(down.ok).toBe(true);
  });
});
