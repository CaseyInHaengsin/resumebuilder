// Phase 7 — one-time data migration for per-resume ordering.
//
// Until now nothing read the join rows' sort_order: the PDF listed a resume's
// jobs, projects and skills by the library row's sort_order (then id), and its
// bullets by the library bullet's sort_order (then id). Once the join rows'
// sort_order drives the PDF, existing resumes must keep that look, so a
// migration in ./drizzle has to rewrite sort_order on all four join tables.
//
// This file builds a database with only the migrations that existed before
// that change, inserts resumes whose join rows have scrambled and colliding
// sort_order values, applies the full ./drizzle folder, and checks the order.
// It never touches ~/db: both databases live in the helper's temp directory.
import { TEST_DIR, assertTempPath } from "../helpers/db";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_DRIZZLE = path.resolve(import.meta.dirname, "../../drizzle");

/** The migrations that existed before per-resume ordering. Do not add to this list. */
const TAGS_BEFORE_ORDERING = [
  "0000_sour_boomerang",
  "0001_marvelous_whistler",
  "0002_network_contacts",
];

interface Journal {
  entries: { tag: string }[];
  [key: string]: unknown;
}

/** Copies only the pre-ordering migrations into a temp migrations folder. */
function writeLegacyMigrationsFolder(): string {
  const folder = assertTempPath(path.join(TEST_DIR, "drizzle-before-ordering"), "legacy migrations folder");
  fs.mkdirSync(path.join(folder, "meta"), { recursive: true });
  const journal: Journal = JSON.parse(
    fs.readFileSync(path.join(REPO_DRIZZLE, "meta", "_journal.json"), "utf8"),
  );
  const entries = journal.entries.filter((e) => TAGS_BEFORE_ORDERING.includes(e.tag));
  if (entries.length !== TAGS_BEFORE_ORDERING.length) {
    throw new Error("drizzle/meta/_journal.json no longer lists the pre-ordering migrations");
  }
  for (const { tag } of entries) {
    fs.copyFileSync(path.join(REPO_DRIZZLE, `${tag}.sql`), path.join(folder, `${tag}.sql`));
  }
  fs.writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  return folder;
}

type Kind = "jobs" | "projects" | "bullets" | "skills";

const JOIN: Record<Kind, { table: string; column: string }> = {
  jobs: { table: "resume_jobs", column: "job_id" },
  projects: { table: "resume_projects", column: "project_id" },
  bullets: { table: "resume_bullets", column: "bullet_id" },
  skills: { table: "resume_skills", column: "skill_id" },
};
const KINDS = Object.keys(JOIN) as Kind[];

let sqlite: Database.Database;

/** Library ids of `kind` in the resume, in join-row order: sort_order, then join row id. */
function order(kind: Kind, resumeId: number): number[] {
  const { table, column } = JOIN[kind];
  return (
    sqlite
      .prepare(`SELECT ${column} AS libraryId FROM ${table} WHERE resume_id = ? ORDER BY sort_order, id`)
      .all(resumeId) as { libraryId: number }[]
  ).map((r) => r.libraryId);
}

function sortOrders(kind: Kind, resumeId: number): number[] {
  const { table } = JOIN[kind];
  return (
    sqlite.prepare(`SELECT sort_order AS s FROM ${table} WHERE resume_id = ?`).all(resumeId) as { s: number }[]
  ).map((r) => r.s);
}

/** [resume_id, library id] pairs, to check no row was added, dropped or repointed. */
function membership(kind: Kind): string[] {
  const { table, column } = JOIN[kind];
  return (
    sqlite.prepare(`SELECT id, resume_id AS r, ${column} AS l FROM ${table} ORDER BY id`).all() as {
      id: number;
      r: number;
      l: number;
    }[]
  ).map((row) => `${row.id}:${row.r}:${row.l}`);
}

// Library rows, 1-based ids in insertion order. `so` is the library sort_order.
// Each kind has a tie (broken by library id) and an order that differs from id order.
//   jobs      id: 1 2 3 4   so: 2 0 0 1   -> library order 2, 3, 4, 1
//   projects  id: 1 2 3     so: 1 1 0     -> library order 3, 1, 2
//   skills    id: 1 2 3 4   so: 3 2 2 0   -> library order 4, 2, 3, 1
//   bullets   id: 1 2 3 4 5 so: 1 0 0 2 0 -> library order 2, 3, 5, 1, 4
const LIBRARY_ORDER: Record<Kind, number[]> = {
  jobs: [2, 3, 4, 1],
  projects: [3, 1, 2],
  skills: [4, 2, 3, 1],
  bullets: [2, 3, 5, 1, 4],
};

// Join rows as [library id, stored sort_order], in insertion order. The stored
// values mimic the old toggle (row count at click time, colliding after removals).
const RESUMES: Record<number, Record<Kind, [number, number][]>> = {
  1: {
    jobs: [[1, 0], [3, 0], [2, 1], [4, 1]],
    projects: [[2, 0], [1, 1], [3, 1]],
    skills: [[1, 0], [2, 0], [3, 0], [4, 0]],
    bullets: [[4, 0], [1, 1], [5, 2], [3, 2], [2, 3]],
  },
  // A second resume of the same user with a different subset and different scrambling.
  2: {
    jobs: [[1, 4], [3, 9]],
    projects: [[1, 0], [3, 5]],
    skills: [[3, 1], [1, 1], [4, 7]],
    bullets: [[4, 0], [2, 0], [1, 0]],
  },
  // Another user's resume, drawing on that user's own library rows (ids below).
  3: {
    jobs: [[5, 0], [6, 1]],
    projects: [],
    skills: [],
    bullets: [[6, 0], [7, 0]],
  },
};

// The second user's library: job 5 (so 1), job 6 (so 0); bullets 6 (so 5), 7 (so 4).
const EXPECTED: Record<number, Record<Kind, number[]>> = {
  1: LIBRARY_ORDER,
  2: { jobs: [3, 1], projects: [3, 1], skills: [4, 3, 1], bullets: [2, 1, 4] },
  3: { jobs: [6, 5], projects: [], skills: [], bullets: [7, 6] },
};

let membershipBefore: Record<Kind, string[]>;
let orderBefore: Record<number, Record<Kind, number[]>>;

beforeAll(() => {
  const dbPath = assertTempPath(path.join(TEST_DIR, "before-ordering.db"), "legacy database");
  sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder: writeLegacyMigrationsFolder() });

  const user = sqlite.prepare("INSERT INTO users (username, password) VALUES (?, 'not-a-real-hash')");
  user.run("rosa-marlowe");
  user.run("jane-doe");

  const job = sqlite.prepare(
    "INSERT INTO jobs (user_id, title, company, dates, location, sort_order) VALUES (?, ?, 'Fernhill Robotics', '2022 - 2025', 'Remote', ?)",
  );
  [2, 0, 0, 1].forEach((so, i) => job.run(1, `Job ${i + 1}`, so));
  job.run(2, "Job 5", 1);
  job.run(2, "Job 6", 0);

  const project = sqlite.prepare(
    "INSERT INTO projects (user_id, name, dates, tech, sort_order) VALUES (1, ?, '2024', 'TypeScript', ?)",
  );
  [1, 1, 0].forEach((so, i) => project.run(`Project ${i + 1}`, so));

  const skill = sqlite.prepare(
    "INSERT INTO skills (user_id, category, name, items, sort_order) VALUES (1, ?, 'Default', '[\"TypeScript\"]', ?)",
  );
  [3, 2, 2, 0].forEach((so, i) => skill.run(`Category ${i + 1}`, so));

  const bullet = sqlite.prepare(
    "INSERT INTO bullets (user_id, parent_type, parent_id, text, tags, sort_order) VALUES (?, ?, ?, ?, '[]', ?)",
  );
  // Bullets 1-5 belong to the first user, spread over two jobs and a project.
  bullet.run(1, "job", 1, "Bullet 1", 1);
  bullet.run(1, "job", 2, "Bullet 2", 0);
  bullet.run(1, "job", 1, "Bullet 3", 0);
  bullet.run(1, "project", 1, "Bullet 4", 2);
  bullet.run(1, "job", 2, "Bullet 5", 0);
  bullet.run(2, "job", 5, "Bullet 6", 5);
  bullet.run(2, "job", 6, "Bullet 7", 4);

  const resume = sqlite.prepare(
    "INSERT INTO resumes (user_id, name, created_at, updated_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  );
  resume.run(1, "General resume");
  resume.run(1, "Platform roles");
  resume.run(2, "Jane's resume");

  for (const [resumeId, kinds] of Object.entries(RESUMES)) {
    for (const kind of KINDS) {
      const { table, column } = JOIN[kind];
      const insert = sqlite.prepare(`INSERT INTO ${table} (resume_id, ${column}, sort_order) VALUES (?, ?, ?)`);
      for (const [libraryId, sortOrder] of kinds[kind]) insert.run(Number(resumeId), libraryId, sortOrder);
    }
  }

  membershipBefore = Object.fromEntries(KINDS.map((k) => [k, membership(k)])) as Record<Kind, string[]>;
  orderBefore = Object.fromEntries(
    Object.keys(RESUMES).map((id) => [
      id,
      Object.fromEntries(KINDS.map((k) => [k, order(k, Number(id))])),
    ]),
  ) as Record<number, Record<Kind, number[]>>;

  // What `pnpm db:migrate` does on the owner's existing database.
  migrate(drizzle(sqlite), { migrationsFolder: REPO_DRIZZLE });
});

afterAll(() => {
  sqlite?.close();
});

describe("ordering migration on a database that predates per-resume ordering", () => {
  // Passing guard on the fixture: before the migration the stored order is not the PDF's order.
  it("starts from join rows whose stored order differs from the library order", () => {
    for (const kind of KINDS) {
      expect(orderBefore[1][kind]).not.toEqual(EXPECTED[1][kind]);
      expect(new Set(RESUMES[1][kind].map(([, so]) => so)).size).toBeLessThan(RESUMES[1][kind].length);
    }
  });

  it.each(["jobs", "projects", "skills"] as const)(
    "orders each resume's %s by the library row's sort_order, then library id",
    (kind) => {
      for (const id of [1, 2, 3]) expect(order(kind, id), `resume ${id}`).toEqual(EXPECTED[id][kind]);
    },
  );

  it("orders each resume's bullets by the library bullet's sort_order, then bullet id", () => {
    for (const id of [1, 2, 3]) expect(order("bullets", id), `resume ${id}`).toEqual(EXPECTED[id].bullets);
  });

  it.each(KINDS)("leaves no two %s of one resume in the same slot", (kind) => {
    for (const id of [1, 2, 3]) {
      const values = sortOrders(kind, id);
      expect(new Set(values).size, `resume ${id}`).toBe(values.length);
    }
  });

  // Passing guard: the migration only rewrites sort_order.
  it.each(KINDS)("keeps every %s join row pointing at the same resume and library row", (kind) => {
    expect(membership(kind)).toEqual(membershipBefore[kind]);
  });

  // Passing guard: applying the migrations a second time changes nothing.
  it("is applied once", () => {
    const before = KINDS.map((k) => [1, 2, 3].map((id) => sortOrders(k, id)));
    migrate(drizzle(sqlite), { migrationsFolder: REPO_DRIZZLE });
    expect(KINDS.map((k) => [1, 2, 3].map((id) => sortOrders(k, id)))).toEqual(before);
  });
});
