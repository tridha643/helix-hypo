import test from "node:test";
import assert from "node:assert/strict";

import { getExternalPackageId, resolveInternalImport } from "../../src/indexer/resolveImport.js";

test("resolveInternalImport handles relative paths, extensions, and index files", () => {
  const fileIdSet = new Set(["src/b.ts", "src/components/index.tsx", "src/lib/helper.ts"]);

  assert.equal(
    resolveInternalImport({
      fileIdSet,
      importerFileId: "src/a.ts",
      specifier: "./b",
    }),
    "src/b.ts"
  );

  assert.equal(
    resolveInternalImport({
      fileIdSet,
      importerFileId: "src/a.ts",
      specifier: "./lib/helper",
    }),
    "src/lib/helper.ts"
  );

  assert.equal(
    resolveInternalImport({
      fileIdSet,
      importerFileId: "src/a.ts",
      specifier: "./components",
    }),
    "src/components/index.tsx"
  );
});

test("resolveInternalImport rejects paths outside the repo and unresolved imports", () => {
  const fileIdSet = new Set(["src/b.ts"]);

  assert.equal(
    resolveInternalImport({
      fileIdSet,
      importerFileId: "src/a.ts",
      specifier: "../outside",
    }),
    null
  );

  assert.equal(
    resolveInternalImport({
      fileIdSet,
      importerFileId: "src/a.ts",
      specifier: "./missing",
    }),
    null
  );
});

test("getExternalPackageId normalizes package roots", () => {
  assert.equal(getExternalPackageId("react"), "react");
  assert.equal(getExternalPackageId("react/jsx-runtime"), "react");
  assert.equal(getExternalPackageId("@scope/pkg"), "@scope/pkg");
  assert.equal(getExternalPackageId("@scope/pkg/internal/path"), "@scope/pkg");
  assert.equal(getExternalPackageId("./local"), null);
});
