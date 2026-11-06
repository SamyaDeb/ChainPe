import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { GatewayGuard, gatewayTerms, type GatewayTransfer, type TransferLookup } from "../src/proxy/gateway.js";
import { RailRouter } from "../src/proxy/railRouter.js";
import { ALL_RAILS, createRoutesConfig, formatRoutesForDisplay, parseRails } from "../src/proxy/routeConfig.js";
import { assertUsdcAmount, railPolicy } from "../src/commands/consume.js";
import { netOfFee, parseWithdrawShortfall, pendingIncoming, resolveDestination } from "../src/commands/seller.js";
import { getNetwork } from "../src/chains.js";
import type { ChainPeConfig } from "../src/types.js";

const NETWORK = "eip155:5042002";
const USDC = "0x3600000000000000000000000000000000000000";
const buyer = privateKeyToAccount(generatePrivateKey()).address;
const seller = privateKeyToAccount(generatePrivateKey()).address;
const other = privateKeyToAccount(generatePrivateKey()).address;
const NONCE = `0x${"ab".repeat(32)}`;
const TERMS = { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9" };

const batched = {
  scheme: "exact",
  network: NETWORK,
  asset: USDC,
  amount: "1000",
  payTo: seller,
  maxTimeoutSeconds: 604900,
  extra: { ...TERMS, paymentFlow: "upfront" },
} as unknown as PaymentRequirements;
const plain = { ...batched, extra: { name: "USDC", version: "2" } } as PaymentRequirements;
const payload = (nonce = NONCE) =>
  ({ x402Version: 2, payload: { signature: "0xsig", authorization: { from: buyer, nonce } } }) as unknown as PaymentPayload;

const accepted: SettleResponse = { success: true, transaction: "uuid-1", network: NETWORK, payer: buyer };
const refused = (errorReason: string): SettleResponse => ({ success: false, errorReason, transaction: "", network: NETWORK });
const transfer = (overrides: Partial<GatewayTransfer> = {}): GatewayTransfer => ({
  id: "uuid-1",
  status: "received",
  fromAddress: buyer.toLowerCase(),
  toAddress: seller.toLowerCase(),
  amount: "1000",
  nonce: NONCE,
  ...overrides,
});

function guardFor(settle: FacilitatorClient["settle"], lookup: TransferLookup = async () => []) {
  return new GatewayGuard({ settle } as unknown as FacilitatorClient, lookup, { settleTimeoutMs: 20 });
}

describe("GatewayGuard", () => {
  it("passes an accepted payment through", async () => {
    expect(await guardFor(vi.fn().mockResolvedValue(accepted)).settle(payload(), batched)).toMatchObject({
      success: true,
      transaction: "uuid-1",
    });
  });

  it("refuses to deliver a payment twice", async () => {
    const settle = vi.fn().mockResolvedValue(accepted);
    const guard = guardFor(settle);
    await guard.settle(payload(), batched);
    expect(await guard.settle(payload(), batched)).toMatchObject({ errorReason: "payment_already_used" });
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("refuses a duplicate while the first settle is running", async () => {
    let finish!: (r: SettleResponse) => void;
    const guard = guardFor(vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve))));
    const first = guard.settle(payload(), batched);
    expect(await guard.settle(payload(), batched)).toMatchObject({ errorReason: "payment_in_progress" });
    finish(accepted);
    expect((await first).success).toBe(true);
  });

  it("treats success without a transfer id as not final", async () => {
    const result = await guardFor(vi.fn().mockResolvedValue({ ...accepted, transaction: "" })).settle(payload(), batched);
    expect(result).toMatchObject({ success: false, errorReason: "gateway_not_final" });
  });

  it("keeps Gateway's reason when it refuses", async () => {
    const result = await guardFor(vi.fn().mockResolvedValue(refused("insufficient_balance"))).settle(payload(), batched);
    expect(result).toMatchObject({ success: false, errorReason: "insufficient_balance" });
  });

  it("gives a reason to a refusal that has none", async () => {
    const settle = vi.fn().mockResolvedValue({ success: false, message: "Invalid request" });
    expect(await guardFor(settle).settle(payload(), batched)).toMatchObject({
      success: false,
      errorReason: "gateway_rejected",
      network: NETWORK,
    });
  });

  it("reports an unreachable Gateway as a failed settlement", async () => {
    const result = await guardFor(vi.fn().mockRejectedValue(new Error("ECONNRESET"))).settle(payload(), batched);
    expect(result).toMatchObject({ success: false, errorReason: "gateway_unavailable" });
  });

  it("gives up on a settle that never answers", async () => {
    const result = await guardFor(vi.fn(() => new Promise<never>(() => {}))).settle(payload(), batched);
    expect(result).toMatchObject({ success: false, errorReason: "gateway_unavailable" });
  });

  it("settles a retry normally after a failed attempt", async () => {
    const settle = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(accepted);
    const guard = guardFor(settle);
    expect((await guard.settle(payload(), batched)).success).toBe(false);
    expect((await guard.settle(payload(), batched)).success).toBe(true);
  });

  describe("nonce_already_used", () => {
    const usedNonce = refused("nonce_already_used");

    /** A first attempt with a lost answer, then Gateway says the nonce is taken. */
    async function afterLostResponse(lookup: TransferLookup, first: () => Promise<SettleResponse> = () => Promise.reject(new Error("socket hang up"))) {
      const settle = vi.fn().mockImplementationOnce(first).mockResolvedValue(usedNonce);
      const guard = guardFor(settle, lookup);
      expect((await guard.settle(payload(), batched)).success).toBe(false);
      return guard;
    }

    it("is refused without a lookup when this payment never went uncertain", async () => {
      const lookup = vi.fn<TransferLookup>().mockResolvedValue([transfer()]);
      const result = await guardFor(vi.fn().mockResolvedValue(usedNonce), lookup).settle(payload(), batched);
      expect(result).toMatchObject({ success: false, errorReason: "nonce_already_used" });
      expect(lookup).not.toHaveBeenCalled();
    });

    it("delivers once when the lost attempt went through", async () => {
      const lookup = vi.fn<TransferLookup>().mockResolvedValue([transfer()]);
      const guard = await afterLostResponse(lookup);
      expect(await guard.settle(payload(), batched)).toMatchObject({ success: true, transaction: "uuid-1" });
      expect(lookup).toHaveBeenCalledWith(NONCE, NETWORK);
      expect(await guard.settle(payload(), batched)).toMatchObject({ errorReason: "payment_already_used" });
    });

    it("also recovers after a server error or a success without an id", async () => {
      const lookup = vi.fn<TransferLookup>().mockResolvedValue([transfer()]);
      const serverError = await afterLostResponse(lookup, async () => refused("unexpected_error"));
      expect((await serverError.settle(payload(), batched)).success).toBe(true);
      const noId = await afterLostResponse(lookup, async () => ({ ...accepted, transaction: "" }));
      expect((await noId.settle(payload(), batched)).success).toBe(true);
    });

    it.each([
      ["another payer", { fromAddress: other }],
      ["another seller", { toAddress: other }],
      ["another amount", { amount: "1" }],
      ["another nonce", { nonce: `0x${"cd".repeat(32)}` }],
    ])("does not deliver on a transfer from %s", async (_name, overrides) => {
      const guard = await afterLostResponse(async () => [transfer(overrides)]);
      expect(await guard.settle(payload(), batched)).toMatchObject({ success: false, errorReason: "nonce_already_used" });
    });

    it("does not deliver when no transfer exists yet, and can still recover later", async () => {
      const lookup = vi.fn<TransferLookup>().mockResolvedValueOnce([]).mockResolvedValue([transfer()]);
      const guard = await afterLostResponse(lookup);
      expect((await guard.settle(payload(), batched)).success).toBe(false);
      expect((await guard.settle(payload(), batched)).success).toBe(true);
    });

    it("does not deliver a failed transfer", async () => {
      const guard = await afterLostResponse(async () => [transfer({ status: "failed" })]);
      expect(await guard.settle(payload(), batched)).toMatchObject({ success: false, errorReason: "settlement_failed" });
    });

    it("does not deliver when the lookup fails", async () => {
      const guard = await afterLostResponse(() => Promise.reject(new Error("timeout")));
      expect(await guard.settle(payload(), batched)).toMatchObject({ success: false, errorReason: "gateway_unavailable" });
    });

    it("stops recovering once the TTL has passed", async () => {
      const lookup = vi.fn<TransferLookup>().mockResolvedValue([transfer()]);
      const settle = vi.fn().mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValue(usedNonce);
      const guard = new GatewayGuard({ settle } as unknown as FacilitatorClient, lookup, { uncertainTtlMs: 0 });
      await guard.settle(payload(), batched);
      expect(await guard.settle(payload(), batched)).toMatchObject({ errorReason: "nonce_already_used" });
      expect(lookup).not.toHaveBeenCalled();
    });
  });
});

describe("RailRouter", () => {
  const client = (kinds: unknown[] = [], extensions: string[] = [], signers = {}) =>
    ({
      verify: vi.fn().mockResolvedValue({ isValid: true }),
      settle: vi.fn().mockResolvedValue(accepted),
      getSupported: vi.fn().mockResolvedValue({ kinds, extensions, signers }),
    }) as unknown as FacilitatorClient;

  it("sends batched payments to Gateway and plain ones to the exact rail", async () => {
    const exact = client();
    const gateway = client();
    const router = new RailRouter({ exact, gateway });

    await router.settle(payload(), batched);
    await router.verify(payload(), batched);
    expect(gateway.settle).toHaveBeenCalledTimes(1);
    expect(gateway.verify).toHaveBeenCalledTimes(1);
    expect(exact.settle).not.toHaveBeenCalled();

    await router.settle(payload(), plain);
    await router.verify(payload(), plain);
    expect(exact.settle).toHaveBeenCalledTimes(1);
    expect(exact.verify).toHaveBeenCalledTimes(1);
    expect(gateway.settle).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the payment's rail is off", async () => {
    const exact = client();
    expect(await new RailRouter({ exact }).settle(payload(), batched)).toMatchObject({
      success: false,
      errorReason: "rail_not_enabled",
    });
    expect(await new RailRouter({ exact }).verify(payload(), batched)).toMatchObject({
      isValid: false,
      invalidReason: "rail_not_enabled",
    });
    expect(exact.settle).not.toHaveBeenCalled();
  });

  it("merges what the rails support", async () => {
    const router = new RailRouter({
      exact: client([{ scheme: "exact", network: NETWORK }], ["payment-identifier"], { [NETWORK]: ["0x1"] }),
      gateway: client([{ scheme: "exact", network: "eip155:1" }], ["payment-identifier", "x"], { [NETWORK]: ["0x2"] }),
    });
    expect(await router.getSupported()).toEqual({
      kinds: [
        { scheme: "exact", network: NETWORK },
        { scheme: "exact", network: "eip155:1" },
      ],
      extensions: ["payment-identifier", "x"],
      signers: { [NETWORK]: ["0x1", "0x2"] },
    });
  });

  it("keeps working when one rail cannot report", async () => {
    const down = client();
    vi.mocked(down.getSupported).mockRejectedValue(new Error("down"));
    const router = new RailRouter({ exact: client([{ scheme: "exact", network: NETWORK }]), gateway: down });
    expect((await router.getSupported()).kinds).toHaveLength(1);
  });

  it("keeps working when one rail throws straight away", async () => {
    const broken = client();
    vi.mocked(broken.getSupported).mockImplementation(() => {
      throw new Error("broken");
    });
    const router = new RailRouter({ exact: client([{ scheme: "exact", network: NETWORK }]), gateway: broken });
    expect((await router.getSupported()).kinds).toHaveLength(1);
  });

  it("fails when no rail can report", async () => {
    const down = client();
    vi.mocked(down.getSupported).mockRejectedValue(new Error("down"));
    await expect(new RailRouter({ gateway: down }).getSupported()).rejects.toThrow("down");
  });
});

describe("gatewayTerms", () => {
  const supported = (extra: Record<string, unknown>, network = NETWORK) => ({
    getSupported: async () =>
      ({ kinds: [{ x402Version: 2, scheme: "exact", network, extra }], extensions: [], signers: {} }) as never,
  });
  const assets = [{ symbol: "USDC", address: USDC, decimals: 6, authorizationVersions: ["2", "1"] }];

  it("reads the terms, with the lowest version Gateway accepts", async () => {
    const client = supported({ ...TERMS, version: "2", assets });
    expect(await gatewayTerms(client, NETWORK, USDC)).toEqual(TERMS);
  });

  it("falls back to the kind's version", async () => {
    expect(await gatewayTerms(supported(TERMS), NETWORK, USDC)).toEqual(TERMS);
  });

  it("fails when the network is not offered", async () => {
    await expect(gatewayTerms(supported(TERMS, "eip155:1"), NETWORK, USDC)).rejects.toThrow(/does not support/);
  });

  it("fails on a kind that is not batched", async () => {
    await expect(gatewayTerms(supported({ name: "USDC", version: "2" }), NETWORK, USDC)).rejects.toThrow(/does not support/);
  });

  it("fails when USDC is not accepted", async () => {
    const client = supported({ ...TERMS, assets: [{ ...assets[0], address: other }] });
    await expect(gatewayTerms(client, NETWORK, USDC)).rejects.toThrow(/does not accept/);
  });
});

describe("Gateway endpoints", () => {
  it("use the testnet API on arc-testnet and the SDK default on arc", () => {
    expect(getNetwork("arc-testnet").gatewayUrl).toBe("https://gateway-api-testnet.circle.com");
    expect(getNetwork("arc").gatewayUrl).toBeUndefined();
    expect(getNetwork("arc-testnet").gatewayChain).toBe("arcTestnet");
    expect(getNetwork("arc").gatewayChain).toBe("arc");
  });
});

describe("createRoutesConfig", () => {
  const config = (overrides: Partial<ChainPeConfig> = {}) =>
    ({ pricePerRequest: "0.01", walletAddress: seller, network: "arc-testnet", ...overrides }) as ChainPeConfig;
  const route = (path: string, pricePerRequest: string) => ({ path, pricePerRequest, paymentToken: "USDC" as const });
  const railsOf = (routes: ReturnType<typeof createRoutesConfig>) =>
    Object.fromEntries(formatRoutesForDisplay(routes).map((r) => [r.path, r.rails]));

  it("treats exactly one cent as enough for exact, and just below as not", () => {
    const routes = createRoutesConfig(config(), [route("GET /a", "0.01"), route("GET /b", "0.009999")], TERMS);
    expect(railsOf(routes)).toMatchObject({ "GET /a": ["exact", "gateway"], "GET /b": ["gateway"] });
  });

  it("warns once about every route that lost exact", async () => {
    const { logger } = await import("../src/logger.js");
    const warn = vi.spyOn(logger, "warn");
    createRoutesConfig(config(), [route("GET /a", "0.001"), route("GET /b", "0.002")], TERMS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("GET /a, GET /b");
    warn.mockRestore();
  });

  it("refuses a route that would have no option left", () => {
    expect(() => createRoutesConfig(config({ rails: ["exact"] }), [route("GET /a", "0.001")])).toThrow(/GET \/a.*gateway rail/);
  });

  it("refuses a route with no price", () => {
    expect(() => createRoutesConfig(config(), [route("GET /a", "0")], TERMS)).toThrow(/no valid price/);
  });

  it("needs Gateway's terms when the rail is on", () => {
    expect(() => createRoutesConfig(config())).toThrow(/terms were not provided/);
  });

  it("does not need them with rails [exact]", () => {
    expect(railsOf(createRoutesConfig(config({ rails: ["exact"] })))).toEqual({ "* /*": ["exact"] });
  });
});

describe("parseRails", () => {
  it("parses and de-duplicates", () => {
    expect(parseRails("exact, gateway,exact")).toEqual(ALL_RAILS);
    expect(parseRails("gateway")).toEqual(["gateway"]);
  });

  it("refuses anything else", () => {
    expect(() => parseRails("exact,visa")).toThrow(/Invalid rail "visa"/);
    expect(() => parseRails("")).toThrow(/Invalid rail/);
  });
});

describe("railPolicy", () => {
  const options = [plain, batched];

  it("keeps only the chosen rail", () => {
    expect(railPolicy("exact", 0n)(2, options)).toEqual([plain]);
    expect(railPolicy("gateway", 0n)(2, options)).toEqual([batched]);
  });

  it("prefers Gateway on auto when the deposit covers the price", () => {
    expect(railPolicy("auto", 1000n)(2, options)).toEqual([batched]);
  });

  it("falls back to exact on auto when it does not", () => {
    expect(railPolicy("auto", 999n)(2, options)).toEqual([plain]);
  });

  it("leaves nothing to sign when no option fits", () => {
    expect(railPolicy("auto", 0n)(2, [batched])).toEqual([]);
    expect(railPolicy("exact", 0n)(2, [batched])).toEqual([]);
  });
});

describe("pendingIncoming", () => {
  it("sums received and batched transfers", async () => {
    const searchTransfers = vi.fn(async ({ status }: { status?: string }) => ({
      transfers: (status === "received" ? [{ amount: "1000" }, { amount: "500" }] : [{ amount: "25" }]) as never[],
    }));
    expect(await pendingIncoming({ searchTransfers } as never, seller)).toBe(1525n);
    expect(searchTransfers.mock.calls.map(([params]) => params.status)).toEqual(["received", "batched"]);
  });
});

describe("withdraw fee handling", () => {
  it("reads Gateway's shortfall error", () => {
    expect(parseWithdrawShortfall("Gateway API error: available 0.001000, required 0.0045")).toEqual({
      available: "0.001000",
      required: "0.0045",
    });
  });

  it("ignores other errors", () => {
    expect(parseWithdrawShortfall("Gateway API error: blocked")).toBeUndefined();
  });

  it("takes the fee off the available balance", () => {
    expect(netOfFee(11_000n, 11_000n, 14_500n)).toBe(7_500n);
  });

  it("refuses when the fee uses up the balance", () => {
    expect(netOfFee(1_000n, 1_000n, 4_500n)).toBeUndefined();
    expect(netOfFee(3_500n, 3_500n, 7_000n)).toBeUndefined();
  });
});

describe("resolveDestination", () => {
  it("accepts Gateway's chain names and refuses others", () => {
    expect(resolveDestination("baseSepolia")).toBe("baseSepolia");
    expect(() => resolveDestination("constructor")).toThrow(/Unknown chain/);
  });
});

describe("assertUsdcAmount", () => {
  it("accepts positive USDC with up to 6 decimals", () => {
    for (const amount of ["1", "1.00", "0.000001"]) expect(() => assertUsdcAmount(amount)).not.toThrow();
  });

  it("refuses the rest", () => {
    for (const amount of ["0", "0.0", "-1", "1e3", "abc", "", "0.0000001"]) {
      expect(() => assertUsdcAmount(amount)).toThrow(/Invalid amount/);
    }
  });
});
