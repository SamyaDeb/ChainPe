import { describe, expect, it, vi } from "vitest";
import { BaseError, ContractFunctionRevertedError, encodeAbiParameters, encodeErrorResult, encodeEventTopics, keccak256, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { chainPeAccountsAbi } from "../src/abi/ChainPeAccounts.js";
import { AccountsReader, accountsAddress, serviceKey } from "../src/accounts.js";
import { getNetwork } from "../src/chains.js";
import { ensureIdentity, explorerAgentIdLookup, IDENTITY_REGISTRY_ABI, ownerOfAgent, type AgentIdLookup } from "../src/erc8004.js";
import { assertPublicUrl, buildServiceInput, canonicalPrice, isPrivateHost, sanitizeForTerminal } from "../src/listing.js";
import { createChainWriter, describeChainError, revertName, type ChainWriter, type ContractCall } from "../src/onchain.js";
import { createRoutesConfig } from "../src/proxy/routeConfig.js";
import type { ChainPeConfig } from "../src/types.js";

const SELLER = "0x261f058496D81703c858DDFEd201834F0b5f2e73" as Address;
const OTHER = "0x24BC730c658201bC51873f7aeAaDE65A545c7A11" as Address;
const REGISTRY = getNetwork("arc-testnet").identityRegistry;
const HASH = `0x${"ab".repeat(32)}` as Hex;

/** A real revert, as viem raises it, so decoding is exercised and not assumed. */
function revert(abi: Abi | readonly unknown[], errorName: string, args: readonly unknown[], functionName = "f") {
  const data = encodeErrorResult({ abi: abi as Abi, errorName, args } as never);
  return new ContractFunctionRevertedError({ abi: abi as Abi, data, functionName });
}

const config = (overrides: Partial<ChainPeConfig> = {}): ChainPeConfig => ({
  serviceName: "ChainPe Weather Demo",
  serviceDescription: "Weather",
  tags: ["weather", "demo"],
  targetUrl: "http://localhost:3001",
  pricePerRequest: "0.01",
  paymentToken: "USDC",
  walletAddress: SELLER,
  proxyPort: 4402,
  network: "arc-testnet",
  ...overrides,
});

describe("network addresses", () => {
  it("has the canonical registries on both networks", () => {
    expect(getNetwork("arc-testnet").identityRegistry).toBe("0x8004A818BFB912233c491871b3d84c89A494BD9e");
    expect(getNetwork("arc").identityRegistry).toBe("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
    expect(getNetwork("arc").reputationRegistry).toBe("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");
  });

  it("refuses arc mainnet cleanly while ChainPeAccounts is not deployed there", () => {
    expect(() => accountsAddress("arc")).toThrow(/not deployed on arc/);
  });
});

describe("write helper", () => {
  const writerWith = (publicClient: Partial<PublicClient>, writeContract = vi.fn(async () => HASH)) =>
    ({
      writer: createChainWriter(publicClient as PublicClient, { writeContract } as unknown as WalletClient, SELLER),
      writeContract,
    });
  const call: ContractCall = { address: OTHER, abi: chainPeAccountsAbi, functionName: "registerProvider", args: [0n] };

  it("simulates, sends, and returns once the receipt succeeded", async () => {
    const order: string[] = [];
    const { writer } = writerWith(
      {
        simulateContract: vi.fn(async () => (order.push("simulate"), { request: { functionName: "x" } })) as never,
        waitForTransactionReceipt: vi.fn(async () => (order.push("wait"), { status: "success", logs: [] })) as never,
      },
      vi.fn(async () => (order.push("write"), HASH))
    );
    const tx = await writer.send("registerProvider", call);
    expect(tx.hash).toBe(HASH);
    expect(order).toEqual(["simulate", "write", "wait"]);
  });

  it("throws when the receipt says the transaction reverted", async () => {
    const { writer } = writerWith({
      simulateContract: vi.fn(async () => ({ request: {} })) as never,
      waitForTransactionReceipt: vi.fn(async () => ({ status: "reverted", logs: [] })) as never,
    });
    await expect(writer.send("registerProvider", call)).rejects.toThrow(/reverted on-chain/);
  });

  it("sends nothing and explains the custom error when the simulation reverts", async () => {
    const { writer, writeContract } = writerWith({
      simulateContract: vi.fn(async () => {
        throw revert(chainPeAccountsAbi, "ServiceLimitReached", [1n]);
      }) as never,
    });
    await expect(writer.send("registerService", call)).rejects.toThrow(/chainpe upgrade/);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("decodes a known revert and leaves other failures alone", () => {
    expect(revertName(revert(chainPeAccountsAbi, "ServiceNotFound", [HASH]))).toBe("ServiceNotFound");
    expect(revertName(new Error("fetch failed"))).toBeUndefined();
    expect(describeChainError(new Error("fetch failed"))).toBe("fetch failed");
  });
});

describe("absent vs could not check", () => {
  const rpcDown = new Error("fetch failed");

  it("reads a missing service as null only on ServiceNotFound", async () => {
    const missing = new AccountsReader({ read: async () => { throw revert(chainPeAccountsAbi, "ServiceNotFound", [HASH]); } }, OTHER);
    await expect(missing.service(HASH)).resolves.toBeNull();
    const down = new AccountsReader({ read: async () => { throw rpcDown; } }, OTHER);
    await expect(down.service(HASH)).rejects.toThrow("fetch failed");
  });

  it("reads a missing agent as null only on ERC721NonexistentToken", async () => {
    const missing = { read: async () => { throw revert(IDENTITY_REGISTRY_ABI, "ERC721NonexistentToken", [5n]); } };
    await expect(ownerOfAgent(missing, REGISTRY, 5n)).resolves.toBeNull();
    await expect(ownerOfAgent({ read: async () => { throw rpcDown; } }, REGISTRY, 5n)).rejects.toThrow("fetch failed");
  });
});

describe("deployment check", () => {
  const reader = (usdc: string, identity: string) =>
    new AccountsReader({ read: (async (c: ContractCall) => (c.functionName === "usdc" ? usdc : identity)) as never }, OTHER);

  it("accepts ours and refuses another contract", async () => {
    const { usdc, identityRegistry } = getNetwork("arc-testnet");
    await expect(reader(usdc, identityRegistry).assertDeployment("arc-testnet")).resolves.toBeUndefined();
    await expect(reader(OTHER, identityRegistry).assertDeployment("arc-testnet")).rejects.toThrow(/CHAINPE_ACCOUNTS_ADDRESS/);
  });
});

describe("deployment check failures", () => {
  it("calls a contract that reverts the wrong contract, but an outage an outage", async () => {
    const reverting = new AccountsReader({ read: async () => { throw revert(chainPeAccountsAbi, "ZeroPrice", []); } }, OTHER);
    await expect(reverting.assertDeployment("arc-testnet")).rejects.toThrow(/CHAINPE_ACCOUNTS_ADDRESS/);
    const wrapped = new BaseError("HTTP request failed.", { cause: new Error("connect ECONNREFUSED") });
    const down = new AccountsReader({ read: async () => { throw wrapped; } }, OTHER);
    await expect(down.assertDeployment("arc-testnet")).rejects.toBe(wrapped);
  });
});

describe("serviceKey", () => {
  it("is keccak256(abi.encode(provider, name))", () => {
    const expected = keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [SELLER, "ChainPe Weather Demo"]));
    expect(serviceKey(SELLER.toLowerCase(), "ChainPe Weather Demo")).toBe(expected);
  });
});

describe("publicUrl", () => {
  const opts = { network: "arc-testnet" as const, targetUrl: "http://localhost:3001" };

  it("returns the canonical URL", () => {
    expect(assertPublicUrl("https://api.example.com/", opts)).toBe("https://api.example.com");
  });

  it.each([
    [undefined, /No publicUrl/],
    ["not a url", /not a valid URL/],
    ["http://api.example.com", /must use https/],
    ["ftp://api.example.com", /must use https/],
    ["https://localhost:4402", /private/],
    ["https://127.0.0.1", /private/],
    ["https://2130706433", /private/],
    ["https://10.1.2.3", /private/],
    ["https://172.20.0.1", /private/],
    ["https://192.168.1.5", /private/],
    ["https://169.254.169.254", /private/],
    ["https://[::1]", /private/],
    ["https://[::ffff:127.0.0.1]", /private/],
    ["https://[fd00::1]", /private/],
    ["https://backend.internal", /private/],
    ["https://user:pass@api.example.com", /credentials/],
    ["https://api.example.com/?key=secret", /query/],
    [`https://example.com/${"a".repeat(260)}`, /bytes/],
  ])("refuses %s", (url, message) => {
    expect(() => assertPublicUrl(url, opts)).toThrow(message);
  });

  it("refuses the backend's own address, which would let buyers skip payment", () => {
    expect(() => assertPublicUrl("https://backend.example.com/api", { ...opts, targetUrl: "https://backend.example.com" })).toThrow(/skip payment/);
  });

  it("allows http only when asked and only on testnet", () => {
    expect(assertPublicUrl("http://api.example.com", { ...opts, allowHttp: true })).toBe("http://api.example.com");
    expect(() => assertPublicUrl("http://api.example.com", { ...opts, network: "arc", allowHttp: true })).toThrow(/testnet only/);
    expect(() => assertPublicUrl("http://localhost:4402", { ...opts, allowHttp: true })).toThrow(/private/);
  });

  it("does not treat public addresses as private", () => {
    for (const host of ["api.example.com", "8.8.8.8", "172.32.0.1", "[2606:4700::1111]"]) expect(isPrivateHost(host)).toBe(false);
  });
});

describe("service input", () => {
  const URL_ = "https://api.example.com";

  it("builds the listing from config, never from targetUrl", () => {
    const input = buildServiceInput(config(), "arc-testnet", URL_);
    expect(input).toMatchObject({ endpoint: URL_, pricePerRequest: "0.01", network: "eip155:5042002", payTo: SELLER, tags: "weather,demo", acceptsExact: true, acceptsGateway: true });
    expect(JSON.stringify(input)).not.toContain("3001");
  });

  it("canonicalises prices and refuses what the contract's digit check would let through", () => {
    expect(canonicalPrice("$0.010")).toBe("0.01");
    for (const bad of ["a1", "1.2.3", "0", "0.00", "-1", "0.0000001", ""]) expect(() => canonicalPrice(bad)).toThrow(/Invalid price/);
  });

  it("counts bytes, as the contract does, not characters", () => {
    const name = "é".repeat(33); // 33 characters, 66 bytes
    expect(name.length).toBeLessThanOrEqual(64);
    expect(() => buildServiceInput(config({ serviceName: name }), "arc-testnet", URL_)).toThrow(/name is 66 bytes/);
    expect(() => buildServiceInput(config({ serviceDescription: "x".repeat(1025) }), "arc-testnet", URL_)).toThrow(/description/);
    expect(() => buildServiceInput(config({ tags: ["x".repeat(257)] }), "arc-testnet", URL_)).toThrow(/tags/);
  });

  it("does not list exact under $0.01, matching what the 402 offers", () => {
    const input = buildServiceInput(config({ pricePerRequest: "0.001" }), "arc-testnet", URL_);
    expect(input).toMatchObject({ acceptsExact: false, acceptsGateway: true });
    const terms = { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9" };
    const routes = createRoutesConfig(config({ pricePerRequest: "0.001" }), [], terms);
    expect(routes["* /*"].accepts).toHaveLength(1);
  });

  it("refuses a listing no rail can take", () => {
    expect(() => buildServiceInput(config({ pricePerRequest: "0.001", rails: ["exact"] }), "arc-testnet", URL_)).toThrow(/No payment rail/);
  });
});

describe("terminal safety", () => {
  it("strips escape sequences, control characters and bidi overrides", () => {
    expect(sanitizeForTerminal("\u001b[31mred\u001b[0m")).toBe("red");
    expect(sanitizeForTerminal("\u001b]0;pwned\u0007ok")).toBe("ok");
    expect(sanitizeForTerminal("a‮b\nc\u0000d\u009be")).toBe("abcde");
    expect(sanitizeForTerminal("Prévisions météo")).toBe("Prévisions météo");
  });
});

/** An IdentityRegistry in memory. `rpcDown` makes every read fail like an RPC outage. */
function fakeRegistry(state: { owners: Record<string, Address>; uris?: Record<string, string>; rpcDown?: boolean; nextId?: bigint }) {
  const uris = state.uris ?? {};
  const send = vi.fn(async (label: string, call: ContractCall) => {
    const args = call.args as unknown[];
    if (call.functionName === "setAgentURI") {
      uris[String(args[0])] = args[1] as string;
      return { label, hash: HASH, receipt: { status: "success", logs: [] } };
    }
    const id = state.nextId ?? 7n;
    state.owners[String(id)] = SELLER;
    uris[String(id)] = args[0] as string;
    const topics = encodeEventTopics({ abi: IDENTITY_REGISTRY_ABI, eventName: "Registered", args: { agentId: id, owner: SELLER } });
    const data = encodeAbiParameters([{ type: "string" }], [args[0] as string]);
    const log = { address: REGISTRY, topics, data, blockNumber: 1n, transactionHash: HASH, logIndex: 0, blockHash: HASH, transactionIndex: 0, removed: false };
    return { label, hash: HASH, receipt: { status: "success", logs: [log] } };
  });
  const chain = {
    account: SELLER,
    send,
    read: async (call: ContractCall) => {
      if (state.rpcDown) throw new Error("fetch failed");
      const arg = (call.args as unknown[])[0];
      if (call.functionName === "balanceOf") return BigInt(Object.values(state.owners).filter((o) => o === arg).length);
      const owner = state.owners[String(arg)];
      if (!owner) throw revert(IDENTITY_REGISTRY_ABI, "ERC721NonexistentToken", [arg]);
      return call.functionName === "ownerOf" ? owner : (uris[String(arg)] ?? "");
    },
  } as unknown as ChainWriter;
  return { chain, send };
}

describe("ensureIdentity", () => {
  const publicUrl = "https://api.example.com";
  const CARD = `${publicUrl}/.well-known/agent.json`;
  const noLookup: AgentIdLookup = async () => {
    throw new Error("explorer down");
  };
  const base = { registry: REGISTRY, publicUrl, lookup: noLookup };

  it("mints when the wallet provably has none, and saves the id straight away", async () => {
    const { chain, send } = fakeRegistry({ owners: {} });
    const onMinted = vi.fn();
    const result = await ensureIdentity({ ...base, chain, onMinted });
    expect(result).toMatchObject({ agentId: 7n, source: "minted", uriMatches: true });
    expect(send.mock.calls[0][1].args).toEqual([CARD]);
    expect(onMinted).toHaveBeenCalledWith(7n);
  });

  it("does not mint when the RPC is down", async () => {
    const { chain, send } = fakeRegistry({ owners: {}, rpcDown: true });
    await expect(ensureIdentity({ ...base, chain })).rejects.toThrow("fetch failed");
    expect(send).not.toHaveBeenCalled();
  });

  it("recovers an existing token instead of minting a second", async () => {
    const { chain, send } = fakeRegistry({ owners: { "42": SELLER }, uris: { "42": CARD } });
    const result = await ensureIdentity({ ...base, chain, lookup: async () => [42n] });
    expect(result).toMatchObject({ agentId: 42n, source: "recovered" });
    expect(send).not.toHaveBeenCalled();
  });

  it("stops rather than mints when it holds a token the explorer cannot list", async () => {
    const { chain, send } = fakeRegistry({ owners: { "42": SELLER } });
    await expect(ensureIdentity({ ...base, chain })).rejects.toThrow(/--agent-id/);
    await expect(ensureIdentity({ ...base, chain, lookup: async () => [] })).rejects.toThrow(/--agent-id/);
    expect(send).not.toHaveBeenCalled();
  });

  it("asks which one when the wallet holds several", async () => {
    const { chain, send } = fakeRegistry({ owners: { "42": SELLER, "43": SELLER } });
    await expect(ensureIdentity({ ...base, chain, lookup: async () => [42n, 43n] })).rejects.toThrow(/42, 43/);
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores explorer ids the wallet does not really own", async () => {
    const { chain } = fakeRegistry({ owners: { "42": SELLER, "99": OTHER }, uris: { "42": CARD } });
    await expect(ensureIdentity({ ...base, chain, lookup: async () => [42n, 99n] })).resolves.toMatchObject({ agentId: 42n });
  });

  it("stops on a stale configured id, such as 273 from another chain, and never mints over it", async () => {
    const owned = fakeRegistry({ owners: { "273": OTHER } });
    await expect(ensureIdentity({ ...base, chain: owned.chain, configuredAgentId: "273" })).rejects.toThrow(/owned by/);
    expect(owned.send).not.toHaveBeenCalled();
    const absent = fakeRegistry({ owners: {} });
    await expect(ensureIdentity({ ...base, chain: absent.chain, configuredAgentId: "273" })).rejects.toThrow(/does not exist/);
    expect(absent.send).not.toHaveBeenCalled();
  });

  it("keeps a configured id the wallet owns", async () => {
    const { chain, send } = fakeRegistry({ owners: { "5": SELLER }, uris: { "5": CARD } });
    await expect(ensureIdentity({ ...base, chain, configuredAgentId: "5" })).resolves.toMatchObject({ source: "configured", agentId: 5n, uriMatches: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses agentId 0, which the contract reads as no identity", async () => {
    const { chain } = fakeRegistry({ owners: { "0": SELLER } });
    await expect(ensureIdentity({ ...base, chain, explicitAgentId: "0" })).rejects.toThrow(/no identity/);
  });

  it("mints another only with --new", async () => {
    const { chain, send } = fakeRegistry({ owners: { "42": SELLER }, nextId: 8n });
    await expect(ensureIdentity({ ...base, chain, configuredAgentId: "42", mintNew: true })).resolves.toMatchObject({ agentId: 8n, source: "minted" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports a URI that moved, and fixes it only with --update-uri", async () => {
    const reported = fakeRegistry({ owners: { "5": SELLER }, uris: { "5": "https://old.example.com/.well-known/agent.json" } });
    await expect(ensureIdentity({ ...base, chain: reported.chain, configuredAgentId: "5" })).resolves.toMatchObject({ uriMatches: false });
    expect(reported.send).not.toHaveBeenCalled();
    const fixed = fakeRegistry({ owners: { "5": SELLER }, uris: { "5": "https://old.example.com/.well-known/agent.json" } });
    await expect(ensureIdentity({ ...base, chain: fixed.chain, configuredAgentId: "5", updateUri: true })).resolves.toMatchObject({ uriMatches: true });
    expect(fixed.send.mock.calls[0][1].functionName).toBe("setAgentURI");
  });
});

describe("explorer lookup", () => {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response;

  it("keeps only tokens from the identity registry and follows pages", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          items: [
            { id: "1", token: { address_hash: REGISTRY } },
            { id: "9", token: { address_hash: OTHER } },
          ],
          next_page_params: { token_contract_address_hash: "0x1", token_id: "1" },
        })
      )
      .mockResolvedValueOnce(json({ items: [{ id: "2", token: { address: REGISTRY.toLowerCase() } }], next_page_params: null }));
    await expect(explorerAgentIdLookup("arc-testnet", fetchImpl)(SELLER)).resolves.toEqual([1n, 2n]);
    expect(fetchImpl.mock.calls[1][0]).toContain("token_id=1");
  });

  it("throws when the explorer fails, so nobody mints on a guess", async () => {
    await expect(explorerAgentIdLookup("arc-testnet", vi.fn().mockResolvedValue(json({}, false)))(SELLER)).rejects.toThrow(/503/);
  });
});
