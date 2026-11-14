/**
 * Phase 5: write the icm-relayer config for Fuji C-Chain -> the L1 mirror (contracts/icm-relayer/config.json).
 *
 *   npx hardhat run scripts/make-relayer-config.ts
 *
 * - Source: Fuji C-Chain Teleporter, relaying ONLY messages whose origin sender is our ChainPeICMSender
 *   (`allowed-origin-sender-addresses`), so the relayer never spends gas on other people's traffic.
 * - Destination: the L1 from deployments/fuji-icm-reputation.json. Subnet ID comes from the P-Chain
 *   (platform.validatedBy), blockchain IDs from the Warp precompile.
 * - No key in the file: the container reads ACCOUNT_PRIVATE_KEY from icm-relayer/.env.relayer (new-relayer-key.ts).
 * - Format for icm-relayer v1.8.x (no `vm` fields, removed in v1.7.5).
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { TELEPORTER, FUJI_RPC_URL, L1_RPC_URL, connect, blockchainIdOf, toCb58, loadDeployment } from "./lib/icmReputation";

const P_CHAIN_API = process.env.P_CHAIN_API_URL ?? "https://api.avax-test.network";
const FUJI_WS_URL = process.env.FUJI_WS_URL ?? FUJI_RPC_URL.replace(/^http/, "ws").replace(/\/rpc$/, "/ws");
const PRIMARY_NETWORK_SUBNET = "11111111111111111111111111111111LpoYY";
const OUT_DIR = path.join(__dirname, "..", "icm-relayer");

async function subnetOf(blockchainIdCb58: string): Promise<string> {
  const res = await fetch(`${P_CHAIN_API}/ext/bc/P`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "platform.validatedBy", params: { blockchainID: blockchainIdCb58 } }),
  });
  const j = (await res.json()) as { result?: { subnetID: string }; error?: { message: string } };
  if (!j.result) throw new Error(`platform.validatedBy failed: ${j.error?.message ?? res.status}`);
  return j.result.subnetID;
}

function relayerAddress(): string {
  const envFile = path.join(OUT_DIR, ".env.relayer");
  if (!fs.existsSync(envFile)) throw new Error("icm-relayer/.env.relayer missing; run `npx ts-node scripts/new-relayer-key.ts` first");
  const m = fs.readFileSync(envFile, "utf8").match(/^ACCOUNT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m);
  if (!m) throw new Error("icm-relayer/.env.relayer has no ACCOUNT_PRIVATE_KEY");
  return new ethers.Wallet(m[1]).address;
}

async function main() {
  const c = await connect();
  const d = loadDeployment();
  const [fujiId, l1Id] = await Promise.all([blockchainIdOf(c.fuji.provider!), blockchainIdOf(c.l1.provider!)]);
  const fujiCb58 = toCb58(fujiId), l1Cb58 = toCb58(l1Id);
  const [fujiSubnet, l1Subnet] = await Promise.all([subnetOf(fujiCb58), subnetOf(l1Cb58)]);
  if (fujiSubnet !== PRIMARY_NETWORK_SUBNET) throw new Error(`Fuji C-Chain resolved to subnet ${fujiSubnet}`);
  const relayer = relayerAddress();
  // The public Fuji RPC caps eth_getLogs at 100 blocks and the relayer back-fills in 200-block chunks, which is fatal.
  // So by default it starts at the chain tip (send only after it is running). With a provider RPC, set
  // RELAYER_BACKFILL_BLOCKS to re-enable catch-up from that many blocks back.
  const backfill = Number(process.env.RELAYER_BACKFILL_BLOCKS ?? 0);
  const initialHeight = Math.max(1, (await c.fuji.provider!.getBlockNumber()) - backfill);

  const config = {
    "log-level": "info",
    // The image runs as a non-root user that cannot write a fresh docker volume; keep state in the container.
    "storage-location": "/tmp/icm-relayer-storage",
    "process-missed-blocks": backfill > 0,
    "info-api": { "base-url": P_CHAIN_API },
    "p-chain-api": { "base-url": P_CHAIN_API },
    "source-blockchains": [{
      "subnet-id": fujiSubnet,
      "blockchain-id": fujiCb58,
      "rpc-endpoint": { "base-url": FUJI_RPC_URL },
      "ws-endpoint": { "base-url": FUJI_WS_URL },
      ...(backfill > 0 ? { "process-historical-blocks-from-height": initialHeight } : {}),
      "allowed-origin-sender-addresses": [d.fuji.chainPeICMSender],
      "supported-destinations": [{ "blockchain-id": l1Cb58, "addresses": [d.l1.chainPeReputationMirror] }],
      "message-contracts": {
        [TELEPORTER]: { "message-format": "teleporter", "settings": { "reward-address": relayer } },
      },
    }],
    "destination-blockchains": [{
      "subnet-id": l1Subnet,
      "blockchain-id": l1Cb58,
      "rpc-endpoint": { "base-url": L1_RPC_URL },
    }],
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, "config.json");
  fs.writeFileSync(out, JSON.stringify(config, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
  console.log(`  source  Fuji C-Chain ${fujiCb58} (subnet ${fujiSubnet}), ${backfill > 0 ? `back-fill from block ${initialHeight}` : "from the chain tip"}, only origin ${d.fuji.chainPeICMSender} -> mirror ${d.l1.chainPeReputationMirror}`);
  console.log(`  dest    ${d.l1.name} ${l1Cb58} (subnet ${l1Subnet}) ${L1_RPC_URL}`);
  console.log(`  relayer ${relayer} (fund it with the ${d.l1.name} gas token)`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
