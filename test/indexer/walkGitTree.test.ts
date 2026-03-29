import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { walkGitTree } from "../../src/indexer/walkGitTree.js";
import { runCommand } from "../../src/indexer/utils.js";

test("walkGitTree includes untracked files but skips ignored files", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "helix-indexer-"));

  try {
    await runCommand("git", ["init"], { cwd: repoRoot });
    await mkdir(path.join(repoRoot, "src"), { recursive: true });
    await writeFile(path.join(repoRoot, ".gitignore"), "src/ignored.ts\n");
    await writeFile(path.join(repoRoot, "src/tracked.ts"), "export const tracked = true;\n");
    await writeFile(path.join(repoRoot, "src/untracked.ts"), "export const untracked = true;\n");
    await writeFile(path.join(repoRoot, "src/ignored.ts"), "export const ignored = true;\n");

    await runCommand("git", ["add", ".gitignore", "src/tracked.ts"], { cwd: repoRoot });

    const repoStructure = await walkGitTree(repoRoot);

    assert.equal(repoStructure.fileMap.has("src/tracked.ts"), true);
    assert.equal(repoStructure.fileMap.has("src/untracked.ts"), true);
    assert.equal(repoStructure.fileMap.has("src/ignored.ts"), false);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});
