export function writeJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function writeLines(lines: string[]): void {
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

export function writeDiagnostic(msg: string): void {
  process.stderr.write(`${msg}\n`);
}
