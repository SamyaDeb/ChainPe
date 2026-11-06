/** Reads and writes the CLI config. Its path comes from CHAINPE_CONFIG, else ~/.chainpe/config.json. */
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { ChainPeConfig } from "./types.js";

export function configPath(): string {
  return process.env.CHAINPE_CONFIG ?? path.join(os.homedir(), ".chainpe", "config.json");
}

export async function loadConfig(): Promise<ChainPeConfig | null> {
  try {
    return JSON.parse(await fs.readFile(configPath(), "utf-8")) as ChainPeConfig;
  } catch {
    return null;
  }
}

/** Writes through a temp file, so a crash cannot leave half a config behind. 0600, because it can also hold the ingest key. */
export async function saveConfig(config: ChainPeConfig): Promise<void> {
  const file = configPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
