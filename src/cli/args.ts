/**
 * Check if a boolean flag (e.g. --json, --reverse) is present.
 * Mutates the array to remove the flag.
 */
export function hasFlag(args: string[], name: string): boolean {
  const idx = args.indexOf(name);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/**
 * Get a flag's string value (e.g. --limit 20, --scope deps-of:foo).
 * Mutates the array to remove the flag and its value.
 * Returns null if not present.
 */
export function getOption(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  const value = args[idx + 1] ?? null;
  if (value === null) {
    args.splice(idx, 1);
  } else {
    args.splice(idx, 2);
  }
  return value;
}

/**
 * Get the first non-flag positional argument.
 * Does not mutate the array.
 */
export function getPositional(args: string[]): string | null {
  for (const arg of args) {
    if (!arg.startsWith("-")) return arg;
  }
  return null;
}
