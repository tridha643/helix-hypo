export const MAIN_HELP = `Usage: helix <command> [options]

Helix indexes a git repository's file structure and import graph into HelixDB,
then exposes it through query commands. Agents and humans can explore
dependencies, search content, and analyze the codebase without grep/find.

Getting started:
  1. Start HelixDB          (helix-db must be running on localhost:6969)
  2. helix index .           Index the current repo into HelixDB
  3. helix status            Verify the index is populated
  4. Query with any command below

Setup commands:
  index [path]          Build the full graph index (files, imports, packages,
                        dependency analysis) and sync to HelixDB. Run this
                        first, or after significant code changes.
  reindex [path]        Alias for index. Performs the same full rebuild.
  embed [path]          Recompute file embeddings only (skip structural index).
                        Use after index if embeddings are stale or missing.
  status                Show HelixDB connection, graph counts, daemon state,
                        and embedding coverage. Safe to run at any time.
  version               Show CLI and daemon version.

Query commands (require 'helix index' first):
  deps <file>           List files this file imports, or files that import it.
                        Returns import edges with specifiers and named imports.
  info <file>           Show file metadata: size, extension, dep depth, topo
                        order, cycle membership, entry/leaf/orphan status.
  tree [path]           List directory contents from the index. Similar to ls
                        but reads from the indexed graph, not the filesystem.
  graph <subcommand>    Dependency graph analysis: entry-points, leaf-deps,
                        orphans, cycles, topo-order, most-imported, stats.
  grep <query>          BM25 full-text search over indexed file content.
                        Supports scoped search within a file's dependencies.
  glob <pattern>        Match indexed files by glob pattern (e.g. **/*.ts).

FUSE commands (optional, requires FUSE-T):
  mount [mountpoint]    Mount a virtual filesystem at /tmp/helix that lets
                        agents navigate the graph with ls/cat/readlink.
  unmount               Unmount the FUSE virtual filesystem.

Options:
  -h, --help            Show help for a command
  --json                Output as JSON (where supported)

Common workflows:
  helix index .                              # First-time setup
  helix deps src/app.ts                      # What does app.ts import?
  helix deps src/app.ts --reverse            # What imports app.ts?
  helix graph entry-points                   # Files nothing imports
  helix graph stats                          # Quick index overview
  helix grep "fetchUser" --scope deps-of:src/api.ts  # Scoped search
  helix glob "**/*.test.ts"                  # Find all test files

All query commands support --json for machine-readable output.
Run 'helix <command> --help' for command-specific help.`;
