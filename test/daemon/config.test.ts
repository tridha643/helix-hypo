import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { getPackageVersion, loadConfig } from "../../src/daemon/config.js";

test("loadConfig returns defaults when no config files exist", () => {
  // Use a nonexistent repo root so no project config is found
  const config = loadConfig("/tmp/nonexistent-repo-root-" + Date.now());

  assert.equal(config.helixUrl, "http://127.0.0.1:6969");
  assert.equal(config.daemonLogLevel, "info");
  assert.equal(config.indexBatchSize, 25);
  assert.equal(config.apiKey, null);
});

test("loadConfig picks up project config.toml", () => {
  const fakeRepo = path.join(tmpdir(), `helix-test-repo-${Date.now()}`);
  const helixDir = path.join(fakeRepo, ".helix");

  try {
    mkdirSync(helixDir, { recursive: true });
    writeFileSync(
      path.join(helixDir, "config.toml"),
      '[helix]\nurl = "http://custom:1234"\n\n[daemon]\nlog_level = "debug"\nindex_batch_size = 50\n'
    );

    const config = loadConfig(fakeRepo);

    assert.equal(config.helixUrl, "http://custom:1234");
    assert.equal(config.daemonLogLevel, "debug");
    assert.equal(config.indexBatchSize, 50);
  } finally {
    rmSync(fakeRepo, { recursive: true, force: true });
  }
});

test("loadConfig env vars override config file values", () => {
  const fakeRepo = path.join(tmpdir(), `helix-test-repo-${Date.now()}`);
  const helixDir = path.join(fakeRepo, ".helix");

  const origUrl = process.env.HELIX_URL;
  const origKey = process.env.HELIX_API_KEY;

  try {
    mkdirSync(helixDir, { recursive: true });
    writeFileSync(
      path.join(helixDir, "config.toml"),
      '[helix]\nurl = "http://from-file:1234"\napi_key = "file-key"\n'
    );

    process.env.HELIX_URL = "http://from-env:9999";
    process.env.HELIX_API_KEY = "env-key";

    const config = loadConfig(fakeRepo);

    assert.equal(config.helixUrl, "http://from-env:9999");
    assert.equal(config.apiKey, "env-key");
  } finally {
    if (origUrl !== undefined) {
      process.env.HELIX_URL = origUrl;
    } else {
      delete process.env.HELIX_URL;
    }
    if (origKey !== undefined) {
      process.env.HELIX_API_KEY = origKey;
    } else {
      delete process.env.HELIX_API_KEY;
    }
    rmSync(fakeRepo, { recursive: true, force: true });
  }
});

test("getPackageVersion returns a semver string", () => {
  const version = getPackageVersion();
  assert.match(version, /^\d+\.\d+\.\d+/);
});
