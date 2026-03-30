/**
 * Path parser for the FUSE-mounted virtual filesystem.
 *
 * Converts mount-relative paths like "/files/src/app.ts/imports/helpers.ts"
 * into structured FuseIntent discriminated unions that downstream handlers
 * can dispatch on.
 *
 * File IDs contain "/" (e.g., "src/daemon/daemon.ts"), so the parser uses
 * greedy longest-prefix matching against a known set of file IDs.
 */

// ── FuseIntent discriminated union ─────────────────────────────────────────

export type FuseIntent =
  | { kind: "root" }
  // /files/
  | { kind: "files-root" }
  | { kind: "files-prefix-dir"; prefix: string }
  | { kind: "file-dir"; fileId: string }
  | { kind: "file-content"; fileId: string }
  | { kind: "file-meta"; fileId: string }
  | { kind: "file-imports"; fileId: string }
  | { kind: "file-import-entry"; fileId: string; targetName: string }
  | { kind: "file-imported-by"; fileId: string }
  | { kind: "file-imported-by-entry"; fileId: string; importerName: string }
  | { kind: "file-external-deps"; fileId: string }
  | { kind: "file-external-dep-entry"; fileId: string; packageName: string }
  // /tree/
  | { kind: "tree-root" }
  | { kind: "tree-dir"; dirId: string }
  | { kind: "tree-file"; fileId: string }
  // /index/
  | { kind: "index-root" }
  | { kind: "index-entry-points" }
  | { kind: "index-entry-points-entry"; name: string }
  | { kind: "index-leaf-deps" }
  | { kind: "index-leaf-deps-entry"; name: string }
  | { kind: "index-most-imported" }
  | { kind: "index-orphans" }
  | { kind: "index-orphans-entry"; name: string }
  | { kind: "index-cycles" }
  | { kind: "index-cycle-dir"; cycleId: string }
  | { kind: "index-cycle-dir-entry"; cycleId: string; name: string }
  | { kind: "index-topo-order" }
  | { kind: "index-external-packages" }
  | { kind: "index-external-package"; packageId: string }
  | { kind: "index-external-package-imported-by"; packageId: string }
  | { kind: "index-external-package-imported-by-entry"; packageId: string; name: string }
  // /stats.json
  | { kind: "stats" }
  // fallback
  | { kind: "not-found" };

// ── File sub-path constants ────────────────────────────────────────────────

const FILE_SUB_DIRS = new Set(["content", "meta.json", "imports", "imported-by", "external-deps"]);

// ── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse a FUSE mount-relative path into a FuseIntent.
 *
 * @param mountPath - Path relative to mount root, e.g., "/files/src/app.ts/content"
 * @param fileIds   - Set of known file IDs for greedy prefix matching
 * @param dirIds    - Set of known directory IDs for tree/ resolution
 */
export function parsePath(
  mountPath: string,
  fileIds: Set<string>,
  dirIds: Set<string>
): FuseIntent {
  // Normalize: strip trailing slash, ensure leading slash
  const p = mountPath === "/" ? "/" : mountPath.replace(/\/+$/, "");

  if (p === "/") return { kind: "root" };
  if (p === "/stats.json") return { kind: "stats" };

  const segments = p.split("/").filter(Boolean);
  const top = segments[0];

  if (top === "files") return parseFilesPath(segments.slice(1), fileIds);
  if (top === "tree") return parseTreePath(segments.slice(1), fileIds, dirIds);
  if (top === "index") return parseIndexPath(segments.slice(1));

  return { kind: "not-found" };
}

// ── /files/ parser ─────────────────────────────────────────────────────────

function parseFilesPath(segments: string[], fileIds: Set<string>): FuseIntent {
  if (segments.length === 0) return { kind: "files-root" };

  // Greedy longest-prefix match against known file IDs
  const match = greedyFileMatch(segments, fileIds);

  if (match) {
    const { fileId, remainder } = match;

    if (remainder.length === 0) return { kind: "file-dir", fileId };
    if (remainder.length === 1) {
      const sub = remainder[0];
      if (sub === "content") return { kind: "file-content", fileId };
      if (sub === "meta.json") return { kind: "file-meta", fileId };
      if (sub === "imports") return { kind: "file-imports", fileId };
      if (sub === "imported-by") return { kind: "file-imported-by", fileId };
      if (sub === "external-deps") return { kind: "file-external-deps", fileId };
      return { kind: "not-found" };
    }
    if (remainder.length === 2) {
      if (remainder[0] === "imports") {
        return { kind: "file-import-entry", fileId, targetName: remainder[1] };
      }
      if (remainder[0] === "imported-by") {
        return { kind: "file-imported-by-entry", fileId, importerName: remainder[1] };
      }
      if (remainder[0] === "external-deps") {
        return { kind: "file-external-dep-entry", fileId, packageName: remainder[1] };
      }
    }
    return { kind: "not-found" };
  }

  // No exact file ID match — check if this is a prefix directory.
  // E.g., "/files/src" or "/files/src/daemon" — intermediate virtual directories
  // that allow traversal to actual file IDs.
  const candidate = segments.join("/");
  const prefixWithSlash = candidate + "/";
  for (const fid of fileIds) {
    if (fid.startsWith(prefixWithSlash)) {
      return { kind: "files-prefix-dir", prefix: candidate };
    }
  }

  return { kind: "not-found" };
}

/**
 * Greedy longest-prefix match: try joining progressively more segments
 * and check if the result is a known file ID. Return the longest match.
 *
 * Example: segments = ["src", "daemon", "daemon.ts", "content"]
 *   try "src" → not a file
 *   try "src/daemon" → not a file
 *   try "src/daemon/daemon.ts" → file ID match! remainder = ["content"]
 *   try "src/daemon/daemon.ts/content" → not a file
 *   → return { fileId: "src/daemon/daemon.ts", remainder: ["content"] }
 */
function greedyFileMatch(
  segments: string[],
  fileIds: Set<string>
): { fileId: string; remainder: string[] } | null {
  let bestMatch: { fileId: string; remainder: string[] } | null = null;

  for (let i = 1; i <= segments.length; i++) {
    const candidate = segments.slice(0, i).join("/");
    if (fileIds.has(candidate)) {
      bestMatch = { fileId: candidate, remainder: segments.slice(i) };
    }
  }

  return bestMatch;
}

// ── /tree/ parser ──────────────────────────────────────────────────────────

function parseTreePath(
  segments: string[],
  fileIds: Set<string>,
  dirIds: Set<string>
): FuseIntent {
  if (segments.length === 0) return { kind: "tree-root" };

  const fullPath = segments.join("/");

  // Check if it's a file first (more specific)
  if (fileIds.has(fullPath)) return { kind: "tree-file", fileId: fullPath };

  // Check if it's a directory
  if (dirIds.has(fullPath)) return { kind: "tree-dir", dirId: fullPath };

  return { kind: "not-found" };
}

// ── /index/ parser ─────────────────────────────────────────────────────────

function parseIndexPath(segments: string[]): FuseIntent {
  if (segments.length === 0) return { kind: "index-root" };

  const sub = segments[0];

  if (sub === "entry-points" && segments.length === 1) return { kind: "index-entry-points" };
  if (sub === "leaf-deps" && segments.length === 1) return { kind: "index-leaf-deps" };
  if (sub === "most-imported.txt" && segments.length === 1) return { kind: "index-most-imported" };
  if (sub === "orphans" && segments.length === 1) return { kind: "index-orphans" };
  if (sub === "cycles" && segments.length === 1) return { kind: "index-cycles" };
  if (sub === "topo-order.txt" && segments.length === 1) return { kind: "index-topo-order" };
  if (sub === "external-packages" && segments.length === 1) return { kind: "index-external-packages" };

  // Entries within symlink directories (length === 2)
  if (segments.length === 2) {
    if (sub === "entry-points") return { kind: "index-entry-points-entry", name: segments[1] };
    if (sub === "leaf-deps") return { kind: "index-leaf-deps-entry", name: segments[1] };
    if (sub === "orphans") return { kind: "index-orphans-entry", name: segments[1] };
    if (sub === "cycles") return { kind: "index-cycle-dir", cycleId: segments[1] };
    if (sub === "external-packages") return { kind: "index-external-package", packageId: segments[1] };
  }

  // Deeper paths
  if (sub === "cycles" && segments.length === 3) {
    return { kind: "index-cycle-dir-entry", cycleId: segments[1], name: segments[2] };
  }

  if (sub === "external-packages" && segments.length === 3 && segments[2] === "imported-by") {
    return { kind: "index-external-package-imported-by", packageId: segments[1] };
  }

  if (sub === "external-packages" && segments.length === 4 && segments[2] === "imported-by") {
    return { kind: "index-external-package-imported-by-entry", packageId: segments[1], name: segments[3] };
  }

  return { kind: "not-found" };
}
