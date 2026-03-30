# Helix Index

A CLI and daemon for indexing git repositories into [HelixDB](https://helixdb.cloud) and querying the dependency graph. Designed for agents and developer tooling — non-interactive, structured output, composable commands.

## What it does

- Walks a git repo's file tree and extracts JS/TS import edges
- Runs DAG analysis (topological sort, cycle detection, dependency depth)
- Syncs the resulting graph into HelixDB (nodes: File, Directory, Package; edges: Imports, ContainsFile, etc.)
- Exposes the full graph via a CLI with human-readable and `--json` output
- Background daemon with auto-start handles indexing and HelixDB queries over Unix socket IPC

## Install

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- [HelixDB](https://helixdb.cloud) running locally (default: `http://127.0.0.1:6970`)
- PostgreSQL (only needed for document ingestion features)

### From npm

```bash
npm install -g @tridha643/helix-cli
# or
pnpm add -g @tridha643/helix-cli
# or
bun add -g @tridha643/helix-cli
```

### From source

```bash
git clone https://github.com/tridha643/helix-hypo.git
cd helix-hypo
bun install
bun link
```

### Standalone binary (no runtime needed)

```bash
# Build for current platform
bun run build:bin

# Cross-compile
bun run build:bin:darwin-arm64
bun run build:bin:darwin-x64
bun run build:bin:linux-x64
bun run build:bin:linux-arm64
```

This produces a self-contained executable (~59MB) with Bun embedded.

## Quick start

```bash
# Index the current repo into HelixDB
helix index .

# Check what was indexed
helix graph stats
helix tree src

# Explore dependencies
helix deps src/app.ts
helix deps src/app.ts --reverse
helix info src/app.ts

# Search
helix grep "useState" --limit 10
helix glob "**/*.test.ts"

# Graph analysis
helix graph entry-points
helix graph most-imported --limit 5
helix graph cycles
```

## CLI reference

Every command supports `--help` for detailed usage and examples.

```
helix <command> [options]
```

### Indexing

| Command | Description |
|---------|-------------|
| `helix index [path]` | Index a git repo into HelixDB (default: cwd) |
| `helix reindex [path]` | Alias for `index` (full rebuild) |
| `helix index --status` | Show current index counts from HelixDB |

Options: `--json`, `--api-key <key>`, `--helix-url <url>`, `--no-deploy`

### Querying

| Command | Description |
|---------|-------------|
| `helix deps <file>` | List files this file imports |
| `helix deps <file> --reverse` | List files that import this file |
| `helix info <file>` | Show file metadata (extension, size, flags) |
| `helix tree [path]` | List directory contents (default: repo root) |

Options: `--json`

### Graph analysis

| Command | Description |
|---------|-------------|
| `helix graph stats` | Index summary (file/dir/edge counts) |
| `helix graph entry-points` | Files with no incoming imports |
| `helix graph leaf-deps` | Files with no outgoing imports |
| `helix graph orphans` | Files with no imports in either direction |
| `helix graph cycles` | List all cycles |
| `helix graph topo-order` | Topological ordering of files |
| `helix graph most-imported` | Most-imported files (default top 20) |

Options: `--json`, `--limit N` (for `most-imported`)

### Search

| Command | Description |
|---------|-------------|
| `helix grep <query>` | BM25 full-text search over file content |
| `helix glob <pattern>` | Match files by glob pattern (`**/*.ts`) |

Grep options: `--scope deps-of:<file>`, `--scope imports-of:<file>`, `--limit N`, `--json`

### System

| Command | Description |
|---------|-------------|
| `helix status` | Show daemon pid, uptime, version |
| `helix version` | Show CLI and daemon versions |
| `helix mount [mountpoint]` | Mount FUSE virtual filesystem (requires FUSE-T) |
| `helix unmount` | Unmount FUSE virtual filesystem |

### JSON output

All query commands accept `--json` to output structured JSON instead of human-readable text. Useful for piping into `jq` or feeding to agents:

```bash
helix deps src/app.ts --json | jq '.[].to_file_id'
helix graph stats --json
helix info src/app.ts --json
```

## Configuration

Config is loaded from three levels (highest priority wins):

1. **Environment variables**: `HELIX_URL`, `HELIX_API_KEY`
2. **Project config**: `<repo>/.helix/config.toml`
3. **Global config**: `~/.helix/config.toml`

Example `.helix/config.toml`:

```toml
[helix]
url = "http://127.0.0.1:6970"
api_key = "your-key"

[daemon]
log_level = "info"

[fuse]
mount_point = "/tmp/helix"
```

## Architecture

```
helix CLI  ──>  daemon (background, auto-started)  ──>  HelixDB
                  │
                  ├── indexer pipeline (walk → extract → DAG → sync)
                  ├── IPC server (Unix socket, length-prefixed JSON)
                  └── FUSE mount (optional, Node.js subprocess)
```

The CLI is a thin wrapper: parse args, call `sendDaemonRequest(method, params)`, format output. The daemon auto-starts on first use and manages the HelixDB connection.

## Development

```bash
bun install                    # Install dependencies
bun run typecheck              # Type check
bun run test:cli               # Run CLI tests (89 tests)
bun run test                   # Run indexer unit tests
bun run test:daemon            # Run daemon tests
bun run verify                 # Full integration verification

bun run build                  # Bundle for npm publish
bun run build:bin              # Compile standalone binary
```

## Document ingestion

Separate from the CLI, this project also includes tools for ingesting PDFs and Markdown into PostgreSQL:

```bash
# Requires DATABASE_URL in .env
bun run extract:pdf -- ./path/to.pdf
CORPUS_ID=default bun run ingest:pdf -- ./path/to.pdf
CORPUS_ID=default bun run ingest:md -- ./path/to.md
```

## License

MIT
