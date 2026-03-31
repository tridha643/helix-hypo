import { hasFlag } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { getHelixStatus, type HelixStatusResult } from "../../helixOps/index.js";

const HELP = `Usage: helix status [options]

Show the current state of the helix system: HelixDB connection, daemon
status, graph counts (files, dirs, packages, imports), and embedding
coverage. Safe to run at any time — works even if HelixDB is unreachable
or the repo hasn't been indexed yet.

Use this to verify prerequisites before running query commands, or to
check embedding coverage after indexing.

Output (text): key: value pairs showing connection, counts, and coverage.
Output (json): full status object with nested counts and daemon state.

Options:
  --json    Output as JSON

Examples:
  helix status                         # Quick health check
  helix status --json                  # Machine-readable status`;

export function formatText(result: HelixStatusResult): string[] {
  const lines = [
    `helix_url:           ${result.helixUrl}`,
    `reachable:           ${result.reachable ? "yes" : "no"}`,
    `daemon:              ${result.daemon.running ? "running" : "stopped"}`,
  ];

  if (!result.reachable) {
    if (result.error) {
      lines.push(`error:               ${result.error}`);
    }
    return lines;
  }

  const counts = result.counts ?? {
    contains_directories: 0,
    contains_files: 0,
    directories: 0,
    embeddings: 0,
    files: 0,
    imports: 0,
    imports_external: 0,
    packages: 0,
  };
  const coverage = result.embeddingCoverage;

  lines.push(`files:               ${counts.files}`);
  lines.push(`directories:         ${counts.directories}`);
  lines.push(`packages:            ${counts.packages}`);
  lines.push(`imports:             ${counts.imports}`);
  lines.push(`external_imports:    ${counts.imports_external}`);
  lines.push(`embeddings:          ${counts.embeddings ?? 0}`);

  if (coverage) {
    lines.push(
      `embedding_coverage:  ${coverage.embeddedFiles}/${coverage.totalFiles} (${coverage.percent}%)`
    );
  }

  return lines;
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const json = hasFlag(args, "--json");
  const result = await getHelixStatus({ repoRoot: process.cwd() });

  if (json) {
    writeJson(result);
  } else {
    writeLines(formatText(result));
  }
}
