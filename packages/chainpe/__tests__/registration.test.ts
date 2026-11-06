import { describe, expect, it, vi } from "vitest";
import { encodeErrorResult, ContractFunctionRevertedError, type Abi, type Address, type Hex } from "viem";
import { chainPeAccountsAbi } from "../src/abi/ChainPeAccounts.js";
import { AccountsWriter, PERIOD_SECONDS, serviceKey, type OnChainService, type ProviderAccount, type ServiceInput } from "../src/accounts.js";
import { buildAgentCard } from "../src/agentCard.js";
import type { ChainWriter, ContractCall } from "../src/onchain.js";
import { planRegistration, quoteUpgrade, runUpgrade, syncRegistration, UPGRADE_GAS_MARGIN } from "../src/registration.js";
import type { ChainPeConfig } from "../src/types.js";

const SELLER = "0x261f058496D81703c858DDFEd201834F0b5f2e73" as Address;
const CONTRACT = "0xD315322c9D83A6f50A04236A2a242e0259bfB580" as Address;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

const input: ServiceInput = {
  name: "ChainPe Weather Demo",
  description: "Weather",
  tags: "weather,demo",
  endpoint: "https://api.example.com",
  pricePerRequest: "0.01",
  network: "eip155:5042002",
  payTo: SELLER,
  acceptsExact: true,
  acceptsGateway: true,
};

const provider = (overrides: Partial<ProviderAccount> = {}): ProviderAccount => ({
  exists: true,
  agentId: 7n,
  createdAt: 1n,
  paidUntil: 0n,
  activeServices: 0,
  ...overrides,
});

const service = (overrides: Partial<OnChainService> = {}): OnChainService => ({
  ...input,
  key: serviceKey(SELLER, input.name),
  provider: SELLER,
  agentId: 7n,
  active: true,
  createdAt: 1n,
  updatedAt: 1n,
  ...overrides,
});

describe("planRegistration", () => {
  const plan = (p: ProviderAccount, s: OnChainService | null, max = 1n, agentId = 7n) => planRegistration({ provider: p, service: s, maxServices: max }, input, agentId);

  it("creates everything for a new wallet", () => {
    expect(plan(provider({ exists: false, agentId: 0n }), null)).toEqual(["registerProvider", "registerService"]);
  });

  it("links the identity on the existing provider, as the smoke-tested seller needs", () => {
    expect(plan(provider({ agentId: 0n, activeServices: 1 }), null, 10n)).toEqual(["setAgentId", "registerService"]);
  });

  it("refreshes a listing whose agentId snapshot went stale", () => {
    expect(plan(provider(), service({ agentId: 0n }))).toEqual(["updateService"]);
    expect(plan(provider({ agentId: 0n, activeServices: 1 }), service({ agentId: 0n }))).toEqual(["setAgentId", "updateService"]);
  });

  it("sends nothing when everything already matches", () => {
    expect(plan(provider({ activeServices: 1 }), service())).toEqual([]);
  });

  it.each([
    ["endpoint", { endpoint: "https://old.example.com" }],
    ["price", { pricePerRequest: "0.02" }],
    ["rails", { acceptsGateway: false }],
    ["description", { description: "Old" }],
    ["tags", { tags: "old" }],
  ])("updates a changed %s", (_field, change) => {
    expect(plan(provider({ activeServices: 1 }), service(change))).toEqual(["updateService"]);
  });

  it("reactivates an inactive service when a slot is free", () => {
    expect(plan(provider(), service({ active: false }))).toEqual(["registerService"]);
  });

  it("stops before any transaction when the plan's limit is reached", () => {
    expect(() => plan(provider({ activeServices: 1 }), null)).toThrow(/chainpe upgrade/);
    expect(() => plan(provider({ agentId: 0n, activeServices: 1 }), service({ active: false }))).toThrow(/allows 1 active/);
  });

  it("does not count an update against the limit", () => {
    expect(plan(provider({ activeServices: 5 }), service({ endpoint: "https://x.example.com" }), 1n)).toEqual(["updateService"]);
  });
});

/** ChainPeAccounts and USDC in memory, enough for the flows under test. */
function fakeChain(init: { provider?: ProviderAccount; service?: OnChainService | null; price?: bigint; balance?: bigint; allowance?: bigint; rpcDown?: boolean }) {
  const state = { provider: init.provider ?? provider({ exists: false, agentId: 0n }), service: init.service ?? null, allowance: init.allowance ?? 0n, price: init.price ?? 1_000_000n };
  const sent: string[] = [];
  const chain: ChainWriter = {
    account: SELLER,
    read: (async (call: ContractCall) => {
      if (init.rpcDown) throw new Error("fetch failed");
      switch (call.functionName) {
        case "providers":
          return [state.provider.exists, state.provider.agentId, state.provider.createdAt, state.provider.paidUntil, state.provider.activeServices];
        case "getService": {
          if (state.service) return state.service;
          const data = encodeErrorResult({ abi: chainPeAccountsAbi as Abi, errorName: "ServiceNotFound", args: [HASH] });
          throw new ContractFunctionRevertedError({ abi: chainPeAccountsAbi as Abi, data, functionName: "getService" });
        }
        case "maxServices":
          return state.provider.paidUntil > 0n ? 10n : 1n;
        case "proPricePerPeriod":
          return state.price;
        case "balanceOf":
          return init.balance ?? 5_000_000n;
        case "allowance":
          return state.allowance;
      }
      throw new Error(`unexpected read ${call.functionName}`);
    }) as never,
    send: vi.fn(async (label: string, call: ContractCall) => {
      sent.push(call.functionName);
      const args = (call.args ?? []) as unknown[];
      if (call.functionName === "registerProvider") state.provider = provider({ agentId: args[0] as bigint });
      if (call.functionName === "setAgentId") state.provider = { ...state.provider, agentId: args[0] as bigint };
      if (call.functionName === "registerService" || call.functionName === "updateService") {
        state.service = service({ ...(args[0] as ServiceInput), agentId: state.provider.agentId, active: true });
        if (call.functionName === "registerService") state.provider = { ...state.provider, activeServices: state.provider.activeServices + 1 };
      }
      if (call.functionName === "approve") state.allowance = args[1] as bigint;
      if (call.functionName === "subscribe") {
        state.allowance = 0n;
        state.provider = { ...state.provider, paidUntil: state.provider.paidUntil + BigInt(args[0] as number) * PERIOD_SECONDS };
      }
      return { label, hash: HASH, receipt: { status: "success", logs: [] } } as never;
    }),
  };
  return { chain, sent, state, accounts: new AccountsWriter(chain, CONTRACT) };
}

describe("syncRegistration", () => {
  it("resumes after a partial failure and is a no-op the second time", async () => {
    const { accounts, sent } = fakeChain({});
    const first = await syncRegistration(accounts, SELLER, input, 7n);
    expect(first.steps).toEqual(["registerProvider", "registerService"]);
    const second = await syncRegistration(accounts, SELLER, input, 7n);
    expect(second.txs).toHaveLength(0);
    expect(sent).toEqual(["registerProvider", "registerService"]);
  });

  it("links the identity and refreshes the snapshot for the existing seller", async () => {
    const { accounts, sent, state } = fakeChain({ provider: provider({ agentId: 0n, activeServices: 1 }), service: service({ agentId: 0n }) });
    await syncRegistration(accounts, SELLER, input, 7n);
    expect(sent).toEqual(["setAgentId", "updateService"]);
    expect(state.service?.agentId).toBe(7n);
  });

  it("registers nothing when reads fail, so an outage never looks like 'not registered'", async () => {
    const { accounts, sent } = fakeChain({ rpcDown: true });
    await expect(syncRegistration(accounts, SELLER, input, 7n)).rejects.toThrow("fetch failed");
    expect(sent).toEqual([]);
  });

  it("uses the key the contract derives", async () => {
    const { accounts } = fakeChain({});
    const { key } = await syncRegistration(accounts, SELLER, input, 7n);
    expect(key).toBe(serviceKey(SELLER, input.name));
  });
});

describe("upgrade", () => {
  const NOW = 1_800_000_000n;
  const now = () => NOW;
  const live = provider({ paidUntil: NOW + 1000n });

  it("approves exactly price × periods, then subscribes", async () => {
    const { chain, accounts, sent } = fakeChain({ provider: live });
    const quote = await quoteUpgrade(chain, accounts, USDC, 3);
    expect(quote.amount).toBe(3_000_000n);
    const result = await runUpgrade(chain, accounts, USDC, 3, quote, now);
    expect(sent).toEqual(["approve", "subscribe"]);
    expect((chain.send as ReturnType<typeof vi.fn>).mock.calls[0][1].args).toEqual([CONTRACT, 3_000_000n]);
    expect(result.after - result.before).toBe(3n * PERIOD_SECONDS);
    expect(result.allowanceAfter).toBe(0n);
  });

  it("replaces a larger leftover allowance rather than leaving it open", async () => {
    const { chain, accounts, sent } = fakeChain({ provider: live, allowance: 99_000_000n });
    await runUpgrade(chain, accounts, USDC, 1, await quoteUpgrade(chain, accounts, USDC, 1), now);
    expect(sent[0]).toBe("approve");
  });

  it("skips the approve when the allowance is already exact", async () => {
    const { chain, accounts, sent } = fakeChain({ provider: live, allowance: 1_000_000n });
    await runUpgrade(chain, accounts, USDC, 1, await quoteUpgrade(chain, accounts, USDC, 1), now);
    expect(sent).toEqual(["subscribe"]);
  });

  it("refuses when USDC does not cover the price plus gas, before sending anything", async () => {
    const { chain, accounts, sent } = fakeChain({ provider: live, balance: 1_000_000n + UPGRADE_GAS_MARGIN - 1n });
    await expect(runUpgrade(chain, accounts, USDC, 1, await quoteUpgrade(chain, accounts, USDC, 1), now)).rejects.toThrow(/price plus gas/);
    expect(sent).toEqual([]);
  });

  it("refuses without a provider account", async () => {
    const { chain, accounts, sent } = fakeChain({});
    await expect(runUpgrade(chain, accounts, USDC, 1, await quoteUpgrade(chain, accounts, USDC, 1), now)).rejects.toThrow(/chainpe register/);
    expect(sent).toEqual([]);
  });

  it.each([0, 13, 1.5, Number.NaN])("refuses %s periods", async (periods) => {
    const { chain, accounts } = fakeChain({ provider: live });
    await expect(quoteUpgrade(chain, accounts, USDC, periods)).rejects.toThrow(/1 to 12/);
  });

  it("reports a subscribe that did not move the plan", async () => {
    const { chain, accounts, state } = fakeChain({ provider: live });
    const send = chain.send as ReturnType<typeof vi.fn>;
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (label: string, call: ContractCall) => {
      const before = state.provider;
      const tx = await original(label, call);
      if (call.functionName === "subscribe") state.provider = before;
      return tx;
    });
    await expect(runUpgrade(chain, accounts, USDC, 1, await quoteUpgrade(chain, accounts, USDC, 1), now)).rejects.toThrow(/paidUntil/);
  });
});

describe("agent card", () => {
  const config: ChainPeConfig = {
    serviceName: "ChainPe Weather Demo",
    serviceDescription: "Weather",
    tags: ["weather"],
    targetUrl: "http://backend.internal:3001",
    pricePerRequest: "0.001",
    paymentToken: "USDC",
    walletAddress: SELLER,
    proxyPort: 4402,
    network: "arc-testnet",
    adminKey: "top-secret",
    publicUrl: "https://api.example.com",
  };

  it("describes the service with the rails it really offers", () => {
    expect(buildAgentCard(config)).toMatchObject({
      name: config.serviceName,
      endpoint: config.publicUrl,
      x402: { networks: ["eip155:5042002"], rails: ["gateway"], priceUsd: "0.001" },
      chainpe: { serviceKey: serviceKey(SELLER, config.serviceName) },
    });
  });

  it("never contains the backend URL or admin key", () => {
    const text = JSON.stringify(buildAgentCard(config));
    expect(text).not.toContain("backend.internal");
    expect(text).not.toContain("top-secret");
  });

  it("does not exist without a public URL", () => {
    expect(buildAgentCard({ ...config, publicUrl: undefined })).toBeUndefined();
  });
});
