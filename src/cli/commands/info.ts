import { hasFlag, getPositional } from "../args.js";
import { dieUsage } from "../errors.js";
import { writeJson, writeLines } from "../format.js";
import { runInfoQuery } from "../../helixOps/index.js";

const HELP = `Usage: helix info <file> [options]

Show indexed metadata for a single file. Includes: file_id, extension,
size_bytes, import_count, imported_by_count, dep_depth (longest chain to
a leaf), topo_order (position in topological sort), tree_depth, and
boolean flags: is_entry_point, is_leaf_dep, is_orphan, is_in_cycle.

Output (text): key: value pairs, one per line (content field excluded).
Output (json): full file object including content.

Requires: helix index (repo must be indexed first)

Arguments:
  file    File path relative to repo root (e.g. src/app.ts)

Options:
  --json    Output as JSON (includes file content)

Examples:
  helix info src/app.ts                # Quick metadata overview
  helix info src/app.ts --json         # Full metadata with content`;

type InfoArgs = {
  fileId: string;
  json: boolean;
};

export function parseArgs(args: string[]): InfoArgs {
  const json = hasFlag(args, "--json");
  const fileId = getPositional(args);

  if (!fileId) {
    dieUsage("Missing required argument: <file>", "helix info <file> [--json]");
  }

  return { fileId, json };
}

type FileInfo = Record<string, unknown>;

export function formatText(info: FileInfo): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(info)) {
    if (key === "content") continue; // Skip large content field
    const display = Array.isArray(value)
      ? value.join(", ")
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value ?? "");
    lines.push(`${key}: ${display}`);
  }
  return lines;
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(args);

  const result = await runInfoQuery(parsed.fileId, { repoRoot: process.cwd() });
  // HelixDB wraps single results: { file: {...} }
  const raw = (result ?? {}) as Record<string, unknown>;
  const info = (raw.file ?? raw) as FileInfo;

  if (parsed.json) {
    writeJson(info);
  } else {
    const lines = formatText(info);
    if (lines.length === 0) {
      writeLines(["No info found for this file."]);
    } else {
      writeLines(lines);
    }
  }
}
