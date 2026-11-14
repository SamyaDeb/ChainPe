/**
 * Phase 3.5 Step B: PolicyVaultUpgradeable v2 refuses to pay providers below the owner's minimum
 * payment-verified score (ChainPeReputationOracle), setPolicy keeps totalSpent, and session epochs kill old signatures.
 *
 * Fork suite (RUN_LIVE_E2E=1, needs anvil): the same upgrade against the real mainnet proxy.
 */
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const USDC = (n: string) => ethers.parseUnits(n, 6);
const ZERO = ethers.ZeroAddress;

async function fixture() {
  const [owner, agent, relayer, goodProvider, badProvider, attester, other] = await ethers.getSigners();
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await usdc.waitForDeployment();

  const V1 = await ethers.getContractFactory("PolicyVaultUpgradeableV1");
  const V2 = await ethers.getContractFactory("PolicyVaultUpgradeable");
  const v1Impl = await V1.deploy();
  const Proxy = await ethers.getContractFactory("contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy");
  const proxy = await Proxy.deploy(
    await v1Impl.getAddress(),
    V1.interface.encodeFunctionData("initialize", [await usdc.getAddress(), owner.address])
  );
  await proxy.waitForDeployment();
  const addr = await proxy.getAddress();

  await usdc.mint(owner.address, USDC("1000"));
  await usdc.connect(owner).approve(addr, USDC("1000"));
  const oracle = await (await ethers.getContractFactory("ChainPeReputationOracle")).deploy(owner.address, attester.address);
  return { owner, agent, relayer, goodProvider, badProvider, attester, other, usdc, V1, V2, addr, oracle };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function upgrade(f: F) {
  const impl = await f.V2.deploy();
  await impl.waitForDeployment();
  await (f.V1.attach(f.addr).connect(f.owner) as any).upgradeToAndCall(await impl.getAddress(), "0x");
  return f.V2.attach(f.addr) as any;
}

async function sign(vault: any, signer: any, owner: string, to: string, amount: bigint, deadline: number, opts: { epoch?: bigint; v1?: boolean } = {}) {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "ChainPePolicyVault", version: "1", chainId, verifyingContract: await vault.getAddress() };
  const nonce = await vault.nonces(owner);
  const base = [
    { name: "owner", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ];
  if (opts.v1) return signer.signTypedData(domain, { Spend: base }, { owner, to, amount, nonce, deadline });
  const epoch = opts.epoch ?? (await vault.sessionEpoch(owner));
  return signer.signTypedData(domain, { Spend: [...base, { name: "epoch", type: "uint256" }] }, { owner, to, amount, nonce, deadline, epoch });
}

async function ready(f: F) {
  const vault = await upgrade(f);
  await vault.connect(f.owner).deposit(USDC("500"));
  const expiry = (await time.latest()) + 7 * 86400;
  await vault.connect(f.owner).setPolicy(f.agent.address, USDC("10"), USDC("50"), USDC("100"), expiry, false);
  return { vault, expiry };
}
const deadline = async () => (await time.latest()) + 600;

describe("ChainPeReputationOracle", () => {
  it("only an attester can score; scores are 0-100; the owner manages attesters", async () => {
    const f = await fixture();
    await expect(f.oracle.connect(f.other).setScore(f.goodProvider.address, 90, 5)).to.be.revertedWithCustomError(f.oracle, "NotAttester");
    await expect(f.oracle.connect(f.attester).setScore(f.goodProvider.address, 101, 5)).to.be.revertedWithCustomError(f.oracle, "ScoreOutOfRange");
    await expect(f.oracle.connect(f.attester).setScore(ZERO, 90, 5)).to.be.revertedWithCustomError(f.oracle, "ZeroAddress");
    await f.oracle.connect(f.attester).setScore(f.goodProvider.address, 90, 5);
    expect(await f.oracle.score(f.goodProvider.address)).to.equal(90);
    await expect(f.oracle.connect(f.other).setAttester(f.other.address, true)).to.be.revertedWithCustomError(f.oracle, "OwnableUnauthorizedAccount");
    await f.oracle.connect(f.owner).setAttester(f.attester.address, false);
    await expect(f.oracle.connect(f.attester).setScore(f.goodProvider.address, 90, 5)).to.be.revertedWithCustomError(f.oracle, "NotAttester");
  });

  it("score() reads 0 for unrated, thinly reviewed and stale providers, but getEntry shows the record", async () => {
    const f = await fixture();
    await f.oracle.connect(f.attester).setScore(f.goodProvider.address, 95, 2); // below the default 3 reviews
    expect(await f.oracle.score(f.goodProvider.address)).to.equal(0);
    expect((await f.oracle.getEntry(f.goodProvider.address))[0]).to.equal(95);
    expect(await f.oracle.score(f.badProvider.address)).to.equal(0);
    await f.oracle.connect(f.owner).setMinPaidReviews(2);
    expect(await f.oracle.score(f.goodProvider.address)).to.equal(95);
    await f.oracle.connect(f.owner).setMaxAge(3600);
    expect(await f.oracle.score(f.goodProvider.address)).to.equal(95);
    await time.increase(3601);
    expect(await f.oracle.score(f.goodProvider.address)).to.equal(0);
  });

  it("setScores updates a batch and rejects mismatched lengths", async () => {
    const f = await fixture();
    await f.oracle.connect(f.attester).setScores([f.goodProvider.address, f.badProvider.address], [90, 10], [5, 6]);
    expect(await f.oracle.score(f.goodProvider.address)).to.equal(90);
    expect(await f.oracle.score(f.badProvider.address)).to.equal(10);
    await expect(f.oracle.connect(f.attester).setScores([f.goodProvider.address], [90, 10], [5])).to.be.revertedWithCustomError(f.oracle, "LengthMismatch");
  });
});

describe("PolicyVaultUpgradeable v2 upgrade", () => {
  it("storage layout of v2 is upgrade-safe against v1 (validateUpgrade)", async () => {
    const { V1, V2 } = await fixture();
    await upgrades.validateUpgrade(V1, V2, { kind: "uups" });
  });

  it("existing deposits, policies, allowlists, nonces and spend history survive the upgrade", async () => {
    const f = await fixture();
    const v1 = f.V1.attach(f.addr) as any;
    await v1.connect(f.owner).deposit(USDC("300"));
    const expiry = (await time.latest()) + 86400;
    await v1.connect(f.owner).setPolicy(f.agent.address, USDC("10"), USDC("50"), USDC("100"), expiry, true);
    await v1.connect(f.owner).setAllowlist(f.goodProvider.address, true);
    // A V1-format spend, so nonces/totalSpent/dailySpent are non-zero before the upgrade.
    const d = await deadline();
    const sig = await sign(v1, f.agent, f.owner.address, f.goodProvider.address, USDC("4"), d, { v1: true });
    await v1.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("4"), d, sig);

    const before = {
      bal: await v1.balanceOf(f.owner.address), spent: await v1.totalSpent(f.owner.address),
      nonce: await v1.nonces(f.owner.address), policy: await v1.policyOf(f.owner.address),
      allowed: await v1.allowlist(f.owner.address, f.goodProvider.address), domain: await v1.domainSeparator(),
    };
    const v2 = await upgrade(f);
    expect(await v2.getVersion()).to.equal("2.0.0");
    expect(await v2.balanceOf(f.owner.address)).to.equal(before.bal);
    expect(await v2.totalSpent(f.owner.address)).to.equal(before.spent);
    expect(await v2.nonces(f.owner.address)).to.equal(before.nonce);
    expect((await v2.policyOf(f.owner.address)).sessionKey).to.equal(before.policy.sessionKey);
    expect(await v2.allowlist(f.owner.address, f.goodProvider.address)).to.equal(before.allowed);
    expect(await v2.domainSeparator()).to.equal(before.domain);
    expect(await v2.owner()).to.equal(f.owner.address);
    // New storage starts empty.
    expect(await v2.reputationOracle()).to.equal(ZERO);
    expect(await v2.minScoreOf(f.owner.address)).to.equal(0);
    expect(await v2.sessionEpoch(f.owner.address)).to.equal(0);
  });

  it("an authorization signed in the v1 format is rejected after the upgrade", async () => {
    const f = await fixture();
    const v1 = f.V1.attach(f.addr) as any;
    await v1.connect(f.owner).deposit(USDC("100"));
    await v1.connect(f.owner).setPolicy(f.agent.address, USDC("10"), USDC("50"), USDC("100"), (await time.latest()) + 86400, false);
    const d = await deadline();
    const oldSig = await sign(v1, f.agent, f.owner.address, f.goodProvider.address, USDC("4"), d, { v1: true });
    const v2 = await upgrade(f);
    await expect(v2.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("4"), d, oldSig)).to.be.revertedWithCustomError(v2, "BadSessionSig");
  });

  it("only the owner can set the oracle or upgrade", async () => {
    const f = await fixture();
    const v2 = await upgrade(f);
    await expect(v2.connect(f.other).setReputationOracle(await f.oracle.getAddress())).to.be.revertedWithCustomError(v2, "OwnableUnauthorizedAccount");
    const impl = await f.V2.deploy();
    await expect(v2.connect(f.other).upgradeToAndCall(await impl.getAddress(), "0x")).to.be.revertedWithCustomError(v2, "OwnableUnauthorizedAccount");
  });
});

describe("reputation gate in spend()", () => {
  async function gated() {
    const f = await fixture();
    const { vault } = await ready(f);
    await vault.connect(f.owner).setReputationOracle(await f.oracle.getAddress());
    await f.oracle.connect(f.attester).setScores([f.goodProvider.address, f.badProvider.address], [85, 15], [9, 9]);
    return { f, vault };
  }
  const spendTo = async (f: F, vault: any, to: string, amount = USDC("1")) => {
    const d = await deadline();
    return vault.connect(f.relayer).spend(f.owner.address, to, amount, d, await sign(vault, f.agent, f.owner.address, to, amount, d));
  };

  it("pays a provider at or above the minimum and refuses one below it", async () => {
    const { f, vault } = await gated();
    await vault.connect(f.owner).setMinScore(60);
    await expect(spendTo(f, vault, f.goodProvider.address)).to.emit(vault, "Spent");
    await expect(spendTo(f, vault, f.badProvider.address)).to.be.revertedWithCustomError(vault, "ProviderReputationTooLow");
    await vault.connect(f.owner).setMinScore(85); // exactly at the score still passes
    await expect(spendTo(f, vault, f.goodProvider.address)).to.emit(vault, "Spent");
    await vault.connect(f.owner).setMinScore(86);
    await expect(spendTo(f, vault, f.goodProvider.address)).to.be.revertedWithCustomError(vault, "ProviderReputationTooLow");
  });

  it("refuses an unrated recipient, and one with too few paid reviews", async () => {
    const { f, vault } = await gated();
    await vault.connect(f.owner).setMinScore(1);
    await expect(spendTo(f, vault, f.other.address)).to.be.revertedWithCustomError(vault, "ProviderReputationTooLow");
    await f.oracle.connect(f.attester).setScore(f.other.address, 100, 1);
    await expect(spendTo(f, vault, f.other.address)).to.be.revertedWithCustomError(vault, "ProviderReputationTooLow");
  });

  it("changes nothing without a minimum, even with no oracle set", async () => {
    const f = await fixture();
    const { vault } = await ready(f);
    await expect(spendTo(f, vault, f.badProvider.address)).to.emit(vault, "Spent");
  });

  it("fails closed when a minimum is set but no oracle is configured", async () => {
    const f = await fixture();
    const { vault } = await ready(f);
    await vault.connect(f.owner).setMinScore(60);
    await expect(spendTo(f, vault, f.goodProvider.address)).to.be.revertedWithCustomError(vault, "ReputationOracleNotSet");
  });

  it("each owner sets their own minimum, and it must be 0-100", async () => {
    const { f, vault } = await gated();
    await vault.connect(f.other).setMinScore(90);
    expect(await vault.minScoreOf(f.other.address)).to.equal(90);
    expect(await vault.minScoreOf(f.owner.address)).to.equal(0);
    await expect(vault.connect(f.owner).setMinScore(101)).to.be.revertedWithCustomError(vault, "ScoreOutOfRange");
    await expect(vault.connect(f.owner).setMinScore(70)).to.emit(vault, "MinScoreSet").withArgs(f.owner.address, 70);
  });

  it("a refused spend moves no money and burns no nonce", async () => {
    const { f, vault } = await gated();
    await vault.connect(f.owner).setMinScore(60);
    const before = [await vault.balanceOf(f.owner.address), await vault.nonces(f.owner.address), await vault.totalSpent(f.owner.address)];
    await expect(spendTo(f, vault, f.badProvider.address)).to.be.reverted;
    expect([await vault.balanceOf(f.owner.address), await vault.nonces(f.owner.address), await vault.totalSpent(f.owner.address)]).to.deep.equal(before);
  });

  it("previewSpend reports the reason", async () => {
    const { f, vault } = await gated();
    await vault.connect(f.owner).setMinScore(60);
    expect((await vault.previewSpend(f.owner.address, f.goodProvider.address, USDC("1")))[0]).to.equal(true);
    expect(await vault.previewSpend(f.owner.address, f.badProvider.address, USDC("1"))).to.deep.equal([false, "provider reputation too low"]);
    await vault.connect(f.owner).setReputationOracle(ZERO);
    expect((await vault.previewSpend(f.owner.address, f.goodProvider.address, USDC("1")))[1]).to.equal("reputation oracle not set");
  });
});

describe("setPolicy keeps totalSpent; session epochs kill old signatures", () => {
  it("setPolicy no longer resets totalSpent, so budget cannot be erased by re-setting the policy", async () => {
    const f = await fixture();
    const { vault, expiry } = await ready(f);
    const d = await deadline();
    await vault.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("8"), d, await sign(vault, f.agent, f.owner.address, f.goodProvider.address, USDC("8"), d));
    expect(await vault.totalSpent(f.owner.address)).to.equal(USDC("8"));
    await vault.connect(f.owner).setPolicy(f.agent.address, USDC("10"), USDC("50"), USDC("100"), expiry, false);
    expect(await vault.totalSpent(f.owner.address)).to.equal(USDC("8"));
    expect(await vault.budgetRemaining(f.owner.address)).to.equal(USDC("92"));
    // A lifetime budget that is used up stays used up until the owner raises it.
    await vault.connect(f.owner).setPolicy(f.agent.address, USDC("8"), USDC("50"), USDC("8"), expiry, false);
    const d2 = await deadline();
    await expect(vault.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("1"), d2, await sign(vault, f.agent, f.owner.address, f.goodProvider.address, USDC("1"), d2))).to.be.revertedWithCustomError(vault, "OverTotalBudget");
  });

  it("revokeSession really kills an outstanding signature, even if the same key is re-enabled", async () => {
    const f = await fixture();
    const { vault, expiry } = await ready(f);
    const d = await deadline();
    const sig = await sign(vault, f.agent, f.owner.address, f.goodProvider.address, USDC("5"), d);
    await vault.connect(f.owner).revokeSession();
    await expect(vault.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("5"), d, sig)).to.be.revertedWithCustomError(vault, "SessionInactive");
    // The same session key is switched back on: the old signature must STILL be dead.
    await vault.connect(f.owner).setPolicy(f.agent.address, USDC("10"), USDC("50"), USDC("100"), expiry, false);
    await expect(vault.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("5"), d, sig)).to.be.revertedWithCustomError(vault, "BadSessionSig");
    // A signature for the new epoch works.
    const fresh = await sign(vault, f.agent, f.owner.address, f.goodProvider.address, USDC("5"), d);
    await expect(vault.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("5"), d, fresh)).to.emit(vault, "Spent");
  });

  it("epochs are per owner: one owner revoking does not touch another's signatures", async () => {
    const f = await fixture();
    const { vault } = await ready(f);
    await vault.connect(f.other).revokeSession();
    expect(await vault.sessionEpoch(f.other.address)).to.equal(1);
    expect(await vault.sessionEpoch(f.owner.address)).to.equal(1); // only its own setPolicy
    const d = await deadline();
    await expect(vault.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("1"), d, await sign(vault, f.agent, f.owner.address, f.goodProvider.address, USDC("1"), d))).to.emit(vault, "Spent");
  });

  it("a signature carrying the wrong epoch is rejected", async () => {
    const f = await fixture();
    const { vault } = await ready(f);
    const d = await deadline();
    const sig = await sign(vault, f.agent, f.owner.address, f.goodProvider.address, USDC("1"), d, { epoch: 99n });
    await expect(vault.connect(f.relayer).spend(f.owner.address, f.goodProvider.address, USDC("1"), d, sig)).to.be.revertedWithCustomError(vault, "BadSessionSig");
  });
});

// ─── Mainnet fork rehearsal via anvil (opt-in) ──────────────────────────────
const LIVE = process.env.RUN_LIVE_E2E === "1";
(LIVE ? describe : describe.skip)("PolicyVault mainnet upgrade rehearsal (anvil fork, RUN_LIVE_E2E=1)", function () {
  this.timeout(180_000);
  const PROXY = "0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8";
  const RPC = process.env.AVALANCHE_RPC_URL ?? "https://api.avax.network/ext/bc/C/rpc";
  const PORT = 18546;
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

  it("the live proxy keeps its state across the upgrade and gains the reputation gate", async () => {
    const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`, undefined, { staticNetwork: true });
    const V1 = await ethers.getContractFactory("PolicyVaultUpgradeableV1");
    const V2 = await ethers.getContractFactory("PolicyVaultUpgradeable");
    const live = new ethers.Contract(PROXY, V1.interface, provider) as any;
    const ownerAddr: string = await live.owner();
    const tokenBefore = await live.token();
    const domainBefore = await live.domainSeparator();

    await provider.send("anvil_impersonateAccount", [ownerAddr]);
    await provider.send("anvil_setBalance", [ownerAddr, "0x56BC75E2D63100000"]);
    const ownerSigner = await provider.getSigner(ownerAddr);
    const impl = await new ethers.ContractFactory(V2.interface, V2.bytecode, ownerSigner).deploy();
    await impl.waitForDeployment();
    await (await (live.connect(ownerSigner) as any).upgradeToAndCall(await impl.getAddress(), "0x")).wait();

    const v2 = new ethers.Contract(PROXY, V2.interface, provider) as any;
    expect(await v2.getVersion()).to.equal("2.0.0");
    expect(await v2.owner()).to.equal(ownerAddr);
    expect(await v2.token()).to.equal(tokenBefore);
    expect(await v2.domainSeparator()).to.equal(domainBefore);
    expect(await v2.reputationOracle()).to.equal(ZERO);

    // The owner can wire an oracle and a minimum on the upgraded proxy.
    const oracle = await new ethers.ContractFactory((await ethers.getContractFactory("ChainPeReputationOracle")).interface, (await ethers.getContractFactory("ChainPeReputationOracle")).bytecode, ownerSigner).deploy(ownerAddr, ownerAddr);
    await oracle.waitForDeployment();
    await (await (v2.connect(ownerSigner) as any).setReputationOracle(await oracle.getAddress())).wait();
    await (await (v2.connect(ownerSigner) as any).setMinScore(60)).wait();
    expect(await v2.reputationOracle()).to.equal(await oracle.getAddress());
    expect(await v2.minScoreOf(ownerAddr)).to.equal(60);
  });
});
