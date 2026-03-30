import { hasFlag, getPositional } from "../args.js";
import { dieUsage } from "../errors.js";
import { writeJson, writeLines } from "../format.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const HELP = `Usage: helix info <file> [options]

Show metadata for a file from the HelixDB index.

Arguments:
  file    File path relative to repo root (e.g. src/app.ts)

Options:
  --json    Output as JSON

Examples:
  helix info src/app.ts
  helix info src/app.ts --json`;

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

  const result = await sendDaemonRequest("info", { fileId: parsed.fileId });
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
