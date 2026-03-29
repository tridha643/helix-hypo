# Helix Embedder Pipeline Build Spec

## Purpose

**Hypothesis:** If we index a codebase's file tree and dependency graph into HelixDB and project it as a FUSE-mounted filesystem, agents get faster and more precise navigation than raw `grep`/`find` on the original repo.

**Test case:** A git repository. Files are nodes, directories are structural edges, import/require statements are dependency edges. Mount the graph via FUSE so an agent can do `ls /helix/src/app.ts/imports/` instead of `grep -r "from.*app" .`.

Start simple. Index a repo's file tree. Extract import edges. Mount it. See if it's actually better.

### Why a git repo is the right starting point

- The structure already exists — no parsing pipeline needed to find it
- Import/require statements are explicit, high-trust edges (no NLP, no heuristics)
- Every developer understands the domain — easy to validate correctness
- Agents like Claude Code already work on git repos — direct comparison possible
- If this doesn't show value here, the more complex document pipeline won't either

### What an agent gets from the mounted graph

```bash
# Instead of: grep -rn "import.*from" src/ | grep "utils"
ls /helix/files/src/utils/helpers.ts/imported-by/
→ src/app.ts  src/services/auth.ts  src/routes/api.ts

# Instead of: manually tracing import chains
ls /helix/files/src/app.ts/imports/
→ src/utils/helpers.ts  src/db/client.ts  src/config.ts

# Instead of: find . -name "*.ts" | head -50
ls /helix/tree/src/
→ app.ts  config.ts  utils/  services/  routes/  db/

# Instead of: figuring out which files are entry points
ls /helix/index/entry-points/
→ src/app.ts  src/cli.ts

# Instead of: figuring out what has the most dependents
cat /helix/index/most-imported.txt
→ src/utils/helpers.ts (14 dependents)
→ src/db/client.ts (9 dependents)
→ src/config.ts (8 dependents)

# Read file content straight through the mount
cat /helix/files/src/app.ts/content
→ (file contents, served from git/disk)
```

The agent uses the same tools it always uses (`cat`, `ls`, `find`). The FUSE layer just gives it a pre-indexed, graph-structured view of the repo.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Agent Layer                         │
│  (Claude Code, custom agents, shell scripts, etc.)       │
│                                                          │
│  Two interfaces, same backing store:                     │
│  ┌─────────────────────┐  ┌────────────────────────────┐ │
│  │  FUSE mount          │  │  CLI (`helix`)             │ │
│  │  ls, cat, find,      │  │  helix search, helix deps, │ │
│  │  readlink, tree       │  │  helix graph, helix status │ │
│  │  (navigation)        │  │  (structured queries)      │ │
│  └──────────┬───────────┘  └─────────────┬──────────────┘ │
└─────────────┼────────────────────────────┼───────────────┘
              │ POSIX file ops             │ Unix socket IPC
              ▼                            ▼
┌─────────────────────────────────────────────────────────┐
│                  Helix Daemon (invisible)                 │
│  Auto-starts on first use. No `helix daemon start`.      │
│  Serves both FUSE mount + CLI queries over Unix socket.  │
│  Version-sync handshake. PID file lifecycle.             │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                       HelixDB                             │
│  File nodes + directory edges + import edges              │
│  Pre-computed: reverse deps, entry points, orphans        │
└─────────────────────────────────────────────────────────┘
                       ▲
                       │
┌─────────────────────────────────────────────────────────┐
│                    Indexing Pipeline                       │
│  Walk git tree → extract imports → DAG analysis → sync    │
└─────────────────────────────────────────────────────────┘
```

No Postgres in v0. HelixDB is the only store. File content is read from the original repo on disk. We're testing whether the graph index adds value, not building a full storage layer.

### Two interfaces, one daemon

FUSE and CLI serve different agent needs:

| | FUSE mount | CLI (`helix`) |
|---|---|---|
| **Best for** | Navigation, browsing, following edges | Structured queries, ranked results, bulk analysis |
| **How agents use it** | `ls`, `cat`, `find`, `tree`, `readlink` | `helix search "auth"`, `helix deps src/app.ts` |
| **Output format** | File content, directory listings, symlinks | Machine-parseable text (IDs, paths, scores, counts) |
| **Example** | `ls /helix/files/src/app.ts/imports/` | `helix deps --reverse src/app.ts --depth 2` |
| **Strength** | Zero learning curve — it's just a filesystem | Richer output — scores, rankings, transitive results |

Both hit the same daemon over a Unix socket. The daemon auto-starts on first use (index or mount), following the CocoIndex "invisible daemon" pattern:
- **No manual lifecycle**: first `helix` CLI call or FUSE mount triggers daemon start as a detached background process
- **Version sync**: every connection handshakes version numbers; mismatches trigger daemon restart
- **PID file**: `~/.helix/daemon.pid` for liveness detection
- **Config**: global in `~/.helix/`, project-level in `.helix/` (re-read per request, no cache invalidation needed)
- **Stateless IPC**: fresh Unix socket connection per request (~0.1ms overhead), no connection pooling

## Two Graphs, One Filesystem

A git repo naturally contains **two overlapping graphs**:

### 1. The structural DAG (directory tree)

```
repo/
├── src/
│   ├── app.ts
│   ├── utils/
│   │   └── helpers.ts
│   └── db/
│       └── client.ts
└── package.json
```

This is a **strict DAG** — always acyclic. A directory contains files and subdirectories; a file can't contain its parent. The parent-child relationships are:

```
repo → src → app.ts
repo → src → utils → helpers.ts
repo → src → db → client.ts
repo → package.json
```

Every file has exactly one parent directory. Every directory has exactly one parent (except root). This is the simplest possible DAG — a tree.

### 2. The dependency graph (imports)

```
app.ts ──imports──► helpers.ts
app.ts ──imports──► client.ts
client.ts ──imports──► helpers.ts
helpers.ts ──imports──► client.ts   ← CYCLE (helpers and client import each other)
```

This is **NOT necessarily a DAG** — import cycles are common in real codebases. Circular imports between files happen all the time. This graph can have:
- Cycles (A imports B, B imports A)
- Multiple paths (A imports C directly, and A imports B which imports C)
- Disconnected components (orphan files that nothing imports)

### Why this distinction matters

The structural DAG gives us **fast tree traversal** — parent/child lookups, subtree enumeration, path resolution. These are O(depth) operations in a DAG, guaranteed no infinite loops.

The dependency graph gives us **impact analysis** — "what breaks if I change this file?" But because it can have cycles, traversal needs cycle detection. HelixDB stores both graphs, and the FUSE mount exposes them differently:

- `tree/` and `files/.../` reflect the **structural DAG** — always a clean hierarchy
- `imports/` and `imported-by/` reflect the **dependency graph** — may contain cycles, symlinks can be circular (agents/tools handle this with `-maxdepth` or similar)

### DAG properties we track

| Property | Structural DAG | Dependency Graph |
|---|---|---|
| Acyclic? | Always | Not guaranteed |
| Root nodes | Repo root directory | Entry points (nothing imports them) |
| Leaf nodes | Files (no children) | Terminal deps (import nothing) |
| Depth | Directory nesting depth | Longest import chain |
| Cycle detection | Not needed | Detected at index time, stored as metadata |
| FUSE projection | `tree/` — natural directory layout | `imports/` + `imported-by/` — symlinks, may be circular |

When cycles exist in the dependency graph, they are:
1. Detected during indexing (Stage 3)
2. Stored as `is_in_cycle: Bool` on the `File` node
3. Listed in `/helix/index/cycles/` for visibility
4. Still navigable via symlinks — the agent's `find -maxdepth` handles it

## v0 Scope

### What v0 delivers

1. **Git tree indexer** — walk a repo's file tree as a DAG: `Directory` parent nodes, `File` leaf nodes, `Contains` edges forming the tree
2. **Import extractor** — parse import/require/from statements in JS/TS files, create `Imports` edges forming the dependency graph (including cycle detection)
3. **DAG analysis** — compute tree depth, dependency depth, entry points, leaf nodes, cycles
4. **Invisible daemon** — auto-starting background process serving both FUSE and CLI over Unix socket
5. **FUSE mount (read-only)** — mount both graphs so agents can navigate the structural DAG via `tree/` and the dependency graph via `imports/`/`imported-by/`
6. **CLI (core commands)** — `helix index`, `helix status`, `helix deps`, `helix graph` for structured queries

### What v0 defers (but scopes out)

- `helix search` — hybrid BM25 + semantic search (see CLI Roadmap below)
- `helix search --ast` — AST-aware structural pattern matching
- Non-JS/TS import extraction (Python, Go, Rust, etc.)
- File content chunking and embedding
- Write-back / watch mode (re-index on file change)
- Postgres persistence
- Multi-repo support
- Transitive dependency resolution (multi-hop traversal is available via symlink chaining, but not pre-computed)

## Design Principles

### 1. The filesystem IS the API

Agents don't get special tools. They get a mounted filesystem. `cat` for content, `ls` for traversal, symlinks for edges. Any agent framework works out of the box.

### 2. The repo on disk is the source of truth

HelixDB stores the graph (structure + edges). File content is always read from the actual repo on disk. No content duplication. If a file changes on disk, content reads reflect that immediately (graph edges are stale until re-index, but content is always fresh).

### 3. Two graphs, explicit separation

The structural DAG (directories) and the dependency graph (imports) are stored as separate edge types in HelixDB and projected into separate areas of the FUSE mount. Don't conflate containment with dependency.

### 4. Extract what's there, don't invent it

Import statements are explicit edges. Directory containment is explicit structure. No heuristics, no NLP, no guessing. If a file says `import { foo } from './bar'`, that's an edge.

### 5. Indexes are pre-computed views

Entry points, most-imported files, orphans, cycles, depth metrics — these are computed at index time and exposed as virtual directories. The agent doesn't need to compute them.

### 6. HelixDB does the searching, not just the scoping

HelixDB is a graph-**vector** database. It has built-in:
- **BM25 keyword search** — full-text search over indexed node properties, same scoring as Lucene/Elasticsearch
- **Vector search** — HNSW-based similarity search with tunable parameters
- **Built-in embedding** — `Embed()` function supports OpenAI, Gemini, VoyageAI; no external embedding pipeline needed
- **Filtering** — conditionals on traversal results
- **Reranking** — search result optimization

This means grep and glob don't need to touch the filesystem at all. HelixDB can do the text search directly:

```
Traditional grep:   grep -rn "db.query" src/              → linear scan, 142 files from disk
HelixDB BM25:       helix search "db.query"               → indexed BM25 search, sub-ms, no disk I/O
Graph-scoped BM25:  helix search "db.query" --scope deps-of:src/app.ts  → BM25 constrained to 9 files in the graph
```

**Three search tiers, all inside HelixDB:**

| Tier | What it does | HelixDB primitive | When to use |
|---|---|---|---|
| **BM25 keyword** | Exact/fuzzy text match over file content | Built-in BM25 search on node properties | Identifier lookups, error strings, exact patterns |
| **Vector semantic** | Conceptual similarity | HNSW vector search + `Embed()` | "Authentication middleware", "error handling logic" |
| **Graph-scoped** | Constrain any search to a subgraph | Traversal → filter → search | "Search for X, but only in files that import Y" |

The graph isn't just a scope constraint — it's the search engine. Ripgrep is a fallback for regex patterns that BM25 can't express (complex regex with lookaheads, etc.), not the primary search path.

#### How file content gets into HelixDB for BM25

At index time (Stage 1), when we create `File` nodes, we also store the file's text content (or a truncated version for large files) as a searchable property. HelixDB's BM25 indexes this automatically. No separate indexing step needed.

For vector search (Phase 2+), we use HelixDB's `V::` vector nodes with the built-in `Embed()` function to generate and store embeddings alongside the graph. One database, both the graph and the search index.

#### Glob over the graph

Glob doesn't need the filesystem either. File paths are stored as `file_id` properties on `N::File` nodes. Globbing is just a query over those string properties:

```
Traditional glob:   find . -name "*.test.ts"              → walks entire directory tree from disk
HelixDB glob:       helix glob "**/*.test.ts"             → string match over indexed file_id properties
Graph-scoped glob:  helix glob "*.test.ts" --scope deps-of:src/db/client.ts  → glob only the dependency set
```

## Indexing Pipeline

### Stage 1: Walk the git tree

- Use `git ls-files` to get the tracked file list (respects .gitignore)
- For each file: create a `File` node with path, extension, size, and **file content as a BM25-searchable property**
- For each directory: create a `Directory` node
- Create `Contains` edges: Directory -> File, Directory -> Directory
- HelixDB automatically indexes the content property for BM25 keyword search — no separate indexing step

### Stage 2: Extract imports (JS/TS only in v0)

Parse each `.js`, `.ts`, `.jsx`, `.tsx` file for:
- `import ... from '...'`
- `import '...'`
- `require('...')`
- `export ... from '...'`
- Dynamic `import('...')`

For each import:
- Resolve the specifier relative to the importing file (handle `./`, `../`, index files, extension resolution)
- If it resolves to a file in the repo, create an `Imports` edge
- If it's an external package (node_modules), create an `ImportsExternal` edge to a `Package` node
- Track what names are imported (`{ foo, bar }`, `* as baz`, default) as edge metadata

### Stage 3: DAG analysis and index computation

After all nodes and edges exist, analyze both graphs:

#### Structural DAG analysis
- Compute `tree_depth` for each file and directory (distance from repo root)
- Compute `total_file_count` for each directory (recursive)
- Verify acyclicity (should always hold — if not, something is wrong with the tree walk)

#### Dependency graph analysis
- **Cycle detection**: run Tarjan's algorithm (or similar SCC detection) on the import graph. Mark files that participate in cycles with `is_in_cycle: true`. Store each cycle as a list of file paths.
- **Entry points** (DAG roots): files with zero incoming `Imports` edges — nothing imports them. These are app entry points, CLI scripts, test files.
- **Leaf dependencies** (DAG leaves): files with zero outgoing `Imports` edges — they don't import anything internal.
- **Most imported**: files sorted by incoming `Imports` edge count.
- **Orphans**: files with zero `Imports` edges in either direction — disconnected from the dependency graph entirely.
- **Dependency depth**: longest chain of imports from each file. For files in cycles, depth is marked as `Infinity` / cycle.
- **Topological order**: for the acyclic portion of the dependency graph (after removing cycle edges), compute a topological sort. This gives a build order / evaluation order.

These are stored as properties on `File`/`Directory` nodes in HelixDB.

### Running the indexer

```
pnpm index -- /path/to/repo
```

Walks the repo, extracts imports, syncs everything to HelixDB. Idempotent — re-running produces the same graph.

## HelixDB Graph Model

### Node types

#### `N::File`

```
file_id: String        -- relative path from repo root (e.g. "src/app.ts")
extension: String      -- ".ts", ".js", ".md", etc.
size_bytes: I64
content: String        -- file text content (BM25-indexed by HelixDB for keyword search)
tree_depth: I64        -- distance from repo root in structural DAG
is_entry_point: Bool   -- true if nothing imports this file (DAG root)
is_leaf_dep: Bool      -- true if this file imports nothing (DAG leaf)
is_orphan: Bool        -- true if no import edges in either direction
is_in_cycle: Bool      -- true if participates in a circular import
import_count: I64      -- number of files this imports (out-degree in dep graph)
imported_by_count: I64 -- number of files that import this (in-degree in dep graph)
dep_depth: I64         -- longest import chain from this file (-1 if in cycle)
topo_order: I64        -- position in topological sort (-1 if in cycle)
```

For large files (>100KB), `content` stores a truncated version. Full content is always readable from the repo on disk via FUSE.

#### `N::Directory`

```
dir_id: String         -- relative path (e.g. "src/utils")
tree_depth: I64        -- distance from repo root
file_count: I64        -- direct children files
total_file_count: I64  -- recursive file count
```

#### `N::Package`

```
package_id: String     -- package name (e.g. "express", "react")
imported_by_count: I64
```

### Edge types

#### `E::Contains`

- From: Directory -> To: File or Directory
- The repo's tree structure

#### `E::Imports`

- From: File -> To: File
- Properties: `specifier: String` (raw import string), `names: String` (imported identifiers)

#### `E::ImportsExternal`

- From: File -> To: Package
- Properties: `specifier: String`, `names: String`

### Queries

```
// Structural DAG traversal
ListDirectoryContents(dir_id: String)
GetParentDirectory(file_id: String)
GetFileByPath(file_id: String)

// Dependency graph traversal
GetFileImports(file_id: String)
GetFileImportedBy(file_id: String)
GetPackageImportedBy(package_id: String)

// BM25 keyword search (over File.content property)
SearchFileContent(query: String)                         -- BM25 keyword search across all files
SearchFileContentScoped(query: String, file_ids: [String])  -- BM25 search constrained to a file set

// Graph-scoped file sets (for constraining search or glob)
GetTransitiveDeps(file_id: String, depth: I64)          -- all files this file transitively imports
GetTransitiveReverseDeps(file_id: String, depth: I64)   -- all files that transitively import this file
GetFilesInSubtree(dir_id: String)                        -- all files under a directory (structural DAG)
GetFilesByExtension(extension: String)                   -- all .ts files, all .md files, etc.
GetFilesMatchingGlob(pattern: String)                    -- glob over the graph's file_id paths

// DAG analysis views
ListEntryPoints()              -- DAG roots: nothing imports them
ListLeafDependencies()         -- DAG leaves: they import nothing
ListMostImported(limit: I64)
ListOrphans()                  -- disconnected from dep graph
ListCycles()                   -- all detected import cycles
GetFilesInCycle(file_id: String)  -- which cycle does this file belong to?
GetTopologicalOrder()          -- build/evaluation order (acyclic portion)
```

## FUSE Mount Design

### Mount layout

```
/helix/                                         ← mount point
├── files/                                      ← every file in the repo
│   └── <path>/                                 ← mirrors repo structure, one dir per file
│       ├── content                             ← actual file content (read from repo disk)
│       ├── meta.json                           ← size, extension, import/imported-by counts
│       ├── imports/                            ← files this file imports (symlinks)
│       │   ├── helpers.ts → ../../src/utils/helpers.ts/
│       │   └── client.ts → ../../src/db/client.ts/
│       ├── imported-by/                        ← files that import this file (symlinks)
│       │   ├── app.ts → ../../src/app.ts/
│       │   └── auth.ts → ../../src/services/auth.ts/
│       └── external-deps/                      ← external packages imported
│           ├── express.json                    ← package info
│           └── pg.json
├── tree/                                       ← directory tree (mirrors repo layout)
│   ├── src/
│   │   ├── app.ts → ../files/src/app.ts/content
│   │   ├── utils/
│   │   │   └── helpers.ts → ../files/src/utils/helpers.ts/content
│   │   └── ...
│   └── ...
├── index/                                      ← pre-computed views
│   ├── entry-points/                           ← DAG roots: nothing imports them (symlinks)
│   │   ├── app.ts → ../../files/src/app.ts/
│   │   └── cli.ts → ../../files/src/cli.ts/
│   ├── leaf-deps/                              ← DAG leaves: import nothing internal (symlinks)
│   ├── most-imported.txt                       ← ranked list by in-degree
│   ├── orphans/                                ← disconnected from dep graph entirely
│   ├── cycles/                                 ← detected circular imports
│   │   ├── cycle-0/                            ← one directory per cycle
│   │   │   ├── helpers.ts → ../../files/src/utils/helpers.ts/
│   │   │   └── client.ts → ../../files/src/db/client.ts/
│   │   └── cycle-1/
│   │       └── ...
│   ├── topo-order.txt                          ← topological sort of acyclic portion
│   └── external-packages/                      ← all third-party deps
│       ├── express/
│       │   └── imported-by/                    ← which files use this package
│       └── ...
└── stats.json                                  ← repo-level stats (file count, edge count, cycles, etc.)
```

### How file operations map to queries

| Agent does | FUSE daemon does |
|---|---|
| `ls /helix/files/src/app.ts/imports/` | `GetFileImports("src/app.ts")` → HelixDB |
| `ls /helix/files/src/utils/helpers.ts/imported-by/` | `GetFileImportedBy("src/utils/helpers.ts")` → HelixDB |
| `cat /helix/files/src/app.ts/content` | Read `<repo-root>/src/app.ts` from disk |
| `cat /helix/files/src/app.ts/meta.json` | `GetFileByPath("src/app.ts")` → HelixDB, format as JSON |
| `ls /helix/tree/src/` | `ListDirectoryContents("src")` → HelixDB |
| `ls /helix/index/entry-points/` | `ListEntryPoints()` → HelixDB (DAG roots) |
| `ls /helix/index/leaf-deps/` | `ListLeafDependencies()` → HelixDB (DAG leaves) |
| `ls /helix/index/cycles/cycle-0/` | `ListCycles()` → HelixDB (circular imports) |
| `cat /helix/index/topo-order.txt` | `GetTopologicalOrder()` → HelixDB, format as text |
| `cat /helix/index/most-imported.txt` | `ListMostImported(20)` → HelixDB, format as text |
| `ls /helix/index/external-packages/express/imported-by/` | `GetPackageImportedBy("express")` → HelixDB |

### Why symlinks for edges

Import edges are symlinks: `imports/helpers.ts → ../../src/utils/helpers.ts/`. This means:
- `cat imports/helpers.ts/content` follows the link and reads the target file's content
- `ls -l imports/` shows all dependencies with their resolved paths
- Standard `tree -l` visualizes import chains
- `readlink` gives you the raw edge target

Symlinks are Unix's native "pointer" — exactly what a graph edge is.

### Grep and glob go through HelixDB, not the FUSE mount

Agents should NOT run `grep -r` or `find` against the FUSE mount. FUSE adds per-file overhead (kernel↔userspace roundtrips) that makes linear scans slower than searching the raw repo.

Instead, `helix grep` and `helix glob` query **HelixDB directly**:

```
helix grep "db.query"
  → HelixDB BM25 search over File.content → returns matching files + lines
  → no disk I/O, no FUSE, no ripgrep — it's an indexed database query

helix grep "db.query" --scope deps-of:src/app.ts
  → HelixDB: traverse deps-of:src/app.ts → get file set → BM25 search within that set
  → graph traversal + keyword search in one round-trip

helix glob "**/*.test.ts" --scope imports-of:src/db/client.ts
  → HelixDB: traverse reverse-deps → pattern match on file_id property
  → no filesystem walk at all
```

**Fallback to ripgrep**: for complex regex patterns that BM25 can't express (lookaheads, character classes, etc.), `helix grep --regex <pattern>` falls back to ripgrep on real disk paths, using the graph to narrow the file list first.

| Search type | Engine | How it works |
|---|---|---|
| Keyword search (`helix grep "query"`) | HelixDB BM25 | Indexed full-text search over `File.content` property |
| Graph-scoped keyword (`--scope`) | HelixDB BM25 + traversal | Traverse graph for file set → BM25 within that set |
| Regex search (`helix grep --regex "pat.*ern"`) | Ripgrep on disk | Graph narrows file list → ripgrep on real paths |
| File pattern (`helix glob "**/*.ts"`) | HelixDB property query | String match on `File.file_id`, no disk access |
| Semantic search (`helix search --semantic`) | HelixDB vector search | HNSW similarity on `Embed()` vectors (Phase 2+) |

#### FUSE is for navigation, CLI + HelixDB is for search

| Operation | Use FUSE | Use CLI (backed by HelixDB) |
|---|---|---|
| "Read this file" | `cat /helix/files/src/app.ts/content` | — |
| "What does this file import?" | `ls /helix/files/src/app.ts/imports/` | `helix deps src/app.ts` |
| "Follow a dependency edge" | `cat /helix/files/src/app.ts/imports/helpers.ts/content` | — |
| "Search for a keyword" | — | `helix grep "db.query"` (BM25) |
| "Search within deps" | — | `helix grep "db.query" --scope deps-of:src/app.ts` |
| "Find test files for a module" | — | `helix glob "*.test.ts" --scope imports-of:src/db/client.ts` |
| "Browse the dependency graph" | `tree -L 2 /helix/files/src/app.ts/` | `helix deps --transitive src/app.ts` |

## CLI Design

### Agent-facing CLI principles

Following Cursor's CLI-for-agents design guide:

- **Non-interactive first**: every input is a flag or argument. No arrow keys, menus, or prompts. Agents can't interact with TUIs.
- **Layered discovery**: `helix --help` lists subcommands. `helix deps --help` shows flags with copy-pasteable examples. Don't dump everything at once.
- **Idempotent**: `helix index` run twice is a no-op if nothing changed. No duplicate side effects.
- **Machine-parseable output**: plain text by default, `--json` flag for structured output. Return paths, counts, scores — not decorative formatting.
- **Pipeline-friendly**: accept stdin, support piping. `helix deps src/app.ts | helix deps --reverse --stdin` chains naturally.
- **Destructive actions need `--yes`**: `helix reset` (clear index) requires confirmation or `--yes` flag.
- **Predictable structure**: if `helix deps` exists, `helix deps --reverse` follows. Consistent flag naming.

### v0 CLI commands

```bash
# Indexing
helix index [path]              # Index a repo (auto-starts daemon). Default: current directory.
helix index --status            # Show indexing progress
helix reindex [path]            # Force full re-index (invalidate all cached analysis)

# Daemon
helix status                    # Daemon status, indexed repos, version, uptime
helix version                   # CLI + daemon version (handshake check)

# Search (BM25 keyword search via HelixDB — the killer feature)
helix grep <query>                                 # BM25 keyword search over all indexed file content
helix grep <query> --scope deps-of:<file>          # BM25 search only in files that <file> imports
helix grep <query> --scope imports-of:<file>       # BM25 search only in files that import <file>
helix grep <query> --scope transitive-deps:<file>          # Full transitive closure
helix grep <query> --scope transitive-imports-of:<file>    # Full reverse transitive closure
helix grep <query> --scope subtree:<dir>           # BM25 within a directory subtree
helix grep <query> --scope cycle:<file>            # BM25 within the same import cycle
helix grep <query> --ext .ts                       # Filter by extension (graph-level)
helix grep <query> --json                          # Structured output with file, line, match, BM25 score
helix grep --regex <pattern>                       # Fallback: ripgrep on disk, graph-scoped file list

# Glob (file pattern matching via HelixDB — no disk I/O)
helix glob <pattern>                               # Glob over indexed file_id paths in HelixDB
helix glob <pattern> --scope deps-of:<file>        # Glob only within dependency set
helix glob "**/*.test.ts" --scope imports-of:src/db/client.ts  # "Find tests that depend on db"
helix glob <pattern> --json                        # Structured output

# Dependency graph queries
helix deps <file>               # List files this file imports
helix deps --reverse <file>     # List files that import this file (reverse deps)
helix deps --transitive <file>  # Full transitive dependency tree
helix deps --depth N <file>     # Limit traversal depth
helix deps --json <file>        # Output as JSON

# DAG analysis
helix graph entry-points        # List DAG roots (nothing imports them)
helix graph leaf-deps           # List DAG leaves (import nothing)
helix graph orphans             # Files disconnected from dep graph
helix graph cycles              # List all circular import cycles
helix graph cycles <file>       # Which cycle does this file belong to?
helix graph topo-order          # Topological sort of the acyclic portion
helix graph stats               # Summary: file count, edge count, cycle count, max depth

# File info
helix info <file>               # All metadata for a file: deps, reverse-deps, depth, cycle membership
helix tree [path]               # Directory tree with file counts (like tree but from the graph)

# FUSE
helix mount [mountpoint]        # Mount the graph (auto-starts daemon). Default: /helix
helix unmount                   # Unmount
```

### Scope expressions

The `--scope` flag is the key primitive. It takes a graph traversal expression and returns a file set. Grep/glob then only operate on that file set.

```
--scope deps-of:<file>                  Files that <file> imports (1 hop out)
--scope imports-of:<file>               Files that import <file> (1 hop in, i.e. reverse deps)
--scope transitive-deps:<file>          Full transitive import closure (all hops out)
--scope transitive-imports-of:<file>    Full reverse transitive closure (all hops in)
--scope subtree:<dir>                   All files under <dir> in structural DAG
--scope cycle:<file>                    All files in the same SCC as <file>
--scope entry-points                    DAG root files
--scope leaf-deps                       DAG leaf files
--scope orphans                         Disconnected files
```

Scopes compose via comma (intersection) or `+` (union):

```bash
# Files that BOTH import db/client.ts AND are under src/services/
helix grep "query" --scope "imports-of:src/db/client.ts,subtree:src/services"

# Files that import EITHER auth.ts OR session.ts
helix grep "token" --scope "imports-of:src/auth.ts+imports-of:src/session.ts"
```

### How graph-scoped search works internally

**BM25 keyword search (default):**
```
1. Parse --scope expression
2. HelixDB: traverse graph → get file node set
3. HelixDB: BM25 keyword search over content property of those nodes
4. Return ranked results with scores
```
One database, one round-trip. No disk I/O. The graph traversal and the text search both happen inside HelixDB.

**Regex fallback (`--regex`):**
```
1. Parse --scope expression
2. HelixDB: traverse graph → get file_id list (real filesystem paths)
3. Ripgrep: rg <pattern> file1 file2 file3... (on real disk)
4. Return results
```
Only used when the agent needs actual regex. Graph narrows the file list, ripgrep does the matching on real files.

### CLI output examples

```bash
$ helix deps src/app.ts
src/utils/helpers.ts
src/db/client.ts
src/config.ts

$ helix deps --reverse src/db/client.ts --json
{
  "file": "src/db/client.ts",
  "imported_by": [
    {"path": "src/app.ts", "specifier": "./db/client", "names": ["db"]},
    {"path": "src/services/auth.ts", "specifier": "../db/client", "names": ["db", "query"]}
  ],
  "count": 2
}

$ helix grep "db.query" --scope imports-of:src/db/client.ts
src/app.ts:14:    const result = await db.query("SELECT * FROM users");    [score: 0.94]
src/services/auth.ts:28:    return db.query("SELECT * FROM sessions");     [score: 0.91]
[2 results from 9 files in scope — BM25 via HelixDB, 0.8ms]

$ helix grep "db.query"
src/db/client.ts:7:  export function query(...) { /* ... */ }              [score: 0.97]
src/app.ts:14:    const result = await db.query("SELECT * FROM users");    [score: 0.94]
src/services/auth.ts:28:    return db.query("SELECT * FROM sessions");     [score: 0.91]
src/services/users.ts:15:    return db.query("SELECT * FROM users");       [score: 0.89]
[4 results from 142 indexed files — BM25 via HelixDB, 1.2ms]

$ helix grep --regex "db\.(query|execute)\(" --scope imports-of:src/db/client.ts
src/app.ts:14:    const result = await db.query("SELECT * FROM users");
src/services/auth.ts:28:    return db.query("SELECT * FROM sessions");
[2 matches in 2 files — ripgrep fallback on 9 scoped disk paths, 4ms]

$ helix glob "**/*.test.ts" --scope imports-of:src/db/client.ts
src/app.test.ts
src/services/auth.test.ts
[2 files — pattern matched in HelixDB, 0.3ms]

$ helix graph cycles
Cycle 0: src/utils/helpers.ts → src/db/client.ts → src/utils/helpers.ts
Cycle 1: src/routes/a.ts → src/routes/b.ts → src/routes/c.ts → src/routes/a.ts

$ helix graph stats
Files:        142
Directories:   23
Import edges: 387
External deps: 31
Entry points:  12
Orphans:        4
Cycles:         2
Max dep depth: 11
```

### CLI Roadmap (deferred, scoped here for future reference)

These commands are NOT in v0, but we're designing the CLI namespace now so v0 commands don't conflict with future additions.

```bash
# Search (requires embeddings — Phase 2+)
helix search <query>              # Hybrid BM25 + semantic search over file content
helix search <query> --bm25      # BM25 (lexical) only — exact keyword/identifier matching
helix search <query> --semantic   # Semantic (vector) only — conceptual similarity
helix search <query> --ast <pattern>  # AST-aware structural matching (like ast-grep)
helix search <query> --top N     # Limit results
helix search <query> --json      # Structured output with scores

# The search pipeline (future):
# 1. BM25 lexical index built at index time (trigram index over file content)
# 2. Semantic embeddings computed per-chunk via HelixDB
# 3. Results merged via Reciprocal Rank Fusion (RRF) — same pattern as SocratiCode
# 4. AST search delegates to ast-grep for structural pattern matching
#
# Why both BM25 and semantic?
# - BM25 is better for exact identifiers: "AuthController.validate" → exact match
# - Semantic is better for concepts: "authentication middleware" → finds auth code
#   even if those exact words don't appear
# - RRF fusion gives you both in one query with no tuning
#
# Reference: SocratiCode, Cursor's fast-regex-search blog, Claude Code paper (arxiv:2603.05344)

# RAG queries (requires embeddings + LLM — Phase 3+)
helix ask <question>              # RAG: search → retrieve chunks → answer with citations
helix ask <question> --sources    # Show which files/chunks were used to generate the answer
helix ask <question> --context N  # Control how many chunks feed the answer

# Context management (Phase 3+)
helix context save <name>         # Save current search/query context for reuse
helix context list                # List saved contexts
helix context load <name>         # Restore a saved context

# Watch mode (Phase 1)
helix watch                       # Watch for file changes, incrementally update index
helix watch --status              # Show what's changed since last index
```

## Code Layout

```text
src/
  ingest-md-file.ts          (exists — keep for later)
  ingest-pdf-file.ts         (exists — keep for later)
  corpusRepo.ts              (exists — keep for later)
  decodeMarkdown.ts          (exists — keep for later)
  extractPdf.ts              (exists — keep for later)
  prisma.ts                  (exists — keep for later)
  constants.ts               (exists — keep for later)
  extract-pdf-cli.ts         (exists — keep for later)

  daemon/
    daemon.ts                 -- invisible daemon: auto-start, PID file, version handshake
    ipc.ts                    -- Unix socket server, per-request connection handling
    lifecycle.ts              -- start, stop, restart, version-mismatch detection
    config.ts                 -- global (~/.helix/) + project (.helix/) config loading

  cli/
    helix.ts                  -- CLI entry point (dispatches to subcommands)
    commands/
      index.ts                -- helix index, helix reindex
      status.ts               -- helix status, helix version
      deps.ts                 -- helix deps, helix deps --reverse, --transitive
      graph.ts                -- helix graph entry-points, cycles, topo-order, stats
      info.ts                 -- helix info <file>
      tree.ts                 -- helix tree [path]
      mount.ts                -- helix mount, helix unmount
    formatters/
      text.ts                 -- plain text output (default)
      json.ts                 -- --json structured output

  indexer/
    indexRepo.ts              -- entry point: walk repo, extract imports, analyze, sync to HelixDB
    walkGitTree.ts            -- git ls-files → File and Directory nodes (structural DAG)
    extractImports.ts         -- parse JS/TS imports → Imports edges (dependency graph)
    resolveImport.ts          -- resolve import specifiers to repo file paths
    dagAnalysis.ts            -- cycle detection (Tarjan's SCC), topo sort, depth computation
    computeIndexes.ts         -- entry points, most-imported, orphans, leaf deps
    syncToHelix.ts            -- push nodes and edges to HelixDB

  fuse/
    mount.ts                  -- FUSE mount setup (delegates to daemon)
    pathParser.ts             -- decompose mount paths into query intent
    queryRouter.ts            -- map parsed paths to HelixDB queries
    dirEntries.ts             -- generate directory listings from query results
    contentReader.ts          -- read file content from repo disk
    symlinkResolver.ts        -- resolve import edges as symlinks
    statsGenerator.ts         -- repo-level stats.json
```

## Concrete First Tasks

1. Define HelixDB schema in `db/schema.hx` — File, Directory, Package nodes; Contains, Imports, ImportsExternal edges
2. Write HelixDB queries in `db/queries.hx` — structural DAG, dependency graph, and analysis queries
3. Implement `walkGitTree.ts` — shell out to `git ls-files`, build File/Directory nodes with tree depth
4. Implement `extractImports.ts` — parse JS/TS import statements (regex or lightweight AST)
5. Implement `resolveImport.ts` — resolve `./foo` to `src/foo.ts` (handle extensions, index files)
6. Implement `dagAnalysis.ts` — Tarjan's SCC for cycle detection, topological sort, dependency depth
7. Implement `computeIndexes.ts` — entry points, leaf deps, most-imported, orphans
8. Implement `syncToHelix.ts` — upsert nodes and edges to HelixDB
9. Implement `indexRepo.ts` — orchestrate: walk → extract → resolve → analyze → sync → compute indexes
10. Implement FUSE path parser and query router
11. Implement FUSE daemon with read-only mount
12. End-to-end test: index this repo → mount → navigate structural DAG and dependency graph via `ls` and `cat`

## Testing Strategy

### Smoke test: index this repo

The helix-embedder repo itself is the first test subject. After indexing:

- `ls /helix/files/src/corpusRepo.ts/imports/` should list `prisma.ts`, `constants.ts`, etc.
- `ls /helix/files/src/prisma.ts/imported-by/` should list every file that imports the Prisma client
- `cat /helix/files/src/corpusRepo.ts/content` should match `cat src/corpusRepo.ts`
- `ls /helix/index/entry-points/` should list CLI entry points

### Hypothesis validation

Run a concrete comparison:
1. Ask an agent (or manually time) "which files depend on src/prisma.ts?" using raw grep on the repo
2. Ask the same question via the FUSE mount
3. Compare: correctness, speed, number of steps

If the FUSE mount gives a correct answer in one `ls` where grep takes multiple passes and filtering, the hypothesis holds.

### Unit tests

- Import extraction finds all JS/TS import patterns
- Import resolution handles: relative paths, index files, extension inference, external packages
- Path parser correctly decomposes all FUSE path patterns
- Directory listing generation matches expected output

### Integration tests

- Index a small fixture repo → assert correct node/edge counts in HelixDB
- Mount → ls imports → assert correct symlinks
- Mount → cat content → assert matches original file

## Risks and Mitigations

### Risk: Import resolution is messy (tsconfig paths, barrel files, package.json exports)

Mitigation: Start with basic relative resolution (`./`, `../`, index files, `.ts`/`.js` extension). Cover 80% of real imports. Add tsconfig path mapping as a fast-follow if needed.

### Risk: macFUSE kernel extension approval friction

Mitigation: Support FUSE-T on macOS (no kext). On Linux, FUSE is built-in. Document setup clearly.

### Risk: HelixDB query latency makes `ls` feel slow

Mitigation: HelixDB graph traversals should be sub-millisecond for single-hop queries. Add LRU cache in the daemon if needed. Profile on a real repo.

### Risk: Large repos (10K+ files) make indexing slow

Mitigation: `git ls-files` is fast even for huge repos. Import extraction is per-file and parallelizable. Index once, query many times.

---

## Appendix: Future Phases (deferred)

### Phase 1: Watch mode + incremental indexing

`helix watch` — daemon watches for file changes (`fs.watch` or `git diff`), incrementally updates the HelixDB graph. Only re-index changed files (content hash comparison, same pattern as SocratiCode's incremental indexing). FUSE mount reflects changes within seconds.

### Phase 2: Semantic search + hybrid fusion

BM25 keyword search is already in v0 (built into HelixDB). Phase 2 adds the vector/semantic layer:

**Semantic search (vector):**
- Use HelixDB's `V::` vector nodes with built-in `Embed()` function (supports OpenAI, Gemini, VoyageAI)
- Compute embeddings per-file (or per-chunk for large files) at index time
- Handles conceptual queries: "authentication middleware" → finds auth code even if those words don't appear
- Exposed via `helix search <query> --semantic`

**Hybrid (default in Phase 2):**
- Merge BM25 + semantic results via Reciprocal Rank Fusion (RRF)
- Same pattern as SocratiCode: `score = 1/(k + rank_bm25) + 1/(k + rank_semantic)`
- Uses HelixDB's built-in reranking capability
- No tuning required — RRF is robust to score scale differences
- Exposed via `helix search <query>` (becomes default once vectors exist)

**AST-aware search:**
- Delegate structural pattern matching to ast-grep
- "All functions that call `db.query`" → `helix search --ast "db.query($$$)"`
- Complements text search — finds patterns that regex can't express cleanly
- Reference: Claude Code paper's `ast_search` tool (arxiv:2603.05344)

FUSE projection: `/helix/search/<query>/` virtual directory returns ranked results as symlinks.

### Phase 3: RAG queries

`helix ask "how does authentication work?"` — search → retrieve top chunks → feed to LLM → return answer with file citations. The CLI becomes a conversational interface to the codebase graph.

### Phase 4: Multi-language import extraction

Add import extractors for Python (`import`, `from ... import`), Go (`import`), Rust (`use`, `mod`), and others. Each is a separate extractor module — the indexer dispatches based on file extension. AST-based extraction via ast-grep rather than regex for reliability.

### Phase 5: Document pipeline (markdown/PDF)

The original spec scope: ingest `.md` and `.pdf` files, extract structure (headings, frontmatter, links), chunk, and sync to HelixDB. Layer this on top of the validated file-tree graph.

### Phase 6: Cross-repo graphs

Index multiple repos into the same HelixDB instance. Cross-repo package dependencies become navigable edges. `helix deps --cross-repo src/app.ts` shows dependencies that live in other repos.

---

## Appendix: References and Prior Art

| Project / Paper | What it demonstrates | How it informs our design |
|---|---|---|
| **CocoIndex** (`cocoindex-code`) | Invisible daemon pattern: auto-start, version handshake, stateless Unix socket IPC, PID file lifecycle | Our daemon architecture directly follows this pattern |
| **Cursor CLI-for-agents** (SKILL.md) | Agent-facing CLI design: non-interactive, layered --help, idempotent, machine-parseable output | Our CLI design principles |
| **Cursor fast-regex-search** (blog) | Agents love grep; ripgrep is slow on large repos; indexing solves this | HelixDB's built-in BM25 replaces the need for a separate trigram index |
| **SocratiCode** | Hybrid BM25 + semantic search with RRF fusion, AST-aware chunking, dependency graph, incremental indexing, MCP-exposed tools | Direct reference for Phase 2 search architecture |
| **Claude Code paper** (arxiv:2603.05344) | 5-tool retrieval surface (read_file, list_files, text_search, find_symbol, ast_search), anchor-based tool selection, Code Explorer subagent | Validates that agents need multiple retrieval modes, not just grep |
| **ArsContexta** | Structure already in source files (frontmatter, wiki links, headings) is the graph — extract, don't invent | Core design principle for Phase 5 document pipeline |
