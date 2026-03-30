import assert from "node:assert/strict";
import test from "node:test";

import { ensureHelixDir, getPackageVersion, SOCKET_PATH } from "../../src/daemon/config.js";
import {
  encodeMessage,
  FrameReader,
  type IpcRequest,
  type IpcResponse,
} from "../../src/daemon/ipc.js";
import {
  ensureDaemonRunning,
  readPidFile,
  isDaemonAlive,
  stopDaemon,
} from "../../src/daemon/lifecycle.js";

async function sendRaw(socketPath: string, request: IpcRequest): Promise<IpcResponse> {
  return new Promise<IpcResponse>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 5_000);
    const reader = new FrameReader();

    Bun.connect({
      unix: socketPath,
      socket: {
        data(_socket, rawData) {
          const frames = reader.push(Buffer.from(rawData));
          if (frames.length > 0) {
            clearTimeout(timer);
            resolve(frames[0] as IpcResponse);
          }
        },
        open(socket) {
          socket.write(encodeMessage(request));
        },
        close() {
          clearTimeout(timer);
        },
        error(_socket, error) {
          clearTimeout(timer);
          reject(error);
        },
        connectError(_socket, error) {
          clearTimeout(timer);
          reject(error);
        },
      },
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// ── Integration tests (spawns real daemon) ──────────────────────────────────

test("daemon auto-starts and responds to ping", async () => {
  await ensureHelixDir();

  // Stop any existing daemon first
  await stopDaemon();

  try {
    const socketPath = await ensureDaemonRunning();
    assert.equal(socketPath, SOCKET_PATH);

    const version = getPackageVersion();
    const response = await sendRaw(socketPath, {
      id: "test-ping",
      method: "ping",
      params: {},
      version,
    });

    assert.equal(response.ok, true);
    assert.deepEqual(response.result, { pong: true });
  } finally {
    await stopDaemon();
  }
});

test("daemon writes PID file with valid PID", async () => {
  await ensureHelixDir();
  await stopDaemon();

  try {
    await ensureDaemonRunning();
    const pid = await readPidFile();

    assert.ok(pid != null, "PID file should contain a PID");
    assert.ok(pid > 0, "PID should be positive");
    assert.equal(isDaemonAlive(pid), true, "Daemon process should be alive");
  } finally {
    await stopDaemon();
  }
});

test("daemon status handler returns uptime and version", async () => {
  await ensureHelixDir();
  await stopDaemon();

  try {
    const socketPath = await ensureDaemonRunning();
    const version = getPackageVersion();

    const response = await sendRaw(socketPath, {
      id: "test-status",
      method: "status",
      params: {},
      version,
    });

    assert.equal(response.ok, true);
    const result = response.result as {
      pid: number;
      version: string;
      uptime: number;
      startedAt: number;
    };
    assert.equal(typeof result.pid, "number");
    assert.equal(result.version, version);
    assert.ok(result.uptime >= 0);
    assert.ok(result.startedAt > 0);
  } finally {
    await stopDaemon();
  }
});

test("daemon returns VERSION_MISMATCH for wrong version", async () => {
  await ensureHelixDir();
  await stopDaemon();

  try {
    const socketPath = await ensureDaemonRunning();

    const response = await sendRaw(socketPath, {
      id: "test-mismatch",
      method: "ping",
      params: {},
      version: "99.99.99",
    });

    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "VERSION_MISMATCH");
  } finally {
    await stopDaemon();
  }
});

test("daemon returns UNKNOWN_METHOD for invalid method", async () => {
  await ensureHelixDir();
  await stopDaemon();

  try {
    const socketPath = await ensureDaemonRunning();
    const version = getPackageVersion();

    const response = await sendRaw(socketPath, {
      id: "test-unknown",
      method: "nonexistent_method",
      params: {},
      version,
    });

    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "UNKNOWN_METHOD");
  } finally {
    await stopDaemon();
  }
});

test("stopDaemon cleans up PID and socket files", async () => {
  await ensureHelixDir();
  await stopDaemon();

  await ensureDaemonRunning();
  await stopDaemon();

  const pid = await readPidFile();
  assert.equal(pid, null, "PID file should be removed after stop");
});

test("ensureDaemonRunning recovers from stale PID file", async () => {
  await ensureHelixDir();
  await stopDaemon();

  // Write a stale PID (process that doesn't exist)
  const { writePidFile } = await import("../../src/daemon/lifecycle.js");
  await writePidFile(99999999);

  try {
    // Should detect stale PID, clean up, and spawn fresh
    const socketPath = await ensureDaemonRunning();
    assert.equal(socketPath, SOCKET_PATH);

    const version = getPackageVersion();
    const response = await sendRaw(socketPath, {
      id: "test-recovery",
      method: "ping",
      params: {},
      version,
    });

    assert.equal(response.ok, true);
    assert.deepEqual(response.result, { pong: true });
  } finally {
    await stopDaemon();
  }
});
