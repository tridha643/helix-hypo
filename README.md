# helix-hypo-ws-get-db-setup

Minimal Bun-based workspace for document ingestion into Postgres via Prisma.

## Setup

```bash
bun install
bun run generate
bun run migrate
```

Copy `.env.example` to `.env` and set `DATABASE_URL` first.

## Commands

```bash
bun run extract:pdf -- ./path/to.pdf
CORPUS_ID=default bun run ingest:pdf -- ./path/to.pdf
CORPUS_ID=default bun run ingest:md -- ./path/to.md
```

## What it does

- stores raw file bytes in Postgres
- generates a SHA-256 checksum per file
- extracts PDF text with `pdf-parse`
- stores decoded markdown text as UTF-8
- persists extraction metadata through Prisma
