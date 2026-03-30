import { describe, expect, test } from "bun:test";

import { parseArgs, formatText } from "../../../src/cli/commands/tree.js";

describe("tree parseArgs", () => {
  test("defaults to root", () => {
    const args: string[] = [];
    const result = parseArgs(args);
    expect(result.dirId).toBe("");
    expect(result.json).toBe(false);
  });

  test("parses positional path", () => {
    const args = ["src"];
    const result = parseArgs(args);
    expect(result.dirId).toBe("src");
  });

  test("parses --json flag", () => {
    const args = ["--json"];
    const result = parseArgs(args);
    expect(result.json).toBe(true);
    expect(result.dirId).toBe("");
  });
});

describe("tree formatText", () => {
  test("sorts dirs first with trailing slash, then files", () => {
    const result = {
      directories: [
        { dir_id: "src" },
        { dir_id: "lib" },
      ],
      files: [
        { file_id: "b.ts" },
        { file_id: "a.ts" },
      ],
    };
    expect(formatText(result)).toEqual(["lib/", "src/", "a.ts", "b.ts"]);
  });

  test("handles empty result", () => {
    expect(formatText({})).toEqual([]);
  });

  test("handles nested dir_id paths", () => {
    const result = {
      directories: [{ dir_id: "src/cli" }],
      files: [{ file_id: "src/app.ts" }],
    };
    expect(formatText(result)).toEqual(["cli/", "app.ts"]);
  });
});

describe("tree --help", () => {
  test("prints help with Usage and Examples", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "tree", "--help"], {
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
