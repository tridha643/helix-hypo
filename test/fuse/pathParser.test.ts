import { describe, test, expect } from "bun:test";
import { parsePath } from "../../src/fuse/pathParser.js";
import type { FuseIntent } from "../../src/fuse/pathParser.js";

const fileIds = new Set([
  "src/app.ts",
  "src/daemon/daemon.ts",
  "src/daemon/config.ts",
  "src/indexer/types.ts",
  "package.json",
]);

const dirIds = new Set([
  "src",
  "src/daemon",
  "src/indexer",
]);

function parse(path: string): FuseIntent {
  return parsePath(path, fileIds, dirIds);
}

describe("parsePath", () => {
  test("root", () => {
    expect(parse("/")).toEqual({ kind: "root" });
  });

  test("stats.json", () => {
    expect(parse("/stats.json")).toEqual({ kind: "stats" });
  });

  // ── /files/ ────────────────────────────────────────────────────────────

  test("/files/ root", () => {
    expect(parse("/files")).toEqual({ kind: "files-root" });
    expect(parse("/files/")).toEqual({ kind: "files-root" });
  });

  test("/files/<id> -> file-dir", () => {
    expect(parse("/files/src/app.ts")).toEqual({ kind: "file-dir", fileId: "src/app.ts" });
    expect(parse("/files/src/daemon/daemon.ts")).toEqual({ kind: "file-dir", fileId: "src/daemon/daemon.ts" });
    expect(parse("/files/package.json")).toEqual({ kind: "file-dir", fileId: "package.json" });
  });

  test("/files/<id>/content", () => {
    expect(parse("/files/src/app.ts/content")).toEqual({ kind: "file-content", fileId: "src/app.ts" });
    expect(parse("/files/src/daemon/daemon.ts/content")).toEqual({
      kind: "file-content",
      fileId: "src/daemon/daemon.ts",
    });
  });

  test("/files/<id>/meta.json", () => {
    expect(parse("/files/src/app.ts/meta.json")).toEqual({ kind: "file-meta", fileId: "src/app.ts" });
  });

  test("/files/<id>/imports", () => {
    expect(parse("/files/src/daemon/daemon.ts/imports")).toEqual({
      kind: "file-imports",
      fileId: "src/daemon/daemon.ts",
    });
  });

  test("/files/<id>/imports/<name>", () => {
    expect(parse("/files/src/daemon/daemon.ts/imports/config.js")).toEqual({
      kind: "file-import-entry",
      fileId: "src/daemon/daemon.ts",
      targetName: "config.js",
    });
  });

  test("/files/<id>/imported-by", () => {
    expect(parse("/files/src/daemon/config.ts/imported-by")).toEqual({
      kind: "file-imported-by",
      fileId: "src/daemon/config.ts",
    });
  });

  test("/files/<id>/imported-by/<name>", () => {
    expect(parse("/files/src/daemon/config.ts/imported-by/daemon.ts")).toEqual({
      kind: "file-imported-by-entry",
      fileId: "src/daemon/config.ts",
      importerName: "daemon.ts",
    });
  });

  test("/files/<id>/external-deps", () => {
    expect(parse("/files/src/app.ts/external-deps")).toEqual({
      kind: "file-external-deps",
      fileId: "src/app.ts",
    });
  });

  test("/files/<id>/external-deps/<pkg>", () => {
    expect(parse("/files/src/app.ts/external-deps/helix-ts")).toEqual({
      kind: "file-external-dep-entry",
      fileId: "src/app.ts",
      packageName: "helix-ts",
    });
  });

  test("unknown file ID -> not-found", () => {
    expect(parse("/files/nonexistent.ts")).toEqual({ kind: "not-found" });
  });

  test("/files/<prefix-dir> for intermediate dirs", () => {
    expect(parse("/files/src")).toEqual({ kind: "files-prefix-dir", prefix: "src" });
    expect(parse("/files/src/daemon")).toEqual({ kind: "files-prefix-dir", prefix: "src/daemon" });
  });

  // ── /tree/ ─────────────────────────────────────────────────────────────

  test("/tree/ root", () => {
    expect(parse("/tree")).toEqual({ kind: "tree-root" });
    expect(parse("/tree/")).toEqual({ kind: "tree-root" });
  });

  test("/tree/<dir>", () => {
    expect(parse("/tree/src")).toEqual({ kind: "tree-dir", dirId: "src" });
    expect(parse("/tree/src/daemon")).toEqual({ kind: "tree-dir", dirId: "src/daemon" });
  });

  test("/tree/<file>", () => {
    expect(parse("/tree/src/app.ts")).toEqual({ kind: "tree-file", fileId: "src/app.ts" });
    expect(parse("/tree/package.json")).toEqual({ kind: "tree-file", fileId: "package.json" });
  });

  test("/tree/unknown -> not-found", () => {
    expect(parse("/tree/unknown")).toEqual({ kind: "not-found" });
  });

  // ── /index/ ────────────────────────────────────────────────────────────

  test("/index/ root", () => {
    expect(parse("/index")).toEqual({ kind: "index-root" });
    expect(parse("/index/")).toEqual({ kind: "index-root" });
  });

  test("/index/entry-points", () => {
    expect(parse("/index/entry-points")).toEqual({ kind: "index-entry-points" });
  });

  test("/index/leaf-deps", () => {
    expect(parse("/index/leaf-deps")).toEqual({ kind: "index-leaf-deps" });
  });

  test("/index/most-imported.txt", () => {
    expect(parse("/index/most-imported.txt")).toEqual({ kind: "index-most-imported" });
  });

  test("/index/orphans", () => {
    expect(parse("/index/orphans")).toEqual({ kind: "index-orphans" });
  });

  test("/index/cycles", () => {
    expect(parse("/index/cycles")).toEqual({ kind: "index-cycles" });
  });

  test("/index/cycles/cycle-0", () => {
    expect(parse("/index/cycles/cycle-0")).toEqual({ kind: "index-cycle-dir", cycleId: "cycle-0" });
  });

  test("/index/topo-order.txt", () => {
    expect(parse("/index/topo-order.txt")).toEqual({ kind: "index-topo-order" });
  });

  test("/index/external-packages", () => {
    expect(parse("/index/external-packages")).toEqual({ kind: "index-external-packages" });
  });

  test("/index/external-packages/<pkg>", () => {
    expect(parse("/index/external-packages/helix-ts")).toEqual({
      kind: "index-external-package",
      packageId: "helix-ts",
    });
  });

  test("/index/external-packages/<pkg>/imported-by", () => {
    expect(parse("/index/external-packages/helix-ts/imported-by")).toEqual({
      kind: "index-external-package-imported-by",
      packageId: "helix-ts",
    });
  });

  test("/index/entry-points/<name> -> entry", () => {
    expect(parse("/index/entry-points/src::app.ts")).toEqual({
      kind: "index-entry-points-entry",
      name: "src::app.ts",
    });
  });

  test("/index/cycles/<id>/<name> -> cycle-dir-entry", () => {
    expect(parse("/index/cycles/cycle-0/src::app.ts")).toEqual({
      kind: "index-cycle-dir-entry",
      cycleId: "cycle-0",
      name: "src::app.ts",
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  test("trailing slash stripped", () => {
    expect(parse("/files/src/app.ts/")).toEqual({ kind: "file-dir", fileId: "src/app.ts" });
  });

  test("top-level unknown -> not-found", () => {
    expect(parse("/unknown")).toEqual({ kind: "not-found" });
  });

  test("greedy match picks longest file ID", () => {
    // "src/daemon/daemon.ts" should match over "src/daemon" (which is a dir, not in fileIds)
    expect(parse("/files/src/daemon/daemon.ts/content")).toEqual({
      kind: "file-content",
      fileId: "src/daemon/daemon.ts",
    });
  });
});
