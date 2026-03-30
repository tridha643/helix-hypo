import { hasFlag, getOption, getPositional } from "../args.js";
import { dieUsage } from "../errors.js";
import { writeJson, writeLines } from "../format.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const HELP = `Usage: helix grep <query> [options]

Search file content using BM25 full-text search.

Arguments:
  query    Search term

Options:
  --scope <expr>    Scope search to dependencies: deps-of:<file> or imports-of:<file>
  --limit N         Maximum results (default: 20)
  --json            Output as JSON

Examples:
  helix grep "import"
  helix grep "useState" --limit 10
  helix grep "fetch" --scope deps-of:src/app.ts --json`;

type GrepArgs = {
  json: boolean;
  limit: number;
  query: string;
  scope: { file: string; type: string } | null;
};

export function parseArgs(args: string[]): GrepArgs {
  const json = hasFlag(args, "--json");
  const limitStr = getOption(args, "--limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 20;
  const scopeStr = getOption(args, "--scope");
  const query = getPositional(args);

  if (!query) {
    dieUsage("Missing required argument: <query>", "helix grep <query> [--scope <expr>] [--json]");
  }

  let scope: GrepArgs["scope"] = null;
  if (scopeStr) {
    const match = scopeStr.match(/^(deps-of|imports-of):(.+)$/);
    if (match) {
      scope = { file: match[2], type: match[1] };
    }
  }

  return { json, limit, query, scope };
}

type GrepResult = {
  file_id?: string;
  score?: number;
};

export function formatText(results: GrepResult[]): string[] {
  return results.map((r) => {
    const score = r.score != null ? `  [${r.score.toFixed(4)}]` : "";
    return `${r.file_id ?? "unknown"}${score}`;
  });
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(args);

  let result: unknown;

  if (parsed.scope) {
    // Get the scoped file set first
    const reverse = parsed.scope.type === "imports-of";
    const depsResult = await sendDaemonRequest("deps", {
      fileId: parsed.scope.file,
      reverse,
    });

    // Unwrap { edges: [...] } wrapper from HelixDB
    const rawEdges = depsResult && typeof depsResult === "object" && !Array.isArray(depsResult)
      ? ((depsResult as Record<string, unknown>).edges as Record<string, unknown>[]) ?? []
      : Array.isArray(depsResult) ? depsResult : [];

    const fileIds = rawEdges.map((e: Record<string, unknown>) => {
      const field = reverse ? e.from_file_id : e.to_file_id;
      if (typeof field === "string") return field;
      if (field && typeof field === "object" && "file_id" in field) {
        return (field as Record<string, unknown>).file_id as string;
      }
      return "";
    }).filter(Boolean);

    if (fileIds.length === 0) {
      if (parsed.json) {
        writeJson([]);
      } else {
        writeLines(["No files in scope."]);
      }
      return;
    }

    // Search within the scoped files
    result = await sendDaemonRequest("query", {
      params: { file_ids: fileIds, query: parsed.query },
      queryName: "SearchFileContentScoped",
    });
  } else {
    result = await sendDaemonRequest("query", {
      params: { limit: parsed.limit, query: parsed.query },
      queryName: "SearchFileContent",
    });
  }

  // Unwrap HelixDB wrappers: { results: [...] }, { scoped: [...] }, or array
  let items: unknown[];
  if (Array.isArray(result)) {
    items = result;
  } else if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    items = (obj.results ?? obj.scoped ?? obj.files ?? []) as unknown[];
  } else {
    items = [];
  }
  const results = items as GrepResult[];

  if (parsed.json) {
    writeJson(results);
  } else {
    const lines = formatText(results);
    if (lines.length === 0) {
      writeLines(["No results."]);
    } else {
      writeLines(lines);
    }
  }
}
