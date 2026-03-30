import { describe, expect, test } from "bun:test";

import { parseArgs, formatText } from "../../../src/cli/commands/info.js";

describe("info parseArgs", () => {
  test("parses positional file", () => {
    const args = ["src/app.ts"];
    const result = parseArgs(args);
    expect(result.fileId).toBe("src/app.ts");
    expect(result.json).toBe(false);
  });

  test("parses --json flag", () => {
    const args = ["src/app.ts", "--json"];
    const result = parseArgs(args);
    expect(result.json).toBe(true);
  });

  test("throws on missing file", () => {
    expect(() => parseArgs(["--json"])).toThrow();
  });
});

describe("info formatText", () => {
  test("formats key-value pairs", () => {
    const info = {
      file_id: "src/app.ts",
      extension: ".ts",
      size: 1024,
      is_entry_point: true,
    };
    const lines = formatText(info);
    expect(lines).toContain("file_id: src/app.ts");
    expect(lines).toContain("extension: .ts");
    expect(lines).toContain("size: 1024");
    expect(lines).toContain("is_entry_point: true");
  });

  test("skips content field", () => {
    const info = { file_id: "src/app.ts", content: "huge file content" };
    const lines = formatText(info);
    expect(lines).toEqual(["file_id: src/app.ts"]);
  });

  test("formats arrays as comma-separated", () => {
    const info = { imports: ["a.ts", "b.ts"] };
    const lines = formatText(info);
    expect(lines).toEqual(["imports: a.ts, b.ts"]);
  });
});

describe("info --help", () => {
  test("prints help with Usage and Examples", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "info", "--help"], {
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
