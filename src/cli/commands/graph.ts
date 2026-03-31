import { hasFlag, getOption, getPositional } from "../args.js";
import { die, dieUsage } from "../errors.js";
import { writeJson, writeLines } from "../format.js";
import { runGraphQuery, runInfoQuery } from "../../helixOps/index.js";

const HELP = `Usage: helix graph <subcommand> [options]

Query the dependency graph analysis produced by 'helix index'. This runs
Tarjan's SCC algorithm for cycle detection, topological sort, and
dependency depth computation across all JS/TS imports.

Subcommands:
  stats            Summary counts: files, dirs, packages, imports, entry
                   points, leaf deps, orphans, and distinct cycle count.
  entry-points     Files with zero incoming imports (nothing imports them).
                   These are typically CLI entry points or top-level scripts.
  leaf-deps        Files with zero outgoing imports (they import nothing).
                   These are utility/config modules at the bottom of the DAG.
  orphans          Files with no imports in either direction (isolated).
  cycles           List files involved in import cycles. Optionally pass a
                   file path to see only that file's cycle members.
  topo-order       All files in topological order (dependencies before
                   dependents). Useful for understanding build/load order.
  most-imported    Files ranked by imported_by_count (most depended-on first).

Output (text): file paths, one per line (stats shows key: value).
Output (json): full result objects from HelixDB.

Requires: helix index (repo must be indexed first)

Options:
  --limit N    Limit results (most-imported, default: 20)
  --json       Output as JSON

Examples:
  helix graph stats                    # Quick index overview
  helix graph entry-points             # Find CLI entry points
  helix graph most-imported --limit 5  # Top 5 most-depended-on files
  helix graph cycles                   # Show all cyclic files
  helix graph cycles src/a.ts          # Show cycle members for a.ts`;

const VALID_SUBCOMMANDS = [
  "entry-points",
  "leaf-deps",
  "orphans",
  "cycles",
  "topo-order",
  "most-imported",
  "stats",
];

type GraphArgs = {
  json: boolean;
  limit: number | null;
  params: Record<string, unknown>;
  subcommand: string;
};

export function parseArgs(args: string[]): GraphArgs {
  const json = hasFlag(args, "--json");
  const limitStr = getOption(args, "--limit");
  const limit = limitStr ? parseInt(limitStr, 10) : null;
  const subcommand = getPositional(args);

  if (!subcommand) {
    dieUsage(
      "Missing required argument: <subcommand>",
      `helix graph <subcommand> [--json]\n\nValid subcommands: ${VALID_SUBCOMMANDS.join(", ")}`
    );
  }

  if (!VALID_SUBCOMMANDS.includes(subcommand)) {
    die(
      `Unknown graph subcommand "${subcommand}"`,
      `Valid subcommands: ${VALID_SUBCOMMANDS.join(", ")}`
    );
  }

  // For cycles with a file argument: helix graph cycles <file>
  const params: Record<string, unknown> = {};
  if (subcommand === "cycles") {
    // Remove the subcommand from args to check for a file positional
    const remaining = args.filter((a) => a !== subcommand && !a.startsWith("-"));
    if (remaining.length > 0) {
      params.file_id = remaining[0];
    }
  }

  if (subcommand === "most-imported") {
    params.limit = limit ?? 20;
  }

  return { json, limit, params, subcommand };
}

type StatsResult = Record<string, unknown>;

function formatStats(stats: StatsResult): string[] {
  const lines: string[] = [];
  const counts = (stats.counts ?? {}) as Record<string, unknown>;

  lines.push(`Files: ${counts.files ?? 0}`);
  lines.push(`Directories: ${counts.directories ?? 0}`);
  lines.push(`Packages: ${counts.packages ?? 0}`);
  lines.push(`Imports: ${counts.imports ?? 0}`);
  lines.push(`External imports: ${counts.imports_external ?? 0}`);
  lines.push(`Entry points: ${stats.entryPoints ?? 0}`);
  lines.push(`Leaf dependencies: ${stats.leafDeps ?? 0}`);
  lines.push(`Orphans: ${stats.orphans ?? 0}`);
  lines.push(`Cycles: ${stats.cycles ?? 0}`);

  return lines;
}

/**
 * Unwrap HelixDB result: queries return { files: [...] } or an array directly.
 */
function unwrapResult(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.files)) return obj.files;
  }
  return [];
}

function formatListResult(result: unknown): string[] {
  const items = unwrapResult(result);

  return items.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      if (obj.file_id) return obj.file_id as string;
      if (obj.id) return obj.id as string;
      if (obj.cycle_id != null) return `cycle-${obj.cycle_id}`;
    }
    return JSON.stringify(item);
  });
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(args);
  const queryOptions = { repoRoot: process.cwd() };

  if (parsed.subcommand === "stats") {
    const result = await runGraphQuery("stats", {}, queryOptions);

    if (parsed.json) {
      writeJson(result);
    } else {
      writeLines(formatStats(result as StatsResult));
    }
    return;
  }

  // For cycles with a file_id, use cycle-files subcommand
  if (parsed.subcommand === "cycles" && parsed.params.file_id) {
    // First get file info to find cycle_id
    const infoRaw = (await runInfoQuery(parsed.params.file_id as string, queryOptions)) as Record<string, unknown>;
    const info = (infoRaw?.file ?? infoRaw) as Record<string, unknown>;

    const cycleId = info?.cycle_id;
    if (cycleId == null) {
      writeLines(["File is not part of any cycle."]);
      return;
    }

    const result = await runGraphQuery("cycle-files", { cycle_id: cycleId }, queryOptions);

    if (parsed.json) {
      writeJson(result);
    } else {
      writeLines(formatListResult(result));
    }
    return;
  }

  const result = await runGraphQuery(parsed.subcommand, parsed.params, queryOptions);

  if (parsed.json) {
    writeJson(result);
  } else {
    const lines = formatListResult(result);
    if (lines.length === 0) {
      writeLines(["No results."]);
    } else {
      writeLines(lines);
    }
  }
}
