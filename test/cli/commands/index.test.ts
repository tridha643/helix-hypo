import { describe, expect, test } from "bun:test";
import path from "node:path";

import { parseArgs, formatText } from "../../../src/cli/commands/index.js";

describe("index parseArgs", () => {
  test("defaults to cwd", () => {
    const args: string[] = [];
    const result = parseArgs(args);
    expect(result.repoRoot).toBe(process.cwd());
    expect(result.json).toBe(false);
    expect(result.statusOnly).toBe(false);
    expect(result.deploy).toBe(true);
    expect(result.embedFiles).toBe(true);
  });

  test("parses --no-embed flag", () => {
    const args = ["--no-embed"];
    const result = parseArgs(args);
    expect(result.embedFiles).toBe(false);
  });

  test("parses positional path", () => {
    const args = ["/tmp/repo"];
    const result = parseArgs(args);
    expect(result.repoRoot).toBe("/tmp/repo");
  });

  test("resolves relative path", () => {
    const args = ["./foo"];
    const result = parseArgs(args);
    expect(result.repoRoot).toBe(path.resolve("./foo"));
  });

  test("parses --status flag", () => {
    const args = ["--status"];
    const result = parseArgs(args);
    expect(result.statusOnly).toBe(true);
  });

  test("parses --json flag", () => {
    const args = ["--json"];
    const result = parseArgs(args);
    expect(result.json).toBe(true);
  });

  test("parses --no-deploy flag", () => {
    const args = ["--no-deploy"];
    const result = parseArgs(args);
    expect(result.deploy).toBe(false);
  });

  test("parses --api-key option", () => {
    const args = ["--api-key", "my-key"];
    const result = parseArgs(args);
    expect(result.apiKey).toBe("my-key");
  });

  test("parses --helix-url option", () => {
    const args = ["--helix-url", "http://localhost:9999"];
    const result = parseArgs(args);
    expect(result.helixUrl).toBe("http://localhost:9999");
  });

  test("strips __reindex__ marker", () => {
    const args = ["__reindex__", "/tmp/repo"];
    const result = parseArgs(args);
    expect(result.repoRoot).toBe("/tmp/repo");
  });
});

describe("index formatText", () => {
  test("formats summary", () => {
    const result = {
      summary: {
        repoRoot: "/tmp/repo",
        fileCount: 42,
        directoryCount: 10,
        packageCount: 5,
        importEdgeCount: 100,
        externalImportEdgeCount: 30,
        entryPointCount: 3,
        leafDependencyCount: 8,
        orphanCount: 2,
        cycleCount: 1,
      },
    };
    const lines = formatText(result);
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("/tmp/repo");
    expect(lines[1]).toContain("files=42");
    expect(lines[2]).toContain("imports=100");
    expect(lines[3]).toContain("entry_points=3");
  });
});

describe("index --help", () => {
  test("prints help with Usage and Examples", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "index", "--help"], {
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
