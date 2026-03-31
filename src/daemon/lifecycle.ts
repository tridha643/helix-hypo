import { closeSync, constants as fsConstants, existsSync, openSync } from "node:fs";
import { readFile, writeFile, rename, unlink, stat, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureHelixDir,
  LOCK_PATH,
  LOG_PATH,
  PID_PATH,
  SOCKET_PATH,
} from "./config.js";
import { encodeMessage, decodeMessage, FrameReader, type IpcResponse } from "./ipc.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type DaemonStatus = {
  pid: number | null;
  running: boolean;
  socketResponsive: boolean;
};

// ── PID file operations ─────────────────────────────────────────────────────

export async function readPidFile(): Promise<number | null> {
  try {
    const content = await readFile(PID_PATH, "utf8");
    const pid = parseInt(content.trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export async function writePidFile(pid: number): Promise<void> {
  const tmpPath = `${PID_PATH}.tmp.${process.pid}`;
  await writeFile(tmpPath, String(pid), "utf8");
  await rename(tmpPath, PID_PATH);
}

export async function removePidFile(): Promise<void> {
  try {
    await unlink(PID_PATH);
  } catch {
    // Already gone — fine
  }
}

export async function removeSocketFile(): Promise<void> {
  try {
    await unlink(SOCKET_PATH);
  } catch {
    // Already gone — fine
  }
}

async function removeLockFile(): Promise<void> {
  try {
    await unlink(LOCK_PATH);
  } catch {
    // Already gone — fine
  }
}

// ── Process liveness ────────────────────────────────────────────────────────

export function isDaemonAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      // Process exists but we lack permission — treat as alive
      return true;
    }
    return false;
  }
}

// ── Socket probe ────────────────────────────────────────────────────────────

export async function probeDaemonSocket(timeoutMs = 500): Promise<boolean> {
  try {
    const { getPackageVersion } = await import("./config.js");
    const request = {
      id: crypto.randomUUID(),
      method: "ping",
      params: {},
      version: getPackageVersion(),
    };

    const response = await new Promise<IpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("probe timeout")), timeoutMs);
      const reader = new FrameReader();

      Bun.connect({
        unix: SOCKET_PATH,
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

    return response.ok === true;
  } catch {
    return false;
  }
}

// ── Lock file ───────────────────────────────────────────────────────────────

const LOCK_STALE_MS = 10_000;

async function acquireLock(): Promise<boolean> {
  try {
    const fd = await open(LOCK_PATH, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
    await fd.write(String(process.pid));
    await fd.close();
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      // Lock file exists — check staleness
      try {
        const lockStat = await stat(LOCK_PATH);
        const ageMs = Date.now() - lockStat.mtimeMs;
        if (ageMs > LOCK_STALE_MS) {
          await removeLockFile();
          return acquireLock();
        }
      } catch {
        // Lock vanished between EEXIST and stat — retry
        return acquireLock();
      }
      return false;
    }
    throw error;
  }
}

// ── Spawn / Stop / Restart ──────────────────────────────────────────────────

export function resolveDaemonEntry(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const baseDir = path.dirname(thisFile);
  const distEntry = path.resolve(baseDir, "daemon.js");
  if (existsSync(distEntry)) {
    return distEntry;
  }

  return path.resolve(baseDir, "daemon.ts");
}

export async function spawnDaemon(): Promise<void> {
  await ensureHelixDir();

  const daemonEntry = resolveDaemonEntry();

  const logFd = openSync(LOG_PATH, "a");

  const child = Bun.spawn(["bun", "run", daemonEntry], {
    stdio: ["ignore", "ignore", logFd],
    env: { ...process.env, HELIX_DAEMON: "1" },
  });

  child.unref();
  closeSync(logFd);
}

export async function stopDaemon(): Promise<void> {
  const pid = await readPidFile();
  if (pid == null) {
    await removePidFile();
    await removeSocketFile();
    return;
  }

  if (!isDaemonAlive(pid)) {
    await removePidFile();
    await removeSocketFile();
    return;
  }

  // SIGTERM → wait up to 2s → SIGKILL
  process.kill(pid, "SIGTERM");

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isDaemonAlive(pid)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (isDaemonAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // May have just exited
    }
  }

  await removePidFile();
  await removeSocketFile();
}

export async function restartDaemon(): Promise<void> {
  await stopDaemon();
  await spawnDaemon();
  await waitForSocket();
}

// ── Wait for socket readiness ───────────────────────────────────────────────

const POLL_INTERVAL_MS = 50;
const POLL_MAX_ATTEMPTS = 20;

async function waitForSocket(): Promise<void> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (await probeDaemonSocket()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("Daemon failed to become ready within 1s");
}

// ── ensureDaemonRunning ─────────────────────────────────────────────────────

export async function ensureDaemonRunning(): Promise<string> {
  await ensureHelixDir();

  // Step 1: Read PID file
  const pid = await readPidFile();

  if (pid != null) {
    // Step 2: Liveness check
    if (!isDaemonAlive(pid)) {
      // Stale PID — clean up and respawn
      await removePidFile();
      await removeSocketFile();
    } else {
      // Step 3: Socket probe
      if (await probeDaemonSocket()) {
        return SOCKET_PATH;
      }

      // Daemon process alive but socket unresponsive — kill and respawn
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // May have just exited
      }
      await removePidFile();
      await removeSocketFile();
    }
  }

  // Step 4: Acquire lock
  const gotLock = await acquireLock();
  if (!gotLock) {
    // Another process is spawning — wait for it
    await waitForSocket();
    return SOCKET_PATH;
  }

  try {
    // Step 5: Spawn daemon
    await spawnDaemon();

    // Step 6: Wait for readiness
    await waitForSocket();
  } finally {
    // Remove lock regardless
    await removeLockFile();
  }

  return SOCKET_PATH;
}

// ── Status ──────────────────────────────────────────────────────────────────

export async function getDaemonStatus(): Promise<DaemonStatus> {
  const pid = await readPidFile();

  if (pid == null) {
    return { pid: null, running: false, socketResponsive: false };
  }

  const running = isDaemonAlive(pid);
  const socketResponsive = running ? await probeDaemonSocket() : false;

  return { pid, running, socketResponsive };
}
