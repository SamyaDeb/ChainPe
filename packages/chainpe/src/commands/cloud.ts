/** `chainpe login` and `chainpe logout`. The seller key is read from the environment, used in memory and never printed. */
import chalk from "chalk";
import { getNetwork, parseNetwork } from "../chains.js";
import { assertCloudUrl, chooseCloudUrl, clearCloudCredentials, credentialsPath, readStoredCredentials, saveCloudCredentials } from "../cloud/credentials.js";
import { loginAndCreateKey, revokeKey } from "../cloud/login.js";
import { loadConfig } from "../config.js";
import { resolveSellerSigner } from "../proxy/circleFacilitator.js";

async function signerContext(networkOption?: string) {
  const config = await loadConfig();
  if (!config) throw new Error("No configuration found. Run `chainpe init` first, or set CHAINPE_CONFIG.");
  const network = parseNetwork(networkOption ?? process.env.CHAINPE_NETWORK ?? config.network);
  return { network, signer: resolveSellerSigner(config.walletAddress), chainId: getNetwork(network).chainId };
}

export interface LoginFlags {
  cloudUrl?: string;
  network?: string;
}

export async function runLoginCommand(flags: LoginFlags): Promise<void> {
  try {
    const stored = await readStoredCredentials();
    const { network, signer, chainId } = await signerContext(flags.network);
    const cloudUrl = assertCloudUrl(chooseCloudUrl(network, flags.cloudUrl, process.env.CHAINPE_CLOUD_URL, stored?.cloudUrl));
    const { id, key, prefix } = await loginAndCreateKey({ cloudUrl, signer, chainId });
    await saveCloudCredentials({ cloudUrl, ingestKey: key, keyId: id, keyPrefix: prefix });
    console.log(chalk.green(`  ✓ Signed in to ${cloudUrl} as ${signer.address}`));
    console.log(chalk.gray(`    Ingest key ${prefix}… saved to ${credentialsPath()} (0600)`));
    console.log(chalk.gray("    `chainpe start` now sends telemetry. Off with --no-telemetry."));
    console.log(chalk.gray("    For a hosted proxy, set CHAINPE_CLOUD_URL and CHAINPE_INGEST_KEY from that file."));
  } catch (err) {
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exitCode = 1;
  }
}

/** Removes the key here in every case, and tries to revoke it on the server too. */
export async function runLogoutCommand(flags: { network?: string }): Promise<void> {
  try {
    const stored = await readStoredCredentials();
    if (!stored) {
      console.log(chalk.gray("  Not logged in."));
      return;
    }
    let revoked = false;
    let reason = "this key has no id";
    if (stored.keyId) {
      try {
        const { signer, chainId } = await signerContext(flags.network);
        await revokeKey({ cloudUrl: stored.cloudUrl, signer, chainId, keyId: stored.keyId });
        revoked = true;
      } catch (err) {
        reason = (err as Error).message;
      }
    }
    await clearCloudCredentials();
    console.log(chalk.green("  ✓ Logged out. The key is gone from this machine."));
    if (revoked) console.log(chalk.gray("    It is revoked on the server too."));
    else console.log(chalk.yellow(`    It could not be revoked on the server (${reason}). Revoke ${stored.keyPrefix ?? "it"}… from the dashboard.`));
  } catch (err) {
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exitCode = 1;
  }
}
