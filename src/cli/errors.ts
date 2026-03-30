export class CliError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function die(message: string, hint?: string): never {
  process.stderr.write(`error: ${message}\n`);
  if (hint) {
    process.stderr.write(`  ${hint}\n`);
  }
  throw new CliError(message);
}

export function dieUsage(message: string, usage: string): never {
  process.stderr.write(`error: ${message}\n\nUsage: ${usage}\n`);
  throw new CliError(message);
}
