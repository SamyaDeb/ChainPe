import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PaymentClient } from "../src/payment.ts";
import type { ServiceInfo } from "../src/types.ts";

// Public Hardhat key — signs locally, never touches a chain.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const URL_ = "https://api.example.com/data";

function offer(maxAmountRequired: string) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "avalanche-fuji",
        maxAmountRequired,
        resource: URL_,
        description: "t",
        mimeType: "application/json",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        asset: "0x5425890298aed601595a70AB815c96711a31Bc65",
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
}

const settleHeader = Buffer.from(
  JSON.stringify({ success: true, transaction: "0xabc", network: "avalanche-fuji", payer: "0xPAYER" })
).toString("base64");

/** First call → 402, retry with X-PAYMENT → 200 + settlement header. */
function stubServer(maxAmountRequired: string) {
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const paid = new Headers(init?.headers).has("X-PAYMENT");
    if (!paid) {
      return new Response(JSON.stringify(offer(maxAmountRequired)), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-PAYMENT-RESPONSE": settleHeader },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("PaymentClient budget", () => {
  it("enforces maxPerPayment (maxPricePerRequest)", async () => {
    const f = stubServer("10000"); // 0.01 USDC
    const client = new PaymentClient({ privateKey: KEY, network: "fuji", maxPerPayment: "0.005" });
    await expect(client.fetch(URL_)).rejects.toThrow(/exceeds maximum/i);
    expect(f).toHaveBeenCalledTimes(1); // never signed / retried
    expect(client.getReceipts()).toHaveLength(0);
  });

  it("defaults to a 0.10 USDC cap when none is configured", async () => {
    stubServer("500000"); // 0.50 USDC
    await expect(new PaymentClient({ privateKey: KEY, network: "fuji" }).fetch(URL_)).rejects.toThrow(
      /exceeds maximum/i
    );
    stubServer("100000"); // exactly 0.10 USDC is allowed
    const res = await new PaymentClient({ privateKey: KEY, network: "fuji" }).fetch(URL_);
    expect(res.paid).toBe(true);
  });

  it("treats a blank maxPerPayment as the default, not as unlimited", async () => {
    stubServer("500000");
    await expect(new PaymentClient({ privateKey: KEY, network: "fuji", maxPerPayment: " " }).fetch(URL_)).rejects.toThrow(
      /exceeds maximum/i
    );
  });
});

describe("PaymentClient receipts", () => {
  it("records the real signed amount and recipient (authorization.to), not the payer", async () => {
    stubServer("10000");
    const client = new PaymentClient({ privateKey: KEY, network: "fuji", maxPerPayment: "1" });
    const res = await client.fetch(URL_);
    expect(res.paid).toBe(true);
    expect(res.paymentReceipt?.amount).toBe("0.01");
    expect(res.paymentReceipt?.recipient.toLowerCase()).toBe(PAY_TO);
    expect(res.paymentReceipt?.txId).toBe("0xabc");
    expect(client.getTotalSpent().USDC).toBe("0.01");
  });

  it("callService does not overwrite amount/recipient with the registry's claims", async () => {
    stubServer("10000");
    const client = new PaymentClient({ privateKey: KEY, network: "fuji", maxPerPayment: "1" });
    const service = {
      name: "liar",
      endpoint: "https://api.example.com",
      pricePerRequest: "0.0001", // registry claims cheaper...
      walletAddress: "0x9999999999999999999999999999999999999999", // ...and a different payee
    } as unknown as ServiceInfo;
    const res = await client.callService(service, "/data");
    expect(res.paymentReceipt?.service).toBe("liar");
    expect(res.paymentReceipt?.amount).toBe("0.01");
    expect(res.paymentReceipt?.recipient.toLowerCase()).toBe(PAY_TO);
  });
});
