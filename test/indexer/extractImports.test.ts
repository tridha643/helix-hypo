import test from "node:test";
import assert from "node:assert/strict";

import { extractImports } from "../../src/indexer/extractImports.js";

test("extractImports covers JS/TS import forms", () => {
  const content = `
    import React, { useMemo as memo } from "react";
    import "./side-effect";
    export { helper as exportedHelper } from "../helper";
    const fs = require("node:fs");
    const { join } = require("node:path");
    const lazy = import("./lazy");
  `;

  assert.deepEqual(extractImports("src/example.tsx", content), [
    {
      kind: "import",
      names: ["React", "useMemo as memo"],
      specifier: "react",
    },
    {
      kind: "import",
      names: [],
      specifier: "./side-effect",
    },
    {
      kind: "export",
      names: ["helper as exportedHelper"],
      specifier: "../helper",
    },
    {
      kind: "require",
      names: ["fs"],
      specifier: "node:fs",
    },
    {
      kind: "require",
      names: ["join"],
      specifier: "node:path",
    },
    {
      kind: "dynamic-import",
      names: ["lazy"],
      specifier: "./lazy",
    },
  ]);
});
