import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "node:http";

// Module reads these at import time — set before the dynamic import below.
process.env.NODE_ENV = "test";
process.env.NETWORK = "fuji";
// Public Hardhat test key (not a real secret) — only to derive the address.
process.env.FACILITATOR_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.REGISTRY_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

let server: Server;
let base: string;

beforeAll(async () => {
  const { createApp } = await import("../src/server.ts");
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

describe("facilitator HTTP contract", () => {
  it("GET /health is a cheap liveness check", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.custodial).toBe(false);
    expect(body.facilitator.toLowerCase()).toBe(ADDR.toLowerCase());
  });

  it("GET /supported advertises exact/avalanche-fuji", async () => {
    const res = await fetch(`${base}/supported`);
    const body = await res.json();
    expect(body.kinds).toEqual([
      { x402Version: 1, scheme: "exact", network: "avalanche-fuji" },
    ]);
  });

  it("GET / lists the endpoints", async () => {
    const res = await fetch(`${base}/`);
    const body = await res.json();
    expect(body.service).toBe("chainpe-facilitator");
    expect(body.endpoints).toContain("/settle");
  });

  it("POST /verify rejects a malformed payload with a 400", async () => {
    const res = await fetch(`${base}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: {}, paymentRequirements: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(String(body.invalidReason)).toBe("verify_failed");
  });
});

// ─── Payment guards ─────────────────────────────────────────────────────────

const USDC_FUJI = "0x5425890298aed601595a70AB815c96711a31Bc65";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const NONCE = "0x" + "ab".repeat(32);

function requirements(over: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: "avalanche-fuji",
    maxAmountRequired: "10000",
    resource: "https://example.com/api",
    description: "test",
    mimeType: "application/json",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    asset: USDC_FUJI,
    extra: { name: "USD Coin", version: "2" },
    ...over,
  };
}

function payload(over: { to?: string; nonce?: string; network?: string; scheme?: string } = {}) {
  return {
    x402Version: 1,
    scheme: over.scheme ?? "exact",
    network: over.network ?? "avalanche-fuji",
    payload: {
      signature: "0x" + "11".repeat(65),
      authorization: {
        from: PAYER,
        to: over.to ?? PAY_TO,
        value: "10000",
        validAfter: "0",
        validBefore: "99999999999",
        nonce: over.nonce ?? NONCE,
      },
    },
  };
}

describe("facilitator payment guards", () => {
  let gbase: string;
  let gserver: Server;
  let nonceUsed = false;
  let registered = [PAY_TO];
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === "getServiceCount") return BigInt(registered.length);
    if (functionName === "getServices") return registered.map((payTo) => ({ payTo, exists: true }));
    if (functionName === "authorizationState") return nonceUsed;
    throw new Error("unexpected " + functionName);
  });
  const verify = vi.fn(async () => ({ isValid: true, payer: PAYER }));
  let releaseSettle: (() => void) | null = null;
  const settle = vi.fn(async () => ({ success: true, transaction: "0xabc", network: "avalanche-fuji", payer: PAYER }));

  beforeAll(async () => {
    const { createApp } = await import("../src/server.ts");
    const app = createApp({
      publicClient: { readContract } as never,
      walletClient: {} as never,
      verify: verify as never,
      settle: settle as never,
    });
    await new Promise<void>((resolve) => {
      gserver = app.listen(0, () => {
        const a = gserver.address();
        gbase = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
        resolve();
      });
    });
  });
  afterAll(() => gserver?.close());

  const post = (path: string, paymentPayload: unknown, paymentRequirements: unknown) =>
    fetch(`${gbase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });

  it("a valid payment reaches settle()", async () => {
    const res = await post("/settle", payload({ nonce: "0x" + "01".repeat(32) }), requirements());
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("a valid payment passes /verify", async () => {
    const res = await post("/verify", payload({ nonce: "0x" + "02".repeat(32) }), requirements());
    expect(res.status).toBe(200);
    expect((await res.json()).isValid).toBe(true);
  });

  const rejects: [string, () => [unknown, unknown]][] = [
    ["wrong asset", () => [payload(), requirements({ asset: "0x3333333333333333333333333333333333333333" })]],
    ["wrong network", () => [payload({ network: "avalanche" }), requirements({ network: "avalanche" })]],
    ["wrong scheme", () => [payload(), requirements({ scheme: "upto" })]],
    ["wrong EIP-712 domain", () => [payload(), requirements({ extra: { name: "Evil", version: "1" } })]],
    ["amount below minimum", () => [payload(), requirements({ maxAmountRequired: "999" })]],
    ["authorization.to != payTo", () => [payload({ to: "0x4444444444444444444444444444444444444444" }), requirements()]],
    ["unregistered payTo", () => {
      const other = "0x5555555555555555555555555555555555555555";
      return [payload({ to: other }), requirements({ payTo: other })];
    }],
  ];

  for (const path of ["/settle", "/verify"]) {
    for (const [name, build] of rejects) {
      it(`${path} rejects: ${name}`, async () => {
        const before = settle.mock.calls.length;
        const [p, r] = build();
        const res = await post(path, p, r);
        expect(res.status).toBe(400);
        const body = await res.json();
        // x402's zod schema already refuses a non-"exact" scheme (generic failure);
        // everything else is caught by our guard.
        const reason = body.invalidReason ?? body.errorReason;
        expect(name === "wrong scheme" ? ["verify_failed", "settle_failed"] : ["unsupported_requirements"]).toContain(reason);
        expect(settle.mock.calls.length).toBe(before);
      });
    }
  }

  it("rejects a nonce already used on-chain (settle and verify)", async () => {
    nonceUsed = true;
    const n = payload({ nonce: "0x" + "03".repeat(32) });
    const before = settle.mock.calls.length;
    const s = await post("/settle", n, requirements());
    expect(s.status).toBe(400);
    expect((await s.json()).errorReason).toBe("nonce_used");
    const v = await post("/verify", n, requirements());
    expect(v.status).toBe(400);
    expect((await v.json()).invalidReason).toBe("nonce_used");
    expect(settle.mock.calls.length).toBe(before);
    nonceUsed = false;
  });

  it("rejects replay of a nonce that already settled", async () => {
    const n = payload({ nonce: "0x" + "04".repeat(32) });
    expect((await post("/settle", n, requirements())).status).toBe(200);
    const again = await post("/settle", n, requirements());
    expect(again.status).toBe(400);
    expect((await again.json()).errorReason).toBe("nonce_used");
  });

  it("concurrent duplicate settle: one settles, the other gets 409", async () => {
    const gate = new Promise<void>((r) => { releaseSettle = r; });
    settle.mockImplementationOnce(async () => {
      await gate;
      return { success: true, transaction: "0xdef", network: "avalanche-fuji", payer: PAYER };
    });
    const n = payload({ nonce: "0x" + "05".repeat(32) });
    const first = post("/settle", n, requirements());
    await vi.waitFor(() => expect(settle.mock.calls.length).toBeGreaterThan(0));
    // wait until the first request is actually inside settle()
    await new Promise((r) => setTimeout(r, 50));
    const second = await post("/settle", n, requirements());
    expect(second.status).toBe(409);
    expect((await second.json()).errorReason).toBe("settle_in_progress");
    releaseSettle!();
    expect((await first).status).toBe(200);
  });
});
