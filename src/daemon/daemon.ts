import { unlinkSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  ensureHelixDir,
  getPackageVersion,
  loadConfig,
  SOCKET_PATH,
} from "./config.js";
import {
  createIpcServer,
  type IpcHandler,
  type IpcRequest,
  type IpcResponse,
} from "./ipc.js";
import { removePidFile, removeSocketFile, writePidFile } from "./lifecycle.js";
import { ensureHelixReachable } from "../indexer/syncToHelix.js";

// ── Globals ─────────────────────────────────────────────────────────────────

const daemonVersion = getPackageVersion();
const startedAt = Date.now();

function log(level: string, message: string): void {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [${level}] ${message}\n`);
}

// ── RPC method handlers ─────────────────────────────────────────────────────

type MethodHandler = (
  params: Record<string, unknown>,
  config: ReturnType<typeof loadConfig>
) => Promise<unknown>;

const handlers: Record<string, MethodHandler> = {
  async ping() {
    return { pong: true };
  },

  async status() {
    return {
      pid: process.pid,
      startedAt,
      uptime: Date.now() - startedAt,
      version: daemonVersion,
    };
  },

  async mount(params, config) {
    if (fuseProcess) {
      return { mounted: true, mountPoint: fuseMountPoint };
    }

    const repoRoot = params.repoRoot as string;
    if (!repoRoot) {
      throw new HandlerError("INVALID_PARAMS", "repoRoot is required");
    }

    const mountPoint = (params.mountPoint as string) ?? config.fuseMountPoint;

    try {
      await ensureHelixReachable(config.helixUrl);
    } catch {
      throw new HandlerError("HELIX_UNAVAILABLE", `Cannot reach HelixDB at ${config.helixUrl}`);
    }

    // Spawn Node.js process for FUSE mount (fuse-native requires Node, not Bun)
    const thisFile = fileURLToPath(import.meta.url);
    const mountScript = path.resolve(path.dirname(thisFile), "../fuse/mount.ts");

    const env: Record<string, string> = { ...process.env as Record<string, string>, HELIX_URL: config.helixUrl };
    if (config.apiKey) env.HELIX_API_KEY = config.apiKey;

    return new Promise<unknown>((resolve, reject) => {
      const child = spawn("node", ["--import", "tsx", mountScript, mountPoint, repoRoot], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let started = false;

      child.stderr?.on("data", (chunk: Buffer) => {
        const msg = chunk.toString();
        log("info", `[fuse] ${msg.trim()}`);
        if (!started && msg.includes("FUSE mounted")) {
          started = true;
          fuseProcess = child;
          fuseMountPoint = mountPoint;
          resolve({ mounted: true, mountPoint });
        }
      });

      child.on("error", (err) => {
        if (!started) reject(new HandlerError("FUSE_ERROR", err.message));
      });

      child.on("exit", (code) => {
        fuseProcess = null;
        fuseMountPoint = null;
        if (!started) {
          reject(new HandlerError("FUSE_ERROR", `Mount process exited with code ${code}`));
        } else {
          log("info", `FUSE process exited (code=${code})`);
        }
      });

      // Timeout
      setTimeout(() => {
        if (!started) {
          child.kill();
          reject(new HandlerError("FUSE_TIMEOUT", "FUSE mount did not start within 15s"));
        }
      }, 15000);
    });
  },

  async unmount() {
    if (!fuseProcess) {
      return { unmounted: true, wasRunning: false };
    }

    return new Promise<unknown>((resolve) => {
      fuseProcess!.on("exit", () => {
        fuseProcess = null;
        fuseMountPoint = null;
        resolve({ unmounted: true, wasRunning: true });
      });
      fuseProcess!.kill("SIGINT");

      // Timeout — force kill if needed
      setTimeout(() => {
        if (fuseProcess) {
          fuseProcess.kill("SIGKILL");
          fuseProcess = null;
          fuseMountPoint = null;
          resolve({ unmounted: true, wasRunning: true, forced: true });
        }
      }, 5000);
    });
  },
};

// ── FUSE mount state ───────────────────────────────────────────────────────

let fuseProcess: ChildProcess | null = null;
let fuseMountPoint: string | null = null;

// ── Handler error ───────────────────────────────────────────────────────────

class HandlerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ── Request router ──────────────────────────────────────────────────────────

const requestHandler: IpcHandler = async (request: IpcRequest): Promise<IpcResponse> => {
  const baseResponse = { id: request.id, version: daemonVersion };

  // Version handshake
  if (request.version !== daemonVersion) {
    return {
      ...baseResponse,
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        message: `Daemon version ${daemonVersion} does not match client version ${request.version}`,
      },
    };
  }

  const handler = handlers[request.method];
  if (!handler) {
    return {
      ...baseResponse,
      ok: false,
      error: {
        code: "UNKNOWN_METHOD",
        message: `Unknown method "${request.method}"`,
      },
    };
  }

  try {
    // Load config fresh per request
    const repoRoot = request.params.repoRoot as string | undefined;
    const config = loadConfig(repoRoot);

    const result = await handler(request.params, config);
    return { ...baseResponse, ok: true, result };
  } catch (error) {
    if (error instanceof HandlerError) {
      return {
        ...baseResponse,
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    log("error", `Handler error [${request.method}]: ${message}`);
    return {
      ...baseResponse,
      ok: false,
      error: { code: "INTERNAL_ERROR", message },
    };
  }
};

// ── Graceful shutdown ───────────────────────────────────────────────────────

let server: { close(): void } | null = null;

async function shutdown(reason: string): Promise<void> {
  log("info", `Shutting down: ${reason}`);

  // Unmount FUSE if running
  if (fuseProcess) {
    log("info", "Unmounting FUSE...");
    fuseProcess.kill("SIGINT");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (fuseProcess) fuseProcess.kill("SIGKILL");
        resolve();
      }, 3000);
      fuseProcess!.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    fuseProcess = null;
    fuseMountPoint = null;
  }

  if (server) {
    server.close();
    server = null;
  }
  await removePidFile();
  await removeSocketFile();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("info", `Daemon starting (pid=${process.pid}, version=${daemonVersion})`);

  // 1. Ensure ~/.helix/ exists
  await ensureHelixDir();

  // 2. Clean up stale socket from prior crash
  try {
    unlinkSync(SOCKET_PATH);
  } catch {
    // Doesn't exist — fine
  }

  // 3. Write PID file
  await writePidFile(process.pid);

  // 4. Start IPC server
  server = createIpcServer(SOCKET_PATH, requestHandler);
  log("info", `Listening on ${SOCKET_PATH}`);

  // 5. Signal handlers
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT").then(() => process.exit(0));
  });

  // 6. Uncaught error handlers
  process.on("uncaughtException", (error) => {
    log("error", `Uncaught exception: ${error.message}`);
    shutdown("uncaughtException").then(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    log("error", `Unhandled rejection: ${message}`);
    shutdown("unhandledRejection").then(() => process.exit(1));
  });

  log("info", "Daemon ready");
}

// Only run when executed directly as the daemon process
if (process.env.HELIX_DAEMON === "1") {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Daemon startup failed: ${message}\n`);
    process.exitCode = 1;
  });
}
