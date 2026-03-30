import { describe, expect, test } from "bun:test";

describe("mount --help", () => {
  test("prints help for mount", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "mount", "--help"], {
      cwd: import.meta.dir + "/../../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(proc.exitCode ?? (await proc.exited)).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("mountpoint");
  });

  test("prints help for unmount", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "unmount", "--help"], {
      cwd: import.meta.dir + "/../../..",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(proc.exitCode ?? (await proc.exited)).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("unmount");
  });
});
