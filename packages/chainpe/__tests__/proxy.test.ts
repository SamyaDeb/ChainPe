import http, { type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import type { FacilitatorClient } from "@x402/core/server";
import type { SettleResponse } from "@x402/core/types";
import { BatchEvmScheme, CompositeEvmScheme } from "@circle-fin/x402-batching/client";
import { analytics, createProxyServer, isLocalRequest } from "../src/proxy/server.js";
import { SettlementGuard, type CircleClient } from "../src/proxy/circleFacilitator.js";
import { GatewayGuard, type GatewayTerms, type TransferLookup } from "../src/proxy/gateway.js";
import { RailRouter } from "../src/proxy/railRouter.js";
import { railPolicy, spendControlsFor, type RailChoice } from "../src/commands/consume.js";
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

const TERMS: GatewayTerms = {
  name: "GatewayWalletBatched",
  version: "1",
  verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9",
};
const TRANSFER_ID = "0eecd4bf-15f4-4bea-8eab-284e7385fb4f";
const accepted: SettleResponse = { success: true, transaction: TRANSFER_ID, network: NETWORK, payer: buyer.address };

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
  analytics.reset();
});

async function startProxy(
  client: Partial<CircleClient>,
  overrides: Partial<ChainPeConfig> = {},
  gatewayClient: Partial<FacilitatorClient> = {},
  lookup: TransferLookup = async () => []
): Promise<string> {
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
    ...overrides,
  };
  const exact = new SettlementGuard(
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
  const gateway = new GatewayGuard(
    {
      verify: vi.fn(),
      getSupported: async () => ({
        kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: TERMS }],
        extensions: [],
        signers: {},
      }),
      ...gatewayClient,
    } as unknown as FacilitatorClient,
    lookup,
    { settleTimeoutMs: 50 }
  );
  const facilitator = new RailRouter({ exact, gateway });
  proxy = http.createServer(createProxyServer({ config, facilitator, gateway: TERMS }));
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

/** Pays like `chainpe fetch`: both schemes, with a rail policy. */
function railFetch(rail: RailChoice, gatewayAvailable = 0n, max = "1") {
  const sent: string[] = [];
  const recording: typeof fetch = async (input, init) => {
    const signature = new Request(input, init).headers.get("payment-signature");
    if (signature) sent.push(signature);
    return fetch(input, init);
  };
  const client = new CompositeEvmScheme(new BatchEvmScheme(buyer), new ExactEvmScheme(buyer));
  const pay = wrapFetchWithPaymentFromConfig(recording, {
    schemes: [{ network: NETWORK, client: client as unknown as ExactEvmScheme }],
    spendControls: spendControlsFor("arc-testnet", max),
    policies: [railPolicy(rail, gatewayAvailable)],
  });
  return { pay, sent };
}

const ROUTES: ChainPeConfig["routes"] = [{ path: "GET /cheap", pricePerRequest: "0.001", paymentToken: "USDC" }];

async function acceptsOf(url: string) {
  const res = await fetch(url);
  expect(res.status).toBe(402);
  return decodePaymentRequiredHeader(res.headers.get("payment-required") as string).accepts;
}

describe("the 402 for each rail", () => {
  it("lists exact then Gateway on a $0.01 route, with the same price and payTo", async () => {
    const url = await startProxy({});
    const accepts = await acceptsOf(`${url}/weather`);
    expect(accepts).toHaveLength(2);
    expect(accepts[0]).toMatchObject({ scheme: "exact", network: NETWORK, amount: "10000", payTo: seller, maxTimeoutSeconds: 300 });
    expect(accepts[0].extra).toEqual({ name: "USDC", version: "2", paymentFlow: "upfront" });
    expect(accepts[1]).toMatchObject({ scheme: "exact", network: NETWORK, amount: "10000", payTo: seller, maxTimeoutSeconds: 604900 });
    expect(accepts[1].extra).toEqual({ ...TERMS, paymentFlow: "upfront" });
  });

  it("lists only Gateway on a $0.001 route", async () => {
    const url = await startProxy({}, { routes: ROUTES });
    const accepts = await acceptsOf(`${url}/cheap`);
    expect(accepts).toHaveLength(1);
    expect(accepts[0]).toMatchObject({ amount: "1000", extra: { name: "GatewayWalletBatched" } });
  });

  it("lists one option with rails [exact]", async () => {
    const url = await startProxy({}, { rails: ["exact"] });
    const accepts = await acceptsOf(`${url}/weather`);
    expect(accepts).toHaveLength(1);
    expect(accepts[0].extra.name).toBe("USDC");
  });

  it("lists one option with rails [gateway]", async () => {
    const url = await startProxy({}, { rails: ["gateway"] });
    const accepts = await acceptsOf(`${url}/weather`);
    expect(accepts).toHaveLength(1);
    expect(accepts[0].extra.name).toBe("GatewayWalletBatched");
  });
});

describe("--max", () => {
  it.each(["gateway", "exact"] as const)("stops a %s payment over the cap before it is signed", async (rail) => {
    const settle = vi.fn();
    const url = await startProxy({ settle }, {}, { settle });
    const { pay, sent } = railFetch(rail, 0n, "0.009");
    await expect(pay(`${url}/weather`)).rejects.toThrow(/maxAmountPerPayment/);
    expect(sent).toHaveLength(0);
    expect(settle).not.toHaveBeenCalled();
    expect(backendCalls).toHaveLength(0);
  });

  it("allows a payment of exactly the cap", async () => {
    const url = await startProxy({}, {}, { settle: vi.fn().mockResolvedValue(accepted) });
    expect((await railFetch("gateway", 0n, "0.01").pay(`${url}/weather`)).status).toBe(200);
  });
});

describe("Gateway payments", () => {
  it("settle through Gateway before forwarding, and never touch Circle's facilitator", async () => {
    const order: string[] = [];
    const circleSettle = vi.fn();
    const settle = vi.fn(async () => {
      order.push(`settle:${backendCalls.length}`);
      return accepted;
    });
    const url = await startProxy({ settle: circleSettle }, { routes: ROUTES }, { settle });

    const res = await railFetch("gateway").pay(`${url}/cheap`);
    expect(res.status).toBe(200);
    expect(order).toEqual(["settle:0"]);
    expect(backendCalls).toHaveLength(1);
    expect(circleSettle).not.toHaveBeenCalled();
    expect(decodePaymentResponseHeader(res.headers.get("payment-response") as string)).toMatchObject({
      success: true,
      transaction: TRANSFER_ID,
    });
  });

  it("do not pass payment headers to the backend", async () => {
    const url = await startProxy({}, {}, { settle: vi.fn().mockResolvedValue(accepted) });
    await railFetch("gateway").pay(`${url}/weather`);
    expect(backendCalls[0].headers).not.toHaveProperty("payment-signature");
  });

  it("are recorded as the gateway rail, with the transfer id and no tx hash", async () => {
    const url = await startProxy({}, {}, { settle: vi.fn().mockResolvedValue(accepted) });
    await railFetch("gateway").pay(`${url}/weather`);
    await vi.waitFor(() => expect(analytics.getRecentPayments()).toHaveLength(1));

    const stats = await (await fetch(`${url}/chainpe-admin/stats`)).json();
    expect(stats.revenue.byRail).toEqual({ exact: "0", gateway: "0.01" });
    expect(stats.recentPayments[0]).toMatchObject({ rail: "gateway", paymentId: TRANSFER_ID, status: "completed" });
    expect(stats.recentPayments[0]).not.toHaveProperty("txHash");
  });

  it("split revenue by rail when both are used", async () => {
    const url = await startProxy(
      { settle: vi.fn().mockResolvedValue(settled) },
      {},
      { settle: vi.fn().mockResolvedValue(accepted) }
    );
    await railFetch("gateway").pay(`${url}/weather`);
    await railFetch("exact").pay(`${url}/weather`);
    await vi.waitFor(() => expect(analytics.getRecentPayments()).toHaveLength(2));
    expect(analytics.getRevenueSummary().byRail).toEqual({ exact: "0.01", gateway: "0.01" });
    expect(backendCalls).toHaveLength(2);
  });

  it.each([
    ["refused", { success: false, errorReason: "insufficient_balance", transaction: "", network: NETWORK }, "insufficient_balance"],
    ["pending", { success: false, errorReason: "settlement_pending", transaction: "", network: NETWORK }, "settlement_pending"],
    ["accepted without a transfer id", { success: true, transaction: "", network: NETWORK }, "gateway_not_final"],
  ])("never reach the backend when %s", async (_name, result, reason) => {
    const url = await startProxy({}, {}, { settle: vi.fn().mockResolvedValue(result) });
    const res = await railFetch("gateway").pay(`${url}/weather`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason });
    expect(backendCalls).toHaveLength(0);
  });

  it("never reach the backend when Gateway is unreachable", async () => {
    const url = await startProxy({}, {}, { settle: vi.fn().mockRejectedValue(new Error("ECONNRESET")) });
    const res = await railFetch("gateway").pay(`${url}/weather`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ reason: "gateway_unavailable" });
    expect(backendCalls).toHaveLength(0);
  });

  it("never reach the backend when Gateway hangs", async () => {
    const url = await startProxy({}, {}, { settle: vi.fn(() => new Promise<never>(() => {})) });
    const res = await railFetch("gateway").pay(`${url}/weather`);
    expect(res.status).toBe(402);
    expect(backendCalls).toHaveLength(0);
  });

  it("cannot be replayed for a second backend call", async () => {
    const settle = vi.fn().mockResolvedValue(accepted);
    const url = await startProxy({}, {}, { settle });
    const { pay, sent } = railFetch("gateway");
    expect((await pay(`${url}/weather`)).status).toBe(200);

    const replay = await fetch(`${url}/weather`, { headers: { "payment-signature": sent[0] } });
    expect(replay.status).toBe(402);
    expect(await replay.json()).toMatchObject({ reason: "payment_already_used" });
    expect(backendCalls).toHaveLength(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("are served once when a retry finds a lost response went through", async () => {
    const settle = vi.fn().mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValue({
      success: false,
      errorReason: "nonce_already_used",
      transaction: "",
      network: NETWORK,
    });
    const lookup = vi.fn<TransferLookup>();
    const url = await startProxy({}, {}, { settle }, lookup);
    const { pay, sent } = railFetch("gateway");
    expect((await pay(`${url}/weather`)).status).toBe(402);
    expect(backendCalls).toHaveLength(0);

    const { authorization } = JSON.parse(Buffer.from(sent[0], "base64").toString()).payload;
    lookup.mockResolvedValue([
      {
        id: TRANSFER_ID,
        status: "received",
        fromAddress: buyer.address,
        toAddress: seller,
        amount: "10000",
        nonce: authorization.nonce,
      },
    ]);
    const retry = await fetch(`${url}/weather`, { headers: { "payment-signature": sent[0] } });
    expect(retry.status).toBe(200);
    expect(backendCalls).toHaveLength(1);

    const replay = await fetch(`${url}/weather`, { headers: { "payment-signature": sent[0] } });
    expect(replay.status).toBe(402);
    expect(backendCalls).toHaveLength(1);
  });
});

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
    expect((await fetch(`${url}/.well-known/x402`)).status).not.toBe(402);
    expect((await fetch(`${url}/openapi.json`)).status).not.toBe(402);
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

  it("reach the backend once when a retry finds the settlement completed", async () => {
    const settle = vi.fn().mockResolvedValue(pending);
    const getStatus = vi.fn().mockResolvedValue({ status: "pending" });
    const url = await startProxy({ settle, getStatus });
    const { pay, sent } = payingFetch();
    expect((await pay(`${url}/weather`)).status).toBe(402);
    expect(backendCalls).toHaveLength(0);

    getStatus.mockResolvedValue({ status: "completed", transaction: TX, payer: buyer.address, amount: "10000" });
    const retry = await fetch(`${url}/weather`, { headers: { "payment-signature": sent[0] } });
    expect(retry.status).toBe(200);
    expect(backendCalls).toHaveLength(1);

    const replay = await fetch(`${url}/weather`, { headers: { "payment-signature": sent[0] } });
    expect(replay.status).toBe(402);
    expect(backendCalls).toHaveLength(1);
    expect(settle).toHaveBeenCalledTimes(1);
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

describe("isLocalRequest", () => {
  const request = (remoteAddress: string, headers = {}) =>
    ({ headers, socket: { remoteAddress } }) as Parameters<typeof isLocalRequest>[0];

  it("accepts loopback in every form Node reports it", () => {
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isLocalRequest(request(address))).toBe(true);
    }
  });

  it("refuses other addresses", () => {
    expect(isLocalRequest(request("203.0.113.7"))).toBe(false);
    expect(isLocalRequest(request("::ffff:203.0.113.7"))).toBe(false);
  });

  it("refuses a request forwarded by a local tunnel or proxy", () => {
    expect(isLocalRequest(request("127.0.0.1", { "x-forwarded-for": "203.0.113.7" }))).toBe(false);
    expect(isLocalRequest(request("127.0.0.1", { forwarded: "for=203.0.113.7" }))).toBe(false);
  });

  it("refuses a web page calling through the local browser", () => {
    expect(isLocalRequest(request("127.0.0.1", { origin: "https://evil.example" }))).toBe(false);
  });
});

describe("/chainpe-admin access", () => {
  const remote = { "x-forwarded-for": "203.0.113.7" };

  it("lets a loopback caller in without a key", async () => {
    const url = await startProxy({});
    expect((await fetch(`${url}/chainpe-admin/payments`)).status).toBe(200);
  });

  it("refuses a remote caller when no adminKey is set", async () => {
    const url = await startProxy({});
    for (const path of ["stats", "payments", "config", "schema"]) {
      expect((await fetch(`${url}/chainpe-admin/${path}`, { headers: remote })).status).toBe(401);
    }
  });

  it("does not treat an empty key as a key when none is set", async () => {
    const url = await startProxy({});
    const res = await fetch(`${url}/chainpe-admin/stats`, { headers: { ...remote, "x-admin-key": "" } });
    expect(res.status).toBe(401);
  });

  it("lets a remote caller in with the adminKey, and only with it", async () => {
    const url = await startProxy({}, { adminKey: "secret" });
    const stats = `${url}/chainpe-admin/stats`;
    expect((await fetch(stats, { headers: { ...remote, "x-admin-key": "secret" } })).status).toBe(200);
    expect((await fetch(stats, { headers: { ...remote, "x-admin-key": "wrong" } })).status).toBe(401);
  });

  it("keeps /health public", async () => {
    const url = await startProxy({});
    expect((await fetch(`${url}/health`, { headers: remote })).status).toBe(200);
  });
});

describe("/chainpe-admin/stats", () => {
  it("counts a paid request whose backend failed", async () => {
    backendStatus = 503;
    const url = await startProxy({ settle: vi.fn().mockResolvedValue(settled) });
    await payingFetch().pay(`${url}/weather`);
    await vi.waitFor(() => expect(analytics.getRecentPayments()).toHaveLength(1));

    const stats = await (await fetch(`${url}/chainpe-admin/stats`)).json();
    expect(stats).toMatchObject({ paidRequests: 1, chargedButBackendFailed: 1 });
    expect(stats.recentPayments[0]).toMatchObject({ status: "completed", backendStatus: 503 });
  });

  it("counts a paid request whose backend was unreachable", async () => {
    const url = await startProxy({ settle: vi.fn().mockResolvedValue(settled) }, { targetUrl: "http://localhost:1" });
    const res = await payingFetch().pay(`${url}/weather`);
    expect(res.status).toBe(502);
    await vi.waitFor(() => expect(analytics.getRecentPayments()).toHaveLength(1));
    expect(analytics.getStats().chargedButBackendFailed).toBe(1);
  });

  it("does not count a backend failure on an unpaid request or a 4xx", async () => {
    backendStatus = 404;
    const url = await startProxy({ settle: vi.fn().mockResolvedValue(settled) });
    await fetch(`${url}/weather`);
    await payingFetch().pay(`${url}/weather`);
    await vi.waitFor(() => expect(analytics.getRecentPayments()).toHaveLength(1));
    expect(analytics.getStats().chargedButBackendFailed).toBe(0);
  });

  it("shows rail, network and tx hash for a completed payment", async () => {
    const url = await startProxy({ settle: vi.fn().mockResolvedValue(settled) });
    await payingFetch().pay(`${url}/weather`);
    await vi.waitFor(() => expect(analytics.getRecentPayments()).toHaveLength(1));

    const stats = await (await fetch(`${url}/chainpe-admin/stats`)).json();
    expect(stats.paidRequests).toBe(1);
    expect(stats.revenue).toEqual({
      USDC: "0.01",
      byRail: { exact: "0.01", gateway: "0" },
      byNetwork: { [NETWORK]: "0.01" },
    });
    expect(stats.recentPayments[0]).toMatchObject({
      rail: "exact",
      network: NETWORK,
      txHash: TX,
      status: "completed",
      amountAtomic: "10000",
      payer: buyer.address,
      payTo: seller,
      route: "/weather",
      method: "GET",
      backendStatus: 200,
    });
  });

  it("records a failed settlement without revenue", async () => {
    const url = await startProxy({
      settle: vi.fn().mockResolvedValue(pending),
      getStatus: vi.fn().mockResolvedValue({ status: "failed", reason: "insufficient_funds", transaction: null, payer: null }),
    });
    await payingFetch().pay(`${url}/weather`);
    await vi.waitFor(() => expect(analytics.getRecentPayments()).toHaveLength(1));

    const stats = await (await fetch(`${url}/chainpe-admin/stats`)).json();
    expect(stats.failedPayments).toBe(1);
    expect(stats.revenue.USDC).toBe("0");
    expect(stats.recentPayments[0]).toMatchObject({ status: "failed", error: "insufficient_funds", paymentId: "pay_1" });
  });

  it("records a settlement that is still pending", async () => {
    const url = await startProxy({
      settle: vi.fn().mockResolvedValue(pending),
      getStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    });
    await payingFetch().pay(`${url}/weather`);
    await vi.waitFor(() => expect(analytics.getRecentPayments()).toHaveLength(1));
    expect(analytics.getRecentPayments()[0]).toMatchObject({ status: "pending", paymentId: "pay_1" });
  });
});
