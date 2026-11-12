/**
 * Throwaway database for tests. IMPORT THIS FIRST in every test file that
 * touches `~/db` (directly or through a route, lib or MCP module), and load
 * those app modules with a dynamic `await import("~/...")` afterwards.
 *
 * On import (once per test file, since vitest isolates files) this module:
 *   1. creates a fresh directory under the OS temp directory,
 *   2. points DATABASE_PATH and UPLOADS_DIR into it and sets SESSION_SECRET,
 *   3. refuses to continue unless both paths resolve inside the OS temp
 *      directory and outside the repository,
 *   4. applies the drizzle migrations to the temp database.
 *
 * `getDb()` re-checks that the connection `~/db` actually opened is the temp
 * file, which catches a test that imported `~/db` before this helper.
 *
 * The real `data/resume.db` and `data/uploads/` are never opened.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const TMP_ROOT = fs.realpathSync(os.tmpdir());

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Throws unless `p` resolves inside the OS temp directory and outside the repo. */
export function assertTempPath(p: string | undefined, label: string): string {
  if (!p) throw new Error(`[tests/helpers/db] ${label} is not set`);
  const resolved = path.resolve(p);
  // Resolve symlinks on the deepest existing ancestor (/var -> /private/var on macOS).
  let existing = resolved;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = path.join(
    fs.realpathSync(existing),
    path.relative(existing, resolved),
  );
  if (!isInside(TMP_ROOT, real) || real === REPO_ROOT || isInside(REPO_ROOT, real)) {
    throw new Error(
      `[tests/helpers/db] refusing to run: ${label} resolves to ${real}, ` +
        `which is not inside the OS temp directory ${TMP_ROOT}`,
    );
  }
  return real;
}

const tempDir = fs.mkdtempSync(path.join(TMP_ROOT, "resume-builder-test-"));

process.env.DATABASE_PATH = path.join(tempDir, "test.db");
process.env.UPLOADS_DIR = path.join(tempDir, "uploads");
process.env.SESSION_SECRET = "test-session-secret";

export const TEST_DIR = tempDir;
export const DATABASE_PATH = assertTempPath(
  process.env.DATABASE_PATH,
  "DATABASE_PATH",
);
export const UPLOADS_DIR = assertTempPath(process.env.UPLOADS_DIR, "UPLOADS_DIR");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Same steps as scripts/migrate.mjs, against the temp file.
{
  const sqlite = new Database(DATABASE_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), {
    migrationsFolder: path.join(REPO_ROOT, "drizzle"),
  });
  sqlite.close();
}

// Registered as a file-level hook in whichever test file imported this module.
afterAll(() => {
  try {
    assertTempPath(tempDir, "temp directory");
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // leave it for the OS to clean up
  }
});

type AppDb = (typeof import("~/db"))["db"];
type Schema = typeof import("~/db/schema");

/** The app's own drizzle instance and schema, verified to be the temp database. */
export async function getDb(): Promise<{ db: AppDb; schema: Schema }> {
  assertTempPath(process.env.DATABASE_PATH, "DATABASE_PATH");
  const { db } = await import("~/db");
  const schema = await import("~/db/schema");
  const opened = (db as unknown as { $client: { name: string } }).$client.name;
  if (assertTempPath(opened, "the database opened by ~/db") !== DATABASE_PATH) {
    throw new Error(
      `[tests/helpers/db] ~/db opened ${opened}, expected ${DATABASE_PATH}. ` +
        `Import tests/helpers/db before any ~/ module.`,
    );
  }
  return { db, schema };
}

// ── Seed helpers (fictional people only) ──

const OLD = "2026-01-01T00:00:00.000Z";
let seq = 0;

/** Inserts a user. The password column holds a placeholder, not a usable hash. */
export async function createUser(username?: string): Promise<{ id: number; username: string }> {
  const { db, schema } = await getDb();
  const name = username ?? `test-user-${++seq}`;
  return db
    .insert(schema.users)
    .values({ username: name, password: "not-a-real-hash" })
    .returning({ id: schema.users.id, username: schema.users.username })
    .get();
}

export async function seedSummary(userId: number, name = "Backend focus") {
  const { db, schema } = await getDb();
  return db
    .insert(schema.summaries)
    .values({ userId, name, text: `${name} summary text` })
    .returning()
    .get();
}

export async function seedCompany(userId: number, name = "Fernhill Robotics") {
  const { db, schema } = await getDb();
  return db
    .insert(schema.companies)
    .values({ userId, name, createdAt: OLD, updatedAt: OLD })
    .returning()
    .get();
}

export async function seedResume(
  userId: number,
  values: Partial<Schema["resumes"]["$inferInsert"]> = {},
) {
  const { db, schema } = await getDb();
  return db
    .insert(schema.resumes)
    .values({
      userId,
      name: "General resume",
      createdAt: OLD,
      updatedAt: OLD,
      ...values,
    })
    .returning()
    .get();
}

export async function seedJob(userId: number, title = "Staff Engineer") {
  const { db, schema } = await getDb();
  return db
    .insert(schema.jobs)
    .values({
      userId,
      title,
      company: "Fernhill Robotics",
      dates: "2022 - 2025",
      location: "Remote",
    })
    .returning()
    .get();
}

export async function seedProject(userId: number, name = "Trail Mapper") {
  const { db, schema } = await getDb();
  return db
    .insert(schema.projects)
    .values({ userId, name, dates: "2024", tech: "TypeScript" })
    .returning()
    .get();
}

export async function seedBullet(userId: number, parentId: number, text = "Cut build time in half") {
  const { db, schema } = await getDb();
  return db
    .insert(schema.bullets)
    .values({ userId, parentType: "job", parentId, text, tags: [] })
    .returning()
    .get();
}

export async function seedSkill(userId: number, name = "Default") {
  const { db, schema } = await getDb();
  return db
    .insert(schema.skills)
    .values({ userId, category: "Languages", name, items: ["TypeScript"] })
    .returning()
    .get();
}

export async function seedApplication(
  userId: number,
  values: Partial<Schema["applications"]["$inferInsert"]> = {},
) {
  const { db, schema } = await getDb();
  return db
    .insert(schema.applications)
    .values({
      userId,
      jobTitle: "Platform Engineer",
      status: "applied",
      createdAt: OLD,
      updatedAt: OLD,
      ...values,
    })
    .returning()
    .get();
}

/** Timestamp the seed helpers use for createdAt/updatedAt. */
export const SEED_TIMESTAMP = OLD;
