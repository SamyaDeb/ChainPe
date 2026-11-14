/**
 * Tests for PolicyVaultUpgradeable — proves the UUPS proxy pattern works and
 * that an upgrade can be pushed. These are separate from PolicyVault.test.ts
 * (which tests the non-upgradeable Fuji version) so neither breaks the other.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { PolicyVaultUpgradeable, MockUSDC } from "../typechain-types";

const USDC = (n: string) => ethers.parseUnits(n, 6);

describe("PolicyVaultUpgradeable (UUPS proxy)", () => {
  async function deployFixture() {
    const [owner, agent, relayer, provider, other] = await ethers.getSigners();

    const Usdc = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Usdc.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    // Deploy implementation + proxy (mirrors the deploy script).
    const Impl = await ethers.getContractFactory("PolicyVaultUpgradeable");
    const impl = await Impl.deploy();
    await impl.waitForDeployment();

    const initData = Impl.interface.encodeFunctionData("initialize", [
      await usdc.getAddress(),
      owner.address,
    ]);
    const Proxy = await ethers.getContractFactory(
      "contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy"
    );
    const proxy = await Proxy.deploy(await impl.getAddress(), initData);
    await proxy.waitForDeployment();

    const vault = (await ethers.getContractAt(
      "PolicyVaultUpgradeable",
      await proxy.getAddress()
    )) as unknown as PolicyVaultUpgradeable;

    // Fund vault.
    await usdc.mint(owner.address, USDC("1000"));
    await usdc.connect(owner).approve(await vault.getAddress(), USDC("1000"));
    await vault.connect(owner).deposit(USDC("1000"));

    return { usdc, vault, impl, proxy, owner, agent, relayer, provider, other };
  }

  async function signSpend(
    vault: PolicyVaultUpgradeable,
    signer: Awaited<ReturnType<typeof ethers.getSigner>>,
    owner: string,
    to: string,
    amount: bigint,
    nonce: bigint,
    deadline: number
  ) {
    const { chainId } = await ethers.provider.getNetwork();
    const domain = {
      name: "ChainPePolicyVault",
      version: "1",
      chainId,
      verifyingContract: await vault.getAddress(),
    };
    const types = {
      Spend: [
        { name: "owner", type: "address" },
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "epoch", type: "uint256" },
      ],
    };
    const epoch = await vault.sessionEpoch(owner);
    return signer.signTypedData(domain, types, { owner, to, amount, nonce, deadline, epoch });
  }

  // ── Proxy basics ────────────────────────────────────────────────────────────

  it("deploys via proxy and initializes owner + token correctly", async () => {
    const { vault, usdc, owner } = await loadFixture(deployFixture);
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.token()).to.equal(await usdc.getAddress());
    expect(await vault.balanceOf(owner.address)).to.equal(USDC("1000"));
  });

  it("implementation cannot be initialized directly (disableInitializers)", async () => {
    const { impl, usdc, owner } = await loadFixture(deployFixture);
    await expect(
      impl.initialize(await usdc.getAddress(), owner.address)
    ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
  });

  // ── Core spend flow ─────────────────────────────────────────────────────────

  it("a relayer settles a session-signed spend through the proxy", async () => {
    const { vault, usdc, owner, agent, relayer, provider } = await loadFixture(deployFixture);

    const expiry = (await time.latest()) + 3600;
    await vault.connect(owner).setPolicy(agent.address, USDC("10"), USDC("20"), USDC("50"), expiry, false);

    const deadline = (await time.latest()) + 600;
    const sig = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, deadline);
    await expect(
      vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), deadline, sig)
    ).to.emit(vault, "Spent");

    expect(await usdc.balanceOf(provider.address)).to.equal(USDC("5"));
    expect(await vault.nonces(owner.address)).to.equal(1n);
  });

  // ── UUPS upgrade ────────────────────────────────────────────────────────────

  it("owner can upgrade to a new implementation and state is preserved", async () => {
    const { vault, usdc, owner } = await loadFixture(deployFixture);

    // Deploy a new implementation (identical logic, simulates a patched version).
    const ImplV2 = await ethers.getContractFactory("PolicyVaultUpgradeable");
    const implV2 = await ImplV2.deploy();
    await implV2.waitForDeployment();

    const balanceBefore = await vault.balanceOf(owner.address);

    // Upgrade to new impl — no re-initialize needed (just upgradeToAndCall with "").
    await expect(
      vault.connect(owner).upgradeToAndCall(await implV2.getAddress(), "0x")
    ).to.not.be.reverted;

    // State survives the upgrade.
    expect(await vault.balanceOf(owner.address)).to.equal(balanceBefore);
    expect(await vault.token()).to.equal(await usdc.getAddress());
  });

  it("non-owner cannot upgrade the implementation", async () => {
    const { vault, other } = await loadFixture(deployFixture);
    const ImplV2 = await ethers.getContractFactory("PolicyVaultUpgradeable");
    const implV2 = await ImplV2.deploy();
    await implV2.waitForDeployment();

    await expect(
      vault.connect(other).upgradeToAndCall(await implV2.getAddress(), "0x")
    ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });

  // ── Pause / unpause ─────────────────────────────────────────────────────────

  it("pause blocks deposit/spend but withdraw stays available; unpause restores them", async () => {
    const { vault, usdc, owner, agent, relayer, provider } = await loadFixture(deployFixture);

    const expiry = (await time.latest()) + 3600;
    await vault.connect(owner).setPolicy(agent.address, USDC("5"), USDC("20"), USDC("50"), expiry, false);
    await vault.connect(owner).pause();

    await usdc.mint(owner.address, USDC("10"));
    await usdc.connect(owner).approve(await vault.getAddress(), USDC("10"));
    await expect(vault.connect(owner).deposit(USDC("10"))).to.be.revertedWithCustomError(vault, "EnforcedPause");
    // withdraw stays available even while paused — users must be able to exit.
    await expect(vault.connect(owner).withdraw(USDC("1"))).to.emit(vault, "Withdrawn");

    const d = (await time.latest()) + 600;
    const sig = await signSpend(vault, agent, owner.address, provider.address, USDC("5"), 0n, d);
    await expect(
      vault.connect(relayer).spend(owner.address, provider.address, USDC("5"), d, sig)
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");

    await vault.connect(owner).unpause();
    await expect(vault.connect(owner).deposit(USDC("10"))).to.emit(vault, "Deposited");
  });

  // ── setPolicy validation ────────────────────────────────────────────────────

  it("setPolicy rejects dailyCap=0, maxPerCall>totalBudget, expiry in past", async () => {
    const { vault, owner, agent } = await loadFixture(deployFixture);
    const expiry = (await time.latest()) + 3600;
    await expect(
      vault.connect(owner).setPolicy(agent.address, USDC("5"), 0, USDC("50"), expiry, false)
    ).to.be.revertedWithCustomError(vault, "ZeroDailyCap");
    await expect(
      vault.connect(owner).setPolicy(agent.address, USDC("20"), USDC("20"), USDC("10"), expiry, false)
    ).to.be.revertedWithCustomError(vault, "MaxPerCallExceedsBudget");
    const past = (await time.latest()) - 1;
    await expect(
      vault.connect(owner).setPolicy(agent.address, USDC("5"), USDC("20"), USDC("50"), past, false)
    ).to.be.revertedWithCustomError(vault, "ExpiryInPast");
  });

  // ── previewSpend ────────────────────────────────────────────────────────────

  it("previewSpend returns ok=true when constraints pass", async () => {
    const { vault, owner, agent, provider } = await loadFixture(deployFixture);
    const expiry = (await time.latest()) + 3600;
    await vault.connect(owner).setPolicy(agent.address, USDC("10"), USDC("20"), USDC("50"), expiry, false);
    const [ok] = await vault.previewSpend(owner.address, provider.address, USDC("5"));
    expect(ok).to.equal(true);
  });
});
