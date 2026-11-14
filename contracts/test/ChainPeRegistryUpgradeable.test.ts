/**
 * Tests for ChainPeRegistryUpgradeable — UUPS proxy deployment and upgrade.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { ChainPeRegistryUpgradeable, MockUSDC } from "../typechain-types";

const FEE = ethers.parseUnits("1.0", 6);
const ZERO = ethers.ZeroAddress;

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Weather API",
    description: "Real-time weather and forecast data",
    tags: "weather,forecast,data",
    endpoint: "https://weather.example.com",
    pricePerRequest: "0.01",
    paymentToken: "USDC",
    network: "avalanche",
    payTo: "0x000000000000000000000000000000000000dEaD",
    agentId: 0n,
    ...overrides,
  };
}

describe("ChainPeRegistryUpgradeable (UUPS proxy)", () => {
  async function deployFixture() {
    const [owner, dev, treasury, other] = await ethers.getSigners();

    const Usdc = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Usdc.deploy()) as unknown as MockUSDC;
    await usdc.waitForDeployment();

    const Impl = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
    const impl = await Impl.deploy();
    await impl.waitForDeployment();

    const initData = Impl.interface.encodeFunctionData("initialize", [
      await usdc.getAddress(),
      treasury.address,
      FEE,
      ZERO,
      owner.address,
    ]);

    const Proxy = await ethers.getContractFactory(
      "contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy"
    );
    const proxy = await Proxy.deploy(await impl.getAddress(), initData);
    await proxy.waitForDeployment();

    const registry = (await ethers.getContractAt(
      "ChainPeRegistryUpgradeable",
      await proxy.getAddress()
    )) as unknown as ChainPeRegistryUpgradeable;

    await usdc.mint(dev.address, ethers.parseUnits("100", 6));
    await usdc.connect(dev).approve(await registry.getAddress(), ethers.MaxUint256);

    return { registry, usdc, impl, proxy, owner, dev, treasury, other };
  }

  it("deploys via proxy, initializes params, and disables direct impl init", async () => {
    const { registry, usdc, owner, treasury, impl } = await loadFixture(deployFixture);
    expect(await registry.owner()).to.equal(owner.address);
    expect(await registry.feeToken()).to.equal(await usdc.getAddress());
    expect(await registry.feeRecipient()).to.equal(treasury.address);
    expect(await registry.registrationFee()).to.equal(FEE);
    await expect(
      impl.initialize(await usdc.getAddress(), treasury.address, FEE, ZERO, owner.address)
    ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
  });

  it("register, update, deregister work through the proxy", async () => {
    const { registry, dev } = await loadFixture(deployFixture);
    await expect(registry.connect(dev).register(input())).to.emit(registry, "ServiceRegistered");
    expect(await registry.getServiceCount()).to.equal(1n);
    await expect(registry.connect(dev).update(input({ description: "Updated" }))).to.emit(registry, "ServiceUpdated");
    await expect(registry.connect(dev).deregister("Weather API")).to.emit(registry, "ServiceDeregistered");
    expect(await registry.getServiceCount()).to.equal(0n);
  });

  it("owner can upgrade to new implementation and state is preserved", async () => {
    const { registry, dev, owner } = await loadFixture(deployFixture);
    await registry.connect(dev).register(input());
    expect(await registry.getServiceCount()).to.equal(1n);

    const ImplV2 = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
    const implV2 = await ImplV2.deploy();
    await implV2.waitForDeployment();

    await expect(
      registry.connect(owner).upgradeToAndCall(await implV2.getAddress(), "0x")
    ).to.not.be.reverted;

    // State survives upgrade.
    expect(await registry.getServiceCount()).to.equal(1n);
  });

  it("non-owner cannot upgrade", async () => {
    const { registry, other } = await loadFixture(deployFixture);
    const ImplV2 = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
    const implV2 = await ImplV2.deploy();
    await implV2.waitForDeployment();
    await expect(
      registry.connect(other).upgradeToAndCall(await implV2.getAddress(), "0x")
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  it("pause blocks register / update; deregister still works (Phase 3.3)", async () => {
    const { registry, dev, owner } = await loadFixture(deployFixture);
    await registry.connect(dev).register(input());
    await registry.connect(owner).pause();
    await expect(registry.connect(dev).register(input({ name: "X" }))).to.be.revertedWithCustomError(registry, "EnforcedPause");
    await expect(registry.connect(dev).update(input({ description: "X" }))).to.be.revertedWithCustomError(registry, "EnforcedPause");
    await expect(registry.connect(dev).deregister("Weather API")).to.emit(registry, "ServiceDeregistered");
  });

  it("Ownable2Step two-step ownership transfer works", async () => {
    const { registry, owner, other } = await loadFixture(deployFixture);
    await registry.connect(owner).transferOwnership(other.address);
    expect(await registry.owner()).to.equal(owner.address); // pending, not yet
    await registry.connect(other).acceptOwnership();
    expect(await registry.owner()).to.equal(other.address);
  });

  it("getServices respects MAX_SERVICES_PER_PAGE cap", async () => {
    const { registry } = await loadFixture(deployFixture);
    await expect(registry.getServices(0, 101)).to.be.revertedWithCustomError(registry, "InvalidPagination");
  });
});
