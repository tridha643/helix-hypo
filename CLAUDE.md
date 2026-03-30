# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Four-part TypeScript pipeline running on **Bun** with **Prisma** ORM (strict mode, ES2022, NodeNext modules):

1. **Document ingestion** — CLI tools that ingest PDFs and Markdown into PostgreSQL (`CorpusFile` table).
2. **Git repo indexer** — Walks a git repo's file tree, extracts JS/TS import edges, runs DAG analysis (topological sort, cycle detection, dependency depth), and syncs the resulting graph into **HelixDB**. The HelixDB graph (nodes: File, Directory, Package; edges: Imports, ImportsExternal, ContainsFile, ContainsDirectory) lets agents navigate repos via graph queries instead of grep/find.
3. **Daemon** — An invisible background process (`src/daemon/`) that exposes the indexer and HelixDB queries over a Unix-domain socket IPC, with auto-start, version handshake, and graceful lifecycle management.
4. **FUSE mount** — A read-only virtual filesystem (`src/fuse/`) that projects the HelixDB graph at `/tmp/helix/`. Agents can navigate dependencies with `ls`, `cat`, and `readlink` instead of grep/find. Requires FUSE-T and Node.js (not Bun) due to fuse-native's libuv dependency.

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

# FUSE mount (requires FUSE-T installed, HelixDB running, repo indexed)
bun run mount -- /tmp/helix .                             # Mount at /tmp/helix for current repo
bun run mount                                             # Mount with defaults (/tmp/helix, cwd)

# Document ingestion CLIs
bun run extract:pdf -- ./path/to.pdf                      # Extract PDF text to JSON (no DB)
CORPUS_ID=default bun run ingest:pdf -- ./path/to.pdf     # Ingest PDF into Postgres
CORPUS_ID=default bun run ingest:md -- ./path/to.md       # Ingest Markdown into Postgres
```

### Testing

Indexer tests use Node built-in test runner (`node:test` + `node:assert/strict`), invoked via `tsx`. Daemon tests use `bun test`.

```bash
bun run test                                              # Run all indexer unit tests
bun run test:daemon                                       # Run daemon tests (bun test)
bun run test:fuse                                         # Run FUSE unit tests (bun test)

# Single test file
node --import tsx --test test/indexer/dagAnalysis.test.ts

# Single test case by name
node --import tsx --test --test-name-pattern "buildIndexModel indexes" test/indexer/indexRepo.test.ts
```

Run `bun run verify` when touching Helix sync or fixture-driven integration behavior (requires HelixDB running on port 6970).

## Architecture

### Indexer pipeline (`src/indexer/`)

Five-stage pipeline orchestrated by `indexRepo.ts`:

1. **`walkGitTree.ts`** — Runs `git ls-files` to enumerate tracked+untracked files, reads content, builds `RepoStructure` (files, directories, containment edges). File IDs are posix-normalized relative paths.
2. **`extractImports.ts`** + **`resolveImport.ts`** — Regex-based import/require/export extraction from `.js/.jsx/.ts/.tsx` files. Internal imports are resolved against the file ID set with extension probing (`.ts`, `.tsx`, `.js`, `.jsx`, `/index.*`). External imports produce package-level edges.
3. **`dagAnalysis.ts`** — Tarjan's SCC for cycle detection, topological ordering, dependency depth computation. Produces `DependencyAnalysis` with per-file metrics (entry point, leaf dep, orphan, cycle membership).
4. **`computeIndexes.ts`** — Merges `RepoStructure` + edges + `DependencyAnalysis` into a single `IndexModel`.
5. **`syncToHelix.ts`** — Deploys schema via `helix push dev`, then batch-upserts nodes/edges into HelixDB via `helix-ts` client.

Key types are in `types.ts`. The central data structure is `IndexModel` containing files, directories, packages, all edge types, and a summary.

### Daemon (`src/daemon/`)

Background process providing IPC access to the indexer and HelixDB:

- **`config.ts`** — Config cascade: `~/.helix/config.toml` (global) → `<repo>/.helix/config.toml` (project) → env vars (highest priority). Paths: `~/.helix/daemon.pid`, `~/.helix/daemon.sock`, `~/.helix/daemon.log`.
- **`ipc.ts`** — Length-prefixed (4-byte uint32 BE header + JSON body) framing over Unix socket. `FrameReader` handles partial reads. Server uses `Bun.listen`, client uses `Bun.connect`.
- **`lifecycle.ts`** — PID file management, `ensureDaemonRunning()` auto-spawns via `Bun.spawn` with `HELIX_DAEMON=1` env var, `restartDaemon()` on version mismatch.
- **`daemon.ts`** — Main process: starts IPC server, registers RPC handlers (`ping`, `status`, `index`, `query`, `deps`, `graph`, `tree`, `info`). Activated only when `HELIX_DAEMON=1` is set.

### FUSE virtual filesystem (`src/fuse/`)

Read-only virtual filesystem projecting HelixDB graph data, mounted via FUSE-T:

- **`mount.ts`** — Main entry point: mounts the FUSE filesystem, implements `getattr`, `readdir`, `read`, `open`, `readlink` ops. Loads file/dir/package IDs from HelixDB at mount time and queries on demand. Can run standalone (`node --import tsx src/fuse/mount.ts`) or be spawned by the daemon's `mount` RPC handler.
- **`pathParser.ts`** — Pure function: mount path → `FuseIntent` discriminated union. Uses greedy longest-prefix matching against known file IDs to handle file IDs containing `/`. Also detects intermediate prefix directories under `/files/`.
- **`smokeTest.ts`** — Phase 0 compatibility test: mounts a minimal FUSE filesystem to verify FUSE-T + fuse-native work.

**Virtual filesystem layout:**
```
/files/<fileId>/              # Per-file directory
  content                     # Actual file content (from disk, fallback to HelixDB)
  meta.json                   # File metadata from HelixDB (minus content)
  imports/                    # Symlinks to imported files
  imported-by/                # Symlinks to files that import this one
  external-deps/              # Symlinks to /index/external-packages/<pkg>/
/tree/                        # Mirrors repo directory structure
  <dir>/<file>                # Symlinks to /files/<fileId>/content
/index/
  entry-points/               # Symlinks to entry point files
  leaf-deps/                  # Symlinks to leaf dependency files
  orphans/                    # Symlinks to orphan files
  cycles/<cycle-N>/           # Subdirectories per cycle with symlinks
  most-imported.txt           # Ranked list of most-imported files
  topo-order.txt              # Topological order of files
  external-packages/<pkg>/    # Package directory with imported-by/
/stats.json                   # Index summary counts
```

**Runtime constraint:** Must run under Node.js, not Bun. The `fuse-native` N-API module calls `uv_sem_init` which Bun does not yet support. The daemon spawns a Node.js child process for the mount.

### Document ingestion (`src/`)

Three CLI entry points (`extract-pdf-cli.ts`, `ingest-pdf-file.ts`, `ingest-md-file.ts`) all funnel through `corpusRepo.ts` for SHA-256 hashing, content extraction, and Prisma upsert into the `CorpusFile` table.

## Key Configuration

- **Database:** PostgreSQL via `DATABASE_URL`. Schema in `prisma/schema.prisma`. `CorpusFile` has unique constraint on `(corpusId, storagePath)`.
- **HelixDB:** Project config in `helix.toml`, graph schema in `db/schema.hx`, queries in `db/queries.hx`. Dev server on port 6970. Env vars: `HELIX_URL` (default `http://127.0.0.1:6970`), `HELIX_API_KEY`.
- **Daemon config:** TOML files at `~/.helix/config.toml` (global) and `<repo>/.helix/config.toml` (project). Supports `[helix]` (url, api_key), `[daemon]` (log_level, socket_path, pid_path, index_batch_size), and `[fuse]` (mount_point) sections. Env vars `HELIX_URL` and `HELIX_API_KEY` override TOML.
- **Env vars:** Copy `.env.example` → `.env`. Required: `DATABASE_URL` (for ingestion). Optional: `CORPUS_ID`, `STORAGE_PATH`, `OPENAI_API_KEY`, `HELIX_URL`, `HELIX_API_KEY`.

## Code Conventions

- **Imports:** Use `.js` suffix on local relative imports (even in `.ts` files). Use `node:` prefix for built-ins. Separate groups: node built-ins → third-party → local. Use `import type` for type-only imports.
- **Types:** Prefer `type` over `interface`. Use `as const` for enum-like constants. Avoid `any`.
- **Naming:** `camelCase` functions/vars, `PascalCase` types, `UPPER_SNAKE_CASE` true constants. Boolean fields use `is` prefix.
- **Style:** Double quotes, semicolons. No Prettier/ESLint configured — match existing style manually.
- **Exports:** Named exports for shared helpers; no default exports.
- **Sentinel values:** Use `DEP_DEPTH_IN_CYCLE` and `TOPO_ORDER_UNAVAILABLE` constants, not magic numbers.
- **Errors:** Normalize with `error instanceof Error ? error.message : String(error)`. CLI entry points write to stderr and use non-zero exit codes.
- **Tests:** Indexer uses `node:test` + `node:assert/strict` with deterministic assertions (no snapshots). Daemon uses `bun test`. Fixtures in `test/fixtures/minimal-repo/`. Tests assert exact counts and ordering.
