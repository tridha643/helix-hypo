import { SOCKET_PATH } from "./config.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type IpcRequest = {
  id: string;
  method: string;
  params: Record<string, unknown>;
  version: string;
};

export type IpcError = {
  code: string;
  message: string;
};

export type IpcResponse = {
  error?: IpcError;
  id: string;
  ok: boolean;
  result?: unknown;
  version: string;
};

export type IpcHandler = (request: IpcRequest) => Promise<IpcResponse>;

// ── Length-prefixed framing ─────────────────────────────────────────────────
// Format: [4 bytes uint32 BE payload length][UTF-8 JSON payload]

const HEADER_SIZE = 4;

export function encodeMessage(payload: object): Buffer {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8");
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function decodeMessage(buffer: Buffer): { bytesConsumed: number; payload: object } | null {
  if (buffer.length < HEADER_SIZE) {
    return null;
  }

  const payloadLength = buffer.readUInt32BE(0);
  const totalLength = HEADER_SIZE + payloadLength;

  if (buffer.length < totalLength) {
    return null;
  }

  const json = buffer.subarray(HEADER_SIZE, totalLength).toString("utf8");
  return {
    bytesConsumed: totalLength,
    payload: JSON.parse(json) as object,
  };
}

// ── FrameReader ─────────────────────────────────────────────────────────────

export class FrameReader {
  private buffer = Buffer.alloc(0);

  push(data: Buffer | Uint8Array): object[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(data)]);
    const frames: object[] = [];

    while (true) {
      const result = decodeMessage(this.buffer);
      if (!result) {
        break;
      }
      frames.push(result.payload);
      this.buffer = this.buffer.subarray(result.bytesConsumed);
    }

    return frames;
  }
}

// ── IPC Server (Bun.listen unix) ────────────────────────────────────────────

export function createIpcServer(
  socketPath: string,
  handler: IpcHandler
): { close(): void } {
  type SocketData = { reader: FrameReader; pending: Buffer | null };

  const server = Bun.listen<SocketData>({
    unix: socketPath,
    socket: {
      data(socket, rawData) {
        const reader = socket.data.reader;
        const frames = reader.push(Buffer.from(rawData));

        for (const frame of frames) {
          handler(frame as IpcRequest)
            .then((response) => {
              writeAndClose(socket, encodeMessage(response));
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              const errorResponse: IpcResponse = {
                id: (frame as IpcRequest).id ?? "unknown",
                ok: false,
                error: { code: "INTERNAL_ERROR", message },
                version: "unknown",
              };
              writeAndClose(socket, encodeMessage(errorResponse));
            });
        }
      },
      drain(socket) {
        const pending = socket.data.pending;
        if (!pending) {
          socket.end();
          return;
        }
        const written = socket.write(pending);
        if (written >= pending.length) {
          socket.data.pending = null;
          socket.end();
        } else if (written > 0) {
          socket.data.pending = pending.subarray(written);
        }
      },
      open(socket) {
        socket.data = { reader: new FrameReader(), pending: null };
      },
      close() {},
      error(_socket, error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[ipc-server] socket error: ${message}\n`);
      },
    },
  });

  function writeAndClose(socket: import("bun").Socket<SocketData>, encoded: Buffer): void {
    const written = socket.write(encoded);
    if (written >= encoded.length) {
      socket.end();
    } else {
      // Partial write — store remainder, drain callback will finish it
      socket.data.pending = written > 0 ? encoded.subarray(written) : encoded;
    }
  }

  return {
    close() {
      server.stop(true);
    },
  };
}

// ── IPC Client ──────────────────────────────────────────────────────────────

async function rawSend(
  socketPath: string,
  request: IpcRequest,
  timeoutMs = 120_000
): Promise<IpcResponse> {
  return new Promise<IpcResponse>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("IPC request timed out")); }
    }, timeoutMs);

    const reader = new FrameReader();

    Bun.connect({
      unix: socketPath,
      socket: {
        data(_socket, rawData) {
          const frames = reader.push(Buffer.from(rawData));
          if (frames.length > 0 && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(frames[0] as IpcResponse);
          }
        },
        open(socket) {
          socket.write(encodeMessage(request));
        },
        close() {
          clearTimeout(timer);
          if (!settled) { settled = true; reject(new Error("Connection closed before response")); }
        },
        error(_socket, error) {
          clearTimeout(timer);
          if (!settled) { settled = true; reject(error); }
        },
        connectError(_socket, error) {
          clearTimeout(timer);
          if (!settled) { settled = true; reject(error); }
        },
      },
    }).catch((error) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(error); }
    });
  });
}

export type SendRequestOptions = {
  socketPath?: string;
  timeoutMs?: number;
};

export async function sendDaemonRequest(
  method: string,
  params: Record<string, unknown>,
  options: SendRequestOptions = {}
): Promise<unknown> {
  const socketPath = options.socketPath ?? SOCKET_PATH;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const { getPackageVersion } = await import("./config.js");

  const version = getPackageVersion();
  const request: IpcRequest = {
    id: crypto.randomUUID(),
    method,
    params,
    version,
  };

  let response: IpcResponse;
  try {
    response = await rawSend(socketPath, request, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot reach Helix daemon at ${socketPath}: ${message}`);
  }

  if (!response.ok) {
    const code = response.error?.code ?? "UNKNOWN";
    const message = response.error?.message ?? "Unknown daemon error";
    throw new Error(`Daemon error [${code}]: ${message}`);
  }

  return response.result;
}
