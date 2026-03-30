import { describe, expect, test } from "bun:test";

import { formatText } from "../../../src/cli/commands/status.js";

describe("status formatText", () => {
  test("formats status with hours", () => {
    const result = {
      pid: 12345,
      startedAt: Date.now() - 3661000,
      uptime: 3661000,
      version: "0.1.0",
    };
    const lines = formatText(result);
    expect(lines[0]).toBe("pid:     12345");
    expect(lines[1]).toContain("1h");
    expect(lines[1]).toContain("1m");
    expect(lines[1]).toContain("1s");
    expect(lines[2]).toBe("version: 0.1.0");
  });

  test("formats status with only seconds", () => {
    const result = {
      pid: 42,
      startedAt: Date.now() - 5000,
      uptime: 5000,
      version: "0.2.0",
    };
    const lines = formatText(result);
    expect(lines[1]).toBe("uptime:  5s");
  });
});

describe("status --help", () => {
  test("prints help with Usage and Examples", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "status", "--help"], {
      cwd: import.meta.dir + "/../../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(proc.exitCode ?? (await proc.exited)).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("Examples:");
  });
});
