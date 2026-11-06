/** Reports a proxy's status to chainpe-cloud every 5 minutes. Failure is only ever a warning. */
import fs from "fs/promises";
import type { FetchLike } from "./login.js";

export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** The server refuses more than 64 KB, so a bigger report is left out and the rest still arrives. */
const MAX_DOCTOR_BYTES = 60 * 1024;

export interface HeartbeatBody {
  serviceKey: string;
  version: string;
  network: string;
  rails: string[];
  gatewayBalanceAtomic?: string;
  doctor?: unknown;
}

export async function sendHeartbeat(
  target: { cloudUrl: string; ingestKey: string },
  body: HeartbeatBody,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  const doctor = body.doctor !== undefined && Buffer.byteLength(JSON.stringify(body.doctor)) <= MAX_DOCTOR_BYTES ? body.doctor : undefined;
  const res = await fetchImpl(`${target.cloudUrl}/v1/ingest/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.ingestKey}` },
    body: JSON.stringify({ ...body, doctor }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`chainpe-cloud answered ${res.status}`);
}

/** The last `chainpe doctor` result, if there is one next to the config. */
export async function readDoctorReport(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return undefined;
  }
}

export interface HeartbeatLoopOptions {
  target: { cloudUrl: string; ingestKey: string };
  build: () => Promise<HeartbeatBody>;
  fetch?: FetchLike;
  warn?: (message: string) => void;
}

export function startHeartbeat(options: HeartbeatLoopOptions): { stop(): void; beat(): Promise<void> } {
  const warn = options.warn ?? ((message: string) => console.warn(`  telemetry: ${message}`));
  const beat = async (): Promise<void> => {
    try {
      await sendHeartbeat(options.target, await options.build(), options.fetch ?? fetch);
    } catch (err) {
      warn(`heartbeat failed: ${(err as Error).message}`);
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer), beat };
}
