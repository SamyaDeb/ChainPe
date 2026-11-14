/**
 * Configure ICM trusted senders after deployment.
 *
 * After deploying ChainPeICMReceiver on the destination chain, call this
 * script to register the trusted ChainPeICMSender address(es) so only
 * genuine intent messages are accepted. The receiver fails closed: until a
 * trusted sender is set for a source chain, every message from it is rejected.
 *
 * Usage:
 *   SOURCE_BLOCKCHAIN_ID=0x... \
 *   TRUSTED_SENDER=0xYourSenderAddr \
 *   npx hardhat run scripts/configure-icm.ts --network avalanche
 *
 * Env:
 *   SOURCE_BLOCKCHAIN_ID   Avalanche L1 blockchain ID (bytes32 hex) of the
 *                          source chain where ChainPeICMSender lives.
 *   TRUSTED_SENDER         Address of the ChainPeICMSender on that source chain.
 *   DEPLOYER_PRIVATE_KEY   Key that owns ChainPeICMReceiver.
 *
 * You can call this script multiple times to register additional source chains.
 * Set TRUSTED_SENDER=0x0000...0000 to stop accepting messages from that chain.
 */
import { ethers, network } from "hardhat";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

async function main() {
  const sourceBlockchainId = process.env.SOURCE_BLOCKCHAIN_ID;
  const trustedSender = process.env.TRUSTED_SENDER;

  if (!sourceBlockchainId) {
    throw new Error("SOURCE_BLOCKCHAIN_ID env var is required (bytes32 hex, e.g. 0xabc...)");
  }
  if (!trustedSender) {
    throw new Error("TRUSTED_SENDER env var is required (address of ChainPeICMSender on source chain)");
  }
  if (!ethers.isHexString(sourceBlockchainId, 32)) {
    throw new Error(`SOURCE_BLOCKCHAIN_ID must be a 32-byte hex string (got: ${sourceBlockchainId})`);
  }
  if (!ethers.isAddress(trustedSender)) {
    throw new Error(`TRUSTED_SENDER must be a valid address (got: ${trustedSender})`);
  }

  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`\nConfiguring ICM trusted sender on ${network.name} (chainId ${net.chainId})`);
  console.log(`  Caller:              ${deployer.address}`);
  console.log(`  Source blockchain:   ${sourceBlockchainId}`);
  console.log(`  Trusted sender:      ${trustedSender}`);

  const icmFile = join(__dirname, "..", "deployments", `${network.name}-icm.json`);
  if (!existsSync(icmFile)) {
    throw new Error(`No ICM deployment found at ${icmFile}. Run deploy-icm.ts first.`);
  }
  const d = JSON.parse(readFileSync(icmFile, "utf-8"));
  const receiverAddr: string = d.chainPeICMReceiver;
  console.log(`  ICMReceiver:         ${receiverAddr}`);

  const receiver = await ethers.getContractAt("ChainPeICMReceiver", receiverAddr);
  const owner = await (receiver as unknown as { owner(): Promise<string> }).owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Deployer ${deployer.address} is not the owner (owner=${owner}).`);
  }

  const before = await (receiver as unknown as { trustedSenders(id: string): Promise<string> })
    .trustedSenders(sourceBlockchainId);
  console.log(`  Current trusted sender: ${before === ethers.ZeroAddress ? "(none — chain rejected)" : before}`);

  const tx = await (receiver as unknown as {
    setTrustedSender(id: string, addr: string): Promise<{ hash: string; wait(): Promise<unknown> }>
  }).setTrustedSender(sourceBlockchainId, trustedSender);
  await tx.wait();

  const after = await (receiver as unknown as { trustedSenders(id: string): Promise<string> })
    .trustedSenders(sourceBlockchainId);
  console.log(`\n  ✓ tx: ${tx.hash}`);
  console.log(`  Trusted sender now: ${after}`);
  console.log("\n  ChainPeICMReceiver will now reject any message from this source chain");
  console.log("  that did NOT originate from the registered sender address.\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
