import { hasFlag } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { getPackageVersion } from "../../daemon/config.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const HELP = `Usage: helix version

Show CLI and daemon version information.

Examples:
  helix version
  helix version --json`;

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
  try {
    const status = (await sendDaemonRequest("status", {})) as {
      pid: number;
      version: string;
    };
    daemon = { pid: status.pid, version: status.version };
  } catch {
    // Daemon not running — that's fine
  }

  const result: VersionResult = { cli: cliVersion, daemon };

  if (json) {
    writeJson(result);
  } else {
    writeLines(formatText(result));
  }
}
