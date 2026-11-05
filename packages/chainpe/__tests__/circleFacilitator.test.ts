import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FacilitatorApiError } from "@circle-fin/x402-batching/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import {
  assertExactSupported,
  facilitatorMode,
  paymentIdentifierFor,
  REGISTRATION_REQUIRED_MESSAGE,
  resolveSellerSigner,
  SettlementGuard,
  type CircleClient,
} from "../src/proxy/circleFacilitator.js";

const NETWORK = "eip155:5042002";
const requirements = { network: NETWORK } as PaymentRequirements;
const payload = (nonce = "0x01") =>
  ({ x402Version: 2, payload: { signature: "0xsig", authorization: { nonce } } }) as unknown as PaymentPayload;

const settled: SettleResponse = { success: true, transaction: "0xtx", network: NETWORK, payer: "0xbuyer" };
const pending: SettleResponse = {
  success: false,
  errorReason: "settlement_pending",
  transaction: "",
  network: NETWORK,
  payer: "0xbuyer",
  extensions: { "settlement-status": { status: "pending", paymentId: "pay_1", statusUrl: "/status/pay_1" } },
};
const statusOf = (status: string, extra = {}) => ({ status, transaction: null, payer: null, reason: null, ...extra });

function guardFor(client: Partial<CircleClient>, pollTimeoutMs = 200) {
  return new SettlementGuard(client as CircleClient, { pollIntervalMs: 1, pollTimeoutMs });
}

describe("resolveSellerSigner", () => {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;

  it("accepts the key of the payout wallet, in any address casing", () => {
    expect(resolveSellerSigner(address.toLowerCase(), key).address).toBe(address);
  });

  it("refuses a key that does not control the payout wallet", () => {
    const other = privateKeyToAccount(generatePrivateKey()).address;
    expect(() => resolveSellerSigner(other, key)).toThrow(/does not match walletAddress/);
  });

  it("refuses a missing key", () => {
    expect(() => resolveSellerSigner(address, "")).toThrow(/CHAINPE_SELLER_PRIVATE_KEY is not set/);
  });

  it("never repeats an invalid key in its error", () => {
    expect(() => resolveSellerSigner(address, "0xnot-a-real-key")).toThrow(/^(?!.*not-a-real-key)/);
  });
});

describe("facilitatorMode", () => {
  it("reports how Circle is authenticated", () => {
    expect(facilitatorMode("")).toBe("circle-keyless");
    expect(facilitatorMode("key")).toBe("circle-key");
  });
});

describe("paymentIdentifierFor", () => {
  it("is valid, stable per payment and different across payments", () => {
    const id = paymentIdentifierFor(payload());
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(paymentIdentifierFor(payload())).toBe(id);
    expect(paymentIdentifierFor(payload("0x02"))).not.toBe(id);
  });
});

describe("SettlementGuard", () => {
  it("sends the payment-identifier on settle", async () => {
    const settle = vi.fn().mockResolvedValue(settled);
    await guardFor({ settle }).settle(payload(), requirements);
    const sent = settle.mock.calls[0][0] as PaymentPayload;
    expect(sent.extensions?.["payment-identifier"]).toEqual({
      info: { required: false, id: paymentIdentifierFor(payload()) },
    });
  });

  it("resolves pending to completed by polling status", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(statusOf("pending"))
      .mockResolvedValueOnce(statusOf("completed", { transaction: "0xtx", amount: "1000" }));
    const result = await guardFor({ settle: vi.fn().mockResolvedValue(pending), getStatus }).settle(payload(), requirements);
    expect(result).toMatchObject({ success: true, transaction: "0xtx", amount: "1000", payer: "0xbuyer" });
    expect(getStatus).toHaveBeenCalledWith("pay_1", { network: NETWORK });
  });

  it("resolves pending to failed", async () => {
    const getStatus = vi.fn().mockResolvedValue(statusOf("failed", { reason: "insufficient_funds" }));
    const result = await guardFor({ settle: vi.fn().mockResolvedValue(pending), getStatus }).settle(payload(), requirements);
    expect(result).toMatchObject({ success: false, errorReason: "insufficient_funds" });
  });

  it("stays unsuccessful when pending outlasts the timeout", async () => {
    const getStatus = vi.fn().mockResolvedValue(statusOf("pending"));
    const result = await guardFor({ settle: vi.fn().mockResolvedValue(pending), getStatus }, 10).settle(payload(), requirements);
    expect(result).toMatchObject({ success: false, errorReason: "settlement_pending" });
  });

  it("keeps polling through a failed status request", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(statusOf("completed", { transaction: "0xtx" }));
    const result = await guardFor({ settle: vi.fn().mockResolvedValue(pending), getStatus }).settle(payload(), requirements);
    expect(result.success).toBe(true);
  });

  it("maps 403 registration_required to the CIRCLE_API_KEY message", async () => {
    const settle = vi
      .fn()
      .mockRejectedValue(new FacilitatorApiError("settle", 403, { code: 403, message: "forbidden", errors: [{ reason: "registration_required" }] }));
    const result = await guardFor({ settle }).settle(payload(), requirements);
    expect(result).toMatchObject({
      success: false,
      errorReason: "registration_required",
      errorMessage: REGISTRATION_REQUIRED_MESSAGE,
    });
  });

  it("reports an unreachable facilitator as a failed settlement", async () => {
    const result = await guardFor({ settle: vi.fn().mockRejectedValue(new Error("ECONNRESET")) }).settle(payload(), requirements);
    expect(result).toMatchObject({ success: false, errorReason: "facilitator_unavailable" });
  });

  it("refuses to deliver a payment twice", async () => {
    const settle = vi.fn().mockResolvedValue(settled);
    const guard = guardFor({ settle });
    expect((await guard.settle(payload(), requirements)).success).toBe(true);
    expect(await guard.settle(payload(), requirements)).toMatchObject({
      success: false,
      errorReason: "payment_already_used",
    });
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("refuses a duplicate while the first settle is running", async () => {
    let finish!: (r: SettleResponse) => void;
    const settle = vi.fn().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const guard = guardFor({ settle });
    const first = guard.settle(payload(), requirements);
    expect(await guard.settle(payload(), requirements)).toMatchObject({ errorReason: "payment_in_progress" });
    finish(settled);
    expect((await first).success).toBe(true);
  });

  it("lets a pending payment retry with the same identifier", async () => {
    const settle = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(settled);
    const getStatus = vi.fn().mockResolvedValue(statusOf("pending"));
    const guard = guardFor({ settle, getStatus }, 5);
    expect((await guard.settle(payload(), requirements)).success).toBe(false);
    expect((await guard.settle(payload(), requirements)).success).toBe(true);
    const ids = settle.mock.calls.map(([p]) => (p as PaymentPayload).extensions?.["payment-identifier"]);
    expect(ids[0]).toEqual(ids[1]);
  });
});

describe("assertExactSupported", () => {
  it("fails when the network is not offered", async () => {
    const facilitator = { getSupported: async () => ({ kinds: [{ scheme: "exact", network: "eip155:1", x402Version: 2 }], extensions: [], signers: {} }) };
    await expect(assertExactSupported(facilitator as never, NETWORK)).rejects.toThrow(/does not support/);
  });
});
