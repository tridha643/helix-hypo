import { createHash } from "node:crypto";

import type { CorpusFile } from "@prisma/client";

import { IngestStatus, SourceType } from "./constants.js";
import { decodeMarkdownBuffer } from "./decodeMarkdown.js";
import { extractTextFromPdfBuffer } from "./extractPdf.js";
import { prisma } from "./prisma.js";

const PDF_EXTRACTOR_LABEL = "pdf-parse@1.1.1";
const MARKDOWN_EXTRACTOR_LABEL = "markdown@utf-8";

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

type UpsertRawCorpusFileArgs = {
  corpusId: string;
  storagePath: string;
  originalFilename: string;
  raw: Buffer;
  sourceType: string;
  extractedText: string;
  textExtractor: string;
};

async function upsertRawCorpusFile({
  corpusId,
  storagePath,
  originalFilename,
  raw,
  sourceType,
  extractedText,
  textExtractor,
}: UpsertRawCorpusFileArgs): Promise<CorpusFile> {
  const now = new Date();
  const bytesSize = raw.length;
  const contentSha256 = sha256Hex(raw);

  return prisma.corpusFile.upsert({
    where: {
      corpusId_storagePath: { corpusId, storagePath },
    },
    create: {
      corpusId,
      storagePath,
      originalFilename,
      rawContent: raw,
      bytesSize,
      contentSha256,
      sourceType,
      ingestStatus: IngestStatus.pending,
      extractedText,
      textExtractor,
      extractedAt: now,
    },
    update: {
      originalFilename,
      rawContent: raw,
      bytesSize,
      contentSha256,
      sourceType,
      ingestStatus: IngestStatus.pending,
      extractedText,
      textExtractor,
      extractedAt: now,
      lastError: null,
    },
  });
}

/**
 * Upsert a PDF blob and persist extracted plain text + metadata.
 */
export async function upsertPdfAndExtract(
  corpusId: string,
  storagePath: string,
  originalFilename: string,
  raw: Buffer
): Promise<CorpusFile> {
  const { text } = await extractTextFromPdfBuffer(raw);

  return upsertRawCorpusFile({
    corpusId,
    storagePath,
    originalFilename,
    raw,
    sourceType: SourceType.pdf,
    extractedText: text,
    textExtractor: PDF_EXTRACTOR_LABEL,
  });
}

/**
 * Upsert a markdown blob and persist decoded UTF-8 text + metadata.
 */
export async function upsertMarkdown(
  corpusId: string,
  storagePath: string,
  originalFilename: string,
  raw: Buffer
): Promise<CorpusFile> {
  return upsertRawCorpusFile({
    corpusId,
    storagePath,
    originalFilename,
    raw,
    sourceType: SourceType.markdown,
    extractedText: decodeMarkdownBuffer(raw),
    textExtractor: MARKDOWN_EXTRACTOR_LABEL,
  });
}
