import path from "node:path";

import { hasFlag, getOption, getPositional } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { runEmbed } from "../../helixOps/index.js";

const HELP = `Usage: helix embed [path] [options]

Recompute file embeddings without re-running the structural index. Uses
TensorFlow.js Universal Sentence Encoder to embed each file's content into
a vector stored in HelixDB. Clears existing embeddings first.

Use this when embeddings are missing or stale but the graph is up to date.
If the graph is also stale, use 'helix index' instead (it includes embedding).

Requires: helix index must have been run at least once (graph must exist)

Arguments:
  path    Repository path (default: current directory)

Options:
  --api-key <key>    HelixDB API key (overrides config/env)
  --helix-url <url>  HelixDB URL (default: http://127.0.0.1:6969)
  --no-deploy        Skip deploying schema/queries to HelixDB
  --json             Output as JSON

Examples:
  helix embed                          # Re-embed current repo
  helix embed /path/to/repo            # Re-embed a different repo
  helix embed . --json                 # Machine-readable output`;

type EmbedArgs = {
  apiKey: string | null;
  deploy: boolean;
  helixUrl: string | null;
  json: boolean;
  repoRoot: string;
};

export function parseArgs(args: string[]): EmbedArgs {
  const json = hasFlag(args, "--json");
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
  };
}

type EmbedSummary = {
  helixCounts?: Record<string, unknown>;
  summary: Record<string, unknown>;
};

function formatText(result: EmbedSummary): string[] {
  const { helixCounts, summary } = result;
  const lines: string[] = [`Embedded ${summary.repoRoot ?? "repository"}`];
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

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const parsed = parseArgs(args);
  const result = (await runEmbed({
    apiKey: parsed.apiKey,
    deployQueries: parsed.deploy,
    helixUrl: parsed.helixUrl,
    repoRoot: parsed.repoRoot,
  })) as EmbedSummary;

  if (parsed.json) {
    writeJson(result);
  } else {
    writeLines(formatText(result));
  }
}
