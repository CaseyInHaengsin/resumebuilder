// Phase 7 — per-resume ordering.
//
// The join tables (resume_jobs, resume_projects, resume_bullets,
// resume_skills) carry a sortOrder. These tests pin that:
//   - the builder loader returns selected ids ordered by it (ties: join row id),
//   - toggling an item on appends it after every existing row of that kind,
//   - `_action=reorder` on /api/resumes reassigns the listed rows' slots,
//   - the order reaches the PDF data (loader output fed to buildResumeData).
import {
  SEED_TIMESTAMP,
  createUser,
  getDb,
  seedBullet,
  seedJob,
  seedProject,
  seedResume,
  seedSkill,
} from "../helpers/db";
import { formRequest, getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { beforeAll, describe, expect, it } from "vitest";

type Kind = "jobs" | "projects" | "bullets" | "skills";

interface KindSpec {
  kind: Kind;
  /** Join table and its library-id column. */
  table: string;
  column: string;
  /** Existing toggle action and its id field. */
  toggleAction: string;
  toggleField: string;
  /** Key of the loader result holding this kind's selected ids. */
  loaderKey: "selectedJobIds" | "selectedProjectIds" | "selectedBulletIds" | "selectedSkillIds";
}

const KINDS: KindSpec[] = [
  { kind: "jobs", table: "resume_jobs", column: "job_id", toggleAction: "toggle_job", toggleField: "jobId", loaderKey: "selectedJobIds" },
  { kind: "projects", table: "resume_projects", column: "project_id", toggleAction: "toggle_project", toggleField: "projectId", loaderKey: "selectedProjectIds" },
  { kind: "bullets", table: "resume_bullets", column: "bullet_id", toggleAction: "toggle_bullet", toggleField: "bulletId", loaderKey: "selectedBulletIds" },
  { kind: "skills", table: "resume_skills", column: "skill_id", toggleAction: "toggle_skill", toggleField: "skillId", loaderKey: "selectedSkillIds" },
];
const spec = (kind: Kind) => KINDS.find((k) => k.kind === kind)!;

const MISSING_ID = 987654;

let me: { id: number };
let stranger: { id: number };
let cookie: string;
/** A job of mine that the "bullets" library items hang from. */
let bulletParentId: number;

beforeAll(async () => {
  me = await createUser();
  stranger = await createUser();
  cookie = await sessionCookie(me.id);
  bulletParentId = (await seedJob(me.id, "Bullet Parent")).id;
});

// ── helpers ──

async function sqlite() {
  const { db } = await getDb();
  return db.$client;
}

let labelSeq = 0;

/** Creates `count` library items of `kind` for `userId` and returns their ids. */
async function seedLibrary(kind: Kind, count: number, userId = me.id): Promise<number[]> {
  const ids: number[] = [];
  let parentId = bulletParentId;
  if (kind === "bullets" && userId !== me.id) parentId = (await seedJob(userId, "Other Parent")).id;
  for (let i = 0; i < count; i++) {
    const label = `${kind} item ${++labelSeq}`;
    if (kind === "jobs") ids.push((await seedJob(userId, label)).id);
    else if (kind === "projects") ids.push((await seedProject(userId, label)).id);
    else if (kind === "skills") ids.push((await seedSkill(userId, label)).id);
    else ids.push((await seedBullet(userId, parentId, label)).id);
  }
  return ids;
}

/** Inserts join rows in the given order (so join row ids ascend in that order). */
async function select(kind: Kind, resumeId: number, rows: [libraryId: number, sortOrder: number][]) {
  const { table, column } = spec(kind);
  const client = await sqlite();
  const insert = client.prepare(
    `INSERT INTO ${table} (resume_id, ${column}, sort_order) VALUES (?, ?, ?)`,
  );
  for (const [libraryId, sortOrder] of rows) insert.run(resumeId, libraryId, sortOrder);
}

/** libraryId -> sortOrder for every join row of `kind` in the resume. */
async function slots(kind: Kind, resumeId: number): Promise<Record<number, number>> {
  const { table, column } = spec(kind);
  const client = await sqlite();
  const rows = client
    .prepare(`SELECT ${column} AS libraryId, sort_order AS sortOrder FROM ${table} WHERE resume_id = ? ORDER BY id`)
    .all(resumeId) as { libraryId: number; sortOrder: number }[];
  return Object.fromEntries(rows.map((r) => [r.libraryId, r.sortOrder]));
}

async function updatedAt(resumeId: number): Promise<string> {
  const client = await sqlite();
  const row = client.prepare("SELECT updated_at AS updatedAt FROM resumes WHERE id = ?").get(resumeId) as
    | { updatedAt: string }
    | undefined;
  if (!row) throw new Error(`resume ${resumeId} is gone`);
  return row.updatedAt;
}

async function post(fields: Record<string, string | number>, as = cookie) {
  const { action } = await import("~/routes/api.resumes");
  return run(action, formRequest("/api/resumes", fields, as));
}

function reorder(resumeId: number, kind: string, ids: number[] | string) {
  return post({
    _action: "reorder",
    resumeId,
    kind,
    ids: typeof ids === "string" ? ids : ids.join(","),
  });
}

type LoaderData = Awaited<ReturnType<(typeof import("~/routes/builder"))["loader"]>>;

async function load(resumeId: number): Promise<LoaderData> {
  const { loader } = await import("~/routes/builder");
  const result = await run<LoaderData>(
    loader,
    getRequest(`/builder/${resumeId}`, cookie),
    { id: String(resumeId) },
  );
  if (result instanceof Response) throw new Error(`builder loader returned ${result.status}`);
  return result;
}

/** The same call app/routes/builder.tsx makes for the preview and the PDF. */
async function render(resumeId: number) {
  const { buildResumeData } = await import("~/lib/resume-data");
  const data = await load(resumeId);
  return buildResumeData({
    resume: data.resume,
    contact: data.contact,
    education: data.education,
    summaries: data.allSummaries,
    jobs: data.allJobs,
    projects: data.allProjects,
    bullets: data.allBullets,
    skills: data.allSkills,
    selectedJobIds: data.selectedJobIds,
    selectedProjectIds: data.selectedProjectIds,
    selectedBulletIds: data.selectedBulletIds,
    selectedSkillIds: data.selectedSkillIds,
  });
}

// ── builder loader ──

describe("builder loader: selected ids follow the join rows' sortOrder", () => {
  it.each(KINDS)("$loaderKey is ordered by sortOrder, ties by join row id", async ({ kind, loaderKey }) => {
    const resume = await seedResume(me.id);
    const [a, b, c, d] = await seedLibrary(kind, 4);
    // Insertion (join id) order a, b, c, d; b and c share a slot.
    await select(kind, resume.id, [[a, 7], [b, 3], [c, 3], [d, 0]]);
    expect((await load(resume.id))[loaderKey]).toEqual([d, b, c, a]);
  });

  it("orders each kind independently and only within its own resume", async () => {
    const resume = await seedResume(me.id);
    const other = await seedResume(me.id, { name: "Other resume" });
    const [j1, j2] = await seedLibrary("jobs", 2);
    const [s1, s2] = await seedLibrary("skills", 2);
    await select("jobs", resume.id, [[j1, 1], [j2, 0]]);
    await select("skills", resume.id, [[s1, 0], [s2, 1]]);
    await select("jobs", other.id, [[j1, 0], [j2, 1]]);

    const mine = await load(resume.id);
    expect(mine.selectedJobIds).toEqual([j2, j1]);
    expect(mine.selectedSkillIds).toEqual([s1, s2]);
    expect((await load(other.id)).selectedJobIds).toEqual([j1, j2]);
  });

  it("a duplicated resume keeps the source's order", async () => {
    const resume = await seedResume(me.id);
    const [a, b, c] = await seedLibrary("jobs", 3);
    await select("jobs", resume.id, [[a, 2], [b, 0], [c, 1]]);

    const result = await post({ _action: "duplicate", id: resume.id });
    const location = result instanceof Response ? result.headers.get("Location") : null;
    const copyId = Number(location?.match(/\/builder\/(\d+)$/)?.[1]);
    expect(copyId).toBeGreaterThan(resume.id);
    expect((await load(copyId)).selectedJobIds).toEqual([b, c, a]);
  });
});

// ── toggle on ──

describe("api.resumes toggle_*: a newly selected item goes to the end", () => {
  it.each(KINDS)(
    "$toggleAction gives the new row a sortOrder above every existing one",
    async ({ kind, toggleAction, toggleField, loaderKey }) => {
      const resume = await seedResume(me.id);
      const [a, b, added] = await seedLibrary(kind, 3);
      // Two rows whose highest slot (5) is above the row count (2).
      await select(kind, resume.id, [[a, 5], [b, 0]]);

      const result = await post({ _action: toggleAction, resumeId: resume.id, [toggleField]: added });
      expect(statusOf(result)).toBe(200);

      const after = await slots(kind, resume.id);
      expect(after[a]).toBe(5);
      expect(after[b]).toBe(0);
      expect(after[added]).toBeGreaterThan(5);
      expect((await load(resume.id))[loaderKey]).toEqual([b, a, added]);
    },
  );

  it.each(KINDS)(
    "$toggleAction does not reuse a slot after a removal",
    async ({ kind, toggleAction, toggleField, loaderKey }) => {
      const resume = await seedResume(me.id);
      const [a, b, c, d] = await seedLibrary(kind, 4);
      const toggle = (id: number) => post({ _action: toggleAction, resumeId: resume.id, [toggleField]: id });
      await toggle(a);
      await toggle(b);
      await toggle(c);
      await toggle(a); // off
      await toggle(d);

      const after = await slots(kind, resume.id);
      expect(Object.keys(after).map(Number).sort((x, y) => x - y)).toEqual([b, c, d].sort((x, y) => x - y));
      expect(new Set(Object.values(after)).size).toBe(3);
      expect(after[d]).toBeGreaterThan(Math.max(after[b], after[c]));
      expect((await load(resume.id))[loaderKey]).toEqual([b, c, d]);
    },
  );

  it("counts only the same resume when appending", async () => {
    const busy = await seedResume(me.id, { name: "Busy resume" });
    const quiet = await seedResume(me.id, { name: "Quiet resume" });
    const [a, b, c] = await seedLibrary("jobs", 3);
    await select("jobs", busy.id, [[a, 40], [b, 50]]);
    await select("jobs", quiet.id, [[a, 3]]);

    await post({ _action: "toggle_job", resumeId: quiet.id, jobId: c });

    const after = await slots("jobs", quiet.id);
    expect(after[c]).toBeGreaterThan(3);
    expect((await load(quiet.id)).selectedJobIds).toEqual([a, c]);
    expect(await slots("jobs", busy.id)).toEqual({ [a]: 40, [b]: 50 });
  });

  // Passing guard: the first item of a kind still gets selected.
  it.each(KINDS)("$toggleAction selects the first item of an empty resume", async ({ kind, toggleAction, toggleField, loaderKey }) => {
    const resume = await seedResume(me.id);
    const [a] = await seedLibrary(kind, 1);
    const result = await post({ _action: toggleAction, resumeId: resume.id, [toggleField]: a });
    expect(statusOf(result)).toBe(200);
    expect((await load(resume.id))[loaderKey]).toEqual([a]);
  });
});

// ── reorder ──

describe("api.resumes reorder", () => {
  it.each(KINDS)("reorders all selected $kind and bumps updatedAt", async ({ kind, loaderKey }) => {
    const resume = await seedResume(me.id);
    const [a, b, c] = await seedLibrary(kind, 3);
    await select(kind, resume.id, [[a, 10], [b, 20], [c, 30]]);

    const result = await reorder(resume.id, kind, [c, a, b]);
    expect(statusOf(result)).toBe(200);

    // Same slots, handed out in the requested order.
    expect(await slots(kind, resume.id)).toEqual({ [c]: 10, [a]: 20, [b]: 30 });
    expect((await load(resume.id))[loaderKey]).toEqual([c, a, b]);
    expect(await updatedAt(resume.id)).not.toBe(SEED_TIMESTAMP);
  });

  it("reordering a subset reuses only that subset's slots", async () => {
    const resume = await seedResume(me.id);
    const [a, b, c, d] = await seedLibrary("skills", 4);
    await select("skills", resume.id, [[a, 0], [b, 1], [c, 2], [d, 3]]);

    expect(statusOf(await reorder(resume.id, "skills", [d, a]))).toBe(200);

    expect(await slots("skills", resume.id)).toEqual({ [d]: 0, [b]: 1, [c]: 2, [a]: 3 });
    expect((await load(resume.id)).selectedSkillIds).toEqual([d, b, c, a]);
  });

  it("reordering one job's bullets does not move another job's bullets", async () => {
    const resume = await seedResume(me.id);
    const first = await seedJob(me.id, "Staff Engineer");
    const second = await seedJob(me.id, "Backend Developer");
    const f1 = (await seedBullet(me.id, first.id, "First job, one")).id;
    const f2 = (await seedBullet(me.id, first.id, "First job, two")).id;
    const f3 = (await seedBullet(me.id, first.id, "First job, three")).id;
    const s1 = (await seedBullet(me.id, second.id, "Second job, one")).id;
    const s2 = (await seedBullet(me.id, second.id, "Second job, two")).id;
    await select("jobs", resume.id, [[first.id, 0], [second.id, 1]]);
    // The two jobs' bullets are interleaved in the resume's slot sequence.
    await select("bullets", resume.id, [[f1, 0], [s1, 1], [f2, 2], [s2, 3], [f3, 4]]);

    expect(statusOf(await reorder(resume.id, "bullets", [f3, f1, f2]))).toBe(200);

    expect(await slots("bullets", resume.id)).toEqual({ [f3]: 0, [s1]: 1, [f1]: 2, [s2]: 3, [f2]: 4 });
    expect((await load(resume.id)).selectedBulletIds).toEqual([f3, s1, f1, s2, f2]);
    const data = await render(resume.id);
    expect(data.jobs.map((j) => j.bullets)).toEqual([
      ["First job, three", "First job, one", "First job, two"],
      ["Second job, one", "Second job, two"],
    ]);
  });

  it("leaves other kinds and other resumes alone", async () => {
    const resume = await seedResume(me.id);
    const other = await seedResume(me.id, { name: "Other resume" });
    const [j1, j2] = await seedLibrary("jobs", 2);
    const [p1, p2] = await seedLibrary("projects", 2);
    await select("jobs", resume.id, [[j1, 0], [j2, 1]]);
    await select("projects", resume.id, [[p1, 0], [p2, 1]]);
    await select("jobs", other.id, [[j1, 0], [j2, 1]]);

    expect(statusOf(await reorder(resume.id, "jobs", [j2, j1]))).toBe(200);

    expect(await slots("jobs", resume.id)).toEqual({ [j2]: 0, [j1]: 1 });
    expect(await slots("projects", resume.id)).toEqual({ [p1]: 0, [p2]: 1 });
    expect(await slots("jobs", other.id)).toEqual({ [j1]: 0, [j2]: 1 });
    expect(await updatedAt(other.id)).toBe(SEED_TIMESTAMP);
  });

  it("the rendered resume follows a reorder of every kind", async () => {
    const resume = await seedResume(me.id);
    const jobA = await seedJob(me.id, "Staff Engineer");
    const jobB = await seedJob(me.id, "Backend Developer");
    const jobC = await seedJob(me.id, "Support Technician");
    const projA = await seedProject(me.id, "Trail Mapper");
    const projB = await seedProject(me.id, "Budget Tracker");
    const { db, schema } = await getDb();
    const skill = (category: string) =>
      db
        .insert(schema.skills)
        .values({ userId: me.id, category, name: `${category} set`, items: [category] })
        .returning()
        .get();
    const skillA = skill("Languages");
    const skillB = skill("Frameworks");
    const skillC = skill("Tools");
    const b1 = (await seedBullet(me.id, jobA.id, "Staff, one")).id;
    const b2 = (await seedBullet(me.id, jobA.id, "Staff, two")).id;

    await select("jobs", resume.id, [[jobA.id, 0], [jobB.id, 1], [jobC.id, 2]]);
    await select("projects", resume.id, [[projA.id, 0], [projB.id, 1]]);
    await select("skills", resume.id, [[skillA.id, 0], [skillB.id, 1], [skillC.id, 2]]);
    await select("bullets", resume.id, [[b1, 0], [b2, 1]]);

    expect(statusOf(await reorder(resume.id, "jobs", [jobC.id, jobA.id, jobB.id]))).toBe(200);
    expect(statusOf(await reorder(resume.id, "projects", [projB.id, projA.id]))).toBe(200);
    expect(statusOf(await reorder(resume.id, "skills", [skillB.id, skillC.id, skillA.id]))).toBe(200);
    expect(statusOf(await reorder(resume.id, "bullets", [b2, b1]))).toBe(200);

    const data = await render(resume.id);
    expect(data.jobs.map((j) => j.title)).toEqual(["Support Technician", "Staff Engineer", "Backend Developer"]);
    expect(data.jobs[1].bullets).toEqual(["Staff, two", "Staff, one"]);
    expect(data.projects.map((p) => p.name)).toEqual(["Budget Tracker", "Trail Mapper"]);
    expect(data.skills.map((s) => s.category)).toEqual(["Frameworks", "Tools", "Languages"]);
  });

  describe("rejects bad input with 400 and writes nothing", () => {
    async function setup() {
      const resume = await seedResume(me.id);
      const [a, b, c, unselected] = await seedLibrary("jobs", 4);
      await select("jobs", resume.id, [[a, 10], [b, 20], [c, 30]]);
      const expectUntouched = async () => {
        expect(await slots("jobs", resume.id)).toEqual({ [a]: 10, [b]: 20, [c]: 30 });
        expect(await updatedAt(resume.id)).toBe(SEED_TIMESTAMP);
      };
      return { resume, a, b, c, unselected, expectUntouched };
    }

    it("a duplicated id", async () => {
      const { resume, a, b, c, expectUntouched } = await setup();
      expect(statusOf(await reorder(resume.id, "jobs", [c, a, c, b]))).toBe(400);
      await expectUntouched();
    });

    it("an id that does not exist", async () => {
      const { resume, a, b, expectUntouched } = await setup();
      expect(statusOf(await reorder(resume.id, "jobs", [b, MISSING_ID, a]))).toBe(400);
      await expectUntouched();
    });

    it("a library item of mine that is not selected in this resume", async () => {
      const { resume, a, b, unselected, expectUntouched } = await setup();
      expect(statusOf(await reorder(resume.id, "jobs", [b, unselected, a]))).toBe(400);
      await expectUntouched();
    });

    it("an item selected only in another of my resumes", async () => {
      const { resume, a, b, unselected, expectUntouched } = await setup();
      const other = await seedResume(me.id, { name: "Other resume" });
      await select("jobs", other.id, [[unselected, 0]]);
      expect(statusOf(await reorder(resume.id, "jobs", [b, unselected, a]))).toBe(400);
      await expectUntouched();
      expect(await slots("jobs", other.id)).toEqual({ [unselected]: 0 });
    });

    it("an id selected under a different kind", async () => {
      const { resume, a, b, expectUntouched } = await setup();
      const [skill] = await seedLibrary("skills", 1);
      await select("skills", resume.id, [[skill, 0]]);
      // A selected job's id that is not also the selected skill's id.
      const jobId = a === skill ? b : a;
      expect(statusOf(await reorder(resume.id, "skills", [jobId]))).toBe(400);
      await expectUntouched();
      expect(await slots("skills", resume.id)).toEqual({ [skill]: 0 });
    });

    it.each(["companies", "job", "JOBS", "resume_jobs", ""])("unknown kind %j", async (kind) => {
      const { resume, a, b, c, expectUntouched } = await setup();
      expect(statusOf(await reorder(resume.id, kind, [c, b, a]))).toBe(400);
      await expectUntouched();
    });

    it("a missing kind field", async () => {
      const { resume, a, b, c, expectUntouched } = await setup();
      const result = await post({ _action: "reorder", resumeId: resume.id, ids: `${c},${b},${a}` });
      expect(statusOf(result)).toBe(400);
      await expectUntouched();
    });

    it("an empty ids list", async () => {
      const { resume, expectUntouched } = await setup();
      expect(statusOf(await reorder(resume.id, "jobs", ""))).toBe(400);
      await expectUntouched();
    });

    it("a missing ids field", async () => {
      const { resume, expectUntouched } = await setup();
      const result = await post({ _action: "reorder", resumeId: resume.id, kind: "jobs" });
      expect(statusOf(result)).toBe(400);
      await expectUntouched();
    });

    it.each(["abc", "1.5", "-1", "0"])("ids that are not row ids: %j", async (ids) => {
      const { resume, expectUntouched } = await setup();
      expect(statusOf(await reorder(resume.id, "jobs", ids))).toBe(400);
      await expectUntouched();
    });

    it("a list with an empty entry", async () => {
      const { resume, a, b, c, expectUntouched } = await setup();
      expect(statusOf(await reorder(resume.id, "jobs", `${c},,${b},${a}`))).toBe(400);
      await expectUntouched();
    });
  });

  describe("returns 404 for a resume that is not the user's", () => {
    it("another user's resume, even with ids selected in it", async () => {
      const theirs = await seedResume(stranger.id, { name: "Their resume" });
      const [x, y] = await seedLibrary("jobs", 2, stranger.id);
      await select("jobs", theirs.id, [[x, 0], [y, 1]]);

      expect(statusOf(await reorder(theirs.id, "jobs", [y, x]))).toBe(404);

      expect(await slots("jobs", theirs.id)).toEqual({ [x]: 0, [y]: 1 });
      expect(await updatedAt(theirs.id)).toBe(SEED_TIMESTAMP);
    });

    it("a resume that does not exist", async () => {
      const [a] = await seedLibrary("jobs", 1);
      expect(statusOf(await reorder(MISSING_ID, "jobs", [a]))).toBe(404);
    });
  });

  it("redirects a signed-out request to /login and writes nothing", async () => {
    const resume = await seedResume(me.id);
    const [a, b] = await seedLibrary("jobs", 2);
    await select("jobs", resume.id, [[a, 0], [b, 1]]);
    const { action } = await import("~/routes/api.resumes");
    const result = await run(
      action,
      formRequest("/api/resumes", { _action: "reorder", resumeId: resume.id, kind: "jobs", ids: `${b},${a}` }),
    );
    expect(statusOf(result)).toBe(302);
    expect(await slots("jobs", resume.id)).toEqual({ [a]: 0, [b]: 1 });
  });

  // Passing guard: a one-item list is valid and changes no slot.
  it("accepts a single selected id", async () => {
    const resume = await seedResume(me.id);
    const [a, b] = await seedLibrary("jobs", 2);
    await select("jobs", resume.id, [[a, 0], [b, 1]]);
    expect(statusOf(await reorder(resume.id, "jobs", [b]))).toBe(200);
    expect(await slots("jobs", resume.id)).toEqual({ [a]: 0, [b]: 1 });
  });
});
