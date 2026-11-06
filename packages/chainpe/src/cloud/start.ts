/** Connects a running proxy to chainpe-cloud. Off with --no-telemetry or with no ingest key: then it sends nothing at all. */
import type { GatewayClient } from "@circle-fin/x402-batching/client";
import { serviceKey } from "../accounts.js";
import { getNetwork, type ChainPeNetwork } from "../chains.js";
import type { ChainPeConfig, PaymentEvent } from "../types.js";
import { resolveCredentials, type CloudCredentials } from "./credentials.js";
import { readDoctorReport, startHeartbeat } from "./heartbeat.js";
import type { FetchLike } from "./login.js";
import { TelemetryQueue } from "./telemetry.js";

export interface TelemetryStartOptions {
  enabled: boolean;
  config: ChainPeConfig;
  network: ChainPeNetwork;
  version: string;
  doctorFile: string;
  /** Null when the seller has no Gateway rail. */
  gatewayClient?: () => Pick<GatewayClient, "getBalances">;
  credentials?: CloudCredentials;
  fetch?: FetchLike;
  warn?: (message: string) => void;
}

export interface RunningTelemetry {
  cloudUrl: string;
  onPayment(event: PaymentEvent): void;
  stop(): void;
}

export async function startTelemetry(options: TelemetryStartOptions): Promise<RunningTelemetry | undefined> {
  if (!options.enabled) return undefined;
  const credentials = options.credentials ?? (await resolveCredentials());
  if (!credentials) return undefined;

  const { config, network, version, doctorFile, gatewayClient } = options;
  const key = serviceKey(config.walletAddress, config.serviceName);
  const queue = new TelemetryQueue({ ...credentials, serviceKey: key, fetch: options.fetch, warn: options.warn });
  queue.start();
  const heartbeat = startHeartbeat({
    target: credentials,
    fetch: options.fetch,
    warn: options.warn,
    build: async () => {
      const balance = await gatewayClient?.()
        .getBalances()
        .then(({ gateway }) => gateway.available.toString())
        .catch(() => undefined);
      return {
        serviceKey: key,
        version,
        network: getNetwork(network).caip2,
        rails: config.rails ?? [],
        ...(balance !== undefined ? { gatewayBalanceAtomic: balance } : {}),
        doctor: await readDoctorReport(doctorFile),
      };
    },
  });
  return {
    cloudUrl: credentials.cloudUrl,
    onPayment: (event) => queue.enqueue(event),
    stop() {
      queue.stop();
      heartbeat.stop();
      void queue.flush();
    },
  };
}
