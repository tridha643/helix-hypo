import path from "node:path";

import { hasFlag, getOption, getPositional } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { runHelixQuery, runIndex } from "../../helixOps/index.js";

const HELP = `Usage: helix index [path] [options]
       helix reindex [path] [options]

Build the full graph index for a git repository and sync it to HelixDB.
This is the first command to run — all query commands depend on it.

Pipeline: git ls-files -> extract JS/TS imports -> resolve import paths ->
  DAG analysis (Tarjan SCC, topo sort, dep depth) -> sync nodes/edges to
  HelixDB -> compute file embeddings (TF.js Universal Sentence Encoder).

The index replaces any previous data in HelixDB for this repo. Reindex is
an alias that performs the same full rebuild.

Arguments:
  path    Repository path (default: current directory)

Options:
  --status           Show current index counts without re-indexing
  --api-key <key>    HelixDB API key (overrides config/env)
  --helix-url <url>  HelixDB URL (default: http://127.0.0.1:6969)
  --no-deploy        Skip deploying schema/queries to HelixDB
  --no-embed         Skip the embedding pass (faster, graph-only sync)
  --json             Output as JSON

Examples:
  helix index                          # Index current repo
  helix index /path/to/repo            # Index a different repo
  helix index . --no-embed             # Fast graph-only index
  helix index --status                 # Check what's already indexed
  helix index --status --json          # Machine-readable index counts`;

type IndexArgs = {
  apiKey: string | null;
  deploy: boolean;
  embedFiles: boolean;
  helixUrl: string | null;
  json: boolean;
  repoRoot: string;
  statusOnly: boolean;
};

export function parseArgs(args: string[]): IndexArgs {
  // Remove reindex marker if present
  if (args[0] === "__reindex__") args.shift();

  const json = hasFlag(args, "--json");
  const statusOnly = hasFlag(args, "--status");
  const noDeploy = hasFlag(args, "--no-deploy");
  const noEmbed = hasFlag(args, "--no-embed");
  const apiKey = getOption(args, "--api-key");
  const helixUrl = getOption(args, "--helix-url");
  const positional = getPositional(args);

  const repoRoot = positional ? path.resolve(positional) : process.cwd();

  return {
    apiKey,
    deploy: !noDeploy,
    embedFiles: !noEmbed,
    helixUrl,
    json,
    repoRoot,
    statusOnly,
  };
}

type IndexSummary = {
  helixCounts?: Record<string, unknown>;
  summary: Record<string, unknown>;
};

export function formatText(result: IndexSummary): string[] {
  const { helixCounts, summary } = result;
  const lines: string[] = [];

  lines.push(`Indexed ${summary.repoRoot ?? "repository"}`);
  lines.push(
    `files=${summary.fileCount ?? 0} directories=${summary.directoryCount ?? 0} packages=${summary.packageCount ?? 0}`
  );
  lines.push(
    `imports=${summary.importEdgeCount ?? 0} external_imports=${summary.externalImportEdgeCount ?? 0}`
  );
  lines.push(
    `entry_points=${summary.entryPointCount ?? 0} leaf_deps=${summary.leafDependencyCount ?? 0} orphans=${summary.orphanCount ?? 0} cycles=${summary.cycleCount ?? 0}`
  );

  if (helixCounts && typeof helixCounts === "object") {
    const h = helixCounts as Record<string, unknown>;
    const emb = h.embeddings;
    const embPart = emb !== undefined ? ` embeddings=${emb}` : "";
    lines.push(
      `helix(files=${h.files ?? 0}, directories=${h.directories ?? 0}, packages=${h.packages ?? 0}, imports=${h.imports ?? 0}, external_imports=${h.imports_external ?? 0}${embPart})`
    );
  }

  return lines;
}

function formatStatusText(counts: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(counts)) {
    lines.push(`${key}: ${value}`);
  }
  return lines;
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(args);

  if (parsed.statusOnly) {
    const result = await runHelixQuery(
      "GetIndexCounts",
      {},
      {
        apiKey: parsed.apiKey,
        helixUrl: parsed.helixUrl,
        repoRoot: parsed.repoRoot,
      }
    );

    if (parsed.json) {
      writeJson(result);
    } else {
      writeLines(formatStatusText((result ?? {}) as Record<string, unknown>));
    }
    return;
  }

  const result = (await runIndex({
    apiKey: parsed.apiKey,
    deployQueries: parsed.deploy,
    embedFiles: parsed.embedFiles,
    helixUrl: parsed.helixUrl,
    repoRoot: parsed.repoRoot,
  })) as IndexSummary;

  if (parsed.json) {
    writeJson(result);
  } else {
    writeLines(formatText(result));
  }
}
