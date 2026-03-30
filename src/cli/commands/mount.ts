import { hasFlag, getPositional } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const MOUNT_HELP = `Usage: helix mount [mountpoint]

Mount the FUSE virtual filesystem. Requires FUSE-T and HelixDB running.

Arguments:
  mountpoint    Mount path (default: /tmp/helix)

Options:
  --json    Output as JSON

Examples:
  helix mount
  helix mount /tmp/my-mount`;

const UNMOUNT_HELP = `Usage: helix unmount

Unmount the FUSE virtual filesystem.

Options:
  --json    Output as JSON

Examples:
  helix unmount`;

export async function run(args: string[]): Promise<void> {
  const isUnmount = args[0] === "__unmount__";
  if (isUnmount) args.shift();

  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${isUnmount ? UNMOUNT_HELP : MOUNT_HELP}\n`);
    return;
  }

  const json = hasFlag(args, "--json");

  if (isUnmount) {
    const result = await sendDaemonRequest("unmount", {});

    if (json) {
      writeJson(result);
    } else {
      writeLines(["Unmounted"]);
    }
    return;
  }

  const mountPoint = getPositional(args) ?? "/tmp/helix";
  const result = await sendDaemonRequest("mount", {
    mountPoint,
    repoRoot: process.cwd(),
  });

  if (json) {
    writeJson(result);
  } else {
    writeLines([`Mounted at ${mountPoint}`]);
  }
}
