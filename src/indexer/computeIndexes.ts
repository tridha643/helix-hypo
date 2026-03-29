import type {
  DependencyAnalysis,
  ExternalImportEdge,
  IndexFileNode,
  IndexModel,
  ImportEdge,
  RepoStructure,
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
      isOrphan: importCount === 0 && importedByCount === 0,
      topoOrder: isDependencyTrackedSource ? (analysis.topoOrderByFileId.get(file.fileId) ?? -1) : -1,
    };
  });
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
    summary: {
      containsDirectoryCount: repoStructure.containsDirectoryEdges.length,
      containsFileCount: repoStructure.containsFileEdges.length,
      directoryCount: repoStructure.directories.length,
      externalImportEdgeCount: externalImportEdges.length,
      fileCount: files.length,
      importEdgeCount: importEdges.length,
      packageCount: packages.length,
      repoRoot: repoStructure.repoRoot,
    },
  };
}
