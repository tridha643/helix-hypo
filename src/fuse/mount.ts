/**
 * FUSE mount for the helix virtual filesystem.
 *
 * Projects the HelixDB dependency graph as a read-only virtual filesystem:
 *   /files/<fileId>/          — per-file directory with content, meta, edges
 *   /tree/                    — mirrors repo directory structure
 *   /index/                   — DAG analysis views (entry-points, cycles, etc.)
 *   /stats.json               — index summary
 *
 * Must be run with Node.js (not Bun) due to fuse-native's libuv dependency.
 * Usage: node --import tsx src/fuse/mount.ts [mountPoint] [repoRoot]
 */

import { mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { parsePath } from "./pathParser.js";
import type { FuseIntent } from "./pathParser.js";

const require = createRequire(import.meta.url);
const Fuse = require("fuse-native");

// ── Error codes ────────────────────────────────────────────────────────────

const ENOENT = -2;
const ENOTDIR = -20;
const EISDIR = -21;
const ENOTSUP = -45;

// ── Stat helpers ───────────────────────────────────────────────────────────

const uid = process.getuid?.() ?? 501;
const gid = process.getgid?.() ?? 20;
const now = new Date();

function dirStat(size = 0): Record<string, unknown> {
  return {
    mtime: now,
    atime: now,
    ctime: now,
    nlink: 2,
    size,
    mode: 0o40555, // dr-xr-xr-x
    uid,
    gid,
  };
}

function fileStat(size: number): Record<string, unknown> {
  return {
    mtime: now,
    atime: now,
    ctime: now,
    nlink: 1,
    size,
    mode: 0o100444, // -r--r--r--
    uid,
    gid,
  };
}

function symlinkStat(size: number): Record<string, unknown> {
  return {
    mtime: now,
    atime: now,
    ctime: now,
    nlink: 1,
    size,
    mode: 0o120444, // lrw-r--r-- (symlink)
    uid,
    gid,
  };
}

// ── Mount state ────────────────────────────────────────────────────────────

export type MountConfig = {
  mountPoint: string;
  repoRoot: string;
  helixUrl?: string;
  apiKey?: string | null;
  debug?: boolean;
};

type QueryFn = (queryName: string, params: Record<string, unknown>) => Promise<unknown>;

// Cache structures populated at mount time and on demand
type MountState = {
  config: MountConfig;
  fileIds: Set<string>;
  dirIds: Set<string>;
  packageIds: Set<string>;
  query: QueryFn;
};

let state: MountState | null = null;

// ── HelixDB query helpers ──────────────────────────────────────────────────

async function queryHelix(queryName: string, params: Record<string, unknown>): Promise<unknown> {
  if (!state) throw new Error("Mount not initialized");
  return state.query(queryName, params);
}

/**
 * Unwrap a HelixDB query result. Responses may be:
 * - A raw array
 * - An object with a single array value (e.g., { files: [...] })
 * - An object with named keys (e.g., { directories: [...], files: [...] })
 * This function extracts the array if possible, otherwise returns as-is.
 */
function unwrapArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const values = Object.values(raw as Record<string, unknown>);
    // If there's exactly one value and it's an array, return it
    if (values.length === 1 && Array.isArray(values[0])) return values[0];
  }
  return [];
}

/**
 * Unwrap a single-object HelixDB response.
 * E.g., { file: { file_id: ... } } -> { file_id: ... }
 */
function unwrapOne(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const values = Object.values(obj);
  if (values.length === 1 && values[0] && typeof values[0] === "object" && !Array.isArray(values[0])) {
    return values[0] as Record<string, unknown>;
  }
  // Already unwrapped
  if ("file_id" in obj || "dir_id" in obj || "package_id" in obj) return obj;
  return obj;
}

async function loadFileAndDirIds(query: QueryFn): Promise<{ fileIds: Set<string>; dirIds: Set<string>; packageIds: Set<string> }> {
  const [filesRaw, dirsRaw, pkgsRaw] = await Promise.all([
    query("ListFiles", {}),
    query("ListDirectories", {}),
    query("ListPackages", {}),
  ]);

  const files = unwrapArray(filesRaw) as Record<string, unknown>[];
  const dirs = unwrapArray(dirsRaw) as Record<string, unknown>[];
  const pkgs = unwrapArray(pkgsRaw) as Record<string, unknown>[];

  return {
    fileIds: new Set(files.map((f) => String(f.file_id))),
    dirIds: new Set(dirs.map((d) => String(d.dir_id))),
    packageIds: new Set(pkgs.map((p) => String(p.package_id))),
  };
}

// ── FUSE ops ───────────────────────────────────────────────────────────────

function getattr(
  fusePath: string,
  cb: (code: number, stat?: Record<string, unknown>) => void
): void {
  if (!state) return cb(ENOENT);

  const intent = parsePath(fusePath, state.fileIds, state.dirIds);
  getattrForIntent(intent).then(
    (result) => cb(result.code, result.stat),
    () => cb(ENOENT)
  );
}

async function getattrForIntent(
  intent: FuseIntent
): Promise<{ code: number; stat?: Record<string, unknown> }> {
  switch (intent.kind) {
    // Directories
    case "root":
    case "files-root":
    case "files-prefix-dir":
    case "tree-root":
    case "index-root":
    case "file-dir":
    case "file-imports":
    case "file-imported-by":
    case "file-external-deps":
    case "index-entry-points":
    case "index-leaf-deps":
    case "index-orphans":
    case "index-cycles":
    case "index-cycle-dir":
    case "index-external-packages":
    case "index-external-package":
    case "index-external-package-imported-by":
    case "tree-dir":
      return { code: 0, stat: dirStat() };

    // Regular files
    case "file-content": {
      const content = await getFileContent(intent.fileId);
      return content !== null
        ? { code: 0, stat: fileStat(Buffer.byteLength(content)) }
        : { code: ENOENT };
    }
    case "file-meta": {
      const meta = await getFileMeta(intent.fileId);
      return meta !== null
        ? { code: 0, stat: fileStat(Buffer.byteLength(meta)) }
        : { code: ENOENT };
    }
    case "stats": {
      const stats = await getStatsJson();
      return stats !== null
        ? { code: 0, stat: fileStat(Buffer.byteLength(stats)) }
        : { code: ENOENT };
    }
    case "index-most-imported": {
      const content = await getMostImportedTxt();
      return { code: 0, stat: fileStat(Buffer.byteLength(content)) };
    }
    case "index-topo-order": {
      const content = await getTopoOrderTxt();
      return { code: 0, stat: fileStat(Buffer.byteLength(content)) };
    }

    // Symlinks
    case "file-import-entry": {
      const target = await getImportSymlinkTarget(intent.fileId, intent.targetName);
      return target !== null
        ? { code: 0, stat: symlinkStat(Buffer.byteLength(target)) }
        : { code: ENOENT };
    }
    case "file-imported-by-entry": {
      const target = await getImportedBySymlinkTarget(intent.fileId, intent.importerName);
      return target !== null
        ? { code: 0, stat: symlinkStat(Buffer.byteLength(target)) }
        : { code: ENOENT };
    }
    case "file-external-dep-entry": {
      const target = getExternalDepSymlinkTarget(intent.packageName, intent.fileId);
      return { code: 0, stat: symlinkStat(Buffer.byteLength(target)) };
    }
    case "tree-file": {
      // Regular file — serves content directly so grep -r works
      const content = await getFileContent(intent.fileId);
      return content !== null
        ? { code: 0, stat: fileStat(Buffer.byteLength(content)) }
        : { code: ENOENT };
    }
    // Index symlink entries — point to /files/<fileId>/
    case "index-entry-points-entry":
    case "index-leaf-deps-entry":
    case "index-orphans-entry": {
      const target = getIndexSymlinkTarget(intent.name);
      return { code: 0, stat: symlinkStat(Buffer.byteLength(target)) };
    }
    case "index-cycle-dir-entry": {
      const target = getCycleDirSymlinkTarget(intent.name);
      return { code: 0, stat: symlinkStat(Buffer.byteLength(target)) };
    }
    case "index-external-package-imported-by-entry": {
      const target = getExtPkgImportedBySymlinkTarget(intent.name);
      return { code: 0, stat: symlinkStat(Buffer.byteLength(target)) };
    }

    case "not-found":
      return { code: ENOENT };

    default:
      return { code: ENOENT };
  }
}

function readdir(
  fusePath: string,
  cb: (code: number, names?: string[]) => void
): void {
  if (!state) return cb(ENOENT);

  const intent = parsePath(fusePath, state.fileIds, state.dirIds);
  readdirForIntent(intent).then(
    (result) => cb(result.code, result.names),
    () => cb(ENOENT)
  );
}

async function readdirForIntent(
  intent: FuseIntent
): Promise<{ code: number; names?: string[] }> {
  switch (intent.kind) {
    case "root":
      return { code: 0, names: ["files", "tree", "index", "stats.json"] };

    case "files-root": {
      // List all file IDs — extract unique first segments
      const topLevel = new Set<string>();
      for (const fid of state!.fileIds) {
        const first = fid.split("/")[0];
        topLevel.add(first);
      }
      return { code: 0, names: [...topLevel].sort() };
    }

    case "files-prefix-dir": {
      // List next-level entries under this prefix.
      // E.g., prefix="src" → show "daemon", "indexer", "app.ts", etc.
      const prefix = intent.prefix + "/";
      const entries = new Set<string>();
      for (const fid of state!.fileIds) {
        if (fid.startsWith(prefix)) {
          const rest = fid.slice(prefix.length);
          const next = rest.split("/")[0];
          entries.add(next);
        }
      }
      return { code: 0, names: [...entries].sort() };
    }

    case "file-dir":
      return { code: 0, names: ["content", "meta.json", "imports", "imported-by", "external-deps"] };

    case "file-imports": {
      const edges = await queryHelix("GetFileImports", { file_id: intent.fileId });
      const items = unwrapArray(edges) as Record<string, unknown>[];
      const nameSet = new Set<string>();
      for (const e of items) {
        const spec = String(e.specifier ?? "");
        nameSet.add(spec.split("/").pop() ?? spec);
      }
      return { code: 0, names: [...nameSet] };
    }

    case "file-imported-by": {
      const edges = await queryHelix("GetFileImportedBy", { file_id: intent.fileId });
      const items = unwrapArray(edges) as Record<string, unknown>[];
      const nameSet = new Set<string>();
      for (const e of items) {
        const fid = extractField(e, "from_file_id");
        nameSet.add(fid.split("/").pop() ?? fid);
      }
      return { code: 0, names: [...nameSet] };
    }

    case "file-external-deps": {
      const allPkgs = unwrapArray(await queryHelix("ListPackages", {})) as Record<string, unknown>[];
      const names: string[] = [];
      for (const pkg of allPkgs) {
        const pkgId = String(pkg.package_id);
        const importedBy = unwrapArray(await queryHelix("GetPackageImportedBy", { package_id: pkgId })) as Record<string, unknown>[];
        if (importedBy.some((e) => extractField(e, "from_file_id") === intent.fileId)) {
          names.push(pkgId);
        }
      }
      return { code: 0, names: names.sort() };
    }

    case "tree-root": {
      // Root directory contents
      const result = await queryHelix("ListDirectoryContents", { dir_id: "" });
      const data = result as { directories?: unknown[]; files?: unknown[] } | null;
      const dirs = (Array.isArray(data?.directories) ? data!.directories : []) as Record<string, unknown>[];
      const files = (Array.isArray(data?.files) ? data!.files : []) as Record<string, unknown>[];
      const names = [
        ...dirs.map((d) => String(d.dir_id).split("/").pop()!),
        ...files.map((f) => String(f.file_id).split("/").pop()!),
      ];
      return { code: 0, names: names.sort() };
    }

    case "tree-dir": {
      const result = await queryHelix("ListDirectoryContents", { dir_id: intent.dirId });
      const data = result as { directories?: unknown[]; files?: unknown[] } | null;
      const dirs = (Array.isArray(data?.directories) ? data!.directories : []) as Record<string, unknown>[];
      const files = (Array.isArray(data?.files) ? data!.files : []) as Record<string, unknown>[];
      const names = [
        ...dirs.map((d) => String(d.dir_id).split("/").pop()!),
        ...files.map((f) => String(f.file_id).split("/").pop()!),
      ];
      return { code: 0, names: names.sort() };
    }

    case "index-root":
      return {
        code: 0,
        names: [
          "entry-points",
          "leaf-deps",
          "most-imported.txt",
          "orphans",
          "cycles",
          "topo-order.txt",
          "external-packages",
        ],
      };

    case "index-entry-points": {
      const result = await queryHelix("ListEntryPoints", {});
      const files = unwrapArray(result) as Record<string, unknown>[];
      return {
        code: 0,
        names: files.map((f) => fileIdToSymlinkName(String(f.file_id))),
      };
    }

    case "index-leaf-deps": {
      const result = await queryHelix("ListLeafDependencies", {});
      const files = unwrapArray(result) as Record<string, unknown>[];
      return {
        code: 0,
        names: files.map((f) => fileIdToSymlinkName(String(f.file_id))),
      };
    }

    case "index-orphans": {
      const result = await queryHelix("ListOrphans", {});
      const files = unwrapArray(result) as Record<string, unknown>[];
      return {
        code: 0,
        names: files.map((f) => fileIdToSymlinkName(String(f.file_id))),
      };
    }

    case "index-cycles": {
      const result = await queryHelix("ListCycles", {});
      const files = unwrapArray(result) as Record<string, unknown>[];
      const cycleIds = new Set(files.map((f) => String(f.cycle_id)));
      return { code: 0, names: [...cycleIds].sort() };
    }

    case "index-cycle-dir": {
      const result = await queryHelix("GetFilesInCycle", { cycle_id: intent.cycleId });
      const files = unwrapArray(result) as Record<string, unknown>[];
      return {
        code: 0,
        names: files.map((f) => fileIdToSymlinkName(String(f.file_id))),
      };
    }

    case "index-external-packages": {
      return { code: 0, names: [...state!.packageIds].sort() };
    }

    case "index-external-package": {
      return { code: 0, names: ["imported-by"] };
    }

    case "index-external-package-imported-by": {
      const result = await queryHelix("GetPackageImportedBy", { package_id: intent.packageId });
      const files = unwrapArray(result) as Record<string, unknown>[];
      return {
        code: 0,
        names: files.map((f) => fileIdToSymlinkName(extractField(f, "from_file_id"))),
      };
    }

    default:
      return { code: ENOENT };
  }
}

function open(
  fusePath: string,
  _flags: number,
  cb: (code: number, fd?: number) => void
): void {
  if (!state) return cb(ENOENT);
  const intent = parsePath(fusePath, state.fileIds, state.dirIds);
  // Allow opening any file-type intent
  if (
    intent.kind === "file-content" ||
    intent.kind === "file-meta" ||
    intent.kind === "stats" ||
    intent.kind === "index-most-imported" ||
    intent.kind === "index-topo-order" ||
    intent.kind === "tree-file"
  ) {
    return cb(0, 42); // dummy fd
  }
  cb(ENOENT);
}

function read(
  fusePath: string,
  _fd: number,
  buf: Buffer,
  len: number,
  pos: number,
  cb: (bytesRead: number) => void
): void {
  if (!state) return cb(0);
  const intent = parsePath(fusePath, state.fileIds, state.dirIds);
  readForIntent(intent, buf, len, pos).then(
    (n) => cb(n),
    () => cb(0)
  );
}

async function readForIntent(
  intent: FuseIntent,
  buf: Buffer,
  len: number,
  pos: number
): Promise<number> {
  let content: string | null = null;

  switch (intent.kind) {
    case "file-content":
    case "tree-file":
      content = await getFileContent(intent.fileId);
      break;
    case "file-meta":
      content = await getFileMeta(intent.fileId);
      break;
    case "stats":
      content = await getStatsJson();
      break;
    case "index-most-imported":
      content = await getMostImportedTxt();
      break;
    case "index-topo-order":
      content = await getTopoOrderTxt();
      break;
    default:
      return 0;
  }

  if (content === null) return 0;

  const contentBuf = Buffer.from(content);
  if (pos >= contentBuf.length) return 0;
  const slice = contentBuf.subarray(pos, pos + len);
  slice.copy(buf);
  return slice.length;
}

function readlink(
  fusePath: string,
  cb: (code: number, target?: string) => void
): void {
  if (!state) return cb(ENOENT);
  const intent = parsePath(fusePath, state.fileIds, state.dirIds);
  readlinkForIntent(intent).then(
    (result) => cb(result.code, result.target),
    () => cb(ENOENT)
  );
}

async function readlinkForIntent(
  intent: FuseIntent
): Promise<{ code: number; target?: string }> {
  switch (intent.kind) {
    case "file-import-entry": {
      const target = await getImportSymlinkTarget(intent.fileId, intent.targetName);
      return target ? { code: 0, target } : { code: ENOENT };
    }
    case "file-imported-by-entry": {
      const target = await getImportedBySymlinkTarget(intent.fileId, intent.importerName);
      return target ? { code: 0, target } : { code: ENOENT };
    }
    case "file-external-dep-entry": {
      const target = getExternalDepSymlinkTarget(intent.packageName, intent.fileId);
      return { code: 0, target };
    }
    case "index-entry-points-entry":
    case "index-leaf-deps-entry":
    case "index-orphans-entry": {
      const target = getIndexSymlinkTarget(intent.name);
      return { code: 0, target };
    }
    case "index-cycle-dir-entry": {
      const target = getCycleDirSymlinkTarget(intent.name);
      return { code: 0, target };
    }
    case "index-external-package-imported-by-entry": {
      const target = getExtPkgImportedBySymlinkTarget(intent.name);
      return { code: 0, target };
    }
    default:
      return { code: ENOENT };
  }
}

// ── Content readers ────────────────────────────────────────────────────────

async function getFileContent(fileId: string): Promise<string | null> {
  if (!state) return null;
  try {
    const absPath = path.join(state.config.repoRoot, fileId);
    return readFileSync(absPath, "utf8");
  } catch {
    // Fall back to HelixDB-stored content
    try {
      const result = await queryHelix("GetFileByPath", { file_id: fileId });
      const data = unwrapOne(result);
      return data?.content != null ? String(data.content) : null;
    } catch {
      return null;
    }
  }
}

async function getFileMeta(fileId: string): Promise<string | null> {
  try {
    const result = await queryHelix("GetFileByPath", { file_id: fileId });
    const data = unwrapOne(result);
    if (!data) return null;
    // Strip content from meta (too large)
    const { content, ...meta } = data;
    return JSON.stringify(meta, null, 2) + "\n";
  } catch {
    return null;
  }
}

async function getStatsJson(): Promise<string | null> {
  try {
    const result = await queryHelix("GetIndexCounts", {});
    return JSON.stringify(result, null, 2) + "\n";
  } catch {
    return null;
  }
}

async function getMostImportedTxt(): Promise<string> {
  try {
    const result = await queryHelix("ListMostImported", { limit: 50 });
    const files = unwrapArray(result) as Record<string, unknown>[];
    return (
      files
        .map((f) => `${f.file_id} (imported by ${f.imported_by_count})`)
        .join("\n") + "\n"
    );
  } catch {
    return "";
  }
}

async function getTopoOrderTxt(): Promise<string> {
  try {
    const result = await queryHelix("GetTopologicalOrder", {});
    const files = unwrapArray(result) as Record<string, unknown>[];
    return files.map((f) => String(f.file_id)).join("\n") + "\n";
  } catch {
    return "";
  }
}

// ── Symlink targets ────────────────────────────────────────────────────────

/**
 * Extract a string field from a HelixDB result.
 * Handles nested objects like { file_id: { file_id: "src/foo.ts" } }.
 */
function extractField(obj: Record<string, unknown>, field: string): string {
  const val = obj[field];
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && field.replace("_id", "_id") in (val as Record<string, unknown>)) {
    // Nested: { to_file_id: { file_id: "src/foo.ts" } }
    return String((val as Record<string, unknown>).file_id ?? (val as Record<string, unknown>).dir_id ?? (val as Record<string, unknown>).package_id ?? val);
  }
  if (val && typeof val === "object") {
    // Try first string value
    const strs = Object.values(val as Record<string, unknown>).filter((v) => typeof v === "string");
    if (strs.length > 0) return strs[0] as string;
  }
  return String(val);
}

/**
 * Compute relative symlink from /files/<sourceFileId>/<subdir>/<name>
 * back to /files/<targetFileId>/.
 *
 * From /files/src/daemon/daemon.ts/imports/config.js:
 * - Parent dir: /files/src/daemon/daemon.ts/imports/
 * - To reach /files/: go up 1 (imports/) + numParts(sourceFileId) levels
 * - Then append targetFileId/
 */
function relativeToFiles(sourceFileId: string, targetFileId: string): string {
  const ups = 1 + sourceFileId.split("/").length; // 1 for subdir (imports/imported-by)
  return "../".repeat(ups) + targetFileId + "/";
}

async function getImportSymlinkTarget(
  fileId: string,
  targetName: string
): Promise<string | null> {
  try {
    const edges = await queryHelix("GetFileImports", { file_id: fileId });
    const items = unwrapArray(edges) as Record<string, unknown>[];
    for (const e of items) {
      const spec = String(e.specifier ?? "");
      const name = spec.split("/").pop() ?? spec;
      if (name === targetName) {
        const toFileId = extractField(e, "to_file_id");
        return relativeToFiles(fileId, toFileId);
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function getImportedBySymlinkTarget(
  fileId: string,
  importerName: string
): Promise<string | null> {
  try {
    const edges = await queryHelix("GetFileImportedBy", { file_id: fileId });
    const items = unwrapArray(edges) as Record<string, unknown>[];
    for (const e of items) {
      const fromFileId = extractField(e, "from_file_id");
      const name = fromFileId.split("/").pop() ?? fromFileId;
      if (name === importerName) {
        return relativeToFiles(fileId, fromFileId);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * External dep symlink from /files/<fileId>/external-deps/<pkg>
 * to /index/external-packages/<pkg>/.
 * This crosses the top-level boundary, so we use absolute-style from mount root.
 * Actually we compute relative: go up to / then down to index/...
 * From /files/<fileId>/external-deps/<name>, parent is /files/<fileId>/external-deps/
 * Ups: 1 (external-deps/) + numParts(fileId) + 1 (files/) = 2 + numParts
 * But since we don't know the fileId here, we accept it as a param.
 */
function getExternalDepSymlinkTarget(packageName: string, fileId?: string): string {
  if (fileId) {
    const ups = 2 + fileId.split("/").length; // external-deps/ + fileId parts + files/
    return "../".repeat(ups) + `index/external-packages/${packageName}/`;
  }
  // Fallback — just use a deep relative that works for most cases
  return `../../../index/external-packages/${packageName}/`;
}

/**
 * Index symlink entries (entry-points/, leaf-deps/, etc.) point to /files/<fileId>/.
 * From /index/<section>/<name>, parent is /index/<section>/.
 * To reach /: up 2 (section/ + index/)
 * Then: files/<fileId>/
 */
function getIndexSymlinkTarget(encodedName: string): string {
  const fileId = symlinkNameToFileId(encodedName);
  return `../../files/${fileId}/`;
}

/**
 * For cycle-dir entries at /index/cycles/<cycleId>/<name>:
 * Parent is /index/cycles/<cycleId>/
 * To reach /: up 3 (cycleId/ + cycles/ + index/)
 */
function getCycleDirSymlinkTarget(encodedName: string): string {
  const fileId = symlinkNameToFileId(encodedName);
  return `../../../files/${fileId}/`;
}

/**
 * For external-package imported-by entries at /index/external-packages/<pkg>/imported-by/<name>:
 * Parent is /index/external-packages/<pkg>/imported-by/
 * To reach /: up 4 (imported-by/ + pkg/ + external-packages/ + index/)
 */
function getExtPkgImportedBySymlinkTarget(encodedName: string): string {
  const fileId = symlinkNameToFileId(encodedName);
  return `../../../../files/${fileId}/`;
}

function getTreeFileSymlinkTarget(fileId: string): string {
  // Symlink at /tree/<fileId>, parent dir is /tree/<dirname(fileId)>/
  // Depth of parent from root: 1 (tree/) + (numParts - 1) = numParts
  const depth = fileId.split("/").length;
  const ups = "../".repeat(depth);
  return `${ups}files/${fileId}/content`;
}

// ── Symlink name encoding ──────────────────────────────────────────────────

/**
 * Encode a file ID as a flat symlink name by replacing "/" with "::".
 * This makes file IDs like "src/daemon/config.ts" into "src::daemon::config.ts".
 */
function fileIdToSymlinkName(fileId: string): string {
  return fileId.replace(/\//g, "::");
}

function symlinkNameToFileId(name: string): string {
  return name.replace(/::/g, "/");
}

// ── Mount / Unmount ────────────────────────────────────────────────────────

let fuseInstance: InstanceType<typeof Fuse> | null = null;

export async function mountFuse(config: MountConfig, query: QueryFn): Promise<void> {
  if (!existsSync(config.mountPoint)) {
    mkdirSync(config.mountPoint, { recursive: true });
  }

  // Load file/dir/package IDs from HelixDB
  const ids = await loadFileAndDirIds(query);

  state = {
    config,
    fileIds: ids.fileIds,
    dirIds: ids.dirIds,
    packageIds: ids.packageIds,
    query,
  };

  const ops = {
    getattr,
    readdir,
    open,
    read,
    readlink,
  };

  fuseInstance = new Fuse(config.mountPoint, ops, {
    debug: config.debug ?? false,
    force: true,
  });

  return new Promise<void>((resolve, reject) => {
    fuseInstance!.mount((err: Error | null) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function unmountFuse(): Promise<void> {
  if (!fuseInstance) return;
  return new Promise<void>((resolve, reject) => {
    fuseInstance!.unmount((err: Error | null) => {
      fuseInstance = null;
      state = null;
      if (err) return reject(err);
      resolve();
    });
  });
}

export function isMounted(): boolean {
  return fuseInstance !== null;
}

// ── Standalone CLI entry point ─────────────────────────────────────────────

async function main(): Promise<void> {
  const mountPoint = process.argv[2] ?? "/tmp/helix";
  const repoRoot = process.argv[3] ?? process.cwd();

  // Import HelixDB client
  const { createHelixClient, ensureHelixReachable } = await import("../indexer/syncToHelix.js");

  const helixUrl = process.env.HELIX_URL ?? "http://127.0.0.1:6969";
  const apiKey = process.env.HELIX_API_KEY ?? null;

  await ensureHelixReachable(helixUrl);
  const client = createHelixClient(helixUrl, apiKey);

  async function query(queryName: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await client.query(queryName, params);
    if (response && typeof response === "object") {
      if ("error" in response && typeof response.error === "string") {
        throw new Error(response.error);
      }
      if ("data" in response) return response.data;
      if ("result" in response) return response.result;
    }
    return response;
  }

  console.error(`Mounting at ${mountPoint} (repo: ${repoRoot})`);

  await mountFuse({ mountPoint, repoRoot, helixUrl, apiKey }, query);

  console.error(`FUSE mounted at ${mountPoint}`);
  console.error("Press Ctrl+C to unmount and exit.");

  const cleanup = () => {
    unmountFuse()
      .then(() => {
        console.error("Unmounted cleanly.");
        process.exit(0);
      })
      .catch((err) => {
        console.error("Unmount error:", err.message);
        process.exit(1);
      });
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// Run if executed directly (not imported)
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/mount.ts") || process.argv[1].endsWith("/mount.js"));

if (isMain) {
  main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
}
