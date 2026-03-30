import { describe, expect, test } from "bun:test";

import { formatText } from "../../../src/cli/commands/version.js";

describe("version formatText", () => {
  test("formats cli-only version", () => {
    const result = { cli: "0.1.0", daemon: null };
    const lines = formatText(result);
    expect(lines).toEqual(["helix 0.1.0 (cli)", "daemon not running"]);
  });

  test("formats cli + daemon version", () => {
    const result = {
      cli: "0.1.0",
      daemon: { pid: 12345, version: "0.1.0" },
    };
    const lines = formatText(result);
    expect(lines).toEqual([
      "helix 0.1.0 (cli)",
      "helix 0.1.0 (daemon, pid 12345)",
    ]);
  });
});

describe("version --help", () => {
  test("prints help", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "version", "--help"], {
      cwd: import.meta.dir + "/../../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(proc.exitCode ?? (await proc.exited)).toBe(0);
    expect(stdout).toContain("Usage:");
  });
});
