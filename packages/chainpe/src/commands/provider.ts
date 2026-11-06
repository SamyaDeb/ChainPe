/**
 * Provider account commands on Arc: identity, register, deregister, list, plan and upgrade.
 * The seller key is read from the environment, used in memory and never printed.
 */
import * as p from "@clack/prompts";
import chalk from "chalk";
import { getAddress } from "viem";
import { accountsAddress, AccountsReader, AccountsWriter, type OnChainService } from "../accounts.js";
import { explorerTxUrl, getNetwork, parseNetwork, type ChainPeNetwork } from "../chains.js";
import { loadConfig, saveConfig } from "../config.js";
import { ensureIdentity, explorerAgentIdLookup } from "../erc8004.js";
import { formatUsdc } from "../evm.js";
import { assertPublicUrl, buildServiceInput, sanitizeForTerminal } from "../listing.js";
import { chainReader, chainWriter, describeChainError, type ChainWriter, type SentTx } from "../onchain.js";
import { resolveSellerKey } from "../proxy/circleFacilitator.js";
import { quoteUpgrade, runUpgrade, syncRegistration } from "../registration.js";
import type { ChainPeConfig } from "../types.js";

/** How many full structs to read per call: a full page of 100 can exceed RPC gas caps. */
const LIST_PAGE_SIZE = 25n;

interface SellerContext {
  config: ChainPeConfig;
  network: ChainPeNetwork;
}

async function context(networkOption?: string): Promise<SellerContext> {
  const config = await loadConfig();
  if (!config) throw new Error("No configuration found. Run `chainpe init` first, or set CHAINPE_CONFIG.");
  return { config, network: parseNetwork(networkOption ?? process.env.CHAINPE_NETWORK ?? config.network) };
}

function printTx(network: ChainPeNetwork, tx: SentTx): void {
  console.log(chalk.gray(`    ${chalk.green("✓")} ${tx.label}  ${chalk.cyan(explorerTxUrl(network, tx.hash))}`));
}

/** Runs a command, printing a clean error instead of a stack trace. */
async function guarded(body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    console.error(chalk.red(`  ✗ ${describeChainError(err)}`));
    process.exit(1);
  }
}

interface IdentityFlags {
  agentId?: string;
  updateUri?: boolean;
  new?: boolean;
  allowHttp?: boolean;
}

/** Finds or mints the identity, saving a new agentId the moment it exists. */
async function resolveIdentity(chain: ChainWriter, ctx: SellerContext, publicUrl: string, flags: IdentityFlags) {
  const { config, network } = ctx;
  const saveAgentId = async (agentId: bigint) => {
    config.agentId = agentId.toString();
    await saveConfig(config);
  };
  const result = await ensureIdentity({
    chain,
    registry: getNetwork(network).identityRegistry,
    publicUrl,
    configuredAgentId: config.agentId,
    explicitAgentId: flags.agentId,
    mintNew: flags.new,
    updateUri: flags.updateUri,
    lookup: explorerAgentIdLookup(network),
    onMinted: saveAgentId,
  });
  if (config.agentId !== result.agentId.toString()) await saveAgentId(result.agentId);
  for (const tx of result.txs) printTx(network, tx);
  const verb = { minted: "Minted", recovered: "Recovered", configured: "Using" }[result.source];
  console.log(chalk.gray(`    ${verb} agentId ${chalk.white(result.agentId)}, owned by ${chain.account}`));
  if (!result.uriMatches) {
    console.log(chalk.yellow(`    ⚠ Token URI is ${sanitizeForTerminal(result.actualUri)}, expected ${result.agentUri}. Fix it with \`chainpe identity --update-uri\`.`));
  }
  return result;
}

export function runIdentityCommand(options: IdentityFlags & { network?: string }): Promise<void> {
  return guarded(async () => {
    const ctx = await context(options.network);
    const publicUrl = assertPublicUrl(ctx.config.publicUrl, { network: ctx.network, targetUrl: ctx.config.targetUrl, allowHttp: options.allowHttp });
    const chain = chainWriter(ctx.network, resolveSellerKey(ctx.config.walletAddress));
    console.log(chalk.cyan.bold("▸ ERC-8004 identity"));
    await resolveIdentity(chain, ctx, publicUrl, options);
  });
}

export function runRegisterCommand(options: { network?: string; allowHttp?: boolean }): Promise<void> {
  return guarded(async () => {
    const ctx = await context(options.network);
    const { config, network } = ctx;
    const address = accountsAddress(network);
    const publicUrl = assertPublicUrl(config.publicUrl, { network, targetUrl: config.targetUrl, allowHttp: options.allowHttp });
    const input = buildServiceInput(config, network, publicUrl);
    const chain = chainWriter(network, resolveSellerKey(config.walletAddress));
    const accounts = new AccountsWriter(chain, address);
    await accounts.assertDeployment(network);

    console.log(chalk.cyan.bold("▸ Registering on ChainPeAccounts"));
    const { agentId } = await resolveIdentity(chain, ctx, publicUrl, {});
    const result = await syncRegistration(accounts, getAddress(config.walletAddress), input, agentId, (tx) => printTx(network, tx));

    console.log();
    if (result.txs.length === 0) console.log(chalk.green("  ✓ Already up to date. No transaction sent."));
    else console.log(chalk.green(`  ✓ ${result.reactivated ? "Reactivated" : "Registered"} "${input.name}"`));
    console.log(chalk.gray(`    Key:      ${chalk.white(result.key)}`));
    console.log(chalk.gray(`    Agent:    ${chalk.white(agentId)}`));
    console.log(chalk.gray(`    Endpoint: ${chalk.cyan(input.endpoint)}`));
    console.log(chalk.gray(`    Contract: ${chalk.cyan(`${getNetwork(network).explorer}/address/${address}`)}`));
    if (process.env.CHAINPE_DASHBOARD_URL) console.log(chalk.gray(`    Dashboard: ${chalk.cyan(process.env.CHAINPE_DASHBOARD_URL)}`));
  });
}

export function runDeregisterCommand(options: { network?: string; name?: string }): Promise<void> {
  return guarded(async () => {
    const { config, network } = await context(options.network);
    const name = options.name ?? config.serviceName;
    const chain = chainWriter(network, resolveSellerKey(config.walletAddress));
    const accounts = new AccountsWriter(chain, accountsAddress(network));
    await accounts.assertDeployment(network);
    printTx(network, await accounts.deactivateService(name));
    console.log(chalk.green(`  ✓ Deactivated "${sanitizeForTerminal(name)}".`));
    console.log(chalk.gray("    Its history stays on-chain. `chainpe register` with the same name reactivates the same key."));
  });
}

/** Every string here was written on-chain by someone we do not know. */
function publicView(service: OnChainService) {
  return {
    key: service.key,
    name: sanitizeForTerminal(service.name),
    provider: service.provider,
    payTo: service.payTo,
    agentId: service.agentId.toString(),
    endpoint: sanitizeForTerminal(service.endpoint),
    pricePerRequest: sanitizeForTerminal(service.pricePerRequest),
    network: sanitizeForTerminal(service.network),
    description: sanitizeForTerminal(service.description),
    tags: sanitizeForTerminal(service.tags),
    rails: [service.acceptsExact && "exact", service.acceptsGateway && "gateway"].filter(Boolean),
    active: service.active,
  };
}

export function runListCommand(options: { network?: string; mine?: boolean; all?: boolean; json?: boolean }): Promise<void> {
  return guarded(async () => {
    const network = parseNetwork(options.network ?? process.env.CHAINPE_NETWORK ?? (await loadConfig())?.network ?? "arc-testnet");
    const accounts = new AccountsReader(chainReader(network), accountsAddress(network));
    await accounts.assertDeployment(network);

    const services: OnChainService[] = [];
    if (options.mine) {
      const config = await loadConfig();
      if (!config) throw new Error("--mine needs a config with walletAddress. Run `chainpe init`, or set CHAINPE_CONFIG.");
      for (const key of await accounts.servicesOf(config.walletAddress)) {
        const service = await accounts.service(key);
        if (service) services.push(service);
      }
    } else {
      const total = await accounts.serviceCount();
      for (let offset = 0n; offset < total; offset += LIST_PAGE_SIZE) services.push(...(await accounts.page(offset, LIST_PAGE_SIZE)));
    }

    const shown = services.filter((service) => options.all || service.active).map(publicView);
    if (options.json) {
      console.log(JSON.stringify(shown, null, 2));
      return;
    }
    console.log(chalk.cyan.bold(`▸ ${shown.length} service(s) on ${network}`));
    for (const service of shown) {
      console.log();
      console.log(`  ${chalk.white.bold(service.name)}${service.active ? "" : chalk.yellow(" (inactive)")}`);
      console.log(chalk.gray(`    Endpoint: ${service.endpoint} ${chalk.yellow("(unverified)")}`));
      console.log(chalk.gray(`    Price:    ${service.pricePerRequest} USDC via ${service.rails.join(", ")}`));
      console.log(chalk.gray(`    Provider: ${service.provider}`));
      console.log(chalk.gray(`    Agent:    ${service.agentId === "0" ? "none" : service.agentId}`));
      console.log(chalk.gray(`    Key:      ${service.key}`));
    }
  });
}

function formatDate(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 10);
}

export function runPlanCommand(options: { network?: string }): Promise<void> {
  return guarded(async () => {
    const { config, network } = await context(options.network);
    const accounts = new AccountsReader(chainReader(network), accountsAddress(network));
    await accounts.assertDeployment(network);
    const [provider, plan, max] = await Promise.all([
      accounts.provider(config.walletAddress),
      accounts.planOf(config.walletAddress),
      accounts.maxServices(config.walletAddress),
    ]);
    console.log(chalk.cyan.bold("▸ Plan"));
    if (!provider.exists) {
      console.log(chalk.gray("    No provider account yet. Run `chainpe register`."));
      return;
    }
    console.log(chalk.gray(`    Plan:       ${plan === 1 ? chalk.green("Pro") : chalk.white("Free")}`));
    console.log(chalk.gray(`    Paid until: ${provider.paidUntil > 0n ? chalk.white(formatDate(provider.paidUntil)) : "-"}`));
    console.log(chalk.gray(`    Services:   ${chalk.white(`${provider.activeServices} of ${max} active`)}`));
  });
}

export function runUpgradeCommand(options: { network?: string; periods?: string; yes?: boolean }): Promise<void> {
  return guarded(async () => {
    const { config, network } = await context(options.network);
    const periods = Number(options.periods ?? "1");
    const { usdc } = getNetwork(network);
    const chain = chainWriter(network, resolveSellerKey(config.walletAddress));
    const accounts = new AccountsWriter(chain, accountsAddress(network));
    await accounts.assertDeployment(network);

    const quote = await quoteUpgrade(chain, accounts, usdc, periods);
    const summary = `Pay ${formatUsdc(quote.amount)} USDC for ${periods} × 30 days of Pro from ${shortAddress(chain.account)}?`;
    if (!options.yes) {
      if (!process.stdin.isTTY) throw new Error(`${summary} Pass --yes to confirm when not in a terminal.`);
      const confirmed = await p.confirm({ message: summary, initialValue: false });
      if (p.isCancel(confirmed) || !confirmed) {
        console.log(chalk.gray("  Nothing was sent."));
        return;
      }
    }
    const result = await runUpgrade(chain, accounts, usdc, periods, quote, undefined, (tx) => printTx(network, tx));
    console.log(chalk.green(`  ✓ Pro until ${formatDate(result.after)} (paidUntil ${result.before} → ${result.after})`));
    console.log(chalk.gray(`    Allowance left: ${formatUsdc(result.allowanceAfter)} USDC`));
  });
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
