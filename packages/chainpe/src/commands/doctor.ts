/**
 * `chainpe doctor`: generates the discovery documents and checks a service is
 * ready for agents and for Circle's marketplace. Read-only and keyless, except
 * `--pay`, which spends one real payment per route from the buyer key.
 */
import fs from "fs/promises";
import chalk from "chalk";
import { getNetwork, parseNetwork, type ChainPeNetwork } from "../chains.js";
import { configPath, loadConfig } from "../config.js";
import { concreteRoutes, runChecks, type CheckStatus, type DoctorReport, type PaidCall } from "../doctor/checks.js";
import { documentedRoutes, documentPaths, generateDocuments, type DocumentPaths, type Samples } from "../doctor/documents.js";
import { formatUsdc, parseUsdc } from "../evm.js";
import { sanitizeForTerminal } from "../listing.js";
import { chainReader } from "../onchain.js";
import type { ChainPeConfig } from "../types.js";
import { createPayingFetch, resolveKey } from "./consume.js";

export interface DoctorOptions {
  network?: string;
  url?: string;
  sample?: string;
  pay?: boolean;
  regenerate?: boolean;
  json?: boolean;
}

const GET_LISTED = "https://forms.gle/7YFzvdmMcn1JH5tF6";

const ICONS: Record<CheckStatus, string> = {
  pass: chalk.green("✓"),
  warn: chalk.yellow("!"),
  fail: chalk.red("✗"),
  unknown: chalk.magenta("?"),
  skip: chalk.gray("-"),
  info: chalk.blue("i"),
};

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false
  );
}

async function readSamples(paths: DocumentPaths, sampleFile?: string): Promise<Samples> {
  if (sampleFile) {
    let samples: Samples;
    try {
      samples = JSON.parse(await fs.readFile(sampleFile, "utf-8")) as Samples;
    } catch (err) {
      throw new Error(`Could not read --sample ${sampleFile}: ${(err as Error).message}`, { cause: err });
    }
    await fs.writeFile(paths.samples, JSON.stringify(samples, null, 2));
    return samples;
  }
  if (!(await exists(paths.samples))) return {};
  return JSON.parse(await fs.readFile(paths.samples, "utf-8")) as Samples;
}

/** Keeps what is there unless asked: an edited document should show up as drift, not be overwritten. */
async function writeDocuments(config: ChainPeConfig, network: ChainPeNetwork, publicUrl: string, paths: DocumentPaths, samples: Samples, force: boolean): Promise<string[]> {
  const documents = generateDocuments(config, network, publicUrl, samples);
  const written: string[] = [];
  for (const [file, content] of [
    [paths.openapi, documents.openapi],
    [paths.x402, documents.x402],
    [paths.discovery, documents.discovery],
  ] as const) {
    if (force || !(await exists(file))) {
      await fs.writeFile(file, JSON.stringify(content, null, 2));
      written.push(file);
    }
  }
  return written;
}

/** One real payment per route, each capped at that route's own price. */
async function payOnce(config: ChainPeConfig, network: ChainPeNetwork, baseUrl: string, quiet: boolean): Promise<{ paid: PaidCall[]; samples: Samples }> {
  const key = resolveKey();
  const routes = concreteRoutes(documentedRoutes(config));
  if (routes.length === 0) throw new Error("--pay needs `routes` in the config: the catch-all has no path to call.");
  if (!quiet) {
    const total = routes.reduce((sum, route) => sum + parseUsdc(route.price), 0n);
    console.log(chalk.yellow(`  --pay spends up to ${formatUsdc(total)} USDC from the buyer key, one payment per route.`));
  }
  const paid: PaidCall[] = [];
  const samples: Samples = {};
  for (const route of routes) {
    const payingFetch = await createPayingFetch(network, key, "auto", route.price);
    const res = await payingFetch(`${baseUrl}${route.path}`, { method: route.method });
    const text = await res.text();
    paid.push({ key: route.key, status: res.status });
    if (res.ok) {
      try {
        samples[route.key] = JSON.parse(text);
      } catch {
        /* Not JSON, so there is no schema to infer. Check 7 reports it. */
      }
    }
  }
  return { paid, samples };
}

function printReport(report: DoctorReport): void {
  console.log(chalk.cyan.bold(`▸ chainpe doctor: ${sanitizeForTerminal(report.service)} on ${report.network}`));
  console.log(chalk.gray(`  ${report.endpoint}\n`));
  for (const check of report.checks) {
    console.log(`  ${ICONS[check.status]} ${String(check.id).padStart(2)}  ${check.name}`);
    console.log(chalk.gray(`        ${sanitizeForTerminal(check.detail)}`));
    for (const line of check.diff ?? []) console.log(chalk.red(`        ${sanitizeForTerminal(line)}`));
  }
  console.log();
  console.log(chalk.gray(`  Score: ${report.score.passed}/${report.score.total}`));
}

function printIntake(config: ChainPeConfig): void {
  console.log();
  console.log(chalk.green.bold("  Ready for Circle's Get listed form"), chalk.cyan(GET_LISTED));
  console.log(chalk.gray(`    Endpoint:       ${config.publicUrl}`));
  console.log(chalk.gray(`    Payout wallet:  ${config.walletAddress} (sanctions-screened during review)`));
  console.log(chalk.gray(`    Description:    ${config.serviceDescription}`));
  console.log(chalk.gray(`    OpenAPI:        ${config.publicUrl}/openapi.json`));
  console.log(chalk.gray("    Listed services are health-checked continuously, so keep the endpoint up."));
}

export async function runDoctorCommand(options: DoctorOptions): Promise<void> {
  try {
    const config = await loadConfig();
    if (!config) throw new Error("No configuration found. Run `chainpe init` first, or set CHAINPE_CONFIG.");
    const network = parseNetwork(options.network ?? process.env.CHAINPE_NETWORK ?? config.network);
    const baseUrl = (options.url ?? config.publicUrl)?.replace(/\/+$/, "");
    if (!baseUrl) throw new Error('No publicUrl in the config. Add "publicUrl", or pass --url to check a proxy elsewhere.');

    const paths = documentPaths(configPath());
    let samples = await readSamples(paths, options.sample);
    let paid: PaidCall[] | undefined;
    if (options.pay) {
      const result = await payOnce(config, network, baseUrl, Boolean(options.json));
      paid = result.paid;
      samples = { ...samples, ...result.samples };
      await fs.writeFile(paths.samples, JSON.stringify(samples, null, 2));
    }
    const publicUrl = (config.publicUrl ?? baseUrl).replace(/\/+$/, "");
    const force = Boolean(options.regenerate || options.sample || options.pay);
    const written = await writeDocuments(config, network, publicUrl, paths, samples, force);
    if (!options.json) for (const file of written) console.log(chalk.gray(`  Wrote ${file}`));

    const report = await runChecks({ config, network, baseUrl, chain: chainReader(network), paid });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
      printReport(report);
      if (report.ok && !options.url) printIntake(config);
      if (!getNetwork(network).accountsAddress) console.log(chalk.yellow(`  ChainPeAccounts is not deployed on ${network} yet.`));
    }
    process.exitCode = report.ok ? 0 : 1;
  } catch (err) {
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exitCode = 1;
  }
}
