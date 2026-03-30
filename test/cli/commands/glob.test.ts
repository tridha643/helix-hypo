import { describe, expect, test } from "bun:test";

import { parseArgs, globToRegex } from "../../../src/cli/commands/glob.js";

describe("glob parseArgs", () => {
  test("parses pattern positional", () => {
    const args = ["**/*.ts"];
    const result = parseArgs(args);
    expect(result.pattern).toBe("**/*.ts");
    expect(result.json).toBe(false);
  });

  test("parses --json flag", () => {
    const args = ["*.ts", "--json"];
    const result = parseArgs(args);
    expect(result.json).toBe(true);
  });

  test("throws on missing pattern", () => {
    expect(() => parseArgs(["--json"])).toThrow();
  });
});

describe("globToRegex", () => {
  test("** matches nested paths", () => {
    const re = globToRegex("**/*.ts");
    expect(re.test("src/app.ts")).toBe(true);
    expect(re.test("src/deep/nested/file.ts")).toBe(true);
    expect(re.test("app.ts")).toBe(true);
    expect(re.test("src/app.js")).toBe(false);
  });

  test("* does not match path separators", () => {
    const re = globToRegex("src/*.ts");
    expect(re.test("src/app.ts")).toBe(true);
    expect(re.test("src/deep/app.ts")).toBe(false);
  });

  test("? matches single character", () => {
    const re = globToRegex("src/?.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/ab.ts")).toBe(false);
  });

  test("*.test.ts does not match nested paths", () => {
    const re = globToRegex("*.test.ts");
    expect(re.test("app.test.ts")).toBe(true);
    expect(re.test("src/app.test.ts")).toBe(false);
  });

  test("exact filename match", () => {
    const re = globToRegex("package.json");
    expect(re.test("package.json")).toBe(true);
    expect(re.test("src/package.json")).toBe(false);
  });

  test("escapes regex special characters", () => {
    const re = globToRegex("file.ts");
    expect(re.test("file.ts")).toBe(true);
    expect(re.test("filexts")).toBe(false);
  });

  test("**/ at start matches any prefix", () => {
    const re = globToRegex("**/index.ts");
    expect(re.test("index.ts")).toBe(true);
    expect(re.test("src/index.ts")).toBe(true);
    expect(re.test("src/cli/index.ts")).toBe(true);
  });
});

describe("glob --help", () => {
  test("prints help with Usage and Examples", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "glob", "--help"], {
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
