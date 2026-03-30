import { describe, expect, test } from "bun:test";

import { parseArgs, formatText } from "../../../src/cli/commands/grep.js";

describe("grep parseArgs", () => {
  test("parses query positional", () => {
    const args = ["import"];
    const result = parseArgs(args);
    expect(result.query).toBe("import");
    expect(result.json).toBe(false);
    expect(result.limit).toBe(20);
    expect(result.scope).toBeNull();
  });

  test("parses --scope deps-of:<file>", () => {
    const args = ["fetch", "--scope", "deps-of:src/app.ts"];
    const result = parseArgs(args);
    expect(result.query).toBe("fetch");
    expect(result.scope).toEqual({ type: "deps-of", file: "src/app.ts" });
  });

  test("parses --scope imports-of:<file>", () => {
    const args = ["fetch", "--scope", "imports-of:src/utils.ts"];
    const result = parseArgs(args);
    expect(result.scope).toEqual({ type: "imports-of", file: "src/utils.ts" });
  });

  test("parses --limit", () => {
    const args = ["query", "--limit", "5"];
    const result = parseArgs(args);
    expect(result.limit).toBe(5);
  });

  test("parses --json", () => {
    const args = ["query", "--json"];
    const result = parseArgs(args);
    expect(result.json).toBe(true);
  });

  test("throws on missing query", () => {
    expect(() => parseArgs(["--json"])).toThrow();
  });
});

describe("grep formatText", () => {
  test("formats results with scores", () => {
    const results = [
      { file_id: "src/app.ts", score: 1.5 },
      { file_id: "src/utils.ts", score: 0.8 },
    ];
    expect(formatText(results)).toEqual([
      "src/app.ts  [1.5000]",
      "src/utils.ts  [0.8000]",
    ]);
  });

  test("formats results without scores", () => {
    const results = [{ file_id: "src/app.ts" }];
    expect(formatText(results)).toEqual(["src/app.ts"]);
  });

  test("handles empty array", () => {
    expect(formatText([])).toEqual([]);
  });
});

describe("grep --help", () => {
  test("prints help with Usage and Examples", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "grep", "--help"], {
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
