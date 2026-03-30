import { hasFlag, getPositional } from "../args.js";
import { dieUsage } from "../errors.js";
import { writeJson, writeLines } from "../format.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const HELP = `Usage: helix glob <pattern> [options]

Match files in the index by glob pattern.

Arguments:
  pattern    Glob pattern (e.g. **/*.ts, src/*.test.ts)

Options:
  --json    Output as JSON

Examples:
  helix glob "**/*.ts"
  helix glob "src/**/*.test.ts"
  helix glob "*.json" --json`;

type GlobArgs = {
  json: boolean;
  pattern: string;
};

export function parseArgs(args: string[]): GlobArgs {
  const json = hasFlag(args, "--json");
  const pattern = getPositional(args);

  if (!pattern) {
    dieUsage("Missing required argument: <pattern>", "helix glob <pattern> [--json]");
  }

  return { json, pattern };
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports **, *, and ? wildcards.
 */
export function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === "*" && pattern[i + 1] === "*") {
      // ** matches anything including /
      if (pattern[i + 2] === "/") {
        regex += "(?:.*/)?";
        i += 3;
      } else {
        regex += ".*";
        i += 2;
      }
    } else if (char === "*") {
      // * matches anything except /
      regex += "[^/]*";
      i += 1;
    } else if (char === "?") {
      regex += ".";
      i += 1;
    } else if (".+^${}()|[]\\".includes(char)) {
      regex += `\\${char}`;
      i += 1;
    } else {
      regex += char;
      i += 1;
    }
  }

  return new RegExp(`^${regex}$`);
}

type FileEntry = {
  file_id?: string;
  id?: string;
};

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(args);
  const regex = globToRegex(parsed.pattern);

  const result = await sendDaemonRequest("query", {
    params: {},
    queryName: "ListFiles",
  });

  // Unwrap { files: [...] } wrapper from HelixDB
  let items: unknown[];
  if (Array.isArray(result)) {
    items = result;
  } else if (result && typeof result === "object") {
    items = ((result as Record<string, unknown>).files ?? []) as unknown[];
  } else {
    items = [];
  }
  const files = items as FileEntry[];
  const matched = files
    .map((f) => f.file_id ?? f.id ?? "")
    .filter((id) => id && regex.test(id))
    .sort();

  if (parsed.json) {
    writeJson(matched);
  } else {
    if (matched.length === 0) {
      writeLines(["No files match the pattern."]);
    } else {
      writeLines(matched);
    }
  }
}
