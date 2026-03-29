# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Document ingestion pipeline (PDF + Markdown → PostgreSQL) with a planned extension into a HelixDB-backed git repository file-tree indexer. Runtime is **Bun**, ORM is **Prisma**, language is **TypeScript** (ES2022, strict mode).

The build spec in `docs/helix-embedder-pipeline-build-spec.md` describes the future vision: indexing codebase file trees into HelixDB graph nodes/edges so agents can navigate repos via graph queries instead of raw grep/find.

## Commands

```bash
# Install dependencies
bun install

# Prisma
bun run generate          # Generate Prisma client
bun run migrate           # Deploy migrations (production)
bun run migrate:dev       # Dev migration + open Prisma Studio
bun run studio            # Open Prisma Studio GUI

# CLI tools (all use tsx runner)
bun run extract:pdf -- ./path/to.pdf                      # Extract PDF text to JSON (no DB)
CORPUS_ID=default bun run ingest:pdf -- ./path/to.pdf     # Ingest PDF into Postgres
CORPUS_ID=default bun run ingest:md -- ./path/to.md       # Ingest Markdown into Postgres
```

No test runner is configured yet. No linter or formatter is configured.

## Architecture

**Current (implemented):** Three CLI entry points in `src/` that ingest documents into a single Prisma `CorpusFile` table.

- `src/corpusRepo.ts` — Core upsert logic (PDF extraction, markdown decoding, SHA-256 hashing, DB persist). All three CLIs funnel through here.
- `src/prisma.ts` — Singleton Prisma client with environment-aware logging.
- `src/constants.ts` — `IngestStatus` and `SourceType` string enums used across the codebase.
- `src/extractPdf.ts` — Wraps `pdf-parse` (pure JS, no Python dependency).
- `src/decodeMarkdown.ts` — UTF-8 decoder with BOM stripping.

**Planned (not yet implemented):** HelixDB graph indexer defined in `db/schema.hx` and `db/queries.hx` (currently stubs). Pending work: git tree walker, import extractor/resolver, DAG analysis, HelixDB sync orchestration.

## Key Configuration

- **Database:** PostgreSQL via `DATABASE_URL` env var. Schema in `prisma/schema.prisma`.
- **HelixDB:** Config in `helix.toml`, schemas in `db/`. Dev server runs on port 6970.
- **Env vars:** Copy `.env.example` → `.env`. Required: `DATABASE_URL`. Optional: `CORPUS_ID`, `STORAGE_PATH`, `OPENAI_API_KEY`.
- **Dedup:** `CorpusFile` has a unique constraint on `(corpusId, storagePath)` and a composite index on `(corpusId, contentSha256)`.
