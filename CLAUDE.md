# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Two-part TypeScript pipeline running on **Bun** with **Prisma** ORM (strict mode, ES2022, NodeNext modules):

1. **Document ingestion** — CLI tools that ingest PDFs and Markdown into PostgreSQL (`CorpusFile` table).
2. **Git repo indexer** — Walks a git repo's file tree, extracts JS/TS import edges, runs DAG analysis (topological sort, cycle detection, dependency depth), and syncs the resulting graph into **HelixDB**. The HelixDB graph (nodes: File, Directory, Package; edges: Imports, ImportsExternal, ContainsFile, ContainsDirectory) lets agents navigate repos via graph queries instead of grep/find.

The build spec in `docs/helix-embedder-pipeline-build-spec.md` describes the long-term vision (FUSE-mounted graph filesystem for agent navigation).

## Commands

```bash
bun install                # Install dependencies
bun run generate           # Regenerate Prisma client (after schema.prisma changes)
bun run migrate            # Deploy migrations (production)
bun run migrate:dev        # Dev migration + Prisma Studio
bun run studio             # Open Prisma Studio GUI
bun run typecheck          # tsc --noEmit

# Indexer
bun run index -- <repo-path>                              # Index a git repo into HelixDB
bun run index -- <repo-path> --no-sync                    # Build index model without HelixDB sync
bun run index -- <repo-path> --json                       # Output full model as JSON
bun run verify                                            # Unit tests + Helix reachability + e2e verification
bun run test:integration                                  # Integration-only indexer verification

# Document ingestion CLIs
bun run extract:pdf -- ./path/to.pdf                      # Extract PDF text to JSON (no DB)
CORPUS_ID=default bun run ingest:pdf -- ./path/to.pdf     # Ingest PDF into Postgres
CORPUS_ID=default bun run ingest:md -- ./path/to.md       # Ingest Markdown into Postgres
```

### Testing

Test runner: Node built-in (`node:test` + `node:assert/strict`), invoked via `tsx`.

```bash
bun run test                                              # Run all unit tests

# Single test file
node --import tsx --test test/indexer/dagAnalysis.test.ts

# Single test case by name
node --import tsx --test --test-name-pattern "buildIndexModel indexes" test/indexer/indexRepo.test.ts
```

Run `bun run verify` when touching Helix sync or fixture-driven integration behavior (requires HelixDB running on port 6970).

## Architecture

### Indexer pipeline (`src/indexer/`)

The indexer is a four-stage pipeline orchestrated by `indexRepo.ts`:

1. **`walkGitTree.ts`** — Runs `git ls-files` to enumerate tracked+untracked files, reads content, builds `RepoStructure` (files, directories, containment edges). File IDs are posix-normalized relative paths.
2. **`extractImports.ts`** + **`resolveImport.ts`** — Regex-based import/require/export extraction from `.js/.jsx/.ts/.tsx` files. Internal imports are resolved against the file ID set with extension probing (`.ts`, `.tsx`, `.js`, `.jsx`, `/index.*`). External imports produce package-level edges.
3. **`dagAnalysis.ts`** — Tarjan's SCC for cycle detection, topological ordering, dependency depth computation. Produces `DependencyAnalysis` with per-file metrics (entry point, leaf dep, orphan, cycle membership).
4. **`computeIndexes.ts`** — Merges `RepoStructure` + edges + `DependencyAnalysis` into a single `IndexModel`.
5. **`syncToHelix.ts`** — Deploys schema via `helix push dev`, then batch-upserts nodes/edges into HelixDB via `helix-ts` client.

Key types are in `types.ts`. The central data structure is `IndexModel` containing files, directories, packages, all edge types, and a summary.

### Document ingestion (`src/`)

Three CLI entry points (`extract-pdf-cli.ts`, `ingest-pdf-file.ts`, `ingest-md-file.ts`) all funnel through `corpusRepo.ts` for SHA-256 hashing, content extraction, and Prisma upsert into the `CorpusFile` table.

## Key Configuration

- **Database:** PostgreSQL via `DATABASE_URL`. Schema in `prisma/schema.prisma`. `CorpusFile` has unique constraint on `(corpusId, storagePath)`.
- **HelixDB:** Config in `helix.toml`, graph schema in `db/schema.hx`, queries in `db/queries.hx`. Dev server on port 6970. Env vars: `HELIX_URL` (default `http://127.0.0.1:6970`), `HELIX_API_KEY`.
- **Env vars:** Copy `.env.example` → `.env`. Required: `DATABASE_URL` (for ingestion). Optional: `CORPUS_ID`, `STORAGE_PATH`, `OPENAI_API_KEY`, `HELIX_URL`, `HELIX_API_KEY`.

## Code Conventions

- **Imports:** Use `.js` suffix on local relative imports (even in `.ts` files). Use `node:` prefix for built-ins. Separate groups: node built-ins → third-party → local. Use `import type` for type-only imports.
- **Types:** Prefer `type` over `interface`. Use `as const` for enum-like constants. Avoid `any`.
- **Naming:** `camelCase` functions/vars, `PascalCase` types, `UPPER_SNAKE_CASE` true constants. Boolean fields use `is` prefix.
- **Style:** Double quotes, semicolons. No Prettier/ESLint configured — match existing style manually.
- **Exports:** Named exports for shared helpers; no default exports.
- **Sentinel values:** Use `DEP_DEPTH_IN_CYCLE` and `TOPO_ORDER_UNAVAILABLE` constants, not magic numbers.
- **Errors:** Normalize with `error instanceof Error ? error.message : String(error)`. CLI entry points write to stderr and use non-zero exit codes.
- **Tests:** `node:test` + `node:assert/strict`. Deterministic assertions (no snapshots). Fixtures in `test/fixtures/minimal-repo/`. Tests assert exact counts and ordering.
