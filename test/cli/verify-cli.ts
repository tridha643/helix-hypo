#!/usr/bin/env bun
/**
 * End-to-end CLI verification script.
 * Run: bun test/cli/verify-cli.ts
 *
 * Prerequisites: HelixDB running on port 6969, repo already indexed.
 * Executes each CLI command as a subprocess and validates exit codes,
 * stdout patterns, and JSON validity.
 */

type Check = {
  cmd: string;
  expect: {
    exitCode: number;
    json?: boolean;
    stderr?: RegExp;
    stdout?: RegExp;
  };
};

const checks: Check[] = [
  // Help
  { cmd: "helix --help",           expect: { exitCode: 0, stdout: /Setup commands:/ } },
  { cmd: "helix deps --help",      expect: { exitCode: 0, stdout: /Examples:/ } },
  { cmd: "helix graph --help",     expect: { exitCode: 0, stdout: /Examples:/ } },
  { cmd: "helix grep --help",      expect: { exitCode: 0, stdout: /Examples:/ } },
  { cmd: "helix glob --help",      expect: { exitCode: 0, stdout: /Examples:/ } },
  { cmd: "helix index --help",     expect: { exitCode: 0, stdout: /Examples:/ } },
  { cmd: "helix info --help",      expect: { exitCode: 0, stdout: /Examples:/ } },
  { cmd: "helix tree --help",      expect: { exitCode: 0, stdout: /Examples:/ } },
  { cmd: "helix status --help",    expect: { exitCode: 0, stdout: /Examples:/ } },
  { cmd: "helix version --help",   expect: { exitCode: 0, stdout: /Usage:/ } },
  { cmd: "helix mount --help",     expect: { exitCode: 0, stdout: /Usage:/ } },
  { cmd: "helix unmount --help",   expect: { exitCode: 0, stdout: /Usage:/ } },

  // Version/status
  { cmd: "helix version",          expect: { exitCode: 0, stdout: /helix \d+\.\d+\.\d+/ } },
  { cmd: "helix status",           expect: { exitCode: 0, stdout: /reachable:/ } },
  { cmd: "helix status --json",    expect: { exitCode: 0, json: true } },

  // Graph analysis
  { cmd: "helix graph stats",      expect: { exitCode: 0 } },
  { cmd: "helix graph stats --json", expect: { exitCode: 0, json: true } },
  { cmd: "helix graph entry-points", expect: { exitCode: 0 } },
  { cmd: "helix graph orphans",    expect: { exitCode: 0 } },
  { cmd: "helix graph cycles",     expect: { exitCode: 0 } },
  { cmd: "helix graph topo-order", expect: { exitCode: 0 } },
  { cmd: "helix graph leaf-deps",  expect: { exitCode: 0 } },
  { cmd: "helix graph most-imported", expect: { exitCode: 0 } },

  // Deps (use a known file from this repo)
  { cmd: "helix deps src/prisma.ts", expect: { exitCode: 0 } },
  { cmd: "helix deps --reverse src/prisma.ts", expect: { exitCode: 0 } },
  { cmd: "helix deps --json src/prisma.ts", expect: { exitCode: 0, json: true } },

  // Info
  { cmd: "helix info src/prisma.ts", expect: { exitCode: 0 } },
  { cmd: "helix info src/prisma.ts --json", expect: { exitCode: 0, json: true } },

  // Tree
  { cmd: "helix tree",             expect: { exitCode: 0 } },
  { cmd: "helix tree src",         expect: { exitCode: 0 } },
  { cmd: "helix tree --json",      expect: { exitCode: 0, json: true } },

  // Index status
  { cmd: "helix index --status",   expect: { exitCode: 0 } },
  { cmd: "helix index --status --json", expect: { exitCode: 0, json: true } },

  // Grep
  { cmd: 'helix grep "import"',    expect: { exitCode: 0 } },
  { cmd: 'helix grep "import" --json', expect: { exitCode: 0, json: true } },

  // Glob
  { cmd: 'helix glob "**/*.ts"',   expect: { exitCode: 0, stdout: /\.ts/ } },
  { cmd: 'helix glob "**/*.ts" --json', expect: { exitCode: 0, json: true } },

  // Error cases
  { cmd: "helix deps",             expect: { exitCode: 1, stderr: /error/ } },
  { cmd: "helix info",             expect: { exitCode: 1, stderr: /error/ } },
  { cmd: "helix grep",             expect: { exitCode: 1, stderr: /error/ } },
  { cmd: "helix glob",             expect: { exitCode: 1, stderr: /error/ } },
  { cmd: "helix graph",            expect: { exitCode: 1, stderr: /error/ } },
  { cmd: "helix bogus",            expect: { exitCode: 1, stderr: /error/ } },
];

async function runCheck(check: Check): Promise<{ message: string; pass: boolean }> {
  const shellArgs = (check.cmd.replace(/^helix /, "").match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map(
    (a) => a.replace(/^"|"$/g, "")
  );
  const proc = Bun.spawn(["bun", "src/cli/helix.ts", ...shellArgs], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = proc.exitCode ?? (await proc.exited);

  // Check exit code
  if (exitCode !== check.expect.exitCode) {
    return {
      pass: false,
      message: `expected exit ${check.expect.exitCode}, got ${exitCode}\n  stderr: ${stderr.trim()}`,
    };
  }

  // Check stdout pattern
  if (check.expect.stdout && !check.expect.stdout.test(stdout)) {
    return {
      pass: false,
      message: `stdout did not match ${check.expect.stdout}\n  stdout: ${stdout.slice(0, 200)}`,
    };
  }

  // Check stderr pattern
  if (check.expect.stderr && !check.expect.stderr.test(stderr)) {
    return {
      pass: false,
      message: `stderr did not match ${check.expect.stderr}\n  stderr: ${stderr.slice(0, 200)}`,
    };
  }

  // Check JSON validity
  if (check.expect.json) {
    try {
      JSON.parse(stdout);
    } catch {
      return {
        pass: false,
        message: `stdout is not valid JSON\n  stdout: ${stdout.slice(0, 200)}`,
      };
    }
  }

  return { pass: true, message: "OK" };
}

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    const result = await runCheck(check);
    if (result.pass) {
      passed += 1;
      process.stdout.write(`  PASS  ${check.cmd}\n`);
    } else {
      failed += 1;
      process.stdout.write(`  FAIL  ${check.cmd}\n        ${result.message}\n`);
    }
  }

  process.stdout.write(`\n${passed} passed, ${failed} failed, ${checks.length} total\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Verification failed: ${message}\n`);
  process.exitCode = 1;
});
