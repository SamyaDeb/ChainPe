/**
 * Consumer-side CLI commands (curl-level): `chainpe fetch`, `chainpe deposit` and
 * `chainpe discover`.
 *
 * `fetch` pays any x402 v2 402 on Arc in USDC, signing with the consumer wallet,
 * either from the wallet (`exact`) or from a Gateway deposit (`gateway`).
 */
import chalk from "chalk";
import ora from "ora";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig, type PaymentPolicy } from "@x402/fetch";
import { isBatchPayment } from "@circle-fin/x402-batching";
import { BatchEvmScheme, CompositeEvmScheme, GatewayClient } from "@circle-fin/x402-batching/client";
import { explorerTxUrl, getNetwork, parseNetwork, type ChainPeNetwork } from "../chains.js";
import { parseUsdc } from "../evm.js";

const DEFAULT_MAX_USDC = "1";
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export type RailChoice = "gateway" | "exact" | "auto";

function parseRailChoice(value: string): RailChoice {
  if (value === "gateway" || value === "exact" || value === "auto") return value;
  throw new Error(`Invalid rail "${value}" (expected gateway, exact or auto).`);
}

/** Keeps the options of the chosen rail. `auto` prefers Gateway when the deposit covers the price. */
export function railPolicy(rail: RailChoice, gatewayAvailable: bigint): PaymentPolicy {
  return (_version, requirements) => {
    const gateway = requirements.filter((r) => isBatchPayment(r));
    const exact = requirements.filter((r) => !isBatchPayment(r));
    if (rail === "gateway") return gateway;
    if (rail === "exact") return exact;
    const funded = gateway.filter((r) => BigInt(r.amount) <= gatewayAvailable);
    return funded.length > 0 ? funded : exact;
  };
}

/**
 * Caps one payment at `max` USDC, before anything is signed. CompositeEvmScheme
 * cannot name default assets, so Arc USDC is listed with its own atomic cap.
 */
export function spendControlsFor(network: ChainPeNetwork, max: string) {
  assertUsdcAmount(max);
  const { caip2, usdc } = getNetwork(network);
  return {
    maxAmountPerPayment: false as const,
    allowedAssets: [{ network: caip2, asset: usdc, maxAmountPerPayment: parseUsdc(max).toString() }],
  };
}

/** Builds a Gateway client for the Arc network. The key stays in memory. */
export function gatewayClient(network: ChainPeNetwork, privateKey: Hex): GatewayClient {
  const info = getNetwork(network);
  return new GatewayClient({ chain: info.gatewayChain, privateKey, rpcUrl: info.rpcUrl });
}

/** Refuses anything but a positive USDC amount with at most 6 decimals. */
export function assertUsdcAmount(amount: string): void {
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseUsdc(amount) <= 0n) {
    throw new Error(`Invalid amount "${amount}" (expected positive USDC, e.g. 1.50).`);
  }
}

function resolveKey(explicit?: string): Hex {
  const key = explicit ?? process.env.CHAINPE_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "No wallet key. Pass --key 0x… or set CHAINPE_PRIVATE_KEY (the consumer wallet that pays).",
    );
  }
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
}

/** Parses repeated `-H "Key: Value"` flags into a headers object. */
function parseHeaders(headers?: string[]): Record<string, string> | undefined {
  if (!headers?.length) return undefined;
  const out: Record<string, string> = {};
  for (const h of headers) {
    const idx = h.indexOf(":");
    if (idx === -1) throw new Error(`Invalid header "${h}" (expected "Key: Value").`);
    out[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
  }
  return out;
}

export interface FetchCommandOptions {
  method?: string;
  header?: string[];
  data?: string;
  key?: string;
  network?: string;
  max?: string;
  rail?: string;
  raw?: boolean;
}

export async function runFetchCommand(url: string, opts: FetchCommandOptions): Promise<void> {
  const spinner = opts.raw ? null : ora("Fetching (auto-pays a 402 in USDC)…");

  try {
    const network = parseNetwork(opts.network ?? process.env.CHAINPE_NETWORK ?? "arc-testnet");
    const rail = parseRailChoice(opts.rail ?? "auto");
    const key = resolveKey(opts.key);
    const account = privateKeyToAccount(key);
    const method = (opts.method ?? "GET").toUpperCase();

    if (!opts.raw) {
      console.log(chalk.gray(`  ${method} ${chalk.white(url)}  ·  wallet ${shortAddr(account.address)} on ${chalk.yellow(network)}`));
    }
    spinner?.start();

    const gatewayAvailable = rail === "auto" ? await availableDeposit(network, key) : 0n;
    const client = new CompositeEvmScheme(new BatchEvmScheme(account), new ExactEvmScheme(account));
    const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: getNetwork(network).caip2, client: client as unknown as ExactEvmScheme }],
      // Runs before policies, so before anything is signed.
      spendControls: spendControlsFor(network, opts.max ?? DEFAULT_MAX_USDC),
      policies: [railPolicy(rail, gatewayAvailable)],
    });

    const res = await payingFetch(url, { method, headers: parseHeaders(opts.header), body: opts.data });
    const body = await res.text();
    const header = res.headers.get("PAYMENT-RESPONSE");
    const receipt = header ? decodePaymentResponseHeader(header) : undefined;
    spinner?.stop();

    if (opts.raw) {
      process.stdout.write(`${body}\n`);
      if (!res.ok) process.exit(1);
      return;
    }

    console.log((res.ok ? chalk.green : chalk.red)(`  ${res.ok ? "✓" : "✗"} ${res.status}`));
    if (receipt?.success && TX_HASH.test(receipt.transaction)) {
      console.log(chalk.gray(`    Tx:       ${chalk.cyan(receipt.transaction)}`));
      console.log(chalk.gray(`    Explorer: ${chalk.cyan(explorerTxUrl(network, receipt.transaction))}`));
    } else if (receipt?.success) {
      console.log(chalk.gray(`    Gateway payment: ${chalk.cyan(receipt.transaction)} (settles in the next batch)`));
    } else if (receipt) {
      console.log(chalk.red(`    Payment failed: ${receipt.errorReason ?? "unknown reason"}`));
    } else {
      console.log(chalk.gray("    Payment:  none made"));
    }
    console.log();
    console.log(body);
    if (!res.ok) process.exit(1);
  } catch (err) {
    spinner?.fail("Request failed");
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exit(1);
  }
}

/** A deposit we cannot read counts as empty, so `auto` falls back to paying from the wallet. */
async function availableDeposit(network: ChainPeNetwork, key: Hex): Promise<bigint> {
  try {
    return (await gatewayClient(network, key).getBalances()).gateway.available;
  } catch {
    return 0n;
  }
}

export interface DepositCommandOptions {
  key?: string;
  network?: string;
}

export async function runDepositCommand(amount: string, opts: DepositCommandOptions): Promise<void> {
  const spinner = ora(`Depositing ${amount} USDC into Gateway…`);
  try {
    assertUsdcAmount(amount);
    const network = parseNetwork(opts.network ?? process.env.CHAINPE_NETWORK ?? "arc-testnet");
    const client = gatewayClient(network, resolveKey(opts.key));

    spinner.start();
    const result = await client.deposit(amount);
    const { gateway } = await client.getBalances();
    spinner.succeed(`Deposited ${result.formattedAmount} USDC from ${shortAddr(result.depositor)}`);

    console.log(chalk.gray(`    Tx:       ${chalk.cyan(result.depositTxHash)}`));
    console.log(chalk.gray(`    Explorer: ${chalk.cyan(explorerTxUrl(network, result.depositTxHash))}`));
    console.log(chalk.gray(`    Gateway:  ${chalk.green(gateway.formattedAvailable)} USDC available`));
  } catch (err) {
    spinner.fail("Deposit failed");
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exit(1);
  }
}

export function runDiscoverCommand(): void {
  console.log(chalk.yellow("  Service discovery is not available on Arc yet."));
  process.exit(1);
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
