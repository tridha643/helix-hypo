import { hasFlag } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { getPackageVersion } from "../../daemon/config.js";
import { getDaemonStatus } from "../../daemon/lifecycle.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const HELP = `Usage: helix version [options]

Show CLI version and daemon version (if the daemon is running).
The daemon is an optional background process used for FUSE mounts.

Options:
  --json    Output as JSON

Examples:
  helix version                        # Show version info
  helix version --json                 # Machine-readable version`;

type VersionResult = {
  cli: string;
  daemon: { pid: number; version: string } | null;
};

export function formatText(result: VersionResult): string[] {
  const lines = [`helix ${result.cli} (cli)`];
  if (result.daemon) {
    lines.push(`helix ${result.daemon.version} (daemon, pid ${result.daemon.pid})`);
  } else {
    lines.push("daemon not running");
  }
  return lines;
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const json = hasFlag(args, "--json");
  const cliVersion = getPackageVersion();

  let daemon: VersionResult["daemon"] = null;
  const daemonStatus = await getDaemonStatus();
  if (daemonStatus.running && daemonStatus.socketResponsive) {
    try {
      const status = (await sendDaemonRequest("status", {})) as {
        pid: number;
        version: string;
      };
      daemon = { pid: status.pid, version: status.version };
    } catch {
      // Ignore daemon probe failures here — version output still useful.
    }
  }

  const result: VersionResult = { cli: cliVersion, daemon };

  if (json) {
    writeJson(result);
  } else {
    writeLines(formatText(result));
  }
}
