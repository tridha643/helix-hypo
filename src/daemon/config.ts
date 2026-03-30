import { readFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";

// ── Path constants ──────────────────────────────────────────────────────────

export const HELIX_DIR = path.join(homedir(), ".helix");
export const PID_PATH = path.join(HELIX_DIR, "daemon.pid");
export const SOCKET_PATH = path.join(HELIX_DIR, "daemon.sock");
export const LOG_PATH = path.join(HELIX_DIR, "daemon.log");
export const LOCK_PATH = path.join(HELIX_DIR, "daemon.lock");

// ── Types ───────────────────────────────────────────────────────────────────

export type HelixConfig = {
  apiKey: string | null;
  daemonLogLevel: string;
  fuseMountPoint: string;
  helixUrl: string;
  indexBatchSize: number;
  pidPath: string;
  socketPath: string;
};

type TomlDaemonSection = {
  log_level?: string;
  socket_path?: string;
  pid_path?: string;
  index_batch_size?: number;
};

type TomlHelixSection = {
  url?: string;
  api_key?: string;
};

type TomlFuseSection = {
  mount_point?: string;
};

type TomlConfig = {
  daemon?: TomlDaemonSection;
  fuse?: TomlFuseSection;
  helix?: TomlHelixSection;
};

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS: HelixConfig = {
  apiKey: null,
  daemonLogLevel: "info",
  fuseMountPoint: "/tmp/helix",
  helixUrl: "http://127.0.0.1:6970",
  indexBatchSize: 25,
  pidPath: PID_PATH,
  socketPath: SOCKET_PATH,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

export async function ensureHelixDir(): Promise<void> {
  mkdirSync(HELIX_DIR, { recursive: true });
}

function readTomlFile(filePath: string): TomlConfig | null {
  try {
    const content = readFileSync(filePath, "utf8");
    return parseToml(content) as unknown as TomlConfig;
  } catch {
    return null;
  }
}

function applyToml(config: HelixConfig, toml: TomlConfig): HelixConfig {
  const merged = { ...config };

  if (toml.helix?.url) {
    merged.helixUrl = toml.helix.url;
  }
  if (toml.helix?.api_key) {
    merged.apiKey = toml.helix.api_key;
  }
  if (toml.daemon?.log_level) {
    merged.daemonLogLevel = toml.daemon.log_level;
  }
  if (toml.daemon?.socket_path) {
    merged.socketPath = toml.daemon.socket_path;
  }
  if (toml.daemon?.pid_path) {
    merged.pidPath = toml.daemon.pid_path;
  }
  if (toml.daemon?.index_batch_size != null) {
    merged.indexBatchSize = toml.daemon.index_batch_size;
  }
  if (toml.fuse?.mount_point) {
    merged.fuseMountPoint = toml.fuse.mount_point;
  }

  return merged;
}

function applyEnv(config: HelixConfig): HelixConfig {
  const merged = { ...config };

  if (process.env.HELIX_URL) {
    merged.helixUrl = process.env.HELIX_URL;
  }
  if (process.env.HELIX_API_KEY) {
    merged.apiKey = process.env.HELIX_API_KEY;
  }

  return merged;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function loadConfig(repoRoot?: string): HelixConfig {
  let config = { ...DEFAULTS };

  // 1. Global config: ~/.helix/config.toml
  const globalToml = readTomlFile(path.join(HELIX_DIR, "config.toml"));
  if (globalToml) {
    config = applyToml(config, globalToml);
  }

  // 2. Project config: <repoRoot>/.helix/config.toml
  if (repoRoot) {
    const projectToml = readTomlFile(path.join(repoRoot, ".helix", "config.toml"));
    if (projectToml) {
      config = applyToml(config, projectToml);
    }
  }

  // 3. Environment variables (highest priority)
  config = applyEnv(config);

  return config;
}

export function getPackageVersion(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const pkgPath = path.resolve(path.dirname(thisFile), "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
