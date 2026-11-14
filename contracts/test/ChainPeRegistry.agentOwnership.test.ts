/**
 * Phase 3.3: ChainPeRegistryUpgradeable v2 checks ERC-8004 agentId ownership.
 *
 * Local suite: deploys the frozen pre-upgrade implementation (V1) behind a UUPS proxy, registers
 * services (including one that hijacked an agentId, which V1 allowed), validates the storage layout
 * with @openzeppelin/hardhat-upgrades, upgrades to v2, and checks old state survives.
 *
 * Fork suite (RUN_LIVE_E2E=1): the same upgrade against the real mainnet proxy.
 */
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { deployErc8004 } from "../scripts/lib/deployErc8004";

const FEE = ethers.parseUnits("1.0", 6);
const ZERO = ethers.ZeroAddress;
const PAY_TO = "0x000000000000000000000000000000000000dEaD";

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Weather API", description: "d", tags: "t", endpoint: "https://w.example.com",
    pricePerRequest: "0.01", paymentToken: "USDC", network: "avalanche", payTo: PAY_TO,
    agentId: 0n, ...overrides,
  };
}

async function fixture() {
  const [owner, alice, mallory, treasury] = await ethers.getSigners();
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await usdc.waitForDeployment();
  const { identityRegistry } = await deployErc8004();
  const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);

  const V1 = await ethers.getContractFactory("ChainPeRegistryUpgradeableV1");
  const V2 = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
  const v1Impl = await V1.deploy();
  const Proxy = await ethers.getContractFactory("contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy");
  const proxy = await Proxy.deploy(
    await v1Impl.getAddress(),
    V1.interface.encodeFunctionData("initialize", [
      await usdc.getAddress(), treasury.address, FEE, identityRegistry, owner.address,
    ])
  );
  await proxy.waitForDeployment();
  const addr = await proxy.getAddress();

  for (const s of [alice, mallory]) {
    await usdc.mint(s.address, ethers.parseUnits("100", 6));
    await usdc.connect(s).approve(addr, ethers.MaxUint256);
  }
  return { owner, alice, mallory, treasury, usdc, identity, V1, V2, addr };
}

async function upgradeToV2(f: Awaited<ReturnType<typeof fixture>>) {
  const impl = await f.V2.deploy();
  await impl.waitForDeployment();
  const v1 = f.V1.attach(f.addr).connect(f.owner) as any;
  await v1.upgradeToAndCall(await impl.getAddress(), "0x");
  return f.V2.attach(f.addr) as any;
}

describe("ChainPeRegistryUpgradeable v2: agentId ownership (Phase 3.3)", () => {
  it("storage layout of v2 is upgrade-safe against v1 (validateUpgrade)", async () => {
    const { V1, V2 } = await fixture();
    await upgrades.validateUpgrade(V1, V2, { kind: "uups" });
  });

  it("validateUpgrade rejects a layout-breaking implementation", async () => {
    // Sanity check that the validator is actually doing something: V2 -> V1 is a no-op, but
    // validating the proxy factory itself as a UUPS impl must pass, and a non-UUPS contract must fail.
    const { V1 } = await fixture();
    const Bad = await ethers.getContractFactory("MockUSDC");
    await expect(upgrades.validateUpgrade(V1, Bad, { kind: "uups" })).to.be.rejected;
  });

  it("existing services survive the upgrade, including a V1-era hijacked agentId", async () => {
    const f = await fixture();
    const { alice, mallory, V1, addr, identity } = f;
    await identity.connect(alice)["register(string)"]("ipfs://a"); // agent 0 (unlinkable by design)
    await identity.connect(alice)["register(string)"]("ipfs://a2"); // agent 1
    const v1 = V1.attach(addr) as any;
    await v1.connect(alice).register(input({ name: "alice-svc", agentId: 1n }));
    await v1.connect(mallory).register(input({ name: "hijack", agentId: 1n })); // V1 let this through
    await v1.connect(mallory).register(input({ name: "plain" }));
    const before = await v1.getServices(0, 10);

    const v2 = await upgradeToV2(f);
    expect(await v2.getVersion()).to.equal("2.0.0");
    expect(await v2.getServiceCount()).to.equal(3n);
    const after = await v2.getServices(0, 10);
    expect(after.map((s: any) => s.name)).to.deep.equal(before.map((s: any) => s.name));
    expect(after.map((s: any) => s.agentId)).to.deep.equal(before.map((s: any) => s.agentId));
    expect(await v2.registrationFee()).to.equal(FEE);
    expect(await v2.identityRegistry()).to.equal(await identity.getAddress());
    expect(await v2.owner()).to.equal(f.owner.address);
    expect(await v2.hasService(mallory.address, "hijack")).to.equal(true);
  });

  describe("after the upgrade", () => {
    async function upgraded() {
      const f = await fixture();
      await f.identity.connect(f.alice)["register(string)"]("ipfs://a0"); // id 0
      await f.identity.connect(f.alice)["register(string)"]("ipfs://a1"); // id 1, alice's
      const v2 = await upgradeToV2(f);
      return { ...f, v2 };
    }

    it("hijacking someone else's agentId reverts with NotAgentOwner", async () => {
      const { v2, mallory } = await upgraded();
      await expect(v2.connect(mallory).register(input({ agentId: 1n })))
        .to.be.revertedWithCustomError(v2, "NotAgentOwner").withArgs(1n);
    });

    it("registering with your own agentId works, and update() enforces the same rule", async () => {
      const { v2, alice, mallory } = await upgraded();
      await expect(v2.connect(alice).register(input({ agentId: 1n }))).to.emit(v2, "ServiceRegistered");
      // mallory registers unlinked, then tries to link alice's agent via update()
      await v2.connect(mallory).register(input({ name: "m" }));
      await expect(v2.connect(mallory).update(input({ name: "m", agentId: 1n })))
        .to.be.revertedWithCustomError(v2, "NotAgentOwner");
      await expect(v2.connect(alice).update(input({ agentId: 1n, description: "new" }))).to.emit(v2, "ServiceUpdated");
    });

    it("an approved operator of the agent may register it", async () => {
      const { v2, alice, mallory, identity } = await upgraded();
      await identity.connect(alice).approve(mallory.address, 1n);
      await expect(v2.connect(mallory).register(input({ agentId: 1n }))).to.emit(v2, "ServiceRegistered");
    });

    it("agentId 0 (unlinked) still works", async () => {
      const { v2, mallory } = await upgraded();
      await expect(v2.connect(mallory).register(input({ agentId: 0n }))).to.emit(v2, "ServiceRegistered");
    });

    it("a nonexistent agentId reverts (identity registry reverts on unknown token)", async () => {
      const { v2, mallory } = await upgraded();
      await expect(v2.connect(mallory).register(input({ agentId: 999n }))).to.be.reverted;
    });

    it("fails closed when no identity registry is configured", async () => {
      const { v2, owner, mallory } = await upgraded();
      await v2.connect(owner).setIdentityRegistry(ZERO);
      await expect(v2.connect(mallory).register(input({ agentId: 1n })))
        .to.be.revertedWithCustomError(v2, "NotAgentOwner");
      await expect(v2.connect(mallory).register(input({ agentId: 0n }))).to.emit(v2, "ServiceRegistered");
    });

    it("deregister works while paused; register does not", async () => {
      const { v2, owner, mallory } = await upgraded();
      await v2.connect(mallory).register(input({ name: "x" }));
      await v2.connect(owner).pause();
      await expect(v2.connect(mallory).register(input({ name: "y" }))).to.be.revertedWithCustomError(v2, "EnforcedPause");
      await expect(v2.connect(mallory).deregister("x")).to.emit(v2, "ServiceDeregistered");
    });

    it("non-owner cannot upgrade", async () => {
      const { v2, mallory, V2 } = await upgraded();
      const impl = await V2.deploy();
      await expect(v2.connect(mallory).upgradeToAndCall(await impl.getAddress(), "0x"))
        .to.be.revertedWithCustomError(v2, "OwnableUnauthorizedAccount");
    });
  });
});

// ─── Mainnet fork rehearsal via anvil (opt-in; needs network + foundry) ─────
// Hardhat's EDR cannot fork Avalanche (no hardfork schedule for chain 43114), so this uses anvil.
const LIVE = process.env.RUN_LIVE_E2E === "1";
(LIVE ? describe : describe.skip)("ChainPeRegistry mainnet upgrade rehearsal (anvil fork, RUN_LIVE_E2E=1)", function () {
  this.timeout(180_000);
  const PROXY = "0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E";
  const RPC = process.env.AVALANCHE_RPC_URL ?? "https://api.avax.network/ext/bc/C/rpc";
  const PORT = 18545;
  let anvil: import("child_process").ChildProcess;

  before(async () => {
    const { spawn } = await import("child_process");
    anvil = spawn("anvil", ["--fork-url", RPC, "--port", String(PORT), "--silent", "--no-rate-limit"], { stdio: "ignore" });
    const p = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`);
    for (let i = 0; i < 60; i++) {
      try { await p.getBlockNumber(); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    throw new Error("anvil did not start");
  });
  after(() => { anvil?.kill(); });

  it("existing services survive upgrading the live proxy; hijack now reverts", async () => {
    const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`, undefined, { staticNetwork: true });
    const V1 = await ethers.getContractFactory("ChainPeRegistryUpgradeableV1");
    const V2 = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
    const live = new ethers.Contract(PROXY, V1.interface, provider) as any;
    const ownerAddr: string = await live.owner();
    // Seed legacy state on the fork (the live registry may be empty until Phase 2.4 services exist).
    const fund = async (w: any) => provider.send("anvil_setBalance", [w.address, "0x56BC75E2D63100000"]);
    await provider.send("anvil_impersonateAccount", [ownerAddr]);
    await fund({ address: ownerAddr });
    const ownerSigner0 = await provider.getSigner(ownerAddr);
    await (await (live.connect(ownerSigner0) as any).setRegistrationFee(0)).wait(); // fork-only; avoids needing USDC
    const idAddr0: string = await live.identityRegistry();
    const idc = new ethers.Contract(idAddr0, ["function register(string) returns (uint256)", "function ownerOf(uint256) view returns (address)", "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"], provider);
    const agentOwner = ethers.Wallet.createRandom().connect(provider);
    const squatter = ethers.Wallet.createRandom().connect(provider);
    await fund(agentOwner); await fund(squatter);
    // The live identity registry is 0-indexed and may be empty; id 0 means "unlinked" in ChainPeRegistry,
    // so burn id 0 with a throwaway agent if nobody has taken it yet.
    try { await idc.ownerOf(0n); } catch { await (await (idc.connect(squatter) as any).register("ipfs://burn-id-0")).wait(); }
    const rc = await (await (idc.connect(agentOwner) as any).register("ipfs://fork-test")).wait();
    const regLog = rc.logs.map((l: any) => { try { return idc.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Registered");
    expect(regLog, "Registered event").to.not.equal(undefined);
    const victimId: bigint = regLog.args[0];
    expect(victimId).to.be.gt(0n); // id 0 means "unlinked" and cannot be hijack-tested
    expect(await idc.ownerOf(victimId)).to.equal(agentOwner.address);
    await (await (live.connect(agentOwner) as any).register(input({ name: "legacy-ok", agentId: victimId }))).wait();
    await (await (live.connect(squatter) as any).register(input({ name: "legacy-hijack", agentId: victimId }))).wait(); // V1 allowed this

    const countBefore: bigint = await live.getServiceCount();
    const n = Number(countBefore);
    expect(n).to.be.gte(2);
    const before = await live.getServices(0, Math.min(n, 100));

    const ownerSigner = await provider.getSigner(ownerAddr);
    const impl = await new ethers.ContractFactory(V2.interface, V2.bytecode, ownerSigner).deploy();
    await impl.waitForDeployment();
    await (await (live.connect(ownerSigner) as any).upgradeToAndCall(await impl.getAddress(), "0x")).wait();

    const v2 = new ethers.Contract(PROXY, V2.interface, provider) as any;
    expect(await v2.getVersion()).to.equal("2.0.0");
    expect(await v2.getServiceCount()).to.equal(countBefore);
    const after = await v2.getServices(0, Math.min(n, 100));
    const key = (arr: any[]) => arr.map((s: any) => [s.name, s.payTo, s.agentId.toString(), s.developer, s.endpoint]);
    expect(key(after)).to.deep.equal(key(before));
    expect(await v2.owner()).to.equal(ownerAddr);

    // Hijack attempt: a fresh account tries to link an agent it does not own.
    const rnd = ethers.Wallet.createRandom().connect(provider);
    await fund(rnd);
    const victim = victimId;
    await expect((v2.connect(rnd) as any).register.staticCall(input({ name: "hijack-fork", agentId: victim })))
      .to.be.revertedWithCustomError(v2, "NotAgentOwner");
  });
});
