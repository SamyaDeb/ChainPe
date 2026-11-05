import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { explorerTxUrl, fromX402Network, getNetwork, parseNetwork } from "../src/chains.js";

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

describe("Arc-only source", () => {
  it("has no AVAX strings left", () => {
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    const hits = files.filter((f) => /\bAVAX\b/.test(readFileSync(join(SRC, f), "utf8")));
    expect(hits).toEqual([]);
  });
});
