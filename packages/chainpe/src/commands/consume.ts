/**
 * Consumer-side CLI commands (curl-level): `chainpe fetch` and `chainpe discover`.
 *
 * `fetch` pays any x402 v2 402 on Arc in USDC, signing with the consumer wallet.
 */
import chalk from "chalk";
import ora from "ora";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { explorerTxUrl, getNetwork, parseNetwork } from "../chains.js";

const DEFAULT_MAX_USDC = "1";

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
  raw?: boolean;
}

export async function runFetchCommand(url: string, opts: FetchCommandOptions): Promise<void> {
  const spinner = opts.raw ? null : ora("Fetching (auto-pays a 402 in USDC)…");

  try {
    const network = parseNetwork(opts.network ?? process.env.CHAINPE_NETWORK ?? "arc-testnet");
    const account = privateKeyToAccount(resolveKey(opts.key));
    const method = (opts.method ?? "GET").toUpperCase();

    if (!opts.raw) {
      console.log(chalk.gray(`  ${method} ${chalk.white(url)}  ·  wallet ${shortAddr(account.address)} on ${chalk.yellow(network)}`));
    }
    spinner?.start();

    const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: getNetwork(network).caip2, client: new ExactEvmScheme(account) }],
      spendControls: { maxAmountPerPayment: `$${opts.max ?? DEFAULT_MAX_USDC}` },
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
    if (receipt?.success && receipt.transaction) {
      console.log(chalk.gray(`    Tx:       ${chalk.cyan(receipt.transaction)}`));
      console.log(chalk.gray(`    Explorer: ${chalk.cyan(explorerTxUrl(network, receipt.transaction))}`));
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

export function runDiscoverCommand(): void {
  console.log(chalk.yellow("  Service discovery is not available on Arc yet."));
  process.exit(1);
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
