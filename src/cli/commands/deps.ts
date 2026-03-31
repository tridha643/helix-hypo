import { hasFlag, getPositional } from "../args.js";
import { die, dieUsage } from "../errors.js";
import { writeJson, writeLines } from "../format.js";
import { runDepsQuery } from "../../helixOps/index.js";

const HELP = `Usage: helix deps <file> [options]

Show the import graph edges for a single file. By default lists all files
that <file> imports (outgoing edges). With --reverse, lists all files
that import <file> (incoming edges).

Output (text): one file path per line.
Output (json): array of edge objects with to_file_id/from_file_id,
  specifier (the import path as written), and names (named imports).

Requires: helix index (repo must be indexed first)

Arguments:
  file    File path relative to repo root (e.g. src/app.ts)

Options:
  --reverse    Show files that import this file (imported-by)
  --json       Output as JSON

Examples:
  helix deps src/app.ts                # What does app.ts import?
  helix deps src/app.ts --reverse      # What files import app.ts?
  helix deps src/app.ts --json         # Machine-readable edge list`;

type DepsArgs = {
  fileId: string;
  json: boolean;
  reverse: boolean;
};

export function parseArgs(args: string[]): DepsArgs {
  const json = hasFlag(args, "--json");
  const reverse = hasFlag(args, "--reverse");
  const fileId = getPositional(args);

  if (!fileId) {
    dieUsage("Missing required argument: <file>", "helix deps <file> [--reverse] [--json]");
  }

  return { fileId, json, reverse };
}

type DepsEdge = Record<string, unknown>;

/**
 * Extract file_id from a deps edge field.
 * HelixDB returns nested objects: { to_file_id: { file_id: "..." } }
 * or flat strings: { to_file_id: "..." }
 */
function extractFileId(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "file_id" in value) {
    return (value as Record<string, unknown>).file_id as string;
  }
  return "unknown";
}

export function formatText(edges: DepsEdge[], reverse: boolean): string[] {
  return edges.map((edge) => {
    const field = reverse ? edge.from_file_id : edge.to_file_id;
    return extractFileId(field);
  });
}

/**
 * Unwrap HelixDB result — deps queries return { edges: [...] } wrapper.
 */
function unwrapEdges(result: unknown): DepsEdge[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.edges)) return obj.edges;
  }
  return [];
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(args);

  const result = await runDepsQuery(parsed.fileId, parsed.reverse, {
    repoRoot: process.cwd(),
  });

  const edges = unwrapEdges(result);

  if (parsed.json) {
    writeJson(edges);
  } else {
    const lines = formatText(edges, parsed.reverse);
    if (lines.length === 0) {
      writeLines([parsed.reverse ? "No files import this file." : "No dependencies found."]);
    } else {
      writeLines(lines);
    }
  }
}
