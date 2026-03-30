import { describe, expect, test } from "bun:test";

import { hasFlag, getOption, getPositional } from "../../src/cli/args.js";

describe("hasFlag", () => {
  test("returns true and removes flag when present", () => {
    const args = ["--json", "foo", "--reverse"];
    expect(hasFlag(args, "--json")).toBe(true);
    expect(args).toEqual(["foo", "--reverse"]);
  });

  test("returns false when flag is absent", () => {
    const args = ["foo", "--reverse"];
    expect(hasFlag(args, "--json")).toBe(false);
    expect(args).toEqual(["foo", "--reverse"]);
  });

  test("handles empty array", () => {
    const args: string[] = [];
    expect(hasFlag(args, "--json")).toBe(false);
    expect(args).toEqual([]);
  });
});

describe("getOption", () => {
  test("returns value and removes flag+value", () => {
    const args = ["--limit", "10", "foo"];
    expect(getOption(args, "--limit")).toBe("10");
    expect(args).toEqual(["foo"]);
  });

  test("returns null when option is absent", () => {
    const args = ["foo", "--json"];
    expect(getOption(args, "--limit")).toBeNull();
    expect(args).toEqual(["foo", "--json"]);
  });

  test("returns null when flag has no value", () => {
    const args = ["--limit"];
    expect(getOption(args, "--limit")).toBeNull();
    expect(args).toEqual([]);
  });
});

describe("getPositional", () => {
  test("returns first non-flag argument", () => {
    expect(getPositional(["--json", "src/app.ts", "--reverse"])).toBe("src/app.ts");
  });

  test("returns null when no positional", () => {
    expect(getPositional(["--json", "--reverse"])).toBeNull();
  });

  test("returns null for empty array", () => {
    expect(getPositional([])).toBeNull();
  });
});
