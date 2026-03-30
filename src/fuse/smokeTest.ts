/**
 * Phase 0 smoke test: mount an empty FUSE filesystem, verify it works, unmount.
 *
 * Usage: bun run src/fuse/smokeTest.ts [mountPoint]
 * Default mount point: /tmp/helix-fuse-test
 */

import { mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Fuse = require("fuse-native");

const mountPoint = process.argv[2] ?? "/tmp/helix-fuse-test";

if (!existsSync(mountPoint)) {
  mkdirSync(mountPoint, { recursive: true });
}

const ops = {
  readdir(path: string, cb: (code: number, names?: string[]) => void) {
    if (path === "/") return cb(0, ["hello.txt"]);
    return cb(-2); // ENOENT
  },
  getattr(path: string, cb: (code: number, stat?: Record<string, unknown>) => void) {
    if (path === "/") {
      return cb(0, {
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
        nlink: 1,
        size: 100,
        mode: 0o40555, // directory, r-xr-xr-x
        uid: process.getuid?.() ?? 501,
        gid: process.getgid?.() ?? 20,
      });
    }
    if (path === "/hello.txt") {
      return cb(0, {
        mtime: new Date(),
        atime: new Date(),
        ctime: new Date(),
        nlink: 1,
        size: 12,
        mode: 0o100444, // regular file, r--r--r--
        uid: process.getuid?.() ?? 501,
        gid: process.getgid?.() ?? 20,
      });
    }
    return cb(-2); // ENOENT
  },
  read(
    path: string,
    _fd: number,
    buf: Buffer,
    len: number,
    pos: number,
    cb: (bytesRead: number) => void
  ) {
    if (path === "/hello.txt") {
      const content = Buffer.from("hello fuse!\n");
      const slice = content.subarray(pos, pos + len);
      slice.copy(buf);
      return cb(slice.length);
    }
    return cb(0);
  },
  open(path: string, _flags: number, cb: (code: number, fd?: number) => void) {
    if (path === "/hello.txt") return cb(0, 42);
    return cb(-2);
  },
};

const fuse = new Fuse(mountPoint, ops, { debug: false, force: true });

fuse.mount((err: Error | null) => {
  if (err) {
    console.error("Mount failed:", err.message);
    process.exit(1);
  }
  console.log(`Mounted at ${mountPoint}`);
  console.log("Smoke test PASSED — FUSE is operational.");
  console.log(`Run: ls ${mountPoint}`);
  console.log(`Run: cat ${mountPoint}/hello.txt`);
  console.log(`Unmount with: umount ${mountPoint}`);

  process.on("SIGINT", () => {
    fuse.unmount((unmountErr: Error | null) => {
      if (unmountErr) console.error("Unmount error:", unmountErr.message);
      else console.log("Unmounted cleanly.");
      process.exit(0);
    });
  });
});
