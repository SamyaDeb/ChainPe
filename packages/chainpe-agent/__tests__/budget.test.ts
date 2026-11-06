import { afterEach, describe, expect, it, vi } from "vitest";
import { createCallPaidApiTool, RunBudget } from "../src/tools/callPaidApi.js";
import { fromAtomic, toAtomic } from "../src/tools/callPaidApi.js";

// Well-known Hardhat test account #0 (public, not a real secret).
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PAY_TO = "0x261f058496D81703c858DDFEd201834F0b5f2e73";
const NETWORK = "eip155:5042002";
const URL_PAID = "https://api.example.com/forecast?city=Pune";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

function required(amount: string) {
  return new Response("{}", {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": encode({
        x402Version: 2,
        error: "Payment required",
        resource: { url: URL_PAID, description: "t", mimeType: "" },
        accepts: [{ scheme: "exact", network: NETWORK, amount, asset: "0x3600000000000000000000000000000000000000", payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2", paymentFlow: "upfront" } }],
      }),
    },
  });
}

function paid() {
  return new Response(JSON.stringify({ forecast: "sunny" }), {
    status: 200,
    headers: { "content-type": "application/json", "PAYMENT-RESPONSE": encode({ success: true, transaction: `0x${"ab".repeat(32)}`, network: NETWORK, payer: PAY_TO }) },
  });
}

/** Answers 402 then 200 for each call, and counts signed requests. */
function stub(amount: string) {
  let signed = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const has = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).has("PAYMENT-SIGNATURE");
    if (has) signed++;
    return has ? paid() : required(amount);
  }));
  return () => signed;
}

const run = (tool: ReturnType<typeof createCallPaidApiTool>, input: object) =>
  (tool.execute as (input: object, options: object) => Promise<Record<string, unknown>>)(input, { toolCallId: "1", messages: [] });

afterEach(() => vi.unstubAllGlobals());

describe("USDC amounts", () => {
  it("convert both ways without float errors", () => {
    expect(toAtomic("0.1")).toBe(100000n);
    expect(toAtomic("1")).toBe(1000000n);
    expect(fromAtomic(10000n)).toBe("0.01");
    expect(fromAtomic(1000000n)).toBe("1");
  });
});

describe("RunBudget", () => {
  it("caps a call at the per-call limit, then at what is left of the task", () => {
    const budget = new RunBudget("0.10", "0.15");
    expect(budget.cap()).toBe("0.1");
    budget.record({ amount: "0.1", token: "USDC", rail: "exact", recipient: PAY_TO, timestamp: new Date(), service: "x", path: "/" });
    expect(budget.cap()).toBe("0.05");
    budget.record({ amount: "0.05", token: "USDC", rail: "exact", recipient: PAY_TO, timestamp: new Date(), service: "x", path: "/" });
    expect(budget.cap()).toBeUndefined();
    expect(budget.spent()).toBe("0.15");
  });
});

describe("callPaidApi", () => {
  it("pays, records the receipt, and never pays twice for the same call", async () => {
    const signed = stub("10000");
    const budget = new RunBudget("0.10", "1");
    const onPayment = vi.fn();
    const tool = createCallPaidApiTool({ privateKey: KEY, network: "arc-testnet", rails: ["exact"], budget, onPayment });
    const first = await run(tool, { url: URL_PAID, method: "GET" });
    expect(first).toMatchObject({ success: true, paid: true, data: { forecast: "sunny" } });
    const again = await run(tool, { url: URL_PAID, method: "GET" });
    expect(again.note).toMatch(/not paid again/);
    expect(signed()).toBe(1);
    expect(onPayment).toHaveBeenCalledTimes(1);
    expect(budget.receipts[0]).toMatchObject({ amount: "0.01", rail: "exact", service: "https://api.example.com", path: "/forecast?city=Pune" });
  });

  it("refuses a price above what the task has left, before signing", async () => {
    const signed = stub("200000");
    const tool = createCallPaidApiTool({ privateKey: KEY, network: "arc-testnet", rails: ["exact"], budget: new RunBudget("1", "0.15") });
    const result = await run(tool, { url: URL_PAID, method: "GET" });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/exceeds maxPerCall/);
    expect(signed()).toBe(0);
  });

  it("stops once the task's budget is used up, without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const budget = new RunBudget("0.10", "0.01");
    budget.record({ amount: "0.01", token: "USDC", rail: "exact", recipient: PAY_TO, timestamp: new Date(), service: "x", path: "/" });
    const tool = createCallPaidApiTool({ privateKey: KEY, network: "arc-testnet", budget });
    expect(String((await run(tool, { url: URL_PAID, method: "GET" })).error)).toMatch(/budget is used up/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
