export type ImportKind = "dynamic-import" | "export" | "import" | "require";

export type IndexFileNode = {
  absolutePath: string;
  content: string;
  cycleId: string;
  depDepth: number;
  extension: string;
  fileId: string;
  importCount: number;
  importedByCount: number;
  isEntryPoint: boolean;
  isInCycle: boolean;
  isLeafDep: boolean;
  isOrphan: boolean;
  sizeBytes: number;
  topoOrder: number;
  treeDepth: number;
};

export type IndexDirectoryNode = {
  dirId: string;
  fileCount: number;
  totalFileCount: number;
  treeDepth: number;
};

export type IndexPackageNode = {
  importedByCount: number;
  packageId: string;
};

export type ContainsDirectoryEdge = {
  childDirId: string;
  parentDirId: string;
};

export type ContainsFileEdge = {
  fileId: string;
  parentDirId: string;
};

export type ExtractedImport = {
  kind: ImportKind;
  names: string[];
  specifier: string;
};

export type ImportEdge = {
  fromFileId: string;
  names: string[];
  specifier: string;
  toFileId: string;
};

export type ExternalImportEdge = {
  fromFileId: string;
  names: string[];
  packageId: string;
  specifier: string;
};

export type RepoStructure = {
  containsDirectoryEdges: ContainsDirectoryEdge[];
  containsFileEdges: ContainsFileEdge[];
  directories: IndexDirectoryNode[];
  fileIdSet: Set<string>;
  fileMap: Map<string, IndexFileNode>;
  files: IndexFileNode[];
  repoRoot: string;
};

export type DependencyAnalysis = {
  cycleIdByFileId: Map<string, string>;
  importedByCountByFileId: Map<string, number>;
  importCountByFileId: Map<string, number>;
  inCycleFileIds: Set<string>;
  topoOrderByFileId: Map<string, number>;
  depDepthByFileId: Map<string, number>;
};

export type IndexSummary = {
  containsDirectoryCount: number;
  containsFileCount: number;
  directoryCount: number;
  externalImportEdgeCount: number;
  fileCount: number;
  importEdgeCount: number;
  packageCount: number;
  repoRoot: string;
};

export type IndexModel = {
  containsDirectoryEdges: ContainsDirectoryEdge[];
  containsFileEdges: ContainsFileEdge[];
  directories: IndexDirectoryNode[];
  externalImportEdges: ExternalImportEdge[];
  files: IndexFileNode[];
  importEdges: ImportEdge[];
  packages: IndexPackageNode[];
  repoRoot: string;
  summary: IndexSummary;
};

export type HelixIndexCounts = {
  contains_directories: number;
  contains_files: number;
  directories: number;
  files: number;
  imports: number;
  imports_external: number;
  packages: number;
};

export type IndexRunResult = {
  helixCounts?: HelixIndexCounts;
  model: IndexModel;
  summary: IndexSummary;
};
