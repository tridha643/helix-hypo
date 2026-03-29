import assert from "node:assert/strict";
import path from "node:path";

import { ensureFixtureGitRepo, readFixtureExpectations } from "./fixtureRepo.js";
import { indexRepository } from "./indexRepo.js";
import { createHelixClient, ensureHelixReachable } from "./syncToHelix.js";
import type { HelixIndexCounts, IndexSummary } from "./types.js";
import { HELIX_DEFAULT_URL, getWorkspaceRootFromImportMeta, runCommand } from "./utils.js";

type VerifyOptions = {
  helixUrl: string;
  integrationOnly: boolean;
  json: boolean;
};

type VerifyReport = {
  assertions: Record<string, boolean>;
  counts: IndexSummary;
  helixCounts: HelixIndexCounts;
  repoPath: string;
};

function helixCountsEqual(left: HelixIndexCounts, right: HelixIndexCounts): boolean {
  return (
    left.contains_directories === right.contains_directories &&
    left.contains_files === right.contains_files &&
    left.directories === right.directories &&
    left.files === right.files &&
    left.imports === right.imports &&
    left.imports_external === right.imports_external &&
    left.packages === right.packages
  );
}

function parseArgs(argv: string[]): VerifyOptions {
  const parsed: VerifyOptions = {
    helixUrl: process.env.HELIX_URL ?? HELIX_DEFAULT_URL,
    integrationOnly: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--integration-only") {
      parsed.integrationOnly = true;
      continue;
    }

    if (arg === "--helix-url") {
      parsed.helixUrl = argv[index + 1] ?? parsed.helixUrl;
      index += 1;
    }
  }

  return parsed;
}

function unwrapResponse<T>(value: unknown): T {
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if ("data" in objectValue) {
      return objectValue.data as T;
    }

    if ("result" in objectValue) {
      return objectValue.result as T;
    }
  }

  return value as T;
}

function asArray<T>(value: unknown): T[] {
  const unwrapped = unwrapResponse<unknown>(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped as T[];
  }

  if (unwrapped && typeof unwrapped === "object") {
    const objectEntries = Object.entries(unwrapped as Record<string, unknown>);
    if (objectEntries.length === 1 && Array.isArray(objectEntries[0]?.[1])) {
      return objectEntries[0][1] as T[];
    }
  }

  if (unwrapped === null || unwrapped === undefined) {
    return [];
  }

  return [unwrapped as T];
}

function getField(entry: unknown, field: string): unknown {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }

  const direct = entry as Record<string, unknown>;
  if (field in direct) {
    return direct[field];
  }

  const properties = direct.properties;
  if (properties && typeof properties === "object" && field in (properties as Record<string, unknown>)) {
    return (properties as Record<string, unknown>)[field];
  }

  const objectEntries = Object.entries(direct);
  if (objectEntries.length === 1) {
    const nested = objectEntries[0]?.[1];
    if (nested && typeof nested === "object" && field in (nested as Record<string, unknown>)) {
      return (nested as Record<string, unknown>)[field];
    }
  }

  return undefined;
}

function getNestedStringField(entry: unknown, field: string, nestedField: string): string | undefined {
  const value = getField(entry, field);
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const nestedValue = (value as Record<string, unknown>)[nestedField];
    return typeof nestedValue === "string" ? nestedValue : undefined;
  }

  return undefined;
}

function getObjectField(entry: unknown, field: string): Record<string, unknown> | undefined {
  const value = getField(entry, field);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

async function runUnitTests(workspaceRoot: string): Promise<void> {
  await runCommand(
    "node",
    [
      "--import",
      "tsx",
      "--test",
      "test/indexer/extractImports.test.ts",
      "test/indexer/resolveImport.test.ts",
      "test/indexer/indexRepo.test.ts",
    ],
    { cwd: workspaceRoot }
  );
}

function assertCountsMatch(summary: IndexSummary, expectations: Record<string, number>): void {
  assert.equal(summary.fileCount, expectations.fileCount);
  assert.equal(summary.directoryCount, expectations.directoryCount);
  assert.equal(summary.packageCount, expectations.packageCount);
  assert.equal(summary.containsDirectoryCount, expectations.containsDirectoryCount);
  assert.equal(summary.containsFileCount, expectations.containsFileCount);
  assert.equal(summary.importEdgeCount, expectations.importEdgeCount);
  assert.equal(summary.externalImportEdgeCount, expectations.externalImportEdgeCount);
}

async function buildReport(helixUrl: string): Promise<VerifyReport> {
  const workspaceRoot = getWorkspaceRootFromImportMeta(import.meta.url);
  const fixtureRoot = path.join(workspaceRoot, "test/fixtures/minimal-repo");
  await ensureFixtureGitRepo(fixtureRoot);

  const expectations = await readFixtureExpectations(fixtureRoot);
  const firstRun = await indexRepository({
    deployQueries: true,
    helixUrl,
    repoRoot: fixtureRoot,
    syncToDb: true,
  });
  const secondRun = await indexRepository({
    deployQueries: false,
    helixUrl,
    repoRoot: fixtureRoot,
    syncToDb: true,
  });

  assert.ok(firstRun.helixCounts, "First index run did not return Helix counts");
  assert.ok(secondRun.helixCounts, "Second index run did not return Helix counts");
  assertCountsMatch(secondRun.summary, expectations);

  const client = createHelixClient(helixUrl);
  const helixCounts = unwrapResponse<HelixIndexCounts>(await client.query("GetIndexCounts", {}));
  const imports = asArray<Record<string, unknown>>(await client.query("GetFileImports", { file_id: "src/a.ts" }));
  const importedByReact = asArray<Record<string, unknown>>(
    await client.query("GetPackageImportedBy", { package_id: "react" })
  );
  const cycleA = unwrapResponse<Record<string, unknown>>(
    await client.query("GetFileByPath", { file_id: "src/cycle-a.ts" })
  );
  const cycleB = unwrapResponse<Record<string, unknown>>(
    await client.query("GetFileByPath", { file_id: "src/cycle-b.ts" })
  );
  const srcLibContents = unwrapResponse<Record<string, unknown>>(
    await client.query("ListDirectoryContents", { dir_id: "src/lib" })
  );
  const srcLibDirectories = asArray<Record<string, unknown>>(getObjectField(srcLibContents, "directories"));
  const srcLibFiles = asArray<Record<string, unknown>>(getObjectField(srcLibContents, "files"));

  const assertions = {
    counts_match_fixture: true,
    cycle_flags_present:
      Boolean(getField(cycleA, "is_in_cycle")) && Boolean(getField(cycleB, "is_in_cycle")),
    directory_contents_handles_leaf_dir:
      srcLibDirectories.length === 0 &&
      srcLibFiles.some((entry) => getField(entry, "file_id") === "src/lib/helper.ts"),
    idempotent_counts:
      helixCountsEqual(firstRun.helixCounts, secondRun.helixCounts) &&
      helixCountsEqual(secondRun.helixCounts, helixCounts),
    known_external_import: importedByReact.some(
      (entry) => getNestedStringField(entry, "from_file_id", "file_id") === "src/a.ts"
    ),
    known_internal_import: imports.some(
      (entry) => getNestedStringField(entry, "to_file_id", "file_id") === "src/b.ts"
    ),
  };

  assert.ok(assertions.known_internal_import, 'Expected "src/a.ts" to import "src/b.ts"');
  assert.ok(assertions.known_external_import, 'Expected "src/a.ts" to import external package "react"');
  assert.ok(assertions.cycle_flags_present, "Expected cycle files to be marked as in-cycle");
  assert.ok(assertions.directory_contents_handles_leaf_dir, 'Expected "src/lib" directory listing to return its files');
  assert.ok(assertions.idempotent_counts, "Expected both index runs to produce identical Helix counts");

  return {
    assertions,
    counts: secondRun.summary,
    helixCounts,
    repoPath: fixtureRoot,
  };
}

function printHumanReport(report: VerifyReport): void {
  process.stdout.write(
    [
      `Verified fixture repo ${report.repoPath}`,
      `files=${report.counts.fileCount} directories=${report.counts.directoryCount} packages=${report.counts.packageCount}`,
      `imports=${report.counts.importEdgeCount} external_imports=${report.counts.externalImportEdgeCount}`,
      `assertions=${Object.entries(report.assertions)
        .map(([key, value]) => `${key}:${value ? "pass" : "fail"}`)
        .join(", ")}`,
    ].join("\n") + "\n"
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = getWorkspaceRootFromImportMeta(import.meta.url);

  if (!options.integrationOnly) {
    await runUnitTests(workspaceRoot);
  }

  await ensureHelixReachable(options.helixUrl);
  const report = await buildReport(options.helixUrl);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  printHumanReport(report);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
