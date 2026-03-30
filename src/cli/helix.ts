#!/usr/bin/env bun

import { hasFlag } from "./args.js";
import { CliError } from "./errors.js";
import { MAIN_HELP } from "./help.js";

type CommandHandler = (args: string[]) => Promise<void>;

const commands: Record<string, () => Promise<{ run: CommandHandler }>> = {
  deps:    () => import("./commands/deps.js"),
  glob:    () => import("./commands/glob.js"),
  graph:   () => import("./commands/graph.js"),
  grep:    () => import("./commands/grep.js"),
  index:   () => import("./commands/index.js"),
  info:    () => import("./commands/info.js"),
  mount:   () => import("./commands/mount.js"),
  reindex: () => import("./commands/index.js"),
  status:  () => import("./commands/status.js"),
  tree:    () => import("./commands/tree.js"),
  unmount: () => import("./commands/mount.js"),
  version: () => import("./commands/version.js"),
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || hasFlag(args, "--help") || hasFlag(args, "-h")) {
    process.stdout.write(`${MAIN_HELP}\n`);
    return;
  }

  const commandName = args.shift()!;

  // For unmount, inject it so the mount module knows which action
  if (commandName === "unmount") {
    args.unshift("__unmount__");
  }

  // For reindex, inject a marker so the index module knows
  if (commandName === "reindex") {
    args.unshift("__reindex__");
  }

  const loader = commands[commandName];
  if (!loader) {
    process.stderr.write(`error: Unknown command "${commandName}"\n`);
    process.stderr.write(`  Run 'helix --help' for a list of commands.\n`);
    process.exitCode = 1;
    return;
  }

  const mod = await loader();
  await mod.run(args);
}

main().catch((error) => {
  if (error instanceof CliError) {
    process.exitCode = error.exitCode;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
});
