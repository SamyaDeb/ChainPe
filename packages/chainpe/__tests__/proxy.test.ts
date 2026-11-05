import http, { type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import type { SettleResponse } from "@x402/core/types";
import { createProxyServer } from "../src/proxy/server.js";
import { SettlementGuard, type CircleClient } from "../src/proxy/circleFacilitator.js";
import type { ChainPeConfig } from "../src/types.js";

const NETWORK = "eip155:5042002";
const TX = `0x${"ab".repeat(32)}`;
const seller = privateKeyToAccount(generatePrivateKey()).address;
const buyer = privateKeyToAccount(generatePrivateKey());

const settled: SettleResponse = { success: true, transaction: TX, network: NETWORK, payer: buyer.address };
const pending: SettleResponse = {
  success: false,
  errorReason: "settlement_pending",
  transaction: "",
  network: NETWORK,
  payer: buyer.address,
  extensions: { "settlement-status": { status: "pending", paymentId: "pay_1", statusUrl: "/status/pay_1" } },
};

const backendCalls: Array<{ url?: string; headers: IncomingHttpHeaders }> = [];
let backendStatus = 200;
let backend: Server;
let proxy: Server | undefined;

const listen = (server: Server) =>
  new Promise<number>((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));

beforeAll(async () => {
  backend = http.createServer((req, res) => {
    backendCalls.push({ url: req.url, headers: req.headers });
    res.writeHead(backendStatus, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await listen(backend);
});

afterAll(() => {
  backend.close();
});

afterEach(() => {
  proxy?.close();
  proxy = undefined;
  backendCalls.length = 0;
  backendStatus = 200;
});

async function startProxy(client: Partial<CircleClient>): Promise<string> {
  const config: ChainPeConfig = {
    serviceName: "test",
    serviceDescription: "test service",
    tags: [],
    targetUrl: `http://localhost:${(backend.address() as AddressInfo).port}`,
    pricePerRequest: "0.01",
    paymentToken: "USDC",
    walletAddress: seller,
    proxyPort: 0,
    network: "arc-testnet",
  };
  const facilitator = new SettlementGuard(
    {
      verify: vi.fn(),
      getSupported: async () => ({
        kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { name: "USDC", version: "2" } }],
        extensions: [],
        signers: {},
      }),
      ...client,
    } as unknown as CircleClient,
    { pollIntervalMs: 1, pollTimeoutMs: 50 }
  );
  proxy = http.createServer(createProxyServer({ config, facilitator }));
  return `http://localhost:${await listen(proxy)}`;
}

/** Records the PAYMENT-SIGNATURE header sent, so a test can replay it. */
function payingFetch() {
  const sent: string[] = [];
  const recording: typeof fetch = async (input, init) => {
    const signature = new Request(input, init).headers.get("payment-signature");
    if (signature) sent.push(signature);
    return fetch(input, init);
  };
  const pay = wrapFetchWithPaymentFromConfig(recording, {
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(buyer) }],
  });
  return { pay, sent };
}

describe("unpaid requests", () => {
  it("get a 402 with an Arc testnet exact option and never reach the backend", async () => {
    const url = await startProxy({});
    const res = await fetch(`${url}/weather`);
    expect(res.status).toBe(402);
    const required = decodePaymentRequiredHeader(res.headers.get("payment-required") as string);
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: NETWORK,
      amount: "10000",
      asset: "0x3600000000000000000000000000000000000000",
      payTo: seller,
      extra: { name: "USDC", version: "2", paymentFlow: "upfront" },
    });
    expect(backendCalls).toHaveLength(0);
  });
});

describe("free paths", () => {
  it("skip payment for discovery documents and OPTIONS", async () => {
    const url = await startProxy({});
    expect((await fetch(`${url}/.well-known/x402`)).status).toBe(200);
    expect((await fetch(`${url}/openapi.json`)).status).toBe(200);
    expect((await fetch(`${url}/weather`, { method: "OPTIONS" })).status).toBeLessThan(300);
    expect((await fetch(`${url}/chainpe-admin/stats`)).status).toBe(200);
  });

  it("do not let a path trick its way past the gate", async () => {
    const url = await startProxy({});
    expect((await fetch(`${url}/openapi.json/../weather`)).status).toBe(402);
    expect((await rawGet(url, "/.well-known/x402/../../weather")).status).toBe(402);
    expect((await rawGet(url, "/chainpe-admin/../weather")).status).toBe(404);
    expect(backendCalls.filter((c) => c.url?.includes("weather"))).toHaveLength(0);
  });
});

/** fetch() normalises paths, so sends the raw path. */
function rawGet(url: string, path: string): Promise<{ status: number }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    http
      .get({ hostname, port, path }, (res) => {
        res.resume();
        resolve({ status: res.statusCode as number });
      })
      .on("error", reject);
  });
}

describe("paid requests", () => {
  it("settle before forwarding and return the receipt", async () => {
    const order: string[] = [];
    const url = await startProxy({
      settle: vi.fn(async () => {
        order.push(`settle:${backendCalls.length}`);
        return settled;
      }),
    });
    const res = await payingFetch().pay(`${url}/weather?city=Mumbai`);
    expect(res.status).toBe(200);
    expect(order).toEqual(["settle:0"]);
    expect(backendCalls).toHaveLength(1);
    expect(decodePaymentResponseHeader(res.headers.get("payment-response") as string)).toMatchObject({
      success: true,
      transaction: TX,
    });
  });

  it("do not pass payment headers to the backend", async () => {
    const url = await startProxy({ settle: vi.fn().mockResolvedValue(settled) });
    await payingFetch().pay(`${url}/weather`);
    expect(backendCalls[0].headers).not.toHaveProperty("payment-signature");
    expect(backendCalls[0].headers).not.toHaveProperty("x-payment");
  });

  it("forward once when a pending settlement completes", async () => {
    const url = await startProxy({
      settle: vi.fn().mockResolvedValue(pending),
      getStatus: vi.fn().mockResolvedValue({ status: "completed", transaction: TX, payer: buyer.address, amount: "10000" }),
    });
    const res = await payingFetch().pay(`${url}/weather`);
    expect(res.status).toBe(200);
    expect(backendCalls).toHaveLength(1);
  });

  it("never reach the backend when pending turns into failed", async () => {
    const url = await startProxy({
      settle: vi.fn().mockResolvedValue(pending),
      getStatus: vi
        .fn()
        .mockResolvedValueOnce({ status: "pending" })
        .mockResolvedValue({ status: "failed", reason: "insufficient_funds", transaction: null, payer: null }),
    });
    const res = await payingFetch().pay(`${url}/weather`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "payment_failed", reason: "insufficient_funds" });
    expect(backendCalls).toHaveLength(0);
  });

  it("never reach the backend while settlement stays pending", async () => {
    const url = await startProxy({
      settle: vi.fn().mockResolvedValue(pending),
      getStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    });
    const res = await payingFetch().pay(`${url}/weather`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "settlement_pending", paymentId: "pay_1" });
    expect(backendCalls).toHaveLength(0);
  });

  it("never reach the backend when Circle is unreachable", async () => {
    const url = await startProxy({ settle: vi.fn().mockRejectedValue(new Error("ECONNRESET")) });
    const res = await payingFetch().pay(`${url}/weather`);
    expect(res.status).toBe(402);
    expect(backendCalls).toHaveLength(0);
  });

  it("cannot be replayed for a second backend call", async () => {
    const settle = vi.fn().mockResolvedValue(settled);
    const url = await startProxy({ settle });
    const { pay, sent } = payingFetch();
    expect((await pay(`${url}/weather`)).status).toBe(200);

    const replay = await fetch(`${url}/weather`, { headers: { "payment-signature": sent[0] } });
    expect(replay.status).toBe(402);
    expect(await replay.json()).toMatchObject({ reason: "payment_already_used" });
    expect(backendCalls).toHaveLength(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("keep the receipt when the backend fails after settlement", async () => {
    backendStatus = 500;
    const url = await startProxy({ settle: vi.fn().mockResolvedValue(settled) });
    const res = await payingFetch().pay(`${url}/weather`);
    expect(res.status).toBe(500);
    expect(decodePaymentResponseHeader(res.headers.get("payment-response") as string).transaction).toBe(TX);
  });
});
