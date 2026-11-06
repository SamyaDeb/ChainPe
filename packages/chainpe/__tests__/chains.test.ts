import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAddress } from "viem";
import { assertMainnetAllowed, explorerTxUrl, fromX402Network, getNetwork, NETWORKS, parseNetwork } from "../src/chains.js";
import { parsePaidRoutes } from "../src/proxy/routeConfig.js";
import { filterListings, mapCircleItem, mergeListings, type FoundService } from "../src/commands/discover.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

describe("Arc networks", () => {
  it("defines arc-testnet", () => {
    const info = getNetwork("arc-testnet");
    expect(info.chainId).toBe(5042002);
    expect(info.caip2).toBe("eip155:5042002");
    expect(info.gasToken).toBe("USDC");
    expect(info.usdc).toBe("0x3600000000000000000000000000000000000000");
    expect(info.chain.id).toBe(5042002);
    expect(info.chain.rpcUrls.default.http).toEqual([info.rpcUrl]);
    expect(info.chain.blockExplorers?.default.url).toBe("https://explorer.testnet.arc.io");
  });

  it("defines arc mainnet", () => {
    const info = getNetwork("arc");
    expect(info.chainId).toBe(5042);
    expect(info.caip2).toBe("eip155:5042");
    expect(info.chain.rpcUrls.default.http).toEqual([info.rpcUrl]);
  });

  it("maps CAIP-2 ids and names back to ChainPe networks", () => {
    expect(fromX402Network("eip155:5042002")).toBe("arc-testnet");
    expect(fromX402Network("eip155:5042")).toBe("arc");
    expect(fromX402Network("arc")).toBe("arc");
    expect(fromX402Network("eip155:43114")).toBeUndefined();
    expect(fromX402Network("avalanche")).toBeUndefined();
  });

  it("rejects anything that is not an Arc network", () => {
    expect(parseNetwork("arc-testnet")).toBe("arc-testnet");
    expect(() => parseNetwork("fuji")).toThrow(/Invalid network/);
    expect(() => parseNetwork("constructor")).toThrow(/Invalid network/);
  });

  it("needs an explicit flag for Arc mainnet only", () => {
    expect(() => assertMainnetAllowed("arc")).toThrow(/--allow-mainnet/);
    expect(() => assertMainnetAllowed("arc", true)).not.toThrow();
    expect(() => assertMainnetAllowed("arc-testnet")).not.toThrow();
  });

  it("builds explorer links", () => {
    expect(explorerTxUrl("arc-testnet", "0xabc")).toBe("https://explorer.testnet.arc.io/tx/0xabc");
  });
});

describe("ChainPeAccounts address", () => {
  it("is set on testnet only", () => {
    expect(getNetwork("arc-testnet").accountsAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(getNetwork("arc").accountsAddress).toBeUndefined();
  });
});

describe("address constants", () => {
  it("are all valid EIP-55, because viem refuses a bad checksum at call time", () => {
    for (const info of Object.values(NETWORKS)) {
      for (const address of [info.usdc, info.accountsAddress, info.identityRegistry, info.reputationRegistry]) {
        if (address) expect(isAddress(address, { strict: true }), address).toBe(true);
      }
    }
  });
});

describe("Arc-only source", () => {
  it("has no AVAX strings left", () => {
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    const hits = files.filter((f) => /\bAVAX\b/.test(readFileSync(join(SRC, f), "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("parsePaidRoutes", () => {
  it("reads methods and paths, at one price", () => {
    expect(parsePaidRoutes("GET /weather, post /v1/search, /forecast", "0.01")).toEqual([
      { path: "GET /weather", pricePerRequest: "0.01", paymentToken: "USDC" },
      { path: "POST /v1/search", pricePerRequest: "0.01", paymentToken: "USDC" },
      { path: "GET /forecast", pricePerRequest: "0.01", paymentToken: "USDC" },
    ]);
  });

  it("is empty for no input, and drops repeats", () => {
    expect(parsePaidRoutes("", "0.01")).toEqual([]);
    expect(parsePaidRoutes(" , ", "0.01")).toEqual([]);
    expect(parsePaidRoutes("/a, GET /a", "0.01")).toHaveLength(1);
  });

  it("rejects anything that is not a route", () => {
    for (const bad of ["weather", "FETCH /weather", "GET weather", "GET /a /b"]) {
      expect(() => parsePaidRoutes(bad, "0.01")).toThrow(/is not a route/);
    }
  });
});

describe("chainpe discover", () => {
  const offer = (over: object) => ({ network: "eip155:5042002", amount: "10000", payTo: "0xAAA", ...over });
  const found = (over: Partial<FoundService>): FoundService => ({
    name: "x", description: "", endpoint: "https://a.test", price: "0.01", rails: ["exact"], source: "circle", payTo: "0xAAA", ...over,
  });

  it("maps a Circle listing, taking the cheapest option on this network", () => {
    const service = mapCircleItem(
      {
        resource: "https://a.test/weather",
        accepts: [offer({}), offer({ amount: "1000", extra: { name: "GatewayWalletBatched" } }), offer({ network: "eip155:8453", amount: "1" })],
        metadata: { method: "GET", description: "Forecasts", provider: { name: "Weather Co" } },
      },
      "arc-testnet"
    );
    expect(service).toMatchObject({ name: "Weather Co", endpoint: "GET https://a.test/weather", price: "0.001", rails: ["gateway", "exact"], source: "circle" });
  });

  it("skips a Circle listing with no option on this network", () => {
    expect(mapCircleItem({ resource: "https://a.test", accepts: [offer({})] }, "arc")).toBeUndefined();
  });

  it("filters ChainPe listings by query and price", () => {
    const cheap = found({ name: "Weather" });
    const dear = found({ name: "Maps", price: "1" });
    expect(filterListings([cheap, dear], { query: "weath" })).toEqual([cheap]);
    expect(filterListings([cheap, dear], { maxPrice: "0.5" })).toEqual([cheap]);
  });

  it("keeps providers Circle has not listed, and drops ones it has", () => {
    const circle = found({ endpoint: "GET https://a.test/weather" });
    const unlisted = found({ source: "chainpe", endpoint: "https://new.test", payTo: "0xBBB" });
    const listed = found({ source: "chainpe", endpoint: "https://a.test", payTo: "0xaaa" });
    expect(mergeListings([circle], [unlisted, listed])).toEqual([unlisted, circle]);
  });
});
