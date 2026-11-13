/**
 * Consumer-side CLI commands (curl-level): `chainpe fetch` and `chainpe discover`.
 *
 * These are thin wrappers over `@chainpe/sdk` — the same payment + discovery
 * core used by the wallet MCP, the agent, and the framework tools — so a paid
 * call from the terminal settles on Avalanche exactly like one from an agent.
 */
import chalk from "chalk";
import ora from "ora";
import {
  ChainPe,
  RegistryClient,
  resolveRegistryAddress,
  resolveReputationRegistry,
  getReputation,
  filterServices,
  rankByReputation,
  type RankedService,
} from "@chainpeavax/sdk";
import type { ChainPeNetwork } from "../types.js";
import { explorerTxUrl } from "../chains.js";

function resolveNetwork(explicit?: string): ChainPeNetwork {
  const n = explicit ?? process.env.CHAINPE_NETWORK ?? "fuji";
  if (n !== "fuji" && n !== "avalanche") {
    throw new Error(`Invalid network "${n}" (expected "fuji" or "avalanche").`);
  }
  return n;
}

function resolveKey(explicit?: string): string {
  const key = explicit ?? process.env.CHAINPE_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "No wallet key. Pass --key 0x… or set CHAINPE_PRIVATE_KEY (the consumer wallet that pays).",
    );
  }
  return key;
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
  feedback?: boolean;
  raw?: boolean;
}

export async function runFetchCommand(url: string, opts: FetchCommandOptions): Promise<void> {
  const network = resolveNetwork(opts.network);
  const privateKey = resolveKey(opts.key);
  const method = (opts.method ?? "GET").toUpperCase();

  const cp = new ChainPe({
    privateKey,
    network,
    maxPerCall: opts.max,
    autoFeedback: !!opts.feedback,
  });

  const headers = parseHeaders(opts.header);

  if (!opts.raw) {
    console.log(chalk.gray(`  ${method} ${chalk.white(url)}  ·  wallet ${shortAddr(cp.getAddress())} on ${chalk.yellow(network)}`));
  }
  const spinner = opts.raw ? null : ora("Fetching (auto-pays a 402 in USDC)…").start();

  try {
    const res = await cp.pay(url, {
      method,
      headers,
      body: opts.data,
    });
    spinner?.stop();

    if (opts.raw) {
      process.stdout.write(typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2));
      process.stdout.write("\n");
      return;
    }

    const statusColor = res.ok ? chalk.green : chalk.red;
    console.log(statusColor(`  ✓ ${res.status}`));

    if (res.payment) {
      console.log(
        chalk.gray(
          `    Paid:     ${chalk.green(res.payment.amount)} USDC → ${shortAddr(res.payment.recipient)} on ${chalk.yellow(res.payment.network)}`,
        ),
      );
      if (res.payment.txHash) {
        console.log(chalk.gray(`    Tx:       ${chalk.cyan(explorerTxUrl(network, res.payment.txHash))}`));
      }
    } else {
      console.log(chalk.gray("    Payment:  none required (non-402 response)"));
    }

    if (res.reputation) {
      console.log(
        chalk.gray(
          `    Rated:    agent ${res.reputation.agentId} +${res.reputation.score} (ERC-8004) · ${chalk.cyan(explorerTxUrl(network, res.reputation.txHash))}`,
        ),
      );
    }

    console.log();
    console.log(typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2));
  } catch (err) {
    spinner?.fail("Request failed");
    console.log(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exit(1);
  }
}

export interface DiscoverCommandOptions {
  network?: string;
  tag?: string[];
  maxPrice?: string;
  json?: boolean;
}

export async function runDiscoverCommand(query: string | undefined, opts: DiscoverCommandOptions): Promise<void> {
  const network = resolveNetwork(opts.network);
  const registryAddress = resolveRegistryAddress(network);
  const reputationRegistry = resolveReputationRegistry(network);

  const spinner = opts.json ? null : ora("Discovering services on-chain…").start();
  try {
    const registry = new RegistryClient(network, registryAddress);
    const services = filterServices(await registry.listAllServices(), {
      query,
      tags: opts.tag,
      maxPrice: opts.maxPrice,
    });

    const ranked: RankedService[] = rankByReputation(
      await Promise.all(
        services.map(async (s) => ({
          ...s,
          reputation: s.agentId ? await getReputation(network, reputationRegistry, s.agentId) : null,
        })),
      ),
    );
    spinner?.stop();

    if (opts.json) {
      process.stdout.write(JSON.stringify(ranked, null, 2) + "\n");
      return;
    }

    if (ranked.length === 0) {
      console.log(chalk.gray("  No matching services on-chain.\n"));
      return;
    }

    console.log();
    for (const s of ranked) {
      const rep = s.reputation;
      const stars = rep?.score != null ? chalk.yellow(`⭐ ${rep.score} (${rep.count})`) : chalk.gray("unrated");
      console.log(`  ${chalk.white.bold(s.name)}  ${stars}`);
      console.log(chalk.gray(`    ${s.description}`));
      console.log(chalk.gray(`    Endpoint: ${chalk.cyan(s.endpoint)}`));
      console.log(chalk.gray(`    Price:    ${chalk.green(s.pricePerRequest)} USDC${s.tags.length ? `  ·  ${s.tags.join(", ")}` : ""}`));
      console.log();
    }
    console.log(chalk.gray(`  ${ranked.length} service(s) · ranked by ERC-8004 reputation · Registry ${registryAddress}\n`));
  } catch (err) {
    spinner?.fail("Discovery failed");
    console.log(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exit(1);
  }
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
