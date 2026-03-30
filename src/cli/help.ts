export const MAIN_HELP = `Usage: helix <command> [options]

Commands:
  index [path]          Index a git repository into HelixDB
  reindex [path]        Re-index a git repository (alias for index)
  status                Show daemon status
  version               Show version information
  deps <file>           List file dependencies
  info <file>           Show file metadata
  tree [path]           List directory contents
  graph <subcommand>    Query dependency graph analysis
  grep <query>          Search file content (BM25)
  glob <pattern>        Match files by glob pattern
  mount [mountpoint]    Mount FUSE virtual filesystem
  unmount               Unmount FUSE virtual filesystem

Options:
  -h, --help            Show help for a command
  --json                Output as JSON (where supported)

Examples:
  helix index .
  helix deps src/app.ts --reverse
  helix graph entry-points --json
  helix grep "import" --scope deps-of:src/app.ts
  helix glob "**/*.test.ts"

Run 'helix <command> --help' for command-specific help.`;
