/**
 * `chainpe discover`: finds services through Circle's Discovery API and
 * ChainPeAccounts, which also covers providers Circle has not listed yet.
 */
import chalk from "chalk";
import { formatUnits } from "viem";
import { AccountsReader, accountsAddress } from "../accounts.js";
import { getNetwork, parseNetwork, USDC_DECIMALS, type ChainPeNetwork } from "../chains.js";
import { loadConfig } from "../config.js";
import { sanitizeForTerminal } from "../listing.js";
import { chainReader } from "../onchain.js";

export const CIRCLE_DISCOVERY_URL = "https://api.circle.com/v2/x402/discovery/resources";

const DEFAULT_LIMIT = 20;
const GATEWAY_SCHEME_NAME = "GatewayWalletBatched";
const ACCOUNTS_PAGE_SIZE = 25n;

export interface FoundService {
  name: string;
  description: string;
  endpoint: string;
  /** Human USDC. */
  price: string;
  rails: string[];
  source: "circle" | "chainpe";
  payTo: string;
  agentId?: string;
}

export interface DiscoverFilters {
  query?: string;
  maxPrice?: string;
  limit?: number;
}

interface CircleItem {
  resource: string;
  accepts?: { network: string; amount: string; payTo: string; extra?: { name?: string } }[];
  metadata?: { method?: string; description?: string; provider?: { name?: string; description?: string } };
}

/** Maps one listing to a service on this network, or undefined if it has no option here. */
export function mapCircleItem(item: CircleItem, network: ChainPeNetwork): FoundService | undefined {
  const { caip2 } = getNetwork(network);
  const accepts = (item.accepts ?? []).filter((accept) => accept.network === caip2);
  if (accepts.length === 0) return undefined;
  const cheapest = accepts.reduce((low, accept) => (BigInt(accept.amount) < BigInt(low.amount) ? accept : low));
  const isGateway = (name?: string) => name === GATEWAY_SCHEME_NAME;
  return {
    name: item.metadata?.provider?.name ?? new URL(item.resource).hostname,
    description: item.metadata?.description ?? item.metadata?.provider?.description ?? "",
    endpoint: `${item.metadata?.method ? `${item.metadata.method} ` : ""}${item.resource}`,
    price: formatUnits(BigInt(cheapest.amount), USDC_DECIMALS),
    rails: [
      ...(accepts.some((accept) => isGateway(accept.extra?.name)) ? ["gateway"] : []),
      ...(accepts.some((accept) => !isGateway(accept.extra?.name)) ? ["exact"] : []),
    ],
    source: "circle",
    payTo: cheapest.payTo,
  };
}

/** Keeps a listing only when one of its words is a query word (or that word plus "s"). */
export function isRelevant(service: FoundService, query?: string): boolean {
  const words = (query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (words.length === 0) return true;
  const tokens = new Set([service.name, service.description, service.endpoint].join(" ").toLowerCase().split(/[^a-z0-9]+/));
  return words.some((w) => tokens.has(w) || tokens.has(`${w}s`) || (w.endsWith("s") && tokens.has(w.slice(0, -1))));
}

async function searchCircle(network: ChainPeNetwork, filters: DiscoverFilters): Promise<FoundService[]> {
  const url = new URL(CIRCLE_DISCOVERY_URL);
  url.searchParams.set("network", getNetwork(network).caip2);
  url.searchParams.set("limit", String(filters.limit ?? DEFAULT_LIMIT));
  if (filters.query) url.searchParams.set("query", filters.query);
  if (filters.maxPrice) url.searchParams.set("maxUsdPrice", filters.maxPrice);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Circle Discovery answered ${res.status}.`);
  const body = (await res.json()) as { items?: CircleItem[] };
  return (body.items ?? []).flatMap((item) => mapCircleItem(item, network) ?? []).filter((service) => isRelevant(service, filters.query));
}

async function listChainPe(network: ChainPeNetwork, filters: DiscoverFilters): Promise<FoundService[]> {
  if (!getNetwork(network).accountsAddress) return [];
  const accounts = new AccountsReader(chainReader(network), accountsAddress(network));
  const total = await accounts.serviceCount();
  const found: FoundService[] = [];
  for (let offset = 0n; offset < total; offset += ACCOUNTS_PAGE_SIZE) {
    for (const service of await accounts.page(offset, ACCOUNTS_PAGE_SIZE)) {
      if (!service.active) continue;
      found.push({
        name: service.name,
        description: service.description,
        endpoint: service.endpoint,
        price: service.pricePerRequest,
        rails: [...(service.acceptsGateway ? ["gateway"] : []), ...(service.acceptsExact ? ["exact"] : [])],
        source: "chainpe",
        payTo: service.payTo,
        agentId: service.agentId > 0n ? service.agentId.toString() : undefined,
      });
    }
  }
  return filterListings(found, filters);
}

export function filterListings(services: FoundService[], filters: DiscoverFilters): FoundService[] {
  const query = filters.query?.toLowerCase();
  return services.filter(
    (service) =>
      (!query || service.name.toLowerCase().includes(query) || service.description.toLowerCase().includes(query)) &&
      (!filters.maxPrice || parseFloat(service.price) <= parseFloat(filters.maxPrice))
  );
}

/** ChainPe listings come first, except one Circle already lists for the same wallet and host. */
export function mergeListings(circle: FoundService[], chainpe: FoundService[]): FoundService[] {
  const key = (service: FoundService) => {
    const url = service.endpoint.split(" ").pop() ?? "";
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* A malformed endpoint is only compared as written. */
    }
    return `${service.payTo.toLowerCase()}@${host}`;
  };
  const listed = new Set(circle.map(key));
  return [...chainpe.filter((service) => !listed.has(key(service))), ...circle];
}

export interface DiscoverCommandOptions {
  network?: string;
  max?: string;
  limit?: string;
  json?: boolean;
}

export async function runDiscoverCommand(query: string | undefined, options: DiscoverCommandOptions): Promise<void> {
  try {
    const network = parseNetwork(options.network ?? process.env.CHAINPE_NETWORK ?? (await loadConfig())?.network ?? "arc-testnet");
    const limit = options.limit ? parseInt(options.limit, 10) : DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Invalid --limit "${options.limit}".`);
    const filters: DiscoverFilters = { query, maxPrice: options.max, limit };

    const [circle, chainpe] = await Promise.allSettled([searchCircle(network, filters), listChainPe(network, filters)]);
    if (circle.status === "rejected" && chainpe.status === "rejected") {
      throw new Error(`Could not read Circle or ChainPeAccounts: ${(circle.reason as Error).message}`);
    }
    const services = mergeListings(
      circle.status === "fulfilled" ? circle.value : [],
      chainpe.status === "fulfilled" ? chainpe.value : []
    ).slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify(services, null, 2));
      return;
    }
    if (circle.status === "rejected") console.log(chalk.yellow("  Circle Discovery could not be read, so this only shows ChainPe listings."));
    if (chainpe.status === "rejected") console.log(chalk.yellow("  ChainPeAccounts could not be read, so this only shows Circle listings."));
    console.log(chalk.cyan.bold(`▸ ${services.length} service(s) on ${network}${query ? ` matching "${sanitizeForTerminal(query)}"` : ""}`));
    for (const service of services) {
      console.log();
      console.log(`  ${chalk.white.bold(sanitizeForTerminal(service.name))} ${chalk.gray(`(${service.source})`)}`);
      if (service.description) console.log(chalk.gray(`    ${sanitizeForTerminal(service.description)}`));
      console.log(chalk.gray(`    Price:    ${chalk.green(sanitizeForTerminal(service.price))} USDC, by ${service.rails.join(" or ")}`));
      console.log(chalk.gray(`    Endpoint: ${sanitizeForTerminal(service.endpoint)} ${chalk.yellow("(unverified)")}`));
      if (service.agentId) console.log(chalk.gray(`    Agent ID: ${service.agentId}`));
    }
    if (services.length > 0) {
      console.log();
      console.log(chalk.gray(`  Pay for one with ${chalk.cyan("chainpe fetch <url>")}. For a base URL, read <url>/openapi.json for its paths.`));
    }
  } catch (err) {
    console.error(chalk.red(`  ✗ ${(err as Error).message}`));
    process.exitCode = 1;
  }
}
