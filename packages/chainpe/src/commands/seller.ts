/**
 * Seller money commands: `chainpe balance` and `chainpe withdraw`.
 *
 * The seller key is read from the environment, used in memory and never printed.
 */
import chalk from "chalk";
import ora from "ora";
import { CHAIN_CONFIGS, type GatewayClient } from "@circle-fin/x402-batching/client";
import { explorerTxUrl, getNetwork, USDC_DECIMALS, type ChainPeNetwork } from "../chains.js";
import { formatUsdc, getUsdcBalance } from "../evm.js";
import { resolveSellerKey } from "../proxy/circleFacilitator.js";
import { assertUsdcAmount, gatewayClient } from "./consume.js";

/** Accepted by Gateway but not yet in a settled batch, so not in `available`. */
const PENDING_STATUSES = ["received", "batched"] as const;

type DestinationChain = keyof typeof CHAIN_CONFIGS;

/** Fixed 6 decimals, so small balances stay readable next to each other. */
function usdc6(atomic: bigint): string {
  const [whole, fraction = ""] = formatUsdc(atomic).split(".");
  return `${whole}.${fraction.padEnd(USDC_DECIMALS, "0")}`;
}

/** Sums incoming transfers that are still on their way to `available`. */
export async function pendingIncoming(
  client: Pick<GatewayClient, "searchTransfers">,
  seller: `0x${string}`
): Promise<bigint> {
  const pages = await Promise.all(
    PENDING_STATUSES.map((status) => client.searchTransfers({ to: seller, status, token: "USDC", pageSize: 100 }))
  );
  return pages.flatMap((page) => page.transfers).reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n);
}

export function resolveDestination(name: string): DestinationChain {
  if (Object.hasOwn(CHAIN_CONFIGS, name)) return name as DestinationChain;
  throw new Error(`Unknown chain "${name}" (expected one of ${Object.keys(CHAIN_CONFIGS).join(", ")}).`);
}

export async function runBalanceCommand(walletAddress: string, network: ChainPeNetwork): Promise<void> {
  const spinner = ora("Reading balances…").start();
  try {
    const client = gatewayClient(network, resolveSellerKey(walletAddress));
    const [{ gateway }, onChain, pending] = await Promise.all([
      client.getBalances(),
      getUsdcBalance(network, walletAddress),
      pendingIncoming(client, client.address).catch(() => undefined),
    ]);
    spinner.stop();

    console.log(chalk.gray(`  Seller ${chalk.cyan(walletAddress)} on ${chalk.yellow(network)}`));
    console.log(chalk.gray(`    Gateway available: ${chalk.green(usdc6(gateway.available))} USDC`));
    console.log(chalk.gray(`    Gateway total:     ${chalk.green(usdc6(gateway.total))} USDC`));
    console.log(
      chalk.gray(
        `    Pending batch:     ${pending === undefined ? chalk.yellow("(could not fetch)") : `${chalk.green(usdc6(pending))} USDC`}`
      )
    );
    console.log(chalk.gray(`    On-chain USDC:     ${chalk.green(usdc6(onChain))} USDC`));
  } catch (err) {
    spinner.fail("Could not read balances");
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exit(1);
  }
}

export async function runWithdrawCommand(
  amount: string,
  walletAddress: string,
  network: ChainPeNetwork,
  chain?: string
): Promise<void> {
  const spinner = ora(`Withdrawing ${amount} USDC from Gateway…`);
  try {
    assertUsdcAmount(amount);
    const destination = chain ? resolveDestination(chain) : undefined;
    const client = gatewayClient(network, resolveSellerKey(walletAddress));

    spinner.start();
    const result = await client.withdraw(amount, destination ? { chain: destination } : undefined);
    spinner.succeed(`Withdrew ${result.formattedAmount} USDC to ${result.destinationChain}`);

    console.log(chalk.gray(`    Tx:       ${chalk.cyan(result.mintTxHash)}`));
    const explorer = explorerFor(network, destination, result.mintTxHash);
    if (explorer) console.log(chalk.gray(`    Explorer: ${chalk.cyan(explorer)}`));
  } catch (err) {
    spinner.fail("Withdrawal failed");
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exit(1);
  }
}

function explorerFor(network: ChainPeNetwork, destination: DestinationChain | undefined, tx: string): string | undefined {
  if (!destination || destination === getNetwork(network).gatewayChain) return explorerTxUrl(network, tx);
  const url = CHAIN_CONFIGS[destination].chain.blockExplorers?.default.url;
  return url ? `${url}/tx/${tx}` : undefined;
}
