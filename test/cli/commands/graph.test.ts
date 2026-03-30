import { describe, expect, test } from "bun:test";

import { parseArgs } from "../../../src/cli/commands/graph.js";

describe("graph parseArgs", () => {
  test("parses entry-points subcommand", () => {
    const args = ["entry-points"];
    const result = parseArgs(args);
    expect(result.subcommand).toBe("entry-points");
    expect(result.json).toBe(false);
  });

  test("parses leaf-deps subcommand", () => {
    const args = ["leaf-deps"];
    const result = parseArgs(args);
    expect(result.subcommand).toBe("leaf-deps");
  });

  test("parses orphans subcommand", () => {
    const args = ["orphans", "--json"];
    const result = parseArgs(args);
    expect(result.subcommand).toBe("orphans");
    expect(result.json).toBe(true);
  });

  test("parses cycles subcommand", () => {
    const args = ["cycles"];
    const result = parseArgs(args);
    expect(result.subcommand).toBe("cycles");
  });

  test("parses topo-order subcommand", () => {
    const args = ["topo-order"];
    const result = parseArgs(args);
    expect(result.subcommand).toBe("topo-order");
  });

  test("parses most-imported with --limit", () => {
    const args = ["most-imported", "--limit", "10"];
    const result = parseArgs(args);
    expect(result.subcommand).toBe("most-imported");
    expect(result.params.limit).toBe(10);
  });

  test("most-imported defaults to limit 20", () => {
    const args = ["most-imported"];
    const result = parseArgs(args);
    expect(result.params.limit).toBe(20);
  });

  test("parses stats subcommand", () => {
    const args = ["stats", "--json"];
    const result = parseArgs(args);
    expect(result.subcommand).toBe("stats");
    expect(result.json).toBe(true);
  });

  test("throws on missing subcommand", () => {
    expect(() => parseArgs([])).toThrow();
  });

  test("throws on unknown subcommand", () => {
    expect(() => parseArgs(["bogus"])).toThrow();
  });

  test("--help prints help", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "graph", "--help"], {
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
