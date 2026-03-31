import { HelixDB, type HelixDBResponse } from "helix-ts";

import type { HelixIndexCounts, IndexModel } from "./types.js";
import {
  HELIX_DEFAULT_URL,
  chunkArray,
  getWorkspaceRootFromImportMeta,
  runCommand,
} from "./utils.js";

type SyncToHelixOptions = {
  apiKey?: string | null;
  batchSize?: number;
  deployQueries?: boolean;
  /** Default true: run local TF.js USE embeddings into V::FileEmbedding after graph sync. */
  embedFiles?: boolean;
  helixUrl?: string;
  workspaceRoot?: string;
};

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
  endpoint: string,
  payload: Record<string, unknown>
): Promise<T> {
  try {
    const response = await client.query(endpoint, payload);
    return normalizeHelixResponse<T>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Helix query "${endpoint}" failed: ${message}`);
  }
}

async function runBatched<T>(
  values: T[],
  batchSize: number,
  worker: (value: T) => Promise<void>
): Promise<void> {
  for (const batch of chunkArray(values, batchSize)) {
    await Promise.all(batch.map((value) => worker(value)));
  }
}

async function embedFilesToHelix(client: HelixDB, model: import("./types.js").IndexModel): Promise<void> {
  const { helixEmbed, loadLocalEmbeddingModel } = await import("./localEmbedder.js");
  await loadLocalEmbeddingModel();
  for (const file of model.files) {
    const text = file.content ?? "";
    if (!text.trim()) {
      continue;
    }
    const vector = await helixEmbed(text);
    await queryOrThrow(client, "CreateFileEmbedding", {
      file_id: file.fileId,
      vector,
    });
  }
}

export function createHelixClient(
  helixUrl: string = process.env.HELIX_URL ?? HELIX_DEFAULT_URL,
  apiKey: string | null = process.env.HELIX_API_KEY ?? null
): HelixDB {
  return new HelixDB(helixUrl, apiKey);
}

export async function ensureHelixReachable(helixUrl: string): Promise<void> {
  try {
    await fetch(helixUrl, {
      method: "GET",
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot connect to HelixDB at ${helixUrl}: ${message}\n` +
      `HelixDB must be running before using helix CLI commands.`
    );
  }
}

export async function deployHelixProject(workspaceRoot: string): Promise<void> {
  try {
    await runCommand("helix", ["push", "dev"], { cwd: workspaceRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to deploy Helix schema and queries from ${workspaceRoot}: ${message}`);
  }
}

export async function syncToHelix(
  model: IndexModel,
  options: SyncToHelixOptions = {}
): Promise<HelixIndexCounts> {
  const helixUrl = options.helixUrl ?? process.env.HELIX_URL ?? HELIX_DEFAULT_URL;
  const apiKey = options.apiKey ?? process.env.HELIX_API_KEY ?? null;
  const batchSize = options.batchSize ?? 25;
  const workspaceRoot = options.workspaceRoot ?? getWorkspaceRootFromImportMeta(import.meta.url);

  await ensureHelixReachable(helixUrl);

  if (options.deployQueries !== false) {
    await deployHelixProject(workspaceRoot);
  }

  const client = createHelixClient(helixUrl, apiKey);

  await queryOrThrow<string>(client, "ClearRepoGraph", {});

  await runBatched(model.directories, batchSize, async (directory) => {
    await queryOrThrow(client, "CreateDirectory", {
      dir_id: directory.dirId,
      file_count: directory.fileCount,
      total_file_count: directory.totalFileCount,
      tree_depth: directory.treeDepth,
    });
  });

  await runBatched(model.files, batchSize, async (file) => {
    await queryOrThrow(client, "CreateFile", {
      content: file.content,
      cycle_id: file.cycleId,
      dep_depth: file.depDepth,
      extension: file.extension,
      file_id: file.fileId,
      import_count: file.importCount,
      imported_by_count: file.importedByCount,
      is_entry_point: file.isEntryPoint,
      is_in_cycle: file.isInCycle,
      is_leaf_dep: file.isLeafDep,
      is_orphan: file.isOrphan,
      size_bytes: file.sizeBytes,
      topo_order: file.topoOrder,
      tree_depth: file.treeDepth,
    });
  });

  await runBatched(model.packages, batchSize, async (pkg) => {
    await queryOrThrow(client, "CreatePackage", {
      imported_by_count: pkg.importedByCount,
      package_id: pkg.packageId,
    });
  });

  await runBatched(model.containsDirectoryEdges, batchSize, async (edge) => {
    await queryOrThrow(client, "CreateContainsDirectory", {
      child_dir_id: edge.childDirId,
      parent_dir_id: edge.parentDirId,
    });
  });

  await runBatched(model.containsFileEdges, batchSize, async (edge) => {
    await queryOrThrow(client, "CreateContainsFile", {
      dir_id: edge.parentDirId,
      file_id: edge.fileId,
    });
  });

  await runBatched(model.importEdges, batchSize, async (edge) => {
    await queryOrThrow(client, "CreateImport", {
      from_file_id: edge.fromFileId,
      names: JSON.stringify(edge.names),
      specifier: edge.specifier,
      to_file_id: edge.toFileId,
    });
  });

  await runBatched(model.externalImportEdges, batchSize, async (edge) => {
    await queryOrThrow(client, "CreateImportExternal", {
      file_id: edge.fromFileId,
      names: JSON.stringify(edge.names),
      package_id: edge.packageId,
      specifier: edge.specifier,
    });
  });

  if (options.embedFiles !== false) {
    await embedFilesToHelix(client, model);
  }

  return queryOrThrow<HelixIndexCounts>(client, "GetIndexCounts", {});
}

/**
 * Refresh only V::FileEmbedding vectors (local USE → HelixDB). Clears existing embeddings first.
 */
export async function syncFileEmbeddingsOnly(
  model: IndexModel,
  options: SyncToHelixOptions = {}
): Promise<HelixIndexCounts> {
  const helixUrl = options.helixUrl ?? process.env.HELIX_URL ?? HELIX_DEFAULT_URL;
  const apiKey = options.apiKey ?? process.env.HELIX_API_KEY ?? null;
  const workspaceRoot = options.workspaceRoot ?? getWorkspaceRootFromImportMeta(import.meta.url);

  await ensureHelixReachable(helixUrl);

  if (options.deployQueries !== false) {
    await deployHelixProject(workspaceRoot);
  }

  const client = createHelixClient(helixUrl, apiKey);
  try {
    await queryOrThrow<string>(client, "ClearFileEmbeddings", {});
  } catch (clearError) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await queryOrThrow<string>(client, "ClearFileEmbeddings", {});
    } catch (retryError) {
      const msg = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(
        `Failed to clear existing embeddings: ${msg}. ` +
        `This can happen if HelixDB's vector index is in an inconsistent state. ` +
        `Try running 'helix index <path>' instead to do a full re-index.`
      );
    }
  }
  await embedFilesToHelix(client, model);
  return queryOrThrow<HelixIndexCounts>(client, "GetIndexCounts", {});
}
