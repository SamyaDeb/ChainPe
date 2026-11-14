/**
 * Phase 5: create a DEDICATED key for the self-hosted ICM relayer (it must not sign anything else, or its nonces break).
 *
 *   npx ts-node scripts/new-relayer-key.ts
 *
 * Writes contracts/icm-relayer/.env.relayer (mode 600, gitignored by `.env.*`) containing ACCOUNT_PRIVATE_KEY=0x...
 * and prints ONLY the address, which you fund with the L1 gas token. Refuses to overwrite an existing file.
 */
import { Wallet } from "ethers";
import * as fs from "fs";
import * as path from "path";

const file = path.join(__dirname, "..", "icm-relayer", ".env.relayer");
if (fs.existsSync(file)) {
  console.error(`${file} already exists; not overwriting. Delete it yourself if you really want a new key.`);
  process.exit(1);
}
const w = Wallet.createRandom();
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `# icm-relayer signing key. Never commit, never reuse elsewhere.\nACCOUNT_PRIVATE_KEY=${w.privateKey}\n`, { mode: 0o600 });
console.log(`Relayer address: ${w.address}`);
console.log(`Key written to ${path.relative(process.cwd(), file)} (not printed).`);
