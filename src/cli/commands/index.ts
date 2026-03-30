import path from "node:path";

import { hasFlag, getOption, getPositional } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const HELP = `Usage: helix index [path] [options]
       helix reindex [path] [options]

Index a git repository into HelixDB. Reindex is an alias that performs
the same full rebuild.

Arguments:
  path    Repository path (default: current directory)

Options:
  --status           Show current index counts instead of indexing
  --api-key <key>    HelixDB API key
  --helix-url <url>  HelixDB URL
  --no-deploy        Skip deploying queries to HelixDB
  --json             Output as JSON

Examples:
  helix index
  helix index /path/to/repo
  helix index --status
  helix index --json
  helix reindex .`;

type IndexArgs = {
  apiKey: string | null;
  deploy: boolean;
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
  const apiKey = getOption(args, "--api-key");
  const helixUrl = getOption(args, "--helix-url");
  const positional = getPositional(args);

  const repoRoot = positional ? path.resolve(positional) : process.cwd();

  return {
    apiKey,
    deploy: !noDeploy,
    helixUrl,
    json,
    repoRoot,
    statusOnly,
  };
}

type IndexSummary = {
  summary: Record<string, unknown>;
  helixCounts?: Record<string, unknown>;
};

export function formatText(result: IndexSummary): string[] {
  const { summary } = result;
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
    const result = await sendDaemonRequest("query", {
      queryName: "GetIndexCounts",
      params: {},
    });

    if (parsed.json) {
      writeJson(result);
    } else {
      writeLines(formatStatusText((result ?? {}) as Record<string, unknown>));
    }
    return;
  }

  const params: Record<string, unknown> = { repoRoot: parsed.repoRoot };
  if (parsed.apiKey) params.apiKey = parsed.apiKey;
  if (parsed.helixUrl) params.helixUrl = parsed.helixUrl;
  if (!parsed.deploy) params.deploy = false;

  const result = (await sendDaemonRequest("index", params)) as IndexSummary;

  if (parsed.json) {
    writeJson(result);
  } else {
    writeLines(formatText(result));
  }
}
