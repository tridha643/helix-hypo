import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDependencyGraph } from "../../src/indexer/dagAnalysis.js";
import { DEP_DEPTH_IN_CYCLE, TOPO_ORDER_UNAVAILABLE } from "../../src/indexer/types.js";

test("analyzeDependencyGraph handles an empty graph", () => {
  const analysis = analyzeDependencyGraph([], []);

  assert.equal(analysis.cycleIdByFileId.size, 0);
  assert.equal(analysis.depDepthByFileId.size, 0);
  assert.equal(analysis.importCountByFileId.size, 0);
  assert.equal(analysis.importedByCountByFileId.size, 0);
  assert.equal(analysis.inCycleFileIds.size, 0);
  assert.equal(analysis.topoOrderByFileId.size, 0);
});

test("analyzeDependencyGraph handles a single acyclic file", () => {
  const analysis = analyzeDependencyGraph(["src/app.ts"], []);

  assert.equal(analysis.cycleIdByFileId.get("src/app.ts"), undefined);
  assert.equal(analysis.depDepthByFileId.get("src/app.ts"), 0);
  assert.equal(analysis.importCountByFileId.get("src/app.ts"), 0);
  assert.equal(analysis.importedByCountByFileId.get("src/app.ts"), 0);
  assert.equal(analysis.inCycleFileIds.has("src/app.ts"), false);
  assert.equal(analysis.topoOrderByFileId.get("src/app.ts"), 0);
});

test("analyzeDependencyGraph marks self imports as a cycle", () => {
  const analysis = analyzeDependencyGraph(["src/self.ts"], [
    {
      fromFileId: "src/self.ts",
      names: ["self"],
      specifier: "./self",
      toFileId: "src/self.ts",
    },
  ]);

  assert.equal(analysis.cycleIdByFileId.get("src/self.ts"), "cycle-0");
  assert.equal(analysis.depDepthByFileId.get("src/self.ts"), DEP_DEPTH_IN_CYCLE);
  assert.equal(analysis.importCountByFileId.get("src/self.ts"), 1);
  assert.equal(analysis.importedByCountByFileId.get("src/self.ts"), 1);
  assert.equal(analysis.inCycleFileIds.has("src/self.ts"), true);
  assert.equal(analysis.topoOrderByFileId.get("src/self.ts"), TOPO_ORDER_UNAVAILABLE);
});

test("analyzeDependencyGraph removes cyclic vertices from topo order", () => {
  const analysis = analyzeDependencyGraph(
    ["src/z.ts", "src/a.ts", "src/cycle-b.ts", "src/b.ts", "src/cycle-a.ts"],
    [
      {
        fromFileId: "src/cycle-b.ts",
        names: ["cycleA"],
        specifier: "./cycle-a",
        toFileId: "src/cycle-a.ts",
      },
      {
        fromFileId: "src/a.ts",
        names: ["cycleA"],
        specifier: "./cycle-a",
        toFileId: "src/cycle-a.ts",
      },
      {
        fromFileId: "src/cycle-a.ts",
        names: ["cycleB"],
        specifier: "./cycle-b",
        toFileId: "src/cycle-b.ts",
      },
      {
        fromFileId: "src/b.ts",
        names: ["z"],
        specifier: "./z",
        toFileId: "src/z.ts",
      },
    ]
  );

  assert.equal(analysis.cycleIdByFileId.get("src/cycle-a.ts"), "cycle-0");
  assert.equal(analysis.cycleIdByFileId.get("src/cycle-b.ts"), "cycle-0");
  assert.equal(analysis.depDepthByFileId.get("src/cycle-a.ts"), DEP_DEPTH_IN_CYCLE);
  assert.equal(analysis.depDepthByFileId.get("src/cycle-b.ts"), DEP_DEPTH_IN_CYCLE);
  assert.equal(analysis.depDepthByFileId.get("src/a.ts"), DEP_DEPTH_IN_CYCLE);
  assert.equal(analysis.depDepthByFileId.get("src/b.ts"), 1);
  assert.equal(analysis.depDepthByFileId.get("src/z.ts"), 0);
  assert.equal(analysis.topoOrderByFileId.get("src/a.ts"), 0);
  assert.equal(analysis.topoOrderByFileId.get("src/b.ts"), 1);
  assert.equal(analysis.topoOrderByFileId.get("src/z.ts"), 2);
  assert.equal(
    analysis.topoOrderByFileId.get("src/cycle-a.ts"),
    TOPO_ORDER_UNAVAILABLE
  );
  assert.equal(
    analysis.topoOrderByFileId.get("src/cycle-b.ts"),
    TOPO_ORDER_UNAVAILABLE
  );
});

test("analyzeDependencyGraph assigns stable cycle ids regardless of input order", () => {
  const analysis = analyzeDependencyGraph(
    ["src/d.ts", "src/b.ts", "src/c.ts", "src/a.ts"],
    [
      {
        fromFileId: "src/d.ts",
        names: ["c"],
        specifier: "./c",
        toFileId: "src/c.ts",
      },
      {
        fromFileId: "src/b.ts",
        names: ["a"],
        specifier: "./a",
        toFileId: "src/a.ts",
      },
      {
        fromFileId: "src/c.ts",
        names: ["d"],
        specifier: "./d",
        toFileId: "src/d.ts",
      },
      {
        fromFileId: "src/a.ts",
        names: ["b"],
        specifier: "./b",
        toFileId: "src/b.ts",
      },
    ]
  );

  assert.equal(analysis.cycleIdByFileId.get("src/a.ts"), "cycle-0");
  assert.equal(analysis.cycleIdByFileId.get("src/b.ts"), "cycle-0");
  assert.equal(analysis.cycleIdByFileId.get("src/c.ts"), "cycle-1");
  assert.equal(analysis.cycleIdByFileId.get("src/d.ts"), "cycle-1");
});
