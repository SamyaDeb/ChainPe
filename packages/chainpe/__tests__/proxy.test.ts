import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { createProxyServer } from "../src/proxy/server.ts";
import type { ChainPeConfig } from "../src/types.ts";

const KEY = "s3cret-admin-key";
const FAC_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function baseConfig(over: Partial<ChainPeConfig> = {}): ChainPeConfig {
  return {
    serviceName: "test",
    serviceDescription: "d",
    targetUrl: "http://127.0.0.1:9",
    pricePerRequest: "0.01",
    paymentToken: "USDC",
    walletAddress: "0x1111111111111111111111111111111111111111",
    network: "fuji",
    proxyPort: 0,
    tags: [],
    ...over,
  } as ChainPeConfig;
}

let server: Server | undefined;
async function start(config: ChainPeConfig, facilitatorKey?: string): Promise<string> {
  const app = createProxyServer({ config, facilitatorKey });
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  const a = server!.address();
  return `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}
afterEach(() => { server?.close(); server = undefined; });

describe("/chainpe-admin", () => {
  it("is 404 when no adminKey is configured", async () => {
    const base = await start(baseConfig());
    for (const path of ["stats", "payments", "config"]) {
      expect((await fetch(`${base}/chainpe-admin/${path}`)).status).toBe(404);
    }
    // a guessed header doesn't turn it on
    expect((await fetch(`${base}/chainpe-admin/stats`, { headers: { "x-admin-key": KEY } })).status).toBe(404);
  });

  it("accepts the key only via the x-admin-key header", async () => {
    const base = await start(baseConfig({ adminKey: KEY }));
    expect((await fetch(`${base}/chainpe-admin/stats`)).status).toBe(401);
    expect((await fetch(`${base}/chainpe-admin/stats?adminKey=${KEY}`)).status).toBe(401);
    expect((await fetch(`${base}/chainpe-admin/stats`, { headers: { "x-admin-key": "wrong" } })).status).toBe(401);
    expect((await fetch(`${base}/chainpe-admin/stats`, { headers: { "x-admin-key": KEY } })).status).toBe(200);
  });

  it("/config does not expose targetUrl", async () => {
    const base = await start(baseConfig({ adminKey: KEY }));
    const res = await fetch(`${base}/chainpe-admin/config`, { headers: { "x-admin-key": KEY } });
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("targetUrl");
  });
});

describe("local facilitator routes", () => {
  it("are not reachable without the per-process secret", async () => {
    const base = await start(baseConfig({ facilitatorUrl: undefined }), FAC_KEY);
    expect((await fetch(`${base}/chainpe-facilitator/supported`)).status).toBe(404);
    const res = await fetch(`${base}/chainpe-facilitator/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
    const guess = await fetch(`${base}/chainpe-facilitator/supported`, {
      headers: { "x-chainpe-facilitator-secret": "guess" },
    });
    expect(guess.status).toBe(404);
  });

  it("are not mounted at all without --facilitator", async () => {
    const base = await start(baseConfig());
    // falls through to the x402 gate/proxy instead of a facilitator
    const res = await fetch(`${base}/chainpe-facilitator/supported`);
    expect(res.status).not.toBe(200);
  });
});
