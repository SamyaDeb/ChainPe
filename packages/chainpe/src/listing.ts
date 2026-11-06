/**
 * Turns a CLI config into the strings published on-chain. Everything here is
 * public and permanent, so it is validated before any transaction is signed.
 */
import { getAddress } from "viem";
import type { ServiceInput } from "./accounts.js";
import { getNetwork, type ChainPeNetwork } from "./chains.js";
import { formatUsdc, parseUsdc } from "./evm.js";
import { effectiveRails, ALL_RAILS } from "./proxy/routeConfig.js";
import type { ChainPeConfig } from "./types.js";

/** Field limits in bytes, matching ChainPeAccounts._validateInput. */
const LIMITS: Record<string, [min: number, max: number]> = {
  name: [1, 64],
  endpoint: [1, 256],
  pricePerRequest: [1, 32],
  network: [1, 32],
  description: [0, 1024],
  tags: [0, 256],
};

function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o))) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Looks at the hostname only. A public name that resolves to a private address is not caught. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || /\.(localhost|local|internal)$/.test(host)) return true;
  if (isPrivateIpv4(host)) return true;
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
  // WHATWG URL rewrites an IPv4-mapped address to hex: ::ffff:7f00:1.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!mapped) return false;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
}

export interface PublicUrlOptions {
  network: ChainPeNetwork;
  targetUrl: string;
  /** `--allow-http`: testnet only. */
  allowHttp?: boolean;
}

/**
 * Checks the URL buyers connect to and returns it without a trailing slash. The
 * backend's own address must never go on-chain: buyers could skip the payment
 * proxy and call it for free, and the record cannot be erased.
 */
export function assertPublicUrl(publicUrl: string | undefined, options: PublicUrlOptions): string {
  const { network, targetUrl, allowHttp } = options;
  if (!publicUrl) {
    throw new Error('No publicUrl in the config. Add the HTTPS URL buyers connect to, e.g. "publicUrl": "https://api.example.com".');
  }
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error(`publicUrl "${publicUrl}" is not a valid URL.`);
  }
  if (url.protocol !== "https:") {
    const allowed = url.protocol === "http:" && allowHttp && network === "arc-testnet";
    if (!allowed) throw new Error(`publicUrl must use https (got ${url.protocol}). --allow-http works on arc-testnet only.`);
  }
  if (url.username || url.password) throw new Error("publicUrl must not contain credentials: it is published on-chain.");
  if (url.search || url.hash) throw new Error("publicUrl must not contain a query or fragment: it is published on-chain.");
  if (isPrivateHost(url.hostname)) throw new Error(`publicUrl host ${url.hostname} is private, so buyers cannot reach it.`);
  try {
    if (new URL(targetUrl).origin === url.origin) {
      throw new Error("publicUrl is your backend (targetUrl). Publish the ChainPe proxy's URL, or buyers can skip payment.");
    }
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
  }
  const canonical = url.toString().replace(/\/+$/, "");
  assertBytes("endpoint", canonical);
  return canonical;
}

function assertBytes(field: string, value: string): void {
  const [min, max] = LIMITS[field];
  const length = Buffer.byteLength(value, "utf8");
  if (length < min || length > max) {
    throw new Error(`${field} is ${length} bytes, but must be ${min}-${max} bytes.`);
  }
}

/** Canonical decimal price: "$0.010" becomes "0.01". The contract's own check is not a parser. */
export function canonicalPrice(price: string): string {
  const clean = price.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,6})?$/.test(clean) || parseUsdc(clean) <= 0n) {
    throw new Error(`Invalid price "${price}" (expected positive USDC with at most 6 decimals, e.g. 0.01).`);
  }
  return formatUsdc(parseUsdc(clean));
}

/** Builds and validates the ServiceInput from a config, listing only rails the 402 really offers. */
export function buildServiceInput(config: ChainPeConfig, network: ChainPeNetwork, publicUrl: string): ServiceInput {
  const pricePerRequest = canonicalPrice(config.pricePerRequest);
  const rails = effectiveRails(parseUsdc(pricePerRequest), config.rails ?? ALL_RAILS);
  if (rails.length === 0) throw new Error(`No payment rail can take $${pricePerRequest}: exact needs at least $0.01, so enable gateway.`);
  const input: ServiceInput = {
    name: config.serviceName,
    description: config.serviceDescription,
    tags: config.tags.join(","),
    endpoint: publicUrl,
    pricePerRequest,
    network: getNetwork(network).caip2,
    payTo: getAddress(config.walletAddress),
    acceptsExact: rails.includes("exact"),
    acceptsGateway: rails.includes("gateway"),
  };
  for (const field of Object.keys(LIMITS)) assertBytes(field, input[field as keyof ServiceInput] as string);
  return input;
}

/** On-chain strings are written by anyone. Removes what could rewrite a terminal or reorder text. */
export function sanitizeForTerminal(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "");
}
