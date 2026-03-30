import { unlinkSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { HelixDB } from "helix-ts";

import {
  ensureHelixDir,
  getPackageVersion,
  loadConfig,
  LOG_PATH,
  SOCKET_PATH,
} from "./config.js";
import {
  createIpcServer,
  type IpcHandler,
  type IpcRequest,
  type IpcResponse,
} from "./ipc.js";
import { removePidFile, removeSocketFile, writePidFile } from "./lifecycle.js";

import { indexRepository } from "../indexer/indexRepo.js";
import { createHelixClient, ensureHelixReachable } from "../indexer/syncToHelix.js";

// ── Globals ─────────────────────────────────────────────────────────────────

const daemonVersion = getPackageVersion();
const startedAt = Date.now();
let helixClient: HelixDB | null = null;

function log(level: string, message: string): void {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [${level}] ${message}\n`);
}

// ── HelixDB client (lazy) ───────────────────────────────────────────────────

function getHelixClient(helixUrl?: string, apiKey?: string | null): HelixDB {
  if (!helixClient) {
    helixClient = createHelixClient(helixUrl, apiKey);
  }
  return helixClient;
}

async function helixQuery(
  queryName: string,
  params: Record<string, unknown>,
  helixUrl?: string,
  apiKey?: string | null
): Promise<unknown> {
  const client = getHelixClient(helixUrl, apiKey);
  const response = await client.query(queryName, params);

  if (response && typeof response === "object") {
    if ("error" in response && typeof response.error === "string") {
      throw new Error(response.error);
    }
    if ("data" in response) {
      return response.data;
    }
    if ("result" in response) {
      return response.result;
    }
  }

  return response;
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

  async index(params, config) {
    const repoRoot = params.repoRoot as string;
    if (!repoRoot) {
      throw new HandlerError("INVALID_PARAMS", "repoRoot is required");
    }

    const result = await indexRepository({
      apiKey: (params.apiKey as string | undefined) ?? config.apiKey,
      deployQueries: params.deploy !== false,
      helixUrl: (params.helixUrl as string | undefined) ?? config.helixUrl,
      repoRoot,
      syncToDb: true,
    });

    // Invalidate cached client — config may have changed
    helixClient = null;

    return {
      helixCounts: result.helixCounts,
      summary: result.summary,
    };
  },

  async query(params, config) {
    const queryName = params.queryName as string;
    if (!queryName) {
      throw new HandlerError("INVALID_PARAMS", "queryName is required");
    }

    const queryParams = (params.params as Record<string, unknown>) ?? {};

    try {
      await ensureHelixReachable(config.helixUrl);
    } catch {
      throw new HandlerError("HELIX_UNAVAILABLE", `Cannot reach HelixDB at ${config.helixUrl}`);
    }

    return helixQuery(queryName, queryParams, config.helixUrl, config.apiKey);
  },

  async deps(params, config) {
    const fileId = params.fileId as string;
    if (!fileId) {
      throw new HandlerError("INVALID_PARAMS", "fileId is required");
    }

    try {
      await ensureHelixReachable(config.helixUrl);
    } catch {
      throw new HandlerError("HELIX_UNAVAILABLE", `Cannot reach HelixDB at ${config.helixUrl}`);
    }

    const reverse = params.reverse === true;
    const queryName = reverse ? "GetFileImportedBy" : "GetFileImports";
    return helixQuery(queryName, { file_id: fileId }, config.helixUrl, config.apiKey);
  },

  async graph(params, config) {
    const subcommand = params.subcommand as string;
    if (!subcommand) {
      throw new HandlerError("INVALID_PARAMS", "subcommand is required");
    }

    try {
      await ensureHelixReachable(config.helixUrl);
    } catch {
      throw new HandlerError("HELIX_UNAVAILABLE", `Cannot reach HelixDB at ${config.helixUrl}`);
    }

    // Handle stats subcommand: aggregate multiple queries
    if (subcommand === "stats") {
      const [counts, entryPoints, leafDeps, orphans, cycles] = await Promise.all([
        helixQuery("GetIndexCounts", {}, config.helixUrl, config.apiKey),
        helixQuery("ListEntryPoints", {}, config.helixUrl, config.apiKey),
        helixQuery("ListLeafDependencies", {}, config.helixUrl, config.apiKey),
        helixQuery("ListOrphans", {}, config.helixUrl, config.apiKey),
        helixQuery("ListCycles", {}, config.helixUrl, config.apiKey),
      ]);

      // HelixDB wraps list results as { files: [...] }
      const unwrap = (r: unknown): unknown[] => {
        if (Array.isArray(r)) return r;
        if (r && typeof r === "object" && "files" in r) {
          return (r as Record<string, unknown>).files as unknown[];
        }
        return [];
      };

      return {
        counts,
        cycles: unwrap(cycles).length,
        entryPoints: unwrap(entryPoints).length,
        leafDeps: unwrap(leafDeps).length,
        orphans: unwrap(orphans).length,
      };
    }

    const queryParams = (params.params as Record<string, unknown>) ?? {};

    const validQueries: Record<string, string> = {
      cycles: "ListCycles",
      "cycle-files": "GetFilesInCycle",
      "entry-points": "ListEntryPoints",
      "leaf-deps": "ListLeafDependencies",
      "most-imported": "ListMostImported",
      orphans: "ListOrphans",
      "topo-order": "GetTopologicalOrder",
    };

    const queryName = validQueries[subcommand];
    if (!queryName) {
      throw new HandlerError(
        "INVALID_PARAMS",
        `Unknown graph subcommand "${subcommand}". Valid: ${Object.keys(validQueries).join(", ")}`
      );
    }

    return helixQuery(queryName, queryParams, config.helixUrl, config.apiKey);
  },

  async info(params, config) {
    const fileId = params.fileId as string;
    if (!fileId) {
      throw new HandlerError("INVALID_PARAMS", "fileId is required");
    }

    try {
      await ensureHelixReachable(config.helixUrl);
    } catch {
      throw new HandlerError("HELIX_UNAVAILABLE", `Cannot reach HelixDB at ${config.helixUrl}`);
    }

    return helixQuery("GetFileByPath", { file_id: fileId }, config.helixUrl, config.apiKey);
  },

  async tree(params, config) {
    try {
      await ensureHelixReachable(config.helixUrl);
    } catch {
      throw new HandlerError("HELIX_UNAVAILABLE", `Cannot reach HelixDB at ${config.helixUrl}`);
    }

    const dirId = (params.dirId as string) ?? "";
    return helixQuery("ListDirectoryContents", { dir_id: dirId }, config.helixUrl, config.apiKey);
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
