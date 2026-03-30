import { hasFlag } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const HELP = `Usage: helix status [options]

Show daemon status including pid, uptime, and version.

Options:
  --json    Output as JSON

Examples:
  helix status
  helix status --json`;

type StatusResult = {
  pid: number;
  startedAt: number;
  uptime: number;
  version: string;
};

export function formatText(result: StatusResult): string[] {
  const uptimeSec = Math.floor(result.uptime / 1000);
  const hours = Math.floor(uptimeSec / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const seconds = uptimeSec % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return [
    `pid:     ${result.pid}`,
    `uptime:  ${parts.join(" ")}`,
    `version: ${result.version}`,
  ];
}

export async function run(args: string[]): Promise<void> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const json = hasFlag(args, "--json");

  const result = (await sendDaemonRequest("status", {})) as StatusResult;

  if (json) {
    writeJson(result);
  } else {
    writeLines(formatText(result));
  }
}
