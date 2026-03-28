#!/usr/bin/env node
/**
 * Upsert corpus_files from a PDF path and store extracted text (TS + pdf-parse).
 *
 * Usage:
 *   DATABASE_URL=... CORPUS_ID=default pnpm ingest:pdf -- /path/to/file.pdf
 *
 * Optional: STORAGE_PATH overrides the unique storage key (defaults to absolute path).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { upsertPdfAndExtract } from "./corpusRepo.js";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

async function main() {
  const pathArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!pathArg) {
    console.error(
      "Usage: CORPUS_ID=my-corpus DATABASE_URL=... pnpm ingest:pdf -- <file.pdf>"
    );
    process.exit(1);
  }
  const databaseUrl = env("DATABASE_URL");
  if (!databaseUrl) {
    console.error("DATABASE_URL is required for ingest.");
    process.exit(1);
  }
  const corpusId = env("CORPUS_ID") ?? "default";
  const abs = resolve(pathArg);
  const storagePath = env("STORAGE_PATH") ?? abs;
  const raw = await readFile(abs);
  const base = abs.split(/[/\\]/).pop() ?? "file.pdf";

  const row = await upsertPdfAndExtract(corpusId, storagePath, base, raw);
  process.stdout.write(
    JSON.stringify(
      {
        id: row.id,
        corpusId: row.corpusId,
        storagePath: row.storagePath,
        bytesSize: row.bytesSize,
        extractedAt: row.extractedAt,
        textPreview: row.extractedText?.slice(0, 240),
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
