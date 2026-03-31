import { describe, expect, test } from "bun:test";

import { formatText } from "../../../src/cli/commands/status.js";

describe("status formatText", () => {
  test("formats reachable Helix status with coverage", () => {
    const result = {
      counts: {
        contains_directories: 4,
        contains_files: 8,
        directories: 3,
        embeddings: 6,
        files: 8,
        imports: 10,
        imports_external: 2,
        packages: 1,
      },
      daemon: {
        pid: 12345,
        running: true,
        socketResponsive: true,
      },
      embeddingCoverage: {
        embeddedFiles: 6,
        missingFiles: 2,
        percent: 75,
        totalFiles: 8,
      },
      error: null,
      helixUrl: "http://127.0.0.1:6969",
      reachable: true,
    };
    const lines = formatText(result);
    expect(lines[0]).toContain("http://127.0.0.1:6969");
    expect(lines[1]).toContain("yes");
    expect(lines[2]).toContain("running");
    expect(lines[3]).toContain("8");
    expect(lines[8]).toContain("6");       // embeddings count
    expect(lines[9]).toContain("6/8 (75%)"); // embedding coverage
  });

  test("formats unreachable Helix status", () => {
    const result = {
      counts: null,
      daemon: {
        pid: null,
        running: false,
        socketResponsive: false,
      },
      embeddingCoverage: null,
      error: "Cannot connect",
      helixUrl: "http://127.0.0.1:6969",
      reachable: false,
    };
    const lines = formatText(result);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("no");
    expect(lines[2]).toContain("stopped");
    expect(lines[3]).toContain("Cannot connect");
  });
});

describe("status --help", () => {
  test("prints help with Usage and Examples", async () => {
    const proc = Bun.spawn(["bun", "src/cli/helix.ts", "status", "--help"], {
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
