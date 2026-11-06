/**
 * Where the chainpe-cloud URL and ingest key live. Always the user's own ~/.chainpe/config.json, never
 * CHAINPE_CONFIG: that can point at a committed example, and an ingest key must not land in a repo.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";

export interface CloudCredentials {
  cloudUrl: string;
  ingestKey: string;
  keyId?: string;
  keyPrefix?: string;
}

export function credentialsPath(home = os.homedir()): string {
  return path.join(home, ".chainpe", "config.json");
}

/** Refuses a file it cannot parse, because writing would destroy what is in it. */
async function readRaw(file: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    /* Reported below. */
  }
  throw new Error(`${file} is not a JSON object. Fix or move it, then try again.`);
}

/** Temp file, 0600 from creation, then rename: the key is never readable by others, even briefly. */
async function writeRaw(file: string, data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.chmod(temp, 0o600);
  await fs.rename(temp, file);
}

/** Merges into the file: it may also hold a service config. */
export async function saveCloudCredentials(credentials: CloudCredentials, file = credentialsPath()): Promise<void> {
  await writeRaw(file, { ...(await readRaw(file)), cloud: credentials });
}

export async function readStoredCredentials(file = credentialsPath()): Promise<CloudCredentials | undefined> {
  const cloud = (await readRaw(file)).cloud as Partial<CloudCredentials> | undefined;
  return cloud?.cloudUrl && cloud.ingestKey ? (cloud as CloudCredentials) : undefined;
}

export async function clearCloudCredentials(file = credentialsPath()): Promise<void> {
  const raw = await readRaw(file);
  if (!("cloud" in raw)) return;
  delete raw.cloud;
  await writeRaw(file, raw);
}

/** A container has no home config, so the environment comes first. An unreadable file never stops the proxy. */
export async function resolveCredentials(env: NodeJS.ProcessEnv = process.env, file = credentialsPath()): Promise<CloudCredentials | undefined> {
  if (env.CHAINPE_CLOUD_URL && env.CHAINPE_INGEST_KEY) {
    return { cloudUrl: env.CHAINPE_CLOUD_URL, ingestKey: env.CHAINPE_INGEST_KEY };
  }
  return readStoredCredentials(file).catch(() => undefined);
}

/** The signature and the ingest key travel to this URL, so it must be https, except on this machine. */
export function assertCloudUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Cloud URL "${raw}" is not a valid URL.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`Cloud URL must use https (got ${url.protocol}).`);
  }
  return url.origin;
}
