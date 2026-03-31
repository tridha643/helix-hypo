import { hasFlag, getOption, getPositional } from "../args.js";
import { dieUsage } from "../errors.js";
import { writeJson, writeLines } from "../format.js";
import { runDepsQuery, runHelixQuery } from "../../helixOps/index.js";

const HELP = `Usage: helix grep <query> [options]

BM25 full-text search over indexed file content. Unlike filesystem grep,
this searches the content stored in HelixDB at index time and ranks
results by relevance score.

Use --scope to restrict search to a file's dependency neighborhood:
  deps-of:<file>     Search only files that <file> imports.
  imports-of:<file>  Search only files that import <file>.

Output (text): file paths with relevance scores (e.g. src/app.ts  [0.8234]).
Output (json): array of { file_id, score } objects.

Requires: helix index (repo must be indexed first)

Arguments:
  query    Search term (matched against full file content)

Options:
  --scope <expr>    Scope search: deps-of:<file> or imports-of:<file>
  --limit N         Maximum results (default: 20)
  --json            Output as JSON

Examples:
  helix grep "fetchUser"                              # Search all files
  helix grep "useState" --limit 5                     # Top 5 matches
  helix grep "auth" --scope deps-of:src/api.ts        # Search api.ts deps
  helix grep "render" --scope imports-of:src/ui.ts     # Search ui.ts importers`;

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
    const depsResult = await runDepsQuery(parsed.scope.file, reverse, {
      repoRoot: process.cwd(),
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
    result = await runHelixQuery(
      "SearchFileContentScoped",
      { file_ids: fileIds, query: parsed.query },
      { repoRoot: process.cwd() }
    );
  } else {
    result = await runHelixQuery(
      "SearchFileContent",
      { limit: parsed.limit, query: parsed.query },
      { repoRoot: process.cwd() }
    );
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
