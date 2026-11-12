import { DATABASE_PATH, UPLOADS_DIR, assertTempPath, getDb } from "./db";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Passing guards on the safety net itself: tests must never reach data/resume.db.
describe("test database guard", () => {
  const tmp = fs.realpathSync(os.tmpdir());

  it("points the app at a database and uploads directory under the OS temp directory", async () => {
    expect(DATABASE_PATH.startsWith(tmp + path.sep)).toBe(true);
    expect(UPLOADS_DIR.startsWith(tmp + path.sep)).toBe(true);
    expect(path.resolve(process.env.DATABASE_PATH!)).toBe(DATABASE_PATH);
    const { db } = await getDb();
    const opened = (db as unknown as { $client: { name: string } }).$client.name;
    expect(fs.realpathSync(opened)).toBe(DATABASE_PATH);
    const { getUploadsDir } = await import("~/lib/uploads.server");
    expect(fs.realpathSync(getUploadsDir())).toBe(UPLOADS_DIR);
  });

  it("rejects the real database, the repository and unset paths", () => {
    expect(() => assertTempPath("data/resume.db", "x")).toThrow(/refusing to run/);
    expect(() => assertTempPath(path.resolve("data/uploads"), "x")).toThrow(/refusing to run/);
    expect(() => assertTempPath(os.homedir(), "x")).toThrow(/refusing to run/);
    expect(() => assertTempPath(tmp, "x")).toThrow(/refusing to run/);
    expect(() => assertTempPath(path.join(tmp, "..", "elsewhere.db"), "x")).toThrow(/refusing to run/);
    expect(() => assertTempPath(undefined, "x")).toThrow(/not set/);
  });
});
