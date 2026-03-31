import { describe, expect, test } from "bun:test";

import { MAIN_HELP } from "../../src/cli/help.js";

describe("helix CLI entry point", () => {
  test("--help prints usage with Commands section", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "--help"], {
      cwd: import.meta.dir + "/../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(proc.exitCode ?? (await proc.exited)).toBe(0);
    expect(stdout).toContain("Setup commands:");
    expect(stdout).toContain("Query commands");
    expect(stdout).toContain("Common workflows:");
  });

  test("-h prints usage", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "-h"], {
      cwd: import.meta.dir + "/../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(proc.exitCode ?? (await proc.exited)).toBe(0);
    expect(stdout).toContain("Setup commands:");
  });

  test("no args prints usage", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts"], {
      cwd: import.meta.dir + "/../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(proc.exitCode ?? (await proc.exited)).toBe(0);
    expect(stdout).toContain("Setup commands:");
  });

  test("unknown command exits 1 with error", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "bogus"], {
      cwd: import.meta.dir + "/../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = proc.exitCode ?? (await proc.exited);
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("error");
    expect(stderr).toContain("bogus");
  });

  test("MAIN_HELP contains all commands", () => {
    const expected = [
      "index", "reindex", "embed", "status", "version", "deps", "info",
      "tree", "graph", "grep", "glob", "mount", "unmount",
    ];
    for (const cmd of expected) {
      expect(MAIN_HELP).toContain(cmd);
    }
  });
});
