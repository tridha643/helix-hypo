import { hasFlag, getPositional } from "../args.js";
import { writeJson, writeLines } from "../format.js";
import { ensureDaemonRunning, getDaemonStatus } from "../../daemon/lifecycle.js";
import { sendDaemonRequest } from "../../daemon/ipc.js";

const MOUNT_HELP = `Usage: helix mount [mountpoint] [options]

Mount a read-only FUSE virtual filesystem that projects the HelixDB graph.
Agents can navigate dependencies with ls/cat/readlink instead of queries.

Layout at the mount point:
  /files/<id>/content        File content
  /files/<id>/imports/       Symlinks to imported files
  /files/<id>/imported-by/   Symlinks to files that import this one
  /tree/                     Mirrors repo directory structure
  /index/entry-points/       Symlinks to entry point files
  /index/cycles/             Cycle subdirectories
  /stats.json                Index summary

Requires: FUSE-T installed, HelixDB running, repo indexed.
Auto-starts the helix daemon if not already running.

Arguments:
  mountpoint    Mount path (default: /tmp/helix)

Options:
  --json    Output as JSON

Examples:
  helix mount                          # Mount at /tmp/helix
  helix mount /tmp/my-mount            # Custom mount point`;

const UNMOUNT_HELP = `Usage: helix unmount [options]

Unmount the FUSE virtual filesystem and stop the mount process.

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
    const daemonStatus = await getDaemonStatus();
    if (!daemonStatus.running || !daemonStatus.socketResponsive) {
      const result = { unmounted: true, wasRunning: false };
      if (json) {
        writeJson(result);
      } else {
        writeLines(["Nothing mounted."]);
      }
      return;
    }

    const result = await sendDaemonRequest("unmount", {});

    if (json) {
      writeJson(result);
    } else {
      writeLines(["Unmounted"]);
    }
    return;
  }

  const mountPoint = getPositional(args) ?? "/tmp/helix";
  await ensureDaemonRunning();
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
