import path from "node:path";

import { RESOLUTION_EXTENSIONS, getParentDirId, normalizeFileId } from "./utils.js";

type ResolveInternalImportArgs = {
  fileIdSet: Set<string>;
  importerFileId: string;
  specifier: string;
};

export function getExternalPackageId(specifier: string): string | null {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) {
    return null;
  }

  const parts = specifier.split("/");

  if (specifier.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }

  return parts[0] ?? null;
}

function buildCandidateFileIds(basePath: string): string[] {
  const normalizedBase = normalizeFileId(basePath);
  const candidates = new Set<string>();

  candidates.add(normalizedBase);

  const hasKnownExtension = RESOLUTION_EXTENSIONS.some((extension) => normalizedBase.endsWith(extension));
  if (hasKnownExtension) {
    const withoutExtension = normalizedBase.replace(/\.[^.]+$/, "");
    candidates.add(withoutExtension);

    for (const extension of RESOLUTION_EXTENSIONS) {
      candidates.add(`${withoutExtension}${extension}`);
    }
  } else {
    for (const extension of RESOLUTION_EXTENSIONS) {
      candidates.add(`${normalizedBase}${extension}`);
    }
  }

  const directoryBase = normalizedBase.endsWith("/") ? normalizedBase.slice(0, -1) : normalizedBase;
  for (const extension of RESOLUTION_EXTENSIONS) {
    candidates.add(`${directoryBase}/index${extension}`);
  }

  return [...candidates];
}

export function resolveInternalImport({
  fileIdSet,
  importerFileId,
  specifier,
}: ResolveInternalImportArgs): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return null;
  }

  const importerDirectory = getParentDirId(importerFileId);
  const resolvedBase = normalizeFileId(path.posix.join(importerDirectory, specifier));

  if (!resolvedBase || resolvedBase.startsWith("../")) {
    return null;
  }

  for (const candidate of buildCandidateFileIds(resolvedBase)) {
    if (candidate && !candidate.startsWith("../") && fileIdSet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}
