import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployErc8004 } from "../scripts/lib/deployErc8004";
import type {
  ChainPeICMSender,
  ChainPeICMReceiver,
  ChainPeReputationMirror,
  ChainPeReputationOracle,
  MockTeleporterMessenger,
} from "../typechain-types";

const SERVICE_ID = ethers.id("research-agent"); // bytes32
const DEST_BLOCKCHAIN = ethers.id("dest-l1"); // bytes32 (the mock ignores it)
const OTHER_CHAIN = ethers.id("some-other-l1");
const coder = ethers.AbiCoder.defaultAbiCoder();

function intentPayload(payTo: string, buyer: string, amount = 1n) {
  return coder.encode(["bytes32", "address", "uint256", "address"], [SERVICE_ID, payTo, amount, buyer]);
}

function reputationPayload(payTo: string, agentId: bigint, score: number, reviews: number, ts: bigint, version = 1) {
  return coder.encode(
    ["uint8", "address", "uint256", "uint8", "uint32", "uint64"],
    [version, payTo, agentId, score, reviews, ts]
  );
}

describe("ChainPe ICM (Teleporter cross-L1)", () => {
  async function deployFixture() {
    const [owner, buyer, payTo, other, attester] = await ethers.getSigners();

    const messenger = (await (await ethers.getContractFactory("MockTeleporterMessenger")).deploy()) as unknown as MockTeleporterMessenger;
    const messengerAddr = await messenger.getAddress();
    const SOURCE = await messenger.MOCK_SOURCE_BLOCKCHAIN_ID();

    const oracle = (await (await ethers.getContractFactory("ChainPeReputationOracle")).deploy(
      owner.address,
      attester.address
    )) as unknown as ChainPeReputationOracle;

    const receiver = (await (await ethers.getContractFactory("ChainPeICMReceiver")).deploy(messengerAddr)) as unknown as ChainPeICMReceiver;
    const mirror = (await (await ethers.getContractFactory("ChainPeReputationMirror")).deploy(messengerAddr)) as unknown as ChainPeReputationMirror;
    const sender = (await (await ethers.getContractFactory("ChainPeICMSender")).deploy(
      messengerAddr,
      await oracle.getAddress(),
      ethers.ZeroAddress
    )) as unknown as ChainPeICMSender;
    const senderAddr = await sender.getAddress();

    return { owner, buyer, payTo, other, attester, messenger, SOURCE, oracle, receiver, mirror, sender, senderAddr };
  }

  /** Fixture with both receivers trusting the sender for the mock source chain. */
  async function trustedFixture() {
    const f = await deployFixture();
    await f.receiver.setTrustedSender(f.SOURCE, f.senderAddr);
    await f.mirror.setTrustedSender(f.SOURCE, f.senderAddr);
    return f;
  }

  it("rejects a zero messenger in the constructors", async () => {
    const z = ethers.ZeroAddress;
    await expect((await ethers.getContractFactory("ChainPeICMSender")).deploy(z, z, z)).to.be.revertedWith("messenger=0");
    await expect((await ethers.getContractFactory("ChainPeICMReceiver")).deploy(z)).to.be.revertedWith("messenger=0");
    await expect((await ethers.getContractFactory("ChainPeReputationMirror")).deploy(z)).to.be.revertedWith("messenger=0");
  });

  // ─── Fail-closed authentication (shared base; checked on both receivers) ────────────
  describe("fail-closed receivers", () => {
    for (const which of ["receiver", "mirror"] as const) {
      describe(which, () => {
        it("rejects a message from an unconfigured source chain", async () => {
          const f = await deployFixture(); // nothing trusted
          const target = await f[which].getAddress();
          await expect(
            f.messenger.deliver(f.SOURCE, f.senderAddr, target, "0x")
          ).to.be.revertedWith("untrusted source chain");
        });

        it("rejects the wrong origin sender on a configured chain", async () => {
          const f = await loadFixture(trustedFixture);
          const target = await f[which].getAddress();
          await expect(
            f.messenger.deliver(f.SOURCE, f.other.address, target, "0x")
          ).to.be.revertedWith("untrusted sender");
        });

        it("rejects the trusted sender address arriving from a different chain", async () => {
          const f = await loadFixture(trustedFixture);
          const target = await f[which].getAddress();
          await expect(
            f.messenger.deliver(OTHER_CHAIN, f.senderAddr, target, "0x")
          ).to.be.revertedWith("untrusted source chain");
        });

        it("rejects a caller that is not the Teleporter messenger", async () => {
          const f = await loadFixture(trustedFixture);
          await expect(
            f[which].connect(f.other).receiveTeleporterMessage(f.SOURCE, f.senderAddr, "0x")
          ).to.be.revertedWith("only teleporter");
        });

        it("only the owner can set a trusted sender; clearing it closes the chain again", async () => {
          const f = await loadFixture(trustedFixture);
          await expect(
            f[which].connect(f.other).setTrustedSender(f.SOURCE, f.other.address)
          ).to.be.revertedWithCustomError(f[which], "OwnableUnauthorizedAccount");
          await expect(f[which].setTrustedSender(f.SOURCE, ethers.ZeroAddress))
            .to.emit(f[which], "TrustedSenderSet")
            .withArgs(f.SOURCE, ethers.ZeroAddress);
          await expect(
            f.messenger.deliver(f.SOURCE, f.senderAddr, await f[which].getAddress(), "0x")
          ).to.be.revertedWith("untrusted source chain");
        });
      });
    }
  });

  // ─── Payment intents (pre-existing path) ────────────────────────────────────────────
  describe("payment intents", () => {
    it("delivers a payment intent from the trusted sender and the receiver emits it", async () => {
      const { receiver, sender, buyer, payTo, SOURCE, senderAddr } = await loadFixture(trustedFixture);
      const amount = ethers.parseUnits("0.5", 6);
      await expect(
        sender.connect(buyer).sendPaymentIntent(
          DEST_BLOCKCHAIN, await receiver.getAddress(), SERVICE_ID, payTo.address, amount, 200_000, ethers.ZeroAddress, 0n
        )
      )
        .to.emit(sender, "PaymentIntentSent")
        .and.to.emit(receiver, "CrossChainPaymentIntent")
        .withArgs(SOURCE, buyer.address, payTo.address, amount, SERVICE_ID, senderAddr);
    });

    it("an unconfigured receiver rejects a payment intent end to end", async () => {
      const { receiver, sender, buyer, payTo } = await loadFixture(deployFixture);
      await expect(
        sender.connect(buyer).sendPaymentIntent(
          DEST_BLOCKCHAIN, await receiver.getAddress(), SERVICE_ID, payTo.address, 1n, 200_000, ethers.ZeroAddress, 0n
        )
      ).to.be.revertedWith("untrusted source chain");
    });

    it("pulls a relayer fee from the caller when feeAmount > 0", async () => {
      const { messenger, receiver, sender, buyer, payTo } = await loadFixture(trustedFixture);
      const fee = ethers.parseUnits("0.01", 6);
      const feeToken = await (await ethers.getContractFactory("MockUSDC")).deploy();
      await feeToken.mint(buyer.address, fee);
      await feeToken.connect(buyer).approve(await sender.getAddress(), fee);

      await sender.connect(buyer).sendPaymentIntent(
        DEST_BLOCKCHAIN, await receiver.getAddress(), SERVICE_ID, payTo.address, 1n, 200_000, await feeToken.getAddress(), fee
      );

      expect(await feeToken.balanceOf(buyer.address)).to.equal(0n);
      expect(await feeToken.balanceOf(await sender.getAddress())).to.equal(fee);
      expect(await feeToken.allowance(await sender.getAddress(), await messenger.getAddress())).to.equal(fee);
    });

    it("the receiver still decodes a raw intent payload delivered by the messenger", async () => {
      const { messenger, receiver, buyer, payTo, SOURCE, senderAddr } = await loadFixture(trustedFixture);
      await expect(messenger.deliver(SOURCE, senderAddr, await receiver.getAddress(), intentPayload(payTo.address, buyer.address, 7n)))
        .to.emit(receiver, "CrossChainPaymentIntent")
        .withArgs(SOURCE, buyer.address, payTo.address, 7n, SERVICE_ID, senderAddr);
    });
  });

  // ─── Portable reputation ────────────────────────────────────────────────────────────
  describe("portable reputation (oracle → sender → mirror)", () => {
    it("sendReputation copies the oracle record into the mirror", async () => {
      const { oracle, attester, sender, mirror, payTo, other, SOURCE } = await loadFixture(trustedFixture);
      await oracle.connect(attester).setScore(payTo.address, 87, 12);
      const [, , updatedAt] = await oracle.getEntry(payTo.address);

      // Permissionless: any caller may push the oracle's value.
      await expect(sender.connect(other).sendReputation(DEST_BLOCKCHAIN, await mirror.getAddress(), payTo.address))
        .to.emit(sender, "ReputationSent")
        .and.to.emit(mirror, "ReputationMirrored")
        .withArgs(payTo.address, 0n, 87, 12, updatedAt, SOURCE);

      const r = await mirror.getReputation(payTo.address);
      expect(r.agentId).to.equal(0n);
      expect(r.paidScore).to.equal(87);
      expect(r.paidReviews).to.equal(12);
      expect(r.sourceTimestamp).to.equal(updatedAt);
      expect(r.receivedAt).to.equal(BigInt(await time.latest()));
      expect(r.sourceBlockchainID).to.equal(SOURCE);
    });

    it("a newer oracle update overwrites the mirror", async () => {
      const { oracle, attester, sender, mirror, payTo } = await loadFixture(trustedFixture);
      const mirrorAddr = await mirror.getAddress();
      await oracle.connect(attester).setScore(payTo.address, 50, 3);
      await sender.sendReputation(DEST_BLOCKCHAIN, mirrorAddr, payTo.address);
      await time.increase(60);
      await oracle.connect(attester).setScore(payTo.address, 91, 4);
      await sender.sendReputation(DEST_BLOCKCHAIN, mirrorAddr, payTo.address);
      const r = await mirror.getReputation(payTo.address);
      expect(r.paidScore).to.equal(91);
      expect(r.paidReviews).to.equal(4);
    });

    it("rejects a stale update (same or older sourceTimestamp)", async () => {
      const { oracle, attester, sender, mirror, messenger, payTo, SOURCE, senderAddr } = await loadFixture(trustedFixture);
      const mirrorAddr = await mirror.getAddress();
      await oracle.connect(attester).setScore(payTo.address, 80, 5);
      await sender.sendReputation(DEST_BLOCKCHAIN, mirrorAddr, payTo.address);
      const [, , ts] = await oracle.getEntry(payTo.address);

      // Re-sending the same oracle record = replay with equal timestamp.
      await expect(sender.sendReputation(DEST_BLOCKCHAIN, mirrorAddr, payTo.address))
        .to.be.revertedWithCustomError(mirror, "StaleUpdate")
        .withArgs(payTo.address, ts, ts);

      // An older record delivered late cannot roll the score back.
      await expect(messenger.deliver(SOURCE, senderAddr, mirrorAddr, reputationPayload(payTo.address, 0n, 10, 99, ts - 1n)))
        .to.be.revertedWithCustomError(mirror, "StaleUpdate");
      expect((await mirror.getReputation(payTo.address)).paidScore).to.equal(80);
    });

    it("rejects an unknown payload version and a zero payTo", async () => {
      const { mirror, messenger, payTo, SOURCE, senderAddr } = await loadFixture(trustedFixture);
      const mirrorAddr = await mirror.getAddress();
      await expect(messenger.deliver(SOURCE, senderAddr, mirrorAddr, reputationPayload(payTo.address, 0n, 1, 1, 1n, 2)))
        .to.be.revertedWithCustomError(mirror, "UnsupportedVersion").withArgs(2);
      await expect(messenger.deliver(SOURCE, senderAddr, mirrorAddr, reputationPayload(ethers.ZeroAddress, 0n, 1, 1, 1n)))
        .to.be.revertedWithCustomError(mirror, "ZeroPayTo");
    });

    it("an unconfigured mirror rejects a reputation update end to end", async () => {
      const { oracle, attester, sender, mirror, payTo } = await loadFixture(deployFixture);
      await oracle.connect(attester).setScore(payTo.address, 70, 3);
      await expect(sender.sendReputation(DEST_BLOCKCHAIN, await mirror.getAddress(), payTo.address))
        .to.be.revertedWith("untrusted source chain");
    });

    it("reverts when the oracle has no record, or no oracle is configured", async () => {
      const { sender, mirror, payTo, messenger } = await loadFixture(trustedFixture);
      await expect(sender.sendReputation(DEST_BLOCKCHAIN, await mirror.getAddress(), payTo.address))
        .to.be.revertedWithCustomError(sender, "NoScore").withArgs(payTo.address);

      const bare = await (await ethers.getContractFactory("ChainPeICMSender")).deploy(
        await messenger.getAddress(), ethers.ZeroAddress, ethers.ZeroAddress
      );
      await expect(bare.sendReputation(DEST_BLOCKCHAIN, await mirror.getAddress(), payTo.address))
        .to.be.revertedWithCustomError(bare, "NoOracle");
      await expect(bare.sendServiceReputation(DEST_BLOCKCHAIN, await mirror.getAddress(), ethers.ZeroHash))
        .to.be.revertedWithCustomError(bare, "NoRegistry");
    });

    it("exposes the fixed 150k reputation gas limit", async () => {
      const { sender } = await loadFixture(deployFixture);
      expect(await sender.REPUTATION_GAS_LIMIT()).to.equal(150_000n);
    });

    it("sendServiceReputation links payTo to the registry's ERC-8004 agentId", async () => {
      const [owner, alice, , , attester, treasury] = await ethers.getSigners();
      const messenger = await (await ethers.getContractFactory("MockTeleporterMessenger")).deploy();
      const SOURCE = await messenger.MOCK_SOURCE_BLOCKCHAIN_ID();
      const oracle = await (await ethers.getContractFactory("ChainPeReputationOracle")).deploy(owner.address, attester.address);

      // Real ERC-8004 identity + ChainPe registry v2 behind a proxy.
      const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
      const { identityRegistry } = await deployErc8004();
      const identity = await ethers.getContractAt("IdentityRegistryUpgradeable", identityRegistry);
      const Registry = await ethers.getContractFactory("ChainPeRegistryUpgradeable");
      const impl = await Registry.deploy();
      const proxy = await (await ethers.getContractFactory("contracts/erc8004/ERC1967Proxy.sol:ERC1967Proxy")).deploy(
        await impl.getAddress(),
        Registry.interface.encodeFunctionData("initialize", [await usdc.getAddress(), treasury.address, 0n, identityRegistry, owner.address])
      );
      const registry = Registry.attach(await proxy.getAddress()) as any;

      await identity.connect(alice)["register(string)"]("ipfs://a0");
      await identity.connect(alice)["register(string)"]("ipfs://a1"); // agentId 1
      const payTo = "0x000000000000000000000000000000000000bEEF";
      await registry.connect(alice).register({
        name: "Weather API", description: "d", tags: "t", endpoint: "https://w.example.com",
        pricePerRequest: "0.01", paymentToken: "USDC", network: "avalanche", payTo, agentId: 1n,
      });
      const key = await registry.computeKey(alice.address, "Weather API");

      const sender = await (await ethers.getContractFactory("ChainPeICMSender")).deploy(
        await messenger.getAddress(), await oracle.getAddress(), await registry.getAddress()
      );
      const mirror = await (await ethers.getContractFactory("ChainPeReputationMirror")).deploy(await messenger.getAddress());
      await mirror.setTrustedSender(SOURCE, await sender.getAddress());

      await oracle.connect(attester).setScore(payTo, 93, 8);
      await expect(sender.sendServiceReputation(DEST_BLOCKCHAIN, await mirror.getAddress(), key))
        .to.emit(mirror, "ReputationMirrored");
      const r = await mirror.getReputation(payTo);
      expect(r.agentId).to.equal(1n);
      expect(r.paidScore).to.equal(93);
    });
  });
});
