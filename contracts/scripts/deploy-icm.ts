/**
 * Deploy the ChainPe ICM (Teleporter) cross-L1 payment contracts.
 *
 * In a real cross-L1 setup you deploy the RECEIVER on the destination L1 (where
 * the service lives, e.g. the C-Chain) and the SENDER on each source L1 (where
 * agents live), pointing both at that L1's Teleporter messenger. This script
 * deploys both to the current --network for wiring/demos.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-icm.ts --network fuji
 *
 * Env:
 *   TELEPORTER_MESSENGER  ICM messenger address (default: canonical Avalanche
 *                         Teleporter 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf)
 */
import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Canonical TeleporterMessenger, deployed at the same address on every
// Avalanche L1 that has ICM enabled.
const DEFAULT_TELEPORTER = "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf";

async function main() {
  const [deployer] = await ethers.getSigners();
  const messenger = process.env.TELEPORTER_MESSENGER ?? DEFAULT_TELEPORTER;

  console.log(`\nDeploying ChainPe ICM contracts to ${network.name}`);
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  Teleporter: ${messenger}\n`);

  const Receiver = await ethers.getContractFactory("ChainPeICMReceiver");
  const receiver = await Receiver.deploy(messenger);
  await receiver.waitForDeployment();
  const receiverAddr = await receiver.getAddress();

  const Sender = await ethers.getContractFactory("ChainPeICMSender");
  // Payment-intent-only deploy: no oracle / registry (reputation sends disabled).
  // For portable reputation use scripts/deploy-icm-reputation.ts.
  const sender = await Sender.deploy(messenger, ethers.ZeroAddress, ethers.ZeroAddress);
  await sender.waitForDeployment();
  const senderAddr = await sender.getAddress();

  console.log("  ChainPeICMReceiver:", receiverAddr);
  console.log("  ChainPeICMSender:  ", senderAddr);

  const dir = join(__dirname, "..", "deployments");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${network.name}-icm.json`),
    JSON.stringify(
      {
        network: network.name,
        teleporterMessenger: messenger,
        chainPeICMReceiver: receiverAddr,
        chainPeICMSender: senderAddr,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  console.log(`\n  Saved -> deployments/${network.name}-icm.json\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
