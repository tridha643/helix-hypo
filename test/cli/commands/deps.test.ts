import { describe, expect, test } from "bun:test";

import { parseArgs, formatText } from "../../../src/cli/commands/deps.js";

describe("deps parseArgs", () => {
  test("parses positional file", () => {
    const args = ["src/app.ts"];
    const result = parseArgs(args);
    expect(result.fileId).toBe("src/app.ts");
    expect(result.json).toBe(false);
    expect(result.reverse).toBe(false);
  });

  test("parses --reverse flag", () => {
    const args = ["--reverse", "src/app.ts"];
    const result = parseArgs(args);
    expect(result.fileId).toBe("src/app.ts");
    expect(result.reverse).toBe(true);
  });

  test("parses --json flag", () => {
    const args = ["src/app.ts", "--json"];
    const result = parseArgs(args);
    expect(result.json).toBe(true);
  });

  test("parses all flags together", () => {
    const args = ["--json", "--reverse", "src/app.ts"];
    const result = parseArgs(args);
    expect(result.fileId).toBe("src/app.ts");
    expect(result.json).toBe(true);
    expect(result.reverse).toBe(true);
  });

  test("throws on missing file", () => {
    expect(() => parseArgs(["--json"])).toThrow();
  });
});

describe("deps formatText", () => {
  test("formats forward deps (flat string)", () => {
    const edges = [
      { to_file_id: "src/utils.ts" },
      { to_file_id: "src/types.ts" },
    ];
    expect(formatText(edges, false)).toEqual(["src/utils.ts", "src/types.ts"]);
  });

  test("formats forward deps (nested object from HelixDB)", () => {
    const edges = [
      { to_file_id: { file_id: "src/utils.ts" } },
      { to_file_id: { file_id: "src/types.ts" } },
    ];
    expect(formatText(edges, false)).toEqual(["src/utils.ts", "src/types.ts"]);
  });

  test("formats reverse deps (nested object)", () => {
    const edges = [
      { from_file_id: { file_id: "src/app.ts" } },
      { from_file_id: { file_id: "src/main.ts" } },
    ];
    expect(formatText(edges, true)).toEqual(["src/app.ts", "src/main.ts"]);
  });

  test("handles empty array", () => {
    expect(formatText([], false)).toEqual([]);
  });
});

describe("deps --help", () => {
  test("prints help with Usage and Examples", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "deps", "--help"], {
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
