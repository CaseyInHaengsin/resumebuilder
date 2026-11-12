import {
  SEED_TIMESTAMP,
  createUser,
  getDb,
  seedBullet,
  seedCompany,
  seedJob,
  seedProject,
  seedResume,
  seedSkill,
  seedSummary,
} from "../helpers/db";
import { formRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// The ids in TEMPLATES (app/components/pdf/types.ts), listed here so this file
// does not load the PDF components.
const TEMPLATE_IDS = ["modern", "classic", "minimal"];
const MISSING_ID = 987654;

let me: { id: number };
let stranger: { id: number };
let cookie: string;

beforeAll(async () => {
  me = await createUser();
  stranger = await createUser();
  cookie = await sessionCookie(me.id);
});

async function post(fields: Record<string, string | number>) {
  const { action } = await import("~/routes/api.resumes");
  return run(action, formRequest("/api/resumes", fields, cookie));
}

async function resumeRow(id: number) {
  const { db, schema } = await getDb();
  const row = db.select().from(schema.resumes).where(eq(schema.resumes.id, id)).get();
  if (!row) throw new Error(`resume ${id} is gone`);
  return row;
}

describe("api.resumes set_template", () => {
  it.each(["fancy", "", "Modern", "modern "])(
    "rejects unknown template %j with 400 and leaves the resume unchanged",
    async (template) => {
      const resume = await seedResume(me.id, { template: "classic" });
      const result = await post({
        _action: "set_template",
        resumeId: resume.id,
        template,
      });
      expect(statusOf(result)).toBe(400);
      const after = await resumeRow(resume.id);
      expect(after.template).toBe("classic");
      expect(after.updatedAt).toBe(SEED_TIMESTAMP);
    },
  );

  it("rejects a request with no template field", async () => {
    const resume = await seedResume(me.id, { template: "classic" });
    const result = await post({ _action: "set_template", resumeId: resume.id });
    expect(statusOf(result)).toBe(400);
    expect((await resumeRow(resume.id)).template).toBe("classic");
  });

  // Passing guard: the valid ids must keep working once validation is added.
  it.each(TEMPLATE_IDS)("accepts template %s", async (template) => {
    const start = template === "modern" ? "classic" : "modern";
    const resume = await seedResume(me.id, { template: start });
    const result = await post({
      _action: "set_template",
      resumeId: resume.id,
      template,
    });
    expect(statusOf(result)).toBe(200);
    const after = await resumeRow(resume.id);
    expect(after.template).toBe(template);
    expect(after.updatedAt).not.toBe(SEED_TIMESTAMP);
  });
});

type ToggleCase = {
  action: string;
  field: string;
  /** Seeds a library row for the user and returns its id. */
  seed: (userId: number) => Promise<number>;
  /** Library ids currently attached to the resume. */
  attached: (resumeId: number) => Promise<number[]>;
};

const TOGGLES: ToggleCase[] = [
  {
    action: "toggle_job",
    field: "jobId",
    seed: async (userId) => (await seedJob(userId)).id,
    attached: async (resumeId) => {
      const { db, schema } = await getDb();
      return db
        .select()
        .from(schema.resumeJobs)
        .where(eq(schema.resumeJobs.resumeId, resumeId))
        .all()
        .map((r) => r.jobId);
    },
  },
  {
    action: "toggle_project",
    field: "projectId",
    seed: async (userId) => (await seedProject(userId)).id,
    attached: async (resumeId) => {
      const { db, schema } = await getDb();
      return db
        .select()
        .from(schema.resumeProjects)
        .where(eq(schema.resumeProjects.resumeId, resumeId))
        .all()
        .map((r) => r.projectId);
    },
  },
  {
    action: "toggle_bullet",
    field: "bulletId",
    seed: async (userId) => {
      const job = await seedJob(userId);
      return (await seedBullet(userId, job.id)).id;
    },
    attached: async (resumeId) => {
      const { db, schema } = await getDb();
      return db
        .select()
        .from(schema.resumeBullets)
        .where(eq(schema.resumeBullets.resumeId, resumeId))
        .all()
        .map((r) => r.bulletId);
    },
  },
  {
    action: "toggle_skill",
    field: "skillId",
    seed: async (userId) => (await seedSkill(userId)).id,
    attached: async (resumeId) => {
      const { db, schema } = await getDb();
      return db
        .select()
        .from(schema.resumeSkills)
        .where(eq(schema.resumeSkills.resumeId, resumeId))
        .all()
        .map((r) => r.skillId);
    },
  },
];

describe.each(TOGGLES)("api.resumes $action", ({ action, field, seed, attached }) => {
  it("returns 404 and attaches nothing for another user's id", async () => {
    const resume = await seedResume(me.id);
    const theirs = await seed(stranger.id);

    const result = await post({ _action: action, resumeId: resume.id, [field]: theirs });

    expect(statusOf(result)).toBe(404);
    expect(await attached(resume.id)).toEqual([]);
    expect((await resumeRow(resume.id)).updatedAt).toBe(SEED_TIMESTAMP);
  });

  it("returns 404 and attaches nothing for an id that does not exist", async () => {
    const resume = await seedResume(me.id);

    const result = await post({
      _action: action,
      resumeId: resume.id,
      [field]: MISSING_ID,
    });

    expect(statusOf(result)).toBe(404);
    expect(await attached(resume.id)).toEqual([]);
    expect((await resumeRow(resume.id)).updatedAt).toBe(SEED_TIMESTAMP);
  });

  // Passing guards: the user's own ids keep toggling on and off.
  it("toggles the user's own id on, then off", async () => {
    const resume = await seedResume(me.id);
    const mine = await seed(me.id);
    const fields = { _action: action, resumeId: resume.id, [field]: mine };

    expect(statusOf(await post(fields))).toBe(200);
    expect(await attached(resume.id)).toEqual([mine]);
    expect((await resumeRow(resume.id)).updatedAt).not.toBe(SEED_TIMESTAMP);

    expect(statusOf(await post(fields))).toBe(200);
    expect(await attached(resume.id)).toEqual([]);
  });

  it("returns 404 for another user's resume", async () => {
    const theirResume = await seedResume(stranger.id);
    const mine = await seed(me.id);

    const result = await post({
      _action: action,
      resumeId: theirResume.id,
      [field]: mine,
    });

    expect(statusOf(result)).toBe(404);
    expect(await attached(theirResume.id)).toEqual([]);
  });
});

type SetCase = {
  action: string;
  field: "summaryId" | "companyId";
  seed: (userId: number) => Promise<number>;
};

const SETTERS: SetCase[] = [
  {
    action: "set_summary",
    field: "summaryId",
    seed: async (userId) => (await seedSummary(userId)).id,
  },
  {
    action: "set_company",
    field: "companyId",
    seed: async (userId) => (await seedCompany(userId)).id,
  },
];

describe.each(SETTERS)("api.resumes $action", ({ action, field, seed }) => {
  it("returns 404 and keeps the current value for another user's id", async () => {
    const current = await seed(me.id);
    const resume = await seedResume(me.id, { [field]: current });
    const theirs = await seed(stranger.id);

    const result = await post({ _action: action, resumeId: resume.id, [field]: theirs });

    expect(statusOf(result)).toBe(404);
    const after = await resumeRow(resume.id);
    expect(after[field]).toBe(current);
    expect(after.updatedAt).toBe(SEED_TIMESTAMP);
  });

  it("returns 404 and keeps the current value for an id that does not exist", async () => {
    const current = await seed(me.id);
    const resume = await seedResume(me.id, { [field]: current });

    const result = await post({
      _action: action,
      resumeId: resume.id,
      [field]: MISSING_ID,
    });

    expect(statusOf(result)).toBe(404);
    const after = await resumeRow(resume.id);
    expect(after[field]).toBe(current);
    expect(after.updatedAt).toBe(SEED_TIMESTAMP);
  });

  // Passing guards: the user's own ids keep working, and an empty value clears.
  it("sets the user's own id, then clears it with an empty value", async () => {
    const resume = await seedResume(me.id);
    const mine = await seed(me.id);

    expect(
      statusOf(await post({ _action: action, resumeId: resume.id, [field]: mine })),
    ).toBe(200);
    expect((await resumeRow(resume.id))[field]).toBe(mine);

    expect(
      statusOf(await post({ _action: action, resumeId: resume.id, [field]: "" })),
    ).toBe(200);
    expect((await resumeRow(resume.id))[field]).toBeNull();
  });
});
