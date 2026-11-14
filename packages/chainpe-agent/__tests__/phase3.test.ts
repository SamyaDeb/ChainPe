/** Phase 3 in the agent: spend gate before signing, payment proof on ratings, cheapest-eligible planner. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const giveFeedbackFn = vi.fn(async (..._a: unknown[]) => "0xfeedbacktx");
vi.mock("../src/reputation.ts", async (orig) => ({
  ...(await orig<typeof import("../src/reputation.ts")>()),
  giveFeedback: (...a: unknown[]) => giveFeedbackFn(...a),
  getReputation: vi.fn(async () => ({ count: 9, score: 99, source: "unverified" })),
}));

const localRegistry = vi.hoisted(() => ({ json: "" }));
vi.mock("fs/promises", async (orig) => {
  const actual = await orig<typeof import("fs/promises")>();
  const readFile = async (p: unknown, ...rest: unknown[]) => {
    if (String(p).endsWith("registry.json") && localRegistry.json) return localRegistry.json;
    if (String(p).includes(".chainpe")) throw new Error("ENOENT");
    return (actual.readFile as (...a: unknown[]) => unknown)(p, ...rest);
  };
  return { ...actual, readFile, default: { ...actual, readFile } };
});

import { PaymentClient } from "../src/payment.ts";
import { CloudClient, ReputationTooLow, enforceMinimum, type CloudService } from "../src/cloud.ts";
import { planCheapestEligible } from "../src/planner.ts";
import { createCallPaidApiTool } from "../src/tools/callPaidApi.ts";
import { createDiscoverServiceTool } from "../src/tools/discoverService.ts";
import { readSafetyEnv } from "../src/config.ts";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const WEATHER = "0x1111111111111111111111111111111111111111";
const CHEAP = "0x2222222222222222222222222222222222222222";
const TX = `0x${"ef".repeat(32)}`;

const cloudSvc = (name: string, payTo: string, paidScore: number | null, paidReviews: number, price = "0.01", extra: Partial<CloudService> = {}): CloudService => ({
  key: "0x1", name, endpoint: `https://${name}.example.com`, price, payTo, agentId: "1", paidScore, paidReviews,
  rawScore: 96, rawReviews: 30, totalSettledAtomic: "0", paidCalls: 0, payToShared: false, ...extra,
});

const reg = (name: string, payTo: string, price: string, agentId?: string) => ({
  id: name, name, description: `${name} api`, tags: [], endpoint: `https://${name}.example.com`, pricePerRequest: price,
  paymentToken: "USDC" as const, walletAddress: payTo, network: "avalanche" as const, agentId,
});

const settle = Buffer.from(JSON.stringify({ success: true, transaction: TX, network: "avalanche", payer: "0xP" })).toString("base64");

/** x402 server for `payTo`, plus chainpe-cloud serving `services` (or being down). */
function stub(payTo: string, services: CloudService[] | "down") {
  const log: { url: string; paid: boolean }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/public/services")) {
        if (services === "down") throw new Error("ECONNREFUSED");
        return new Response(JSON.stringify({ services }), { status: 200 });
      }
      const paid = new Headers(init?.headers).has("X-PAYMENT");
      log.push({ url, paid });
      if (!paid) {
        return new Response(
          JSON.stringify({ x402Version: 1, accepts: [{ scheme: "exact", network: "avalanche", maxAmountRequired: "10000", resource: url, description: "t", mimeType: "application/json", payTo, maxTimeoutSeconds: 60, asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", extra: { name: "USD Coin", version: "2" } }] }),
          { status: 402, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json", "X-PAYMENT-RESPONSE": settle } });
    })
  );
  return log;
}

const gateFor = (min: number, reviews = 3) => {
  const cloud = new CloudClient();
  return (payTo: string, url: string) => enforceMinimum(cloud, payTo, url, min, reviews);
};

beforeEach(() => giveFeedbackFn.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("PaymentClient spend gate", () => {
  it("refuses a low verified score before anything is signed: no retry with X-PAYMENT is ever sent", async () => {
    const log = stub(CHEAP, [cloudSvc("cheap", CHEAP, 20, 5)]);
    const client = new PaymentClient({ privateKey: KEY, network: "avalanche", gate: gateFor(60) });
    const err = await client.fetch("https://cheap.example.com/x").catch((e) => e);
    expect(err).toBeInstanceOf(ReputationTooLow);
    expect(err).toMatchObject({ reason: "below_minimum", paidScore: 20, paidReviews: 5, payTo: CHEAP });
    expect(log).toEqual([{ url: "https://cheap.example.com/x", paid: false }]);
    expect(client.getReceipts()).toHaveLength(0);
  });

  it("pays a provider that meets the minimum and returns the settlement tx", async () => {
    stub(WEATHER, [cloudSvc("weather", WEATHER, 90, 6)]);
    const res = await new PaymentClient({ privateKey: KEY, network: "avalanche", gate: gateFor(60) }).fetch("https://weather.example.com/x");
    expect(res.paid).toBe(true);
    expect(res.paymentReceipt?.txId).toBe(TX);
  });

  it("fails closed when chainpe-cloud is unreachable", async () => {
    const log = stub(WEATHER, "down");
    const err = await new PaymentClient({ privateKey: KEY, network: "avalanche", gate: gateFor(60) }).fetch("https://weather.example.com/x").catch((e) => e);
    expect(err).toMatchObject({ name: "ReputationTooLow", reason: "unavailable" });
    expect(log.every((l) => !l.paid)).toBe(true);
  });

  it("has no gate by default", async () => {
    stub(WEATHER, "down");
    expect((await new PaymentClient({ privateKey: KEY, network: "avalanche" }).fetch("https://weather.example.com/x")).paid).toBe(true);
  });
});

describe("enforceMinimum", () => {
  it("covers every refusal reason and is a no-op at 0", async () => {
    stub(WEATHER, [cloudSvc("weather", WEATHER, 70, 5), cloudSvc("few", CHEAP, 99, 1)]);
    const cloud = new CloudClient();
    await expect(enforceMinimum(cloud, WEATHER, "u", 0, 3)).resolves.toBeUndefined();
    await expect(enforceMinimum(cloud, WEATHER, "u", 60, 3)).resolves.toBeUndefined();
    await expect(enforceMinimum(cloud, WEATHER, "u", 80, 3)).rejects.toMatchObject({ reason: "below_minimum" });
    await expect(enforceMinimum(cloud, CHEAP, "u", 60, 3)).rejects.toMatchObject({ reason: "not_enough_reviews" });
    await expect(enforceMinimum(cloud, "0x3333333333333333333333333333333333333333", "u", 60, 3)).rejects.toMatchObject({ reason: "unknown_service" });
  });
});

describe("planner: cheapest service at or above the minimum", () => {
  const c = (name: string, price: string, paidScore: number | null, reviews: number) => ({ name, price, payTo: name, paid: cloudSvc(name, name, paidScore, reviews, price) });

  it("recommends the cheapest eligible, not the cheapest overall or the best rated", () => {
    const plan = planCheapestEligible([c("junk", "0.001", 20, 9), c("good", "0.01", 85, 9), c("premium", "0.05", 99, 9), c("ok", "0.02", 70, 9)], 60, 3);
    expect(plan.recommended?.name).toBe("good");
    expect(plan.eligible.map((x) => x.name)).toEqual(["good", "ok", "premium"]);
    expect(plan.refused.map((r) => [r.service.name, r.reason])).toEqual([["junk", "below_minimum"]]);
  });

  it("refuses unrated and thinly rated services, and recommends nothing when none qualify", () => {
    const plan = planCheapestEligible([c("new", "0.001", null, 0), c("thin", "0.002", 100, 2)], 60, 3);
    expect(plan.recommended).toBeUndefined();
    expect(plan.refused.map((r) => r.reason)).toEqual(["not_enough_reviews", "not_enough_reviews"]);
  });

  it("ties on price go to the higher score", () => {
    expect(planCheapestEligible([c("a", "0.01", 70, 5), c("b", "0.01", 90, 5)], 60, 3).recommended?.name).toBe("b");
  });

  it("with no minimum, everything is eligible and the cheapest wins", () => {
    const plan = planCheapestEligible([c("junk", "0.001", 5, 9), c("good", "0.01", 90, 9)], 0, 3);
    expect(plan.refused).toEqual([]);
    expect(plan.recommended?.name).toBe("junk");
  });
});

describe("discoverService with a minimum", () => {
  const registryClient = { listAllServices: async () => [reg("weather", WEATHER, "0.01", "7"), reg("cheap", CHEAP, "0.001", "8")] } as never;
  const run = (opts: Record<string, unknown>) =>
    (createDiscoverServiceTool({ registryClient, network: "avalanche", ...opts }) as unknown as { execute: (a: object, o: object) => Promise<Record<string, unknown>> }).execute({}, {});

  it("recommends weather, lists cheap-weather as refused, and shows verified score next to the unverified average", async () => {
    stub(WEATHER, [cloudSvc("weather", WEATHER, 91, 6), cloudSvc("cheap", CHEAP, 12, 4, "0.001", { rawScore: 98, rawReviews: 40 })]);
    const out = await run({ minReputation: 60 });
    expect(out.recommended).toBe("weather");
    expect((out.services as { name: string }[]).map((s) => s.name)).toEqual(["weather"]);
    const refused = (out.refused as { name: string; refusedBecause: string; reputation: Record<string, unknown> }[])[0];
    expect(refused).toMatchObject({ name: "cheap", refusedBecause: "below_minimum" });
    expect(refused.reputation).toMatchObject({ score: 12, paidReviews: 4, unverifiedAverage: 98, unverifiedRatings: 40 });
  });

  it("without a minimum lists everything with its verified score", async () => {
    stub(WEATHER, [cloudSvc("weather", WEATHER, 91, 6)]);
    const out = await run({});
    expect((out.services as unknown[]).length).toBe(2);
    expect(out.refused).toBeUndefined();
  });

  it("labels the on-chain fallback unverified when chainpe-cloud is down", async () => {
    stub(WEATHER, "down");
    const out = await run({});
    const rep = (out.services as { reputation: Record<string, unknown> }[])[0].reputation;
    expect(rep).toMatchObject({ verified: false });
    expect(String(rep.warning)).toMatch(/UNVERIFIED/);
  });
});

describe("callPaidApi: rating carries payment proof", () => {
  const svc = reg("weather", WEATHER, "0.01", "7");
  const receipt = { txId: TX, amount: "0.01", token: "USDC", recipient: WEATHER, timestamp: new Date(), service: "weather", path: "/" };
  const tool = (over: Record<string, unknown> = {}) =>
    createCallPaidApiTool({
      paymentClient: { callService: vi.fn(async () => ({ status: 200, data: { ok: 1 }, paid: true, paymentReceipt: receipt })) } as never,
      registryClient: { listAllServices: async () => [svc], findByName: async () => svc } as never,
      privateKey: KEY,
      network: "avalanche",
      ...over,
    }) as unknown as { execute: (a: object, o: object) => Promise<Record<string, unknown>> };

  beforeEach(async () => {
    const mod = await import("../src/tools/callPaidApi.ts");
    mod.resetPaidCallCache();
    localRegistry.json = JSON.stringify({ version: "1", services: [{ ...svc, agentId: "999" }] }); // a stale or hostile local file
  });
  afterEach(() => {
    localRegistry.json = "";
  });

  it("attaches the settlement tx as feedbackHash and uses the agent from the registry for the payTo that was paid", async () => {
    const out = await tool().execute({ serviceName: "weather", path: "/", method: "GET" }, {});
    expect(out.success).toBe(true);
    expect(giveFeedbackFn).toHaveBeenCalledTimes(1);
    const [, , agentId, , opts] = giveFeedbackFn.mock.calls[0] as [string, string, string, number, Record<string, unknown>];
    expect(agentId).toBe("7");
    expect(opts).toMatchObject({ paymentTx: TX, tag: "x402-success", endpoint: "https://weather.example.com" });
    expect(out.reputation).toMatchObject({ agentId: "7", paymentTx: TX });
  });

  it("does not use a local registry file's agentId: only the on-chain registry for the recipient counts", async () => {
    const onchain = reg("weather", WEATHER, "0.01", "7");
    await tool({ registryClient: { listAllServices: async () => [onchain], findByName: async () => svc } as never }).execute({ serviceName: "weather", path: "/x", method: "GET" }, {});
    expect(giveFeedbackFn.mock.calls.every((c) => c[2] === "7")).toBe(true);
  });

  it("posts no rating when there is no settlement tx", async () => {
    const t = tool({ paymentClient: { callService: vi.fn(async () => ({ status: 200, data: {}, paid: true, paymentReceipt: { ...receipt, txId: undefined } })) } as never });
    await t.execute({ serviceName: "weather", path: "/y", method: "GET" }, {});
    expect(giveFeedbackFn).not.toHaveBeenCalled();
  });

  it("tells the model plainly when a payment was refused, so it does not retry", async () => {
    const refused = new ReputationTooLow("below_minimum", WEATHER, "https://weather.example.com/z", 20, 5, 60, 3);
    const t = tool({ paymentClient: { callService: vi.fn(async () => { throw refused; }) } as never });
    const out = await t.execute({ serviceName: "weather", path: "/z", method: "GET" }, {});
    expect(out).toMatchObject({ success: false, refused: true, reason: "below_minimum" });
    expect(String(out.error)).toMatch(/^REFUSED: .*Nothing was signed/);
    expect(giveFeedbackFn).not.toHaveBeenCalled();
  });
});

describe("giveFeedback paymentTx and safety env", () => {
  it("rejects a malformed payment tx before touching the network", async () => {
    const { giveFeedback: realGiveFeedback } = await vi.importActual<typeof import("../src/reputation.ts")>("../src/reputation.ts");
    await expect(realGiveFeedback(KEY, "avalanche", "1", 90, { paymentTx: "0x12" })).rejects.toThrow(/32-byte/);
  });
  it("MIN_REPUTATION: reads, treats blank as unset, and rejects a typo", () => {
    expect(readSafetyEnv({ MIN_REPUTATION: "60" } as never).minReputation).toBe(60);
    expect(readSafetyEnv({ MIN_REPUTATION: "" } as never).minReputation).toBeUndefined();
    expect(() => readSafetyEnv({ MIN_REPUTATION: "sixty" } as never)).toThrow(/MIN_REPUTATION/);
    expect(() => readSafetyEnv({ MIN_REPUTATION: "101" } as never)).toThrow(/MIN_REPUTATION/);
    expect(readSafetyEnv({ CHAINPE_CLOUD_URL: "off" } as never).cloudUrl).toBe(false);
  });
});
