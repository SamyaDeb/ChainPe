import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { serviceKey } from "../src/accounts.js";
import { assertCloudUrl, chooseCloudUrl, clearCloudCredentials, HOSTED_CLOUD_URL, readStoredCredentials, resolveCredentials, saveCloudCredentials } from "../src/cloud/credentials.js";
import { readDoctorReport, sendHeartbeat } from "../src/cloud/heartbeat.js";
import { assertMessageIsSafe, loginAndCreateKey } from "../src/cloud/login.js";
import { startTelemetry } from "../src/cloud/start.js";
import { FLUSH_AT_EVENTS, MAX_AGE_MS, TelemetryQueue, toWireEvent } from "../src/cloud/telemetry.js";
import { saveConfig } from "../src/config.js";
import type { ChainPeConfig, PaymentEvent } from "../src/types.js";

const SELLER = "0x261f058496D81703c858DDFEd201834F0b5f2e73";
const CHAIN_ID = 5042002;
const CLOUD = "https://api.chainpe.test";

describe("chooseCloudUrl", () => {
  it("prefers the flag, then the environment, then the saved URL", () => {
    expect(chooseCloudUrl("arc-testnet", "https://flag.test", "https://env.test", "https://saved.test")).toBe("https://flag.test");
    expect(chooseCloudUrl("arc-testnet", undefined, "https://env.test", "https://saved.test")).toBe("https://env.test");
    expect(chooseCloudUrl("arc-testnet", undefined, "", "https://saved.test")).toBe("https://saved.test");
  });

  it("defaults to the hosted API on Arc testnet only", () => {
    expect(chooseCloudUrl("arc-testnet")).toBe(HOSTED_CLOUD_URL);
    expect(() => chooseCloudUrl("arc")).toThrow(/only covers Arc testnet/);
    expect(chooseCloudUrl("arc", "https://own.test")).toBe("https://own.test");
  });
});

const payment = (overrides: Partial<PaymentEvent> = {}): PaymentEvent => ({
  id: `chainpe_${"a".repeat(48)}`,
  ts: 1_790_000_000_000,
  route: "/weather",
  method: "GET",
  rail: "exact",
  network: "eip155:5042002",
  amountAtomic: "10000",
  payer: "0x24bc730c658201bc51873f7aeaade65a545c7a11",
  payTo: SELLER,
  txHash: `0x${"b".repeat(64)}`,
  status: "completed",
  latencyMs: 12,
  backendStatus: 200,
  ...overrides,
});

const config = (): ChainPeConfig => ({
  serviceName: "demo",
  serviceDescription: "d",
  tags: [],
  targetUrl: "http://127.0.0.1:3001",
  pricePerRequest: "0.01",
  paymentToken: "USDC",
  walletAddress: SELLER,
  proxyPort: 0,
  network: "arc-testnet",
  rails: ["exact", "gateway"],
});

type Call = { url: string; body: any; headers: Record<string, string> };

function stubFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { impl, calls };
}

const ok = () => new Response("{}", { status: 200 });

describe("credentials", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chainpe-cloud-"));
    file = path.join(dir, "sub", "config.json");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const creds = { cloudUrl: CLOUD, ingestKey: "cpk_secret", keyId: "id", keyPrefix: "cpk_secret" };

  it("creates the file 0600", async () => {
    await saveCloudCredentials(creds, file);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(await readStoredCredentials(file)).toEqual(creds);
  });

  it("tightens an existing file that was readable by others", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{}", { mode: 0o644 });
    await saveCloudCredentials(creds, file);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("keeps a service config in the same file, on save and on clear", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ serviceName: "keep", agentId: "273" }));
    await saveCloudCredentials(creds, file);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toMatchObject({ serviceName: "keep", agentId: "273", cloud: creds });
    await clearCloudCredentials(file);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ serviceName: "keep", agentId: "273" });
    expect(fs.readFileSync(file, "utf-8")).not.toContain("cpk_");
  });

  it("refuses to overwrite a file it cannot parse", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    await expect(saveCloudCredentials(creds, file)).rejects.toThrow(/not a JSON object/);
    expect(fs.readFileSync(file, "utf-8")).toBe("not json");
  });

  it("does not follow CHAINPE_CONFIG, so a key cannot reach a committed example", async () => {
    const committed = path.join(dir, "committed-config.json");
    vi.stubEnv("CHAINPE_CONFIG", committed);
    vi.stubEnv("HOME", dir);
    try {
      const { credentialsPath } = await import("../src/cloud/credentials.js");
      expect(credentialsPath(dir)).toBe(path.join(dir, ".chainpe", "config.json"));
      await saveCloudCredentials(creds, credentialsPath(dir));
      expect(fs.existsSync(committed)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a later config save does not widen the file", async () => {
    const target = path.join(dir, "c.json");
    vi.stubEnv("CHAINPE_CONFIG", target);
    try {
      await saveConfig(config());
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prefers the environment, for a container with no home config", async () => {
    await saveCloudCredentials(creds, file);
    const env = { CHAINPE_CLOUD_URL: "https://env.test", CHAINPE_INGEST_KEY: "cpk_env" };
    expect(await resolveCredentials(env, file)).toEqual({ cloudUrl: "https://env.test", ingestKey: "cpk_env" });
    expect(await resolveCredentials({}, file)).toEqual(creds);
    expect(await resolveCredentials({ CHAINPE_CLOUD_URL: "https://env.test" }, path.join(dir, "none.json"))).toBeUndefined();
  });

  it("never lets an unreadable file stop the proxy", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    expect(await resolveCredentials({}, file)).toBeUndefined();
  });

  it.each([
    ["https://api.chainpe.test/v1/", "https://api.chainpe.test"],
    ["http://localhost:4700", "http://localhost:4700"],
    ["http://127.0.0.1:4700", "http://127.0.0.1:4700"],
  ])("accepts %s", (raw, origin) => {
    expect(assertCloudUrl(raw)).toBe(origin);
  });

  it.each(["http://api.chainpe.test", "ftp://x.test", "nope"])("refuses %s", (raw) => {
    expect(() => assertCloudUrl(raw)).toThrow();
  });
});

describe("the message chainpe login signs", () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = (overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) =>
    createSiweMessage({
      address: account.address,
      chainId: CHAIN_ID,
      domain: "api.chainpe.test",
      uri: "https://api.chainpe.test",
      nonce: "abcdefgh12345",
      version: "1",
      expirationTime: new Date(Date.now() + 60_000),
      ...overrides,
    });
  const expected = { cloudUrl: CLOUD, address: account.address, chainId: CHAIN_ID };

  it("accepts a message for this host, wallet and chain", () => {
    expect(() => assertMessageIsSafe(message(), expected)).not.toThrow();
  });

  it.each([
    ["another site's challenge", () => message({ domain: "app.chainpe.test" }), /is for app\.chainpe\.test/],
    ["another chain", () => message({ chainId: 1 }), /chain 1/],
    ["another wallet", () => message({ address: privateKeyToAccount(generatePrivateKey()).address }), /another wallet/],
    ["no expiry", () => message({ expirationTime: undefined }), /never expires/],
    ["an expired message", () => message({ expirationTime: new Date(Date.now() - 1000) }), /expired/],
    ["free text", () => "please sign this", /Refused|did not send/],
  ])("refuses %s", (_name, build, error) => {
    expect(() => assertMessageIsSafe(build(), expected)).toThrow(error);
  });

  it("does not sign at all when the check fails, and sends no signature", async () => {
    const signer = { address: account.address, signMessage: vi.fn() };
    const { impl, calls } = stubFetch(() => new Response(JSON.stringify({ message: message({ domain: "app.chainpe.test" }) }), { status: 200 }));
    await expect(loginAndCreateKey({ cloudUrl: CLOUD, signer: signer as any, chainId: CHAIN_ID, fetch: impl })).rejects.toThrow(/Refused to sign/);
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("signs, creates a key and ends the session, sending no private key", async () => {
    const key = generatePrivateKey();
    const signer = privateKeyToAccount(key);
    const { impl, calls } = stubFetch(({ url }) => {
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.endsWith("/auth/nonce")) return reply({ message: message({ address: signer.address }) });
      if (url.endsWith("/auth/verify")) return reply({ token: "jwt" });
      if (url.endsWith("/keys")) return reply({ id: "1", key: "cpk_x", prefix: "cpk_x" }, 201);
      return reply({ ok: true });
    });
    const created = await loginAndCreateKey({ cloudUrl: CLOUD, signer, chainId: CHAIN_ID, fetch: impl });
    expect(created.key).toBe("cpk_x");
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/auth/nonce", "/v1/auth/verify", "/v1/keys", "/v1/auth/logout"]);
    expect(calls[0].body).toEqual({ address: signer.address, client: "cli" });
    expect(calls[2].headers.Authorization).toBe("Bearer jwt");
    expect(JSON.stringify(calls)).not.toContain(key.slice(2));
  });

  it("reports the server's reason, such as an unregistered wallet", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const { impl } = stubFetch(({ url }) =>
      url.endsWith("/auth/nonce")
        ? new Response(JSON.stringify({ message: message({ address: signer.address }) }), { status: 200 })
        : new Response(JSON.stringify({ error: "not_registered", message: "This wallet has no ChainPe provider account." }), { status: 403 })
    );
    await expect(loginAndCreateKey({ cloudUrl: CLOUD, signer, chainId: CHAIN_ID, fetch: impl })).rejects.toThrow(/no ChainPe provider account/);
  });
});

describe("telemetry", () => {
  const queue = (answer: (call: Call) => Response | Promise<Response>, extra: { now?: () => number; warn?: (m: string) => void } = {}) => {
    const { impl, calls } = stubFetch(answer);
    return { q: new TelemetryQueue({ cloudUrl: CLOUD, ingestKey: "cpk_k", fetch: impl, warn: () => {}, ...extra }), calls };
  };

  it("sends only known fields, so a signature on the object cannot leave", () => {
    const wire = toWireEvent({ ...payment(), signature: "0xsig", paymentPayload: { x: 1 }, privateKey: "0xkey" } as PaymentEvent);
    expect(Object.keys(wire).sort()).toEqual(["amountAtomic", "backendStatus", "id", "latencyMs", "method", "network", "payTo", "payer", "rail", "route", "status", "ts", "txHash"].sort());
    expect(JSON.stringify(wire)).not.toMatch(/sig|key/i);
  });

  it("caps text the server would refuse", () => {
    const wire = toWireEvent(payment({ error: "e".repeat(500), route: `/${"r".repeat(900)}` }));
    expect(String(wire.error)).toHaveLength(256);
    expect(String(wire.route)).toHaveLength(512);
  });

  it("sends the key as a bearer header only, never in the body", async () => {
    const { q, calls } = queue(ok);
    q.enqueue(payment());
    await q.flush();
    expect(calls[0].url).toBe(`${CLOUD}/v1/ingest/events`);
    expect(calls[0].headers.Authorization).toBe("Bearer cpk_k");
    expect(JSON.stringify(calls[0].body)).not.toContain("cpk_");
    expect(q.pending).toBe(0);
  });

  it("flushes on its own at 50 events", async () => {
    const { q, calls } = queue(ok);
    for (let i = 0; i < FLUSH_AT_EVENTS - 1; i++) q.enqueue(payment());
    expect(calls).toHaveLength(0);
    q.enqueue(payment());
    expect(calls).toHaveLength(1);
    expect(calls[0].body.events).toHaveLength(FLUSH_AT_EVENTS);
  });

  it("flushes on a timer", async () => {
    vi.useFakeTimers();
    try {
      const { q, calls } = queue(ok);
      q.enqueue(payment());
      q.start();
      await vi.advanceTimersByTimeAsync(2100);
      expect(calls).toHaveLength(1);
      q.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing with an empty queue", async () => {
    const { q, calls } = queue(ok);
    await q.flush();
    expect(calls).toEqual([]);
  });

  it.each([500, 503, 429, 401])("keeps events and backs off after %i, doubling", async (status) => {
    let time = 0;
    let answer = status;
    const { q, calls } = queue(() => new Response("{}", { status: answer }), { now: () => time });
    q.enqueue(payment());
    await q.flush();
    expect(q.pending).toBe(1);
    await q.flush();
    expect(calls).toHaveLength(1); // still backing off
    time += 2000;
    await q.flush();
    expect(calls).toHaveLength(2);
    time += 2000;
    await q.flush();
    expect(calls).toHaveLength(2); // the wait doubled to 4 s
    time += 2000;
    answer = 200;
    await q.flush();
    expect(q.pending).toBe(0);
  });

  it("keeps events after a network failure, and never throws", async () => {
    let time = 0;
    const { q } = queue(() => Promise.reject(new TypeError("fetch failed")), { now: () => time });
    q.enqueue(payment());
    await expect(q.flush()).resolves.toBeUndefined();
    expect(q.pending).toBe(1);
    time += 1;
  });

  it("drops events after 24 h", async () => {
    let time = 0;
    const warnings: string[] = [];
    const { q, calls } = queue(() => new Response("{}", { status: 500 }), { now: () => time, warn: (m) => warnings.push(m) });
    q.enqueue(payment());
    await q.flush();
    expect(q.pending).toBe(1);
    time = MAX_AGE_MS + 1;
    await q.flush();
    expect(q.pending).toBe(0);
    expect(calls).toHaveLength(1);
    expect(warnings.join()).toMatch(/older than 24 h/);
  });

  it("isolates and drops the one event the server refuses, delivering the others", async () => {
    const delivered: string[] = [];
    const warnings: string[] = [];
    const { q } = queue(
      ({ body }) => {
        const ids = body.events.map((e: { id: string }) => e.id);
        if (ids.includes("bad")) return new Response("{}", { status: 400 });
        delivered.push(...ids);
        return ok();
      },
      { warn: (m) => warnings.push(m) }
    );
    for (const id of ["a", "b", "bad", "c", "d"]) q.enqueue(payment({ id }));
    for (let i = 0; i < 12 && q.pending > 0; i++) await q.flush();
    expect(q.pending).toBe(0);
    expect(delivered.sort()).toEqual(["a", "b", "c", "d"]);
    expect(warnings.join()).toMatch(/refused an event/);
  });

  it("bounds the queue during a long outage", async () => {
    const { q } = queue(() => new Response("{}", { status: 500 }));
    for (let i = 0; i < 10_050; i++) q.enqueue(payment());
    expect(q.pending).toBeLessThanOrEqual(10_000);
  });
});

describe("startTelemetry", () => {
  const credentials = { cloudUrl: CLOUD, ingestKey: "cpk_k" };
  const start = (enabled: boolean, impl: typeof fetch, extra = {}) =>
    startTelemetry({ enabled, config: config(), network: "arc-testnet", version: "9.9.9", doctorFile: "/nonexistent", credentials, fetch: impl, warn: () => {}, ...extra });

  it("--no-telemetry sends nothing at all", async () => {
    const { impl, calls } = stubFetch(ok);
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await start(false, impl)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is off with no ingest key, and sends nothing", async () => {
    vi.stubEnv("HOME", "/nonexistent");
    vi.stubEnv("CHAINPE_CLOUD_URL", "");
    vi.stubEnv("CHAINPE_INGEST_KEY", "");
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      const running = await startTelemetry({ enabled: true, config: config(), network: "arc-testnet", version: "1", doctorFile: "/x" });
      expect(running).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("beats at start with version, rails, balance and the last doctor report, and tags events with the service key", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chainpe-beat-"));
    const doctorFile = path.join(dir, "d.json");
    fs.writeFileSync(doctorFile, JSON.stringify({ ok: true, score: { passed: 1, total: 1 } }));
    const { impl, calls } = stubFetch(ok);
    const running = await start(true, impl, { doctorFile, gatewayClient: () => ({ getBalances: async () => ({ gateway: { available: 4500n } }) }) });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const key = serviceKey(SELLER, "demo");
    expect(calls[0].url).toBe(`${CLOUD}/v1/ingest/heartbeat`);
    expect(calls[0].body).toMatchObject({ serviceKey: key, version: "9.9.9", network: "eip155:5042002", rails: ["exact", "gateway"], gatewayBalanceAtomic: "4500", doctor: { ok: true } });
    running!.onPayment(payment());
    running!.stop();
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith("/ingest/events"))).toBe(true));
    const events = calls.find((c) => c.url.endsWith("/ingest/events"))!;
    expect(events.body.events[0].serviceKey).toBe(key);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("still beats if the Gateway balance cannot be read, and does not throw when Cloud is down", async () => {
    const { impl, calls } = stubFetch(() => new Response("{}", { status: 500 }));
    const running = await start(true, impl, { gatewayClient: () => ({ getBalances: async () => { throw new Error("down"); } }) });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].body.gatewayBalanceAtomic).toBeUndefined();
    running!.stop();
  });
});

describe("heartbeat", () => {
  it("leaves out a doctor report too big to be accepted, and keeps the rest", async () => {
    const { impl, calls } = stubFetch(ok);
    await sendHeartbeat({ cloudUrl: CLOUD, ingestKey: "k" }, { serviceKey: "0x", version: "1", network: "n", rails: [], doctor: { pad: "x".repeat(70_000) } }, impl);
    expect(calls[0].body.doctor).toBeUndefined();
    expect(calls[0].body.version).toBe("1");
  });

  it("reads no report when there is none", async () => {
    expect(await readDoctorReport("/nonexistent")).toBeUndefined();
  });
});
