import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ContainsDirectoryEdge,
  ContainsFileEdge,
  IndexDirectoryNode,
  IndexFileNode,
  RepoStructure,
} from "./types.js";
import { TOPO_ORDER_UNAVAILABLE } from "./types.js";
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
    topoOrder: TOPO_ORDER_UNAVAILABLE,
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

export function assertStructuralTreeValid(input: {
  containsDirectoryEdges: ContainsDirectoryEdge[];
  containsFileEdges: ContainsFileEdge[];
  directories: IndexDirectoryNode[];
  files: Pick<IndexFileNode, "fileId">[];
}): void {
  const directoryIds = new Set<string>();
  const fileIds = new Set<string>();

  for (const directory of input.directories) {
    if (directoryIds.has(directory.dirId)) {
      throw new Error(`Invalid structural tree: duplicate directory node "${directory.dirId}"`);
    }

    directoryIds.add(directory.dirId);
  }

  if (!directoryIds.has("")) {
    throw new Error('Invalid structural tree: missing root directory ""');
  }

  for (const file of input.files) {
    if (fileIds.has(file.fileId)) {
      throw new Error(`Invalid structural tree: duplicate file node "${file.fileId}"`);
    }

    fileIds.add(file.fileId);
  }

  const parentByFileId = new Map<string, string>();
  const seenFileContainment = new Set<string>();

  for (const edge of input.containsFileEdges) {
    const key = `${edge.parentDirId}\u0000${edge.fileId}`;
    if (seenFileContainment.has(key)) {
      throw new Error(
        `Invalid structural tree: duplicate ContainsFile edge "${edge.parentDirId}" -> "${edge.fileId}"`
      );
    }

    seenFileContainment.add(key);

    if (!directoryIds.has(edge.parentDirId)) {
      throw new Error(
        `Invalid structural tree: missing parent directory "${edge.parentDirId}" for file "${edge.fileId}"`
      );
    }

    if (!fileIds.has(edge.fileId)) {
      throw new Error(`Invalid structural tree: missing file node "${edge.fileId}"`);
    }

    const existingParent = parentByFileId.get(edge.fileId);
    if (existingParent !== undefined) {
      throw new Error(
        `Invalid structural tree: file "${edge.fileId}" has multiple parent directories`
      );
    }

    parentByFileId.set(edge.fileId, edge.parentDirId);
  }

  for (const fileId of fileIds) {
    const parentDirId = parentByFileId.get(fileId);
    if (parentDirId === undefined) {
      throw new Error(`Invalid structural tree: file "${fileId}" is missing a parent directory`);
    }

    const expectedParent = getParentDirId(fileId);
    if (parentDirId !== expectedParent) {
      throw new Error(
        `Invalid structural tree: file "${fileId}" is contained by "${parentDirId}" instead of "${expectedParent}"`
      );
    }
  }

  const parentByDirectoryId = new Map<string, string>();
  const childrenByDirectoryId = new Map<string, string[]>();
  const seenDirectoryContainment = new Set<string>();

  for (const edge of input.containsDirectoryEdges) {
    const key = `${edge.parentDirId}\u0000${edge.childDirId}`;
    if (seenDirectoryContainment.has(key)) {
      throw new Error(
        `Invalid structural tree: duplicate ContainsDirectory edge "${edge.parentDirId}" -> "${edge.childDirId}"`
      );
    }

    seenDirectoryContainment.add(key);

    if (edge.childDirId === "") {
      throw new Error('Invalid structural tree: root directory "" cannot have a parent');
    }

    if (!directoryIds.has(edge.parentDirId)) {
      throw new Error(
        `Invalid structural tree: missing parent directory "${edge.parentDirId}" for directory "${edge.childDirId}"`
      );
    }

    if (!directoryIds.has(edge.childDirId)) {
      throw new Error(`Invalid structural tree: missing child directory "${edge.childDirId}"`);
    }

    const existingParent = parentByDirectoryId.get(edge.childDirId);
    if (existingParent !== undefined) {
      throw new Error(
        `Invalid structural tree: directory "${edge.childDirId}" has multiple parent directories`
      );
    }

    parentByDirectoryId.set(edge.childDirId, edge.parentDirId);
    const children = childrenByDirectoryId.get(edge.parentDirId) ?? [];
    children.push(edge.childDirId);
    childrenByDirectoryId.set(edge.parentDirId, children);
  }

  for (const dirId of directoryIds) {
    if (dirId === "") {
      continue;
    }

    const parentDirId = parentByDirectoryId.get(dirId);
    if (parentDirId === undefined) {
      throw new Error(`Invalid structural tree: directory "${dirId}" is missing a parent`);
    }

    const expectedParent = getParentDirId(dirId);
    if (parentDirId !== expectedParent) {
      throw new Error(
        `Invalid structural tree: directory "${dirId}" is contained by "${parentDirId}" instead of "${expectedParent}"`
      );
    }
  }

  const visited = new Set<string>();
  const stack = [""];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    const children = [...(childrenByDirectoryId.get(current) ?? [])].sort((left, right) =>
      left.localeCompare(right)
    );
    stack.push(...children);
  }

  if (visited.size !== directoryIds.size) {
    const unreachableDirectoryIds = [...directoryIds]
      .filter((dirId) => !visited.has(dirId))
      .sort((left, right) => left.localeCompare(right));
    throw new Error(
      `Invalid structural tree: directories are disconnected from root: ${unreachableDirectoryIds.join(", ")}`
    );
  }
}

export async function walkGitTree(repoRoot: string): Promise<RepoStructure> {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const fileIds = await listIndexableFiles(resolvedRepoRoot);

  const files = await Promise.all(fileIds.map((fileId) => buildFileNode(resolvedRepoRoot, fileId)));
  const fileMap = new Map(files.map((file) => [file.fileId, file] as const));
  const fileIdSet = new Set(fileIds);
  const { directories, containsDirectoryEdges, containsFileEdges } = buildDirectoryNodes(fileIds);
  assertStructuralTreeValid({
    containsDirectoryEdges,
    containsFileEdges,
    directories,
    files,
  });

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
