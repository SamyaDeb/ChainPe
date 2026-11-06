/** Example configs are committed and copied into deploy images, so none may ever hold a private key. */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const EXAMPLES = path.resolve(__dirname, "../../../examples");
/** 64 hex digits, with or without 0x, not part of a longer hex run. */
const PRIVATE_KEY = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;

function configFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return configFiles(full);
    return /config.*\.json$/i.test(entry.name) ? [full] : [];
  });
}

describe("example configs", () => {
  it("includes the Arc demo config", () => {
    expect(configFiles(EXAMPLES)).toContain(path.join(EXAMPLES, "arc-demo", "config.json"));
  });

  it("contain no 64-hex private key", () => {
    const leaks = configFiles(EXAMPLES).filter((file) => PRIVATE_KEY.test(fs.readFileSync(file, "utf-8")));
    expect(leaks).toEqual([]);
  });

  it("the matcher catches a key with or without 0x, and ignores an address", () => {
    const key = "ab".repeat(32);
    expect(PRIVATE_KEY.test(`{"k":"0x${key}"}`)).toBe(true);
    expect(PRIVATE_KEY.test(`{"k":"${key}"}`)).toBe(true);
    expect(PRIVATE_KEY.test('{"walletAddress":"0x261f058496D81703c858DDFEd201834F0b5f2e73"}')).toBe(false);
  });
});
