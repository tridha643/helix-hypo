import { type HelixDB, type HelixDBResponse } from "helix-ts";

import { loadConfig, type HelixConfig } from "../daemon/config.js";
import { getDaemonStatus, type DaemonStatus } from "../daemon/lifecycle.js";
import { buildIndexModel, indexRepository } from "../indexer/indexRepo.js";
import {
  createHelixClient,
  ensureHelixReachable,
  syncFileEmbeddingsOnly,
} from "../indexer/syncToHelix.js";
import type { HelixIndexCounts, IndexRunResult, IndexSummary } from "../indexer/types.js";

export type HelixCommandOptions = {
  apiKey?: string | null;
  helixUrl?: string | null;
  repoRoot?: string;
};

export type RunIndexOptions = HelixCommandOptions & {
  deployQueries?: boolean;
  embedFiles?: boolean;
  repoRoot: string;
};

export type HelixStatusResult = {
  counts: HelixIndexCounts | null;
  daemon: DaemonStatus;
  embeddingCoverage: {
    embeddedFiles: number;
    missingFiles: number;
    percent: number;
    totalFiles: number;
  } | null;
  error: string | null;
  helixUrl: string;
  reachable: boolean;
};

type ResolvedHelixConfig = HelixConfig & {
  repoRoot: string;
};

function resolveHelixConfig(options: HelixCommandOptions = {}): ResolvedHelixConfig {
  const repoRoot = options.repoRoot ?? process.cwd();
  const config = loadConfig(repoRoot);

  if (options.apiKey) {
    config.apiKey = options.apiKey;
  }

  if (options.helixUrl) {
    config.helixUrl = options.helixUrl;
  }

  return {
    ...config,
    repoRoot,
  };
}

function normalizeHelixResponse<T>(response: HelixDBResponse): T {
  if (response && typeof response === "object") {
    if ("error" in response && typeof response.error === "string") {
      throw new Error(response.error);
    }

    if ("data" in response) {
      return response.data as T;
    }

    if ("result" in response) {
      return response.result as T;
    }
  }

  return response as T;
}

async function queryOrThrow<T>(
  client: HelixDB,
  queryName: string,
  params: Record<string, unknown>
): Promise<T> {
  try {
    const response = await client.query(queryName, params);
    return normalizeHelixResponse<T>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Helix query "${queryName}" failed: ${message}`);
  }
}

async function requireHelix(options: HelixCommandOptions = {}): Promise<{
  client: HelixDB;
  config: ResolvedHelixConfig;
}> {
  const config = resolveHelixConfig(options);
  await ensureHelixReachable(config.helixUrl);
  return {
    client: createHelixClient(config.helixUrl, config.apiKey),
    config,
  };
}

export async function runIndex(options: RunIndexOptions): Promise<IndexRunResult> {
  const config = resolveHelixConfig(options);
  await ensureHelixReachable(config.helixUrl);
  return indexRepository({
    apiKey: config.apiKey,
    deployQueries: options.deployQueries,
    embedFiles: options.embedFiles,
    helixUrl: config.helixUrl,
    repoRoot: options.repoRoot,
    syncToDb: true,
  });
}

export async function runEmbed(options: RunIndexOptions): Promise<{
  helixCounts: HelixIndexCounts;
  summary: IndexSummary;
}> {
  const config = resolveHelixConfig(options);
  await ensureHelixReachable(config.helixUrl);

  const model = await buildIndexModel(options.repoRoot);
  const helixCounts = await syncFileEmbeddingsOnly(model, {
    apiKey: config.apiKey,
    deployQueries: options.deployQueries,
    helixUrl: config.helixUrl,
  });

  return {
    helixCounts,
    summary: model.summary,
  };
}

export async function runHelixQuery(
  queryName: string,
  params: Record<string, unknown>,
  options: HelixCommandOptions = {}
): Promise<unknown> {
  const { client } = await requireHelix(options);
  return queryOrThrow(client, queryName, params);
}

export async function runDepsQuery(
  fileId: string,
  reverse: boolean,
  options: HelixCommandOptions = {}
): Promise<unknown> {
  const queryName = reverse ? "GetFileImportedBy" : "GetFileImports";
  return runHelixQuery(queryName, { file_id: fileId }, options);
}

export async function runInfoQuery(
  fileId: string,
  options: HelixCommandOptions = {}
): Promise<unknown> {
  return runHelixQuery("GetFileByPath", { file_id: fileId }, options);
}

export async function runTreeQuery(
  dirId: string,
  options: HelixCommandOptions = {}
): Promise<unknown> {
  return runHelixQuery("ListDirectoryContents", { dir_id: dirId }, options);
}

export async function runGraphQuery(
  subcommand: string,
  params: Record<string, unknown>,
  options: HelixCommandOptions = {}
): Promise<unknown> {
  const { client } = await requireHelix(options);

  if (subcommand === "stats") {
    const [counts, entryPoints, leafDeps, orphans, cycles] = await Promise.all([
      queryOrThrow(client, "GetIndexCounts", {}),
      queryOrThrow(client, "ListEntryPoints", {}),
      queryOrThrow(client, "ListLeafDependencies", {}),
      queryOrThrow(client, "ListOrphans", {}),
      queryOrThrow(client, "ListCycles", {}),
    ]);

    const unwrap = (result: unknown): unknown[] => {
      if (Array.isArray(result)) {
        return result;
      }
      if (result && typeof result === "object" && "files" in result) {
        return (result as Record<string, unknown>).files as unknown[];
      }
      return [];
    };

    const cycleFiles = unwrap(cycles);
    const distinctCycles = new Set(
      cycleFiles
        .filter((f): f is Record<string, unknown> => f !== null && typeof f === "object")
        .map((f) => f.cycle_id)
        .filter((id) => typeof id === "string" && id !== "")
    );

    return {
      counts,
      cycles: distinctCycles.size,
      entryPoints: unwrap(entryPoints).length,
      leafDeps: unwrap(leafDeps).length,
      orphans: unwrap(orphans).length,
    };
  }

  const validQueries: Record<string, string> = {
    cycles: "ListCycles",
    "cycle-files": "GetFilesInCycle",
    "entry-points": "ListEntryPoints",
    "leaf-deps": "ListLeafDependencies",
    "most-imported": "ListMostImported",
    orphans: "ListOrphans",
    "topo-order": "GetTopologicalOrder",
  };

  const queryName = validQueries[subcommand];
  if (!queryName) {
    throw new Error(
      `Unknown graph subcommand "${subcommand}". Valid: ${Object.keys(validQueries).join(", ")}`
    );
  }

  return queryOrThrow(client, queryName, params);
}

export async function getHelixStatus(options: HelixCommandOptions = {}): Promise<HelixStatusResult> {
  const config = resolveHelixConfig(options);
  const daemon = await getDaemonStatus();

  try {
    await ensureHelixReachable(config.helixUrl);
    const client = createHelixClient(config.helixUrl, config.apiKey);
    const counts = await queryOrThrow<HelixIndexCounts>(client, "GetIndexCounts", {});
    const totalFiles = counts.files ?? 0;
    const embeddedFiles = counts.embeddings ?? 0;
    const missingFiles = Math.max(totalFiles - embeddedFiles, 0);
    const percent = totalFiles === 0 ? 0 : Math.round((embeddedFiles / totalFiles) * 100);

    return {
      counts,
      daemon,
      embeddingCoverage: {
        embeddedFiles,
        missingFiles,
        percent,
        totalFiles,
      },
      error: null,
      helixUrl: config.helixUrl,
      reachable: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      counts: null,
      daemon,
      embeddingCoverage: null,
      error: message,
      helixUrl: config.helixUrl,
      reachable: false,
    };
  }
}
