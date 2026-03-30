import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureFixtureGitRepo, readFixtureExpectations } from "../../src/indexer/fixtureRepo.js";
import { buildIndexModel } from "../../src/indexer/indexRepo.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(workspaceRoot, "test/fixtures/minimal-repo");

test("buildIndexModel indexes the fixture repo structure and dependency graph", async () => {
  await ensureFixtureGitRepo(fixtureRoot);
  const expectations = await readFixtureExpectations(fixtureRoot);
  const model = await buildIndexModel(fixtureRoot);

  assert.equal(model.summary.fileCount, expectations.fileCount);
  assert.equal(model.summary.directoryCount, expectations.directoryCount);
  assert.equal(model.summary.packageCount, expectations.packageCount);
  assert.equal(model.summary.containsDirectoryCount, expectations.containsDirectoryCount);
  assert.equal(model.summary.containsFileCount, expectations.containsFileCount);
  assert.equal(model.summary.cycleCount, expectations.cycleCount);
  assert.equal(model.summary.entryPointCount, expectations.entryPointCount);
  assert.equal(model.summary.importEdgeCount, expectations.importEdgeCount);
  assert.equal(model.summary.leafDependencyCount, expectations.leafDependencyCount);
  assert.equal(model.summary.maxDepDepth, expectations.maxDepDepth);
  assert.equal(model.summary.orphanCount, expectations.orphanCount);
  assert.equal(model.summary.externalImportEdgeCount, expectations.externalImportEdgeCount);

  assert.ok(
    model.importEdges.some((edge) => edge.fromFileId === "src/a.ts" && edge.toFileId === "src/b.ts")
  );
  assert.ok(
    model.externalImportEdges.some(
      (edge) => edge.fromFileId === "src/a.ts" && edge.packageId === "react"
    )
  );

  const cycleA = model.files.find((file) => file.fileId === "src/cycle-a.ts");
  const cycleB = model.files.find((file) => file.fileId === "src/cycle-b.ts");
  const entryPoint = model.files.find((file) => file.fileId === "src/a.ts");
  const leafDep = model.files.find((file) => file.fileId === "src/lib/helper.ts");
  const nonSourceFile = model.files.find((file) => file.fileId === "expectations.json");

  assert.equal(cycleA?.isInCycle, true);
  assert.equal(cycleB?.isInCycle, true);
  assert.equal(cycleA?.cycleId, cycleB?.cycleId);
  assert.equal(cycleA?.depDepth, -1);
  assert.equal(cycleA?.topoOrder, -1);
  assert.equal(entryPoint?.isEntryPoint, true);
  assert.equal(entryPoint?.depDepth, 2);
  assert.equal(entryPoint?.topoOrder, 0);
  assert.equal(leafDep?.isLeafDep, true);
  assert.equal(leafDep?.depDepth, 0);
  assert.equal(leafDep?.topoOrder, 2);
  assert.equal(nonSourceFile?.isEntryPoint, false);
  assert.equal(nonSourceFile?.isLeafDep, false);
  assert.equal(nonSourceFile?.isOrphan, false);
  assert.equal(nonSourceFile?.topoOrder, -1);
});
