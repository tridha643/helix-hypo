import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { runCommand } from "./utils.js";

type FixtureExpectations = {
  containsDirectoryCount: number;
  containsFileCount: number;
  cycleCount: number;
  directoryCount: number;
  entryPointCount: number;
  externalImportEdgeCount: number;
  fileCount: number;
  importEdgeCount: number;
  leafDependencyCount: number;
  maxDepDepth: number;
  orphanCount: number;
  packageCount: number;
};

export async function ensureFixtureGitRepo(repoRoot: string): Promise<void> {
  const gitDirectory = path.join(repoRoot, ".git");

  try {
    await access(gitDirectory);
  } catch {
    await runCommand("git", ["init"], { cwd: repoRoot });
  }

  await runCommand("git", ["add", "--all"], { cwd: repoRoot });
}

export async function readFixtureExpectations(repoRoot: string): Promise<FixtureExpectations> {
  const raw = await readFile(path.join(repoRoot, "expectations.json"), "utf8");
  return JSON.parse(raw) as FixtureExpectations;
}
