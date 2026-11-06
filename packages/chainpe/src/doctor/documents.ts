/**
 * The discovery documents `chainpe doctor` generates and the proxy serves.
 * Built field by field from public values, so targetUrl and adminKey cannot reach them.
 */
import { getNetwork, type ChainPeNetwork } from "../chains.js";
import { parseUsdc } from "../evm.js";
import { canonicalPrice } from "../listing.js";
import { ALL_RAILS, effectiveRails, toRouteKey } from "../proxy/routeConfig.js";
import type { ChainPeConfig, PaymentRail } from "../types.js";

/** Common indexers drop examples larger than this. */
const MAX_EXAMPLE_BYTES = 1500;

export type Samples = Record<string, unknown>;

export interface DocumentPaths {
  openapi: string;
  x402: string;
  discovery: string;
  samples: string;
  /** The last report. Not served: the proxy's heartbeat reads it. */
  doctor: string;
}

/** Named after the config file, so several configs in one folder do not collide. */
export function documentPaths(configFile: string): DocumentPaths {
  const base = configFile.replace(/\.json$/, "");
  return {
    openapi: `${base}.openapi.json`,
    x402: `${base}.x402.json`,
    discovery: `${base}.discovery.json`,
    samples: `${base}.samples.json`,
    doctor: `${base}.doctor.json`,
  };
}

export interface DocumentedRoute {
  /** "GET /weather", the key used in config and in samples. */
  key: string;
  method: string;
  path: string;
  price: string;
  amountAtomic: string;
  rails: PaymentRail[];
  description: string;
  query: Record<string, string>;
}

/** Routes from the config. The catch-all is not one: it has no path a document could name. */
export function documentedRoutes(config: ChainPeConfig): DocumentedRoute[] {
  return (config.routes ?? []).map((route) => {
    const [rawMethod, path] = toRouteKey(route.path).split(" ");
    const method = rawMethod === "*" ? "GET" : rawMethod.toUpperCase();
    const price = canonicalPrice(route.pricePerRequest || config.pricePerRequest);
    const atomic = parseUsdc(price);
    return {
      key: `${method} ${path}`,
      method,
      path,
      price,
      amountAtomic: atomic.toString(),
      rails: effectiveRails(atomic, config.rails ?? ALL_RAILS),
      description: route.description ?? `${method} ${path} on ${config.serviceName}`,
      query: route.query ?? {},
    };
  });
}

/** A JSON Schema from one sample, with real field names and types. */
export function inferSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return value.length > 0 ? { type: "array", items: inferSchema(value[0]) } : { type: "array" };
  if (typeof value === "object") {
    const properties = Object.fromEntries(Object.entries(value).map(([key, field]) => [key, inferSchema(field)]));
    return { type: "object", properties, required: Object.keys(properties) };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  return { type: typeof value };
}

export interface GeneratedDocuments {
  openapi: Record<string, unknown>;
  x402: X402Document;
  discovery: Record<string, unknown>;
}

export interface X402Resource {
  resource: string;
  method: string;
  path: string;
  description: string;
  price: string;
  amountAtomic: string;
  network: string;
  payTo: string;
  rails: PaymentRail[];
}

export interface X402Document {
  version: 1;
  name: string;
  description: string;
  docsUrl: string;
  resources: X402Resource[];
}

function buildOpenApi(config: ChainPeConfig, publicUrl: string, routes: DocumentedRoute[], samples: Samples) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const sample = samples[route.key];
    const content =
      sample === undefined
        ? {}
        : {
            "application/json": {
              schema: inferSchema(sample),
              ...(Buffer.byteLength(JSON.stringify(sample)) <= MAX_EXAMPLE_BYTES ? { example: sample } : {}),
            },
          };
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      summary: route.description,
      operationId: route.key.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, ""),
      parameters: Object.entries(route.query).map(([name, description]) => ({ name, in: "query", description, schema: { type: "string" } })),
      "x-x402-price": route.price,
      "x-x402-rails": route.rails,
      responses: {
        "200": { description: "Paid response", content },
        "402": { description: "Payment required. The PAYMENT-REQUIRED header carries the x402 payment options." },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: config.serviceName, description: config.serviceDescription, version: "1.0.0" },
    servers: [{ url: publicUrl }],
    paths,
  };
}

function buildDiscovery(config: ChainPeConfig, network: ChainPeNetwork, publicUrl: string, routes: DocumentedRoute[], samples: Samples) {
  const { caip2, usdc } = getNetwork(network);
  const items = routes.map((route) => ({
    resource: `${publicUrl}${route.path}`,
    type: "http",
    x402Version: 2,
    accepts: route.rails.map((rail) => ({
      scheme: "exact",
      network: caip2,
      asset: usdc,
      amount: route.amountAtomic,
      payTo: config.walletAddress,
      extra: rail === "gateway" ? { name: "GatewayWalletBatched", version: "1" } : { name: "USDC", version: "2" },
    })),
    metadata: {
      provider: {
        name: config.serviceName,
        description: config.serviceDescription,
        ...(config.category ? { category: config.category } : {}),
        tags: config.tags,
        website: publicUrl,
        docsUrl: `${publicUrl}/openapi.json`,
        openApiUrl: `${publicUrl}/openapi.json`,
      },
      path: route.path,
      method: route.method,
      description: route.description,
      mimeType: "application/json",
      input: { type: "object", properties: Object.fromEntries(Object.entries(route.query).map(([name, description]) => [name, { type: "string", description }])) },
      output: samples[route.key] === undefined ? {} : inferSchema(samples[route.key]),
      siwx: false,
      supportsVanillax402: route.rails.includes("exact"),
      supportsCircleGateway: route.rails.includes("gateway"),
    },
  }));
  return { x402Version: 2, items };
}

export function generateDocuments(config: ChainPeConfig, network: ChainPeNetwork, publicUrl: string, samples: Samples = {}): GeneratedDocuments {
  const routes = documentedRoutes(config);
  const { caip2 } = getNetwork(network);
  return {
    openapi: buildOpenApi(config, publicUrl, routes, samples),
    x402: {
      version: 1,
      name: config.serviceName,
      description: config.serviceDescription,
      docsUrl: `${publicUrl}/openapi.json`,
      resources: routes.map((route) => ({
        resource: `${publicUrl}${route.path}`,
        method: route.method,
        path: route.path,
        description: route.description,
        price: route.price,
        amountAtomic: route.amountAtomic,
        network: caip2,
        payTo: config.walletAddress,
        rails: route.rails,
      })),
    },
    discovery: buildDiscovery(config, network, publicUrl, routes, samples),
  };
}

/**
 * Writes the discovery documents a hosted proxy serves, when they are missing, so a
 * deployed proxy answers /.well-known/x402 and /openapi.json without a local doctor
 * run. Never overwrites: an edited or doctor-written document stays. Returns what it wrote.
 */
export async function writeMissingDocuments(config: ChainPeConfig, paths: DocumentPaths): Promise<string[]> {
  if (!config.publicUrl || !(config.routes?.length)) return [];
  const { readFile, writeFile, access } = await import("fs/promises");
  const exists = (file: string) => access(file).then(() => true, () => false);
  let samples: Samples = {};
  try {
    samples = JSON.parse(await readFile(paths.samples, "utf-8")) as Samples;
  } catch {
    /* No samples yet: the documents list the routes without response fields. */
  }
  const docs = generateDocuments(config, config.network, config.publicUrl.replace(/\/+$/, ""), samples);
  const written: string[] = [];
  for (const [file, content, name] of [
    [paths.x402, docs.x402, "/.well-known/x402"],
    [paths.openapi, docs.openapi, "/openapi.json"],
    [paths.discovery, docs.discovery, "discovery"],
  ] as const) {
    if (await exists(file)) continue;
    try {
      await writeFile(file, JSON.stringify(content, null, 2));
      written.push(name);
    } catch {
      /* A read-only config folder: the proxy answers 404 for that document, as before. */
    }
  }
  return written;
}
