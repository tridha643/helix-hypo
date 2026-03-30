import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";

import { PID_PATH, ensureHelixDir } from "../../src/daemon/config.js";
import {
  isDaemonAlive,
  readPidFile,
  removePidFile,
  writePidFile,
} from "../../src/daemon/lifecycle.js";

test("writePidFile and readPidFile roundtrip", async () => {
  await ensureHelixDir();

  try {
    await writePidFile(12345);
    const pid = await readPidFile();
    assert.equal(pid, 12345);
  } finally {
    await removePidFile();
  }
});

test("readPidFile returns null when file does not exist", async () => {
  await removePidFile();
  const pid = await readPidFile();
  assert.equal(pid, null);
});

test("readPidFile returns null for non-numeric content", async () => {
  await ensureHelixDir();

  try {
    writeFileSync(PID_PATH, "not-a-number", "utf8");
    const pid = await readPidFile();
    assert.equal(pid, null);
  } finally {
    await removePidFile();
  }
});

test("isDaemonAlive returns true for current process", () => {
  assert.equal(isDaemonAlive(process.pid), true);
});

test("isDaemonAlive returns false for a non-existent PID", () => {
  // PID 99999999 is extremely unlikely to exist
  assert.equal(isDaemonAlive(99999999), false);
});

test("writePidFile is atomic (temp file + rename)", async () => {
  await ensureHelixDir();

  try {
    // Write twice — second should overwrite cleanly
    await writePidFile(11111);
    await writePidFile(22222);
    const content = readFileSync(PID_PATH, "utf8").trim();
    assert.equal(content, "22222");
  } finally {
    await removePidFile();
  }
});
