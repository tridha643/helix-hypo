import { hasFlag, getPositional } from "../args.js";
import { die, dieUsage } from "../errors.js";
import { writeJson, writeLines } from "../format.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const HELP = `Usage: helix deps <file> [options]

List dependencies of a file, or files that depend on it.

Arguments:
  file    File path relative to repo root (e.g. src/app.ts)

Options:
  --reverse    Show files that import this file (imported-by)
  --json       Output as JSON

Examples:
  helix deps src/app.ts
  helix deps src/app.ts --reverse
  helix deps src/app.ts --json`;

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

  const result = await sendDaemonRequest("deps", {
    fileId: parsed.fileId,
    reverse: parsed.reverse,
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
