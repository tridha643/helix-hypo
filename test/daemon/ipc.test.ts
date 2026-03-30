import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createIpcServer,
  decodeMessage,
  encodeMessage,
  FrameReader,
  type IpcRequest,
  type IpcResponse,
} from "../../src/daemon/ipc.js";

// ── Framing protocol ────────────────────────────────────────────────────────

test("encodeMessage produces a 4-byte header + JSON body", () => {
  const msg = { hello: "world" };
  const buf = encodeMessage(msg);

  assert.equal(buf.readUInt32BE(0), Buffer.from(JSON.stringify(msg)).length);
  assert.equal(buf.subarray(4).toString("utf8"), JSON.stringify(msg));
});

test("decodeMessage roundtrips with encodeMessage", () => {
  const original = { id: "abc", method: "ping", version: "0.1.0", params: {} };
  const encoded = encodeMessage(original);
  const decoded = decodeMessage(encoded);

  assert.ok(decoded);
  assert.deepEqual(decoded.payload, original);
  assert.equal(decoded.bytesConsumed, encoded.length);
});

test("decodeMessage returns null for incomplete header", () => {
  const buf = Buffer.alloc(2);
  assert.equal(decodeMessage(buf), null);
});

test("decodeMessage returns null for incomplete payload", () => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(100, 0); // Claim 100 bytes of payload
  const partial = Buffer.concat([header, Buffer.from("short")]);
  assert.equal(decodeMessage(partial), null);
});

test("FrameReader yields frames from chunked data", () => {
  const reader = new FrameReader();

  const msg1 = { id: "1", method: "ping" };
  const msg2 = { id: "2", method: "status" };
  const buf1 = encodeMessage(msg1);
  const buf2 = encodeMessage(msg2);
  const combined = Buffer.concat([buf1, buf2]);

  // Feed in small chunks
  const chunk1 = combined.subarray(0, 3);
  const chunk2 = combined.subarray(3, buf1.length + 2);
  const chunk3 = combined.subarray(buf1.length + 2);

  let frames = reader.push(chunk1);
  assert.equal(frames.length, 0);

  frames = reader.push(chunk2);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], msg1);

  frames = reader.push(chunk3);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], msg2);
});

// ── IPC server integration ──────────────────────────────────────────────────

test("createIpcServer handles a ping request over Unix socket", async () => {
  const socketPath = path.join(tmpdir(), `helix-ipc-test-${Date.now()}.sock`);

  const server = createIpcServer(socketPath, async (request) => ({
    id: request.id,
    ok: true,
    result: { pong: true },
    version: "0.1.0",
  }));

  try {
    const response = await new Promise<IpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 2_000);
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
            const request: IpcRequest = {
              id: "test-1",
              method: "ping",
              params: {},
              version: "0.1.0",
            };
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

    assert.equal(response.id, "test-1");
    assert.equal(response.ok, true);
    assert.deepEqual(response.result, { pong: true });
  } finally {
    server.close();
    try {
      unlinkSync(socketPath);
    } catch {
      // Already cleaned up
    }
  }
});
