import { hasFlag, getPositional } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { runTreeQuery } from "../../helixOps/index.js";

const HELP = `Usage: helix tree [path] [options]

List directory contents from the indexed graph. Works like 'ls' but reads
from HelixDB, not the filesystem. Shows directories (with trailing /) and
files at the given path.

Output (text): sorted list, directories first (suffixed with /), then files.
Output (json): { directories: [...], files: [...] } with full metadata.

Requires: helix index (repo must be indexed first)

Arguments:
  path    Directory path relative to repo root (default: repo root)

Options:
  --json    Output as JSON (includes full file/directory metadata)

Examples:
  helix tree                           # List repo root
  helix tree src                       # List src/ contents
  helix tree src/cli --json            # Machine-readable directory listing`;

type TreeArgs = {
  dirId: string;
  json: boolean;
};

export function parseArgs(args: string[]): TreeArgs {
  const json = hasFlag(args, "--json");
  const dirId = getPositional(args) ?? "";
  return { dirId, json };
}

type TreeResult = {
  directories?: Record<string, unknown>[];
  files?: Record<string, unknown>[];
};

/**
 * Extract the last path segment from a dir_id or file_id for display.
 */
function basename(id: string): string {
  const parts = id.split("/");
  return parts[parts.length - 1] || id;
}

export function formatText(result: TreeResult): string[] {
  const dirs = (result.directories ?? [])
    .map((d) => basename((d.dir_id as string) ?? ""))
    .filter(Boolean)
    .sort();

  const files = (result.files ?? [])
    .map((f) => basename((f.file_id as string) ?? ""))
    .filter(Boolean)
    .sort();

  return [...dirs.map((d) => `${d}/`), ...files];
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(args);

  const result = await runTreeQuery(parsed.dirId, { repoRoot: process.cwd() });
  const treeResult = (result ?? {}) as TreeResult;

  if (parsed.json) {
    writeJson(treeResult);
  } else {
    const lines = formatText(treeResult);
    if (lines.length === 0) {
      writeLines(["Empty directory."]);
    } else {
      writeLines(lines);
    }
  }
}
