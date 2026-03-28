#!/usr/bin/env node
/**
 * Upsert corpus_files from a markdown path and store decoded UTF-8 text.
 *
 * Usage:
 *   DATABASE_URL=... CORPUS_ID=default pnpm ingest:md -- /path/to/file.md
 *
 * Optional: STORAGE_PATH overrides the unique storage key (defaults to absolute path).
 */
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { upsertMarkdown } from "./corpusRepo.js";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

async function main() {
  const pathArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!pathArg) {
    console.error(
      "Usage: CORPUS_ID=my-corpus DATABASE_URL=... pnpm ingest:md -- <file.md>"
    );
    process.exit(1);
  }

  const databaseUrl = env("DATABASE_URL");
  if (!databaseUrl) {
    console.error("DATABASE_URL is required for ingest.");
    process.exit(1);
  }

  const abs = resolve(pathArg);
  if (extname(abs).toLowerCase() !== ".md") {
    console.error(
      "Usage: CORPUS_ID=my-corpus DATABASE_URL=... pnpm ingest:md -- <file.md>"
    );
    process.exit(1);
  }

  const corpusId = env("CORPUS_ID") ?? "default";
  const storagePath = env("STORAGE_PATH") ?? abs;
  const raw = await readFile(abs);

  const row = await upsertMarkdown(corpusId, storagePath, basename(abs), raw);
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
