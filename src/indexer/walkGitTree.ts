import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ContainsDirectoryEdge,
  ContainsFileEdge,
  IndexDirectoryNode,
  IndexFileNode,
  RepoStructure,
} from "./types.js";
import {
  MAX_INDEXED_CONTENT_BYTES,
  getDirectoryPrefixes,
  getParentDirId,
  getTreeDepth,
  normalizeFileId,
  runCommand,
} from "./utils.js";

const utf8Decoder = new TextDecoder("utf-8");

async function listIndexableFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await runCommand(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: repoRoot }
    );

    const fileIds = [...new Set(
      stdout
        .split("\u0000")
        .map((entry) => normalizeFileId(entry))
        .filter(Boolean)
    )];

    const stats = await Promise.all(
      fileIds.map(async (fileId) => ({
        fileId,
        stat: await lstat(path.join(repoRoot, fileId)),
      }))
    );

    return stats
      .filter(({ stat }) => stat.isFile())
      .map(({ fileId }) => fileId)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to run "git ls-files" in ${repoRoot}: ${message}`);
  }
}

async function buildFileNode(repoRoot: string, fileId: string): Promise<IndexFileNode> {
  const absolutePath = path.join(repoRoot, fileId);
  const raw = await readFile(absolutePath);
  const indexedContent =
    raw.byteLength > MAX_INDEXED_CONTENT_BYTES ? raw.subarray(0, MAX_INDEXED_CONTENT_BYTES) : raw;

  return {
    absolutePath,
    content: utf8Decoder.decode(indexedContent),
    cycleId: "",
    depDepth: 0,
    extension: path.posix.extname(fileId),
    fileId,
    importCount: 0,
    importedByCount: 0,
    isEntryPoint: false,
    isInCycle: false,
    isLeafDep: false,
    isOrphan: false,
    sizeBytes: raw.byteLength,
    topoOrder: -1,
    treeDepth: getTreeDepth(fileId),
  };
}

function buildDirectoryNodes(fileIds: string[]): {
  containsDirectoryEdges: ContainsDirectoryEdge[];
  containsFileEdges: ContainsFileEdge[];
  directories: IndexDirectoryNode[];
} {
  const directoryIds = new Set<string>([""]);
  const directFileCounts = new Map<string, number>();
  const totalFileCounts = new Map<string, number>();

  for (const fileId of fileIds) {
    const parentDirId = getParentDirId(fileId);
    directFileCounts.set(parentDirId, (directFileCounts.get(parentDirId) ?? 0) + 1);

    for (const dirId of getDirectoryPrefixes(fileId)) {
      directoryIds.add(dirId);
      totalFileCounts.set(dirId, (totalFileCounts.get(dirId) ?? 0) + 1);
    }
  }

  const sortedDirectoryIds = [...directoryIds].sort((left, right) => {
    const depthDelta = getTreeDepth(left) - getTreeDepth(right);
    return depthDelta === 0 ? left.localeCompare(right) : depthDelta;
  });

  const directories = sortedDirectoryIds.map<IndexDirectoryNode>((dirId) => ({
    dirId,
    fileCount: directFileCounts.get(dirId) ?? 0,
    totalFileCount: totalFileCounts.get(dirId) ?? 0,
    treeDepth: getTreeDepth(dirId),
  }));

  const containsDirectoryEdges = sortedDirectoryIds
    .filter((dirId) => dirId !== "")
    .map<ContainsDirectoryEdge>((childDirId) => ({
      childDirId,
      parentDirId: getParentDirId(childDirId),
    }));

  const containsFileEdges = fileIds.map<ContainsFileEdge>((fileId) => ({
    fileId,
    parentDirId: getParentDirId(fileId),
  }));

  return {
    containsDirectoryEdges,
    containsFileEdges,
    directories,
  };
}

export async function walkGitTree(repoRoot: string): Promise<RepoStructure> {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const fileIds = await listIndexableFiles(resolvedRepoRoot);

  const files = await Promise.all(fileIds.map((fileId) => buildFileNode(resolvedRepoRoot, fileId)));
  const fileMap = new Map(files.map((file) => [file.fileId, file] as const));
  const fileIdSet = new Set(fileIds);
  const { directories, containsDirectoryEdges, containsFileEdges } = buildDirectoryNodes(fileIds);

  return {
    containsDirectoryEdges,
    containsFileEdges,
    directories,
    fileIdSet,
    fileMap,
    files,
    repoRoot: resolvedRepoRoot,
  };
}
