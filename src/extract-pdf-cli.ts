#!/usr/bin/env node
/**
 * Extract text from a PDF file and print to stdout.
 * Usage: pnpm extract:pdf -- path/to/file.pdf
 *
 * With DATABASE_URL set, you can extend this to upsert corpus_files rows (see prisma schema).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { extractTextFromPdfBuffer } from "./extractPdf.js";

async function main() {
  const pathArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!pathArg) {
    console.error("Usage: pnpm extract:pdf -- <file.pdf>");
    process.exit(1);
  }
  const buf = await readFile(resolve(pathArg));
  const { text, nPages } = await extractTextFromPdfBuffer(buf);
  process.stdout.write(
    JSON.stringify({ nPages, textLength: text.length, text }, null, 2) + "\n"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
