import {
  DEP_DEPTH_IN_CYCLE,
  TOPO_ORDER_UNAVAILABLE,
  type DependencyAnalysis,
  type ExternalImportEdge,
  type IndexFileNode,
  type IndexModel,
  type ImportEdge,
  type RepoStructure,
} from "./types.js";
import { SUPPORTED_SOURCE_EXTENSIONS } from "./utils.js";

function buildPackageNodes(externalImportEdges: ExternalImportEdge[]) {
  const importedByFileIds = new Map<string, Set<string>>();

  for (const edge of externalImportEdges) {
    let inboundFiles = importedByFileIds.get(edge.packageId);
    if (!inboundFiles) {
      inboundFiles = new Set<string>();
      importedByFileIds.set(edge.packageId, inboundFiles);
    }

    inboundFiles.add(edge.fromFileId);
  }

  return [...importedByFileIds.entries()]
    .map(([packageId, fileIds]) => ({
      importedByCount: fileIds.size,
      packageId,
    }))
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
}

function applyDependencyAnalysis(
  files: IndexFileNode[],
  analysis: DependencyAnalysis
): IndexFileNode[] {
  return files.map((file) => {
    const isDependencyTrackedSource = SUPPORTED_SOURCE_EXTENSIONS.has(file.extension);
    const importCount = analysis.importCountByFileId.get(file.fileId) ?? 0;
    const importedByCount = analysis.importedByCountByFileId.get(file.fileId) ?? 0;

    return {
      ...file,
      cycleId: analysis.cycleIdByFileId.get(file.fileId) ?? "",
      depDepth: analysis.depDepthByFileId.get(file.fileId) ?? 0,
      importCount,
      importedByCount,
      isEntryPoint: isDependencyTrackedSource && importedByCount === 0,
      isInCycle: analysis.inCycleFileIds.has(file.fileId),
      isLeafDep: isDependencyTrackedSource && importCount === 0,
      // "Orphan" is scoped to dependency-tracked source files so assets like
      // fixture JSON and Markdown do not appear in dependency-graph views.
      isOrphan: isDependencyTrackedSource && importCount === 0 && importedByCount === 0,
      topoOrder: isDependencyTrackedSource
        ? (analysis.topoOrderByFileId.get(file.fileId) ?? TOPO_ORDER_UNAVAILABLE)
        : TOPO_ORDER_UNAVAILABLE,
    };
  });
}

function buildSummary(
  repoStructure: RepoStructure,
  files: IndexFileNode[],
  importEdges: ImportEdge[],
  externalImportEdges: ExternalImportEdge[],
  packageCount: number
): IndexModel["summary"] {
  const cycleIds = new Set<string>();
  let entryPointCount = 0;
  let leafDependencyCount = 0;
  let orphanCount = 0;
  let maxDepDepth = 0;

  for (const file of files) {
    if (file.cycleId) {
      cycleIds.add(file.cycleId);
    }

    if (file.isEntryPoint) {
      entryPointCount += 1;
    }

    if (file.isLeafDep) {
      leafDependencyCount += 1;
    }

    if (file.isOrphan) {
      orphanCount += 1;
    }

    if (file.depDepth !== DEP_DEPTH_IN_CYCLE) {
      maxDepDepth = Math.max(maxDepDepth, file.depDepth);
    }
  }

  return {
    containsDirectoryCount: repoStructure.containsDirectoryEdges.length,
    containsFileCount: repoStructure.containsFileEdges.length,
    cycleCount: cycleIds.size,
    directoryCount: repoStructure.directories.length,
    entryPointCount,
    externalImportEdgeCount: externalImportEdges.length,
    fileCount: files.length,
    importEdgeCount: importEdges.length,
    leafDependencyCount,
    maxDepDepth,
    orphanCount,
    packageCount,
    repoRoot: repoStructure.repoRoot,
  };
}

export function computeIndexes(
  repoStructure: RepoStructure,
  importEdges: ImportEdge[],
  externalImportEdges: ExternalImportEdge[],
  analysis: DependencyAnalysis
): IndexModel {
  const files = applyDependencyAnalysis(repoStructure.files, analysis);
  const packages = buildPackageNodes(externalImportEdges);

  return {
    containsDirectoryEdges: repoStructure.containsDirectoryEdges,
    containsFileEdges: repoStructure.containsFileEdges,
    directories: repoStructure.directories,
    externalImportEdges,
    files,
    importEdges,
    packages,
    repoRoot: repoStructure.repoRoot,
    summary: buildSummary(
      repoStructure,
      files,
      importEdges,
      externalImportEdges,
      packages.length
    ),
  };
}
