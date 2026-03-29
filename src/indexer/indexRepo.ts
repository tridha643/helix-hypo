import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeIndexes } from "./computeIndexes.js";
import { analyzeDependencyGraph } from "./dagAnalysis.js";
import { extractImports } from "./extractImports.js";
import { getExternalPackageId, resolveInternalImport } from "./resolveImport.js";
import { syncToHelix } from "./syncToHelix.js";
import type { ExternalImportEdge, ImportEdge, IndexModel, IndexRunResult, RepoStructure } from "./types.js";
import { SUPPORTED_SOURCE_EXTENSIONS } from "./utils.js";
import { walkGitTree } from "./walkGitTree.js";

type IndexRepositoryOptions = {
  apiKey?: string | null;
  deployQueries?: boolean;
  helixUrl?: string;
  repoRoot: string;
  syncToDb?: boolean;
};

type ParsedCliArgs = {
  apiKey?: string | null;
  deployQueries: boolean;
  helixUrl?: string;
  json: boolean;
  repoRoot: string;
  syncToDb: boolean;
};

function sortImportEdges<T extends ImportEdge | ExternalImportEdge>(edges: T[]): T[] {
  return edges.sort((left, right) => {
    const bySource = left.fromFileId.localeCompare(right.fromFileId);
    if (bySource !== 0) {
      return bySource;
    }

    const leftTarget = "toFileId" in left ? left.toFileId : left.packageId;
    const rightTarget = "toFileId" in right ? right.toFileId : right.packageId;
    const byTarget = leftTarget.localeCompare(rightTarget);
    if (byTarget !== 0) {
      return byTarget;
    }

    return left.specifier.localeCompare(right.specifier);
  });
}

async function buildDependencyEdges(repoStructure: RepoStructure): Promise<{
  externalImportEdges: ExternalImportEdge[];
  importEdges: ImportEdge[];
}> {
  const importEdges: ImportEdge[] = [];
  const externalImportEdges: ExternalImportEdge[] = [];
  const seenInternal = new Set<string>();
  const seenExternal = new Set<string>();

  for (const file of repoStructure.files) {
    if (!SUPPORTED_SOURCE_EXTENSIONS.has(file.extension)) {
      continue;
    }

    const fullContent = await readFile(file.absolutePath, "utf8");
    const imports = extractImports(file.fileId, fullContent);

    for (const extractedImport of imports) {
      const internalTarget = resolveInternalImport({
        fileIdSet: repoStructure.fileIdSet,
        importerFileId: file.fileId,
        specifier: extractedImport.specifier,
      });

      if (internalTarget) {
        const key = JSON.stringify([
          file.fileId,
          internalTarget,
          extractedImport.specifier,
          extractedImport.names,
        ]);
        if (!seenInternal.has(key)) {
          seenInternal.add(key);
          importEdges.push({
            fromFileId: file.fileId,
            names: extractedImport.names,
            specifier: extractedImport.specifier,
            toFileId: internalTarget,
          });
        }
        continue;
      }

      const packageId = getExternalPackageId(extractedImport.specifier);
      if (!packageId) {
        continue;
      }

      const key = JSON.stringify([file.fileId, packageId, extractedImport.specifier, extractedImport.names]);
      if (!seenExternal.has(key)) {
        seenExternal.add(key);
        externalImportEdges.push({
          fromFileId: file.fileId,
          names: extractedImport.names,
          packageId,
          specifier: extractedImport.specifier,
        });
      }
    }
  }

  return {
    externalImportEdges: sortImportEdges(externalImportEdges),
    importEdges: sortImportEdges(importEdges),
  };
}

export async function buildIndexModel(repoRoot: string): Promise<IndexModel> {
  const repoStructure = await walkGitTree(repoRoot);
  const { importEdges, externalImportEdges } = await buildDependencyEdges(repoStructure);
  const dependencyAnalysis = analyzeDependencyGraph(
    repoStructure.files.map((file) => file.fileId),
    importEdges
  );

  return computeIndexes(repoStructure, importEdges, externalImportEdges, dependencyAnalysis);
}

export async function indexRepository(
  options: IndexRepositoryOptions
): Promise<IndexRunResult> {
  const model = await buildIndexModel(options.repoRoot);
  const helixCounts =
    options.syncToDb === false
      ? undefined
      : await syncToHelix(model, {
          apiKey: options.apiKey,
          deployQueries: options.deployQueries,
          helixUrl: options.helixUrl,
        });

  return {
    helixCounts,
    model,
    summary: model.summary,
  };
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    deployQueries: true,
    json: false,
    repoRoot: process.cwd(),
    syncToDb: true,
  };

  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--no-deploy") {
      parsed.deployQueries = false;
      continue;
    }

    if (arg === "--no-sync") {
      parsed.syncToDb = false;
      continue;
    }

    if (arg === "--helix-url") {
      parsed.helixUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--api-key") {
      parsed.apiKey = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  if (positional[0]) {
    parsed.repoRoot = path.resolve(positional[0]);
  }

  return parsed;
}

function printHumanSummary(result: IndexRunResult): void {
  const { summary, helixCounts } = result;
  const lines = [
    `Indexed ${summary.repoRoot}`,
    `files=${summary.fileCount} directories=${summary.directoryCount} packages=${summary.packageCount}`,
    `contains(file=${summary.containsFileCount}, dir=${summary.containsDirectoryCount}) imports=${summary.importEdgeCount} external_imports=${summary.externalImportEdgeCount}`,
  ];

  if (helixCounts) {
    lines.push(
      `helix(files=${helixCounts.files}, directories=${helixCounts.directories}, packages=${helixCounts.packages}, imports=${helixCounts.imports}, external_imports=${helixCounts.imports_external})`
    );
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const result = await indexRepository({
    apiKey: args.apiKey,
    deployQueries: args.deployQueries,
    helixUrl: args.helixUrl,
    repoRoot: args.repoRoot,
    syncToDb: args.syncToDb,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  printHumanSummary(result);
}

const isCliEntryPoint =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCliEntryPoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
