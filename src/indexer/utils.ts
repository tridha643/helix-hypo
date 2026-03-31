import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const HELIX_DEFAULT_URL = "http://127.0.0.1:6969";
export const MAX_INDEXED_CONTENT_BYTES = 100 * 1024;
export const SUPPORTED_SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
export const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

export function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function normalizeFileId(fileId: string): string {
  const normalized = path.posix.normalize(toPosixPath(fileId));
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

export function getParentDirId(fileId: string): string {
  const normalized = normalizeFileId(fileId);
  if (!normalized) {
    return "";
  }

  const dir = path.posix.dirname(normalized);
  return dir === "." ? "" : dir;
}

export function getTreeDepth(fileId: string): number {
  const normalized = normalizeFileId(fileId);
  return normalized ? normalized.split("/").length : 0;
}

export function getDirectoryPrefixes(fileId: string): string[] {
  const normalized = normalizeFileId(fileId);
  if (!normalized) {
    return [""];
  }

  const parts = normalized.split("/");
  const directories = [""];
  let current = "";

  for (const part of parts.slice(0, -1)) {
    current = current ? `${current}/${part}` : part;
    directories.push(current);
  }

  return directories;
}

export function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    throw new Error(`chunkSize must be positive, received ${chunkSize}`);
  }

  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function getWorkspaceRootFromImportMeta(metaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), "../..");
}
