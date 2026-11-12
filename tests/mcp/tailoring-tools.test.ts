import {
  createUser,
  getDb,
  seedApplication,
  seedBullet,
  seedCompany,
  seedJob,
  seedProject,
  seedResume,
  seedSkill,
  seedSummary,
  SEED_TIMESTAMP,
} from "../helpers/db";
import { getRequest, run, sessionCookie } from "../helpers/routes";
import { expectNotFound, expectRefused, mcpSession, okJson } from "../helpers/mcp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, count, eq } from "drizzle-orm";

type Row = Record<string, unknown>;

const NEW_TOOLS = [
  "create_company",
  "create_application",
  "update_application",
  "add_summary",
  "create_resume",
  "update_resume",
];
const EXISTING_WRITE_TOOLS = [
  "update_application_status",
  "append_application_note",
  "add_skill",
  "add_bullet",
];

const MISSING_ID = 987_654;

// The trailing slash pins that links are built with getPublicUrl()
// (app/lib/oauth.server.ts), which strips it.
const savedPublicUrl = process.env.PUBLIC_URL;
beforeAll(() => {
  process.env.PUBLIC_URL = "https://resume.test/";
});
afterAll(() => {
  if (savedPublicUrl === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = savedPublicUrl;
});

// ── Fixtures and readers ──

async function seedProjectBullet(userId: number, projectId: number, text: string) {
  const { db, schema } = await getDb();
  return db
    .insert(schema.bullets)
    .values({ userId, parentType: "project", parentId: projectId, text, tags: [] })
    .returning()
    .get();
}

/** A user with a small library. jobB has a higher id than jobA, s2 than s1. */
async function library() {
  const user = await createUser();
  const jobA = await seedJob(user.id, "Staff Engineer");
  const jobB = await seedJob(user.id, "Senior Engineer");
  const project = await seedProject(user.id, "Trail Mapper");
  const a1 = await seedBullet(user.id, jobA.id, "Cut build time in half");
  const a2 = await seedBullet(user.id, jobA.id, "Led the billing rewrite");
  const b1 = await seedBullet(user.id, jobB.id, "Shipped offline sync");
  const p1 = await seedProjectBullet(user.id, project.id, "Mapped 400 km of trail");
  const s1 = await seedSkill(user.id, "JS-first");
  const s2 = await seedSkill(user.id, "Elixir-first");
  const summary = await seedSummary(user.id, "Backend focus");
  const company = await seedCompany(user.id, "Fernhill Robotics");
  return { user, jobA, jobB, project, a1, a2, b1, p1, s1, s2, summary, company };
}
type Library = Awaited<ReturnType<typeof library>>;

/** A second user who owns one of everything, to offer as ids that are not the caller's. */
async function stranger() {
  const user = await createUser();
  const job = await seedJob(user.id, "Engineering Manager");
  const project = await seedProject(user.id, "Tide Tables");
  const bullet = await seedBullet(user.id, job.id, "Grew the team to twelve");
  const skill = await seedSkill(user.id, "Go-first");
  const summary = await seedSummary(user.id, "Management focus");
  const company = await seedCompany(user.id, "Osprey Logistics");
  const resume = await seedResume(user.id, { name: "Stranger resume" });
  const application = await seedApplication(user.id, { jobTitle: "Director of Engineering" });
  return { user, job, project, bullet, skill, summary, company, resume, application };
}
type Stranger = Awaited<ReturnType<typeof stranger>>;

async function rowById(
  table: "companies" | "applications" | "summaries" | "resumes",
  id: number,
): Promise<Row | undefined> {
  const { db, schema } = await getDb();
  const t = schema[table];
  return db.select().from(t).where(eq(t.id, id)).get() as Row | undefined;
}

async function companiesOf(userId: number): Promise<Row[]> {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.userId, userId))
    .all() as Row[];
}

/** Row counts of every table the tailoring tools can write to. */
async function counts(): Promise<Record<string, number>> {
  const { db, schema } = await getDb();
  const n = (t: Parameters<ReturnType<typeof db.select>["from"]>[0]) =>
    db.select({ n: count() }).from(t).get()?.n ?? -1;
  return {
    companies: n(schema.companies),
    applications: n(schema.applications),
    summaries: n(schema.summaries),
    resumes: n(schema.resumes),
    resumeJobs: n(schema.resumeJobs),
    resumeProjects: n(schema.resumeProjects),
    resumeSkills: n(schema.resumeSkills),
    resumeBullets: n(schema.resumeBullets),
  };
}

/** A resume's join rows as [libraryId, sortOrder] pairs, in stored order. */
async function selection(resumeId: number) {
  const { db, schema } = await getDb();
  const { resumeJobs, resumeProjects, resumeSkills, resumeBullets } = schema;
  return {
    jobs: db
      .select()
      .from(resumeJobs)
      .where(eq(resumeJobs.resumeId, resumeId))
      .orderBy(asc(resumeJobs.sortOrder), asc(resumeJobs.id))
      .all()
      .map((r) => [r.jobId, r.sortOrder]),
    projects: db
      .select()
      .from(resumeProjects)
      .where(eq(resumeProjects.resumeId, resumeId))
      .orderBy(asc(resumeProjects.sortOrder), asc(resumeProjects.id))
      .all()
      .map((r) => [r.projectId, r.sortOrder]),
    skills: db
      .select()
      .from(resumeSkills)
      .where(eq(resumeSkills.resumeId, resumeId))
      .orderBy(asc(resumeSkills.sortOrder), asc(resumeSkills.id))
      .all()
      .map((r) => [r.skillId, r.sortOrder]),
    bullets: db
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, resumeId))
      .orderBy(asc(resumeBullets.sortOrder), asc(resumeBullets.id))
      .all()
      .map((r) => [r.bulletId, r.sortOrder]),
  };
}

function expectBumped(updatedAt: unknown) {
  expect(typeof updatedAt).toBe("string");
  expect(new Date(updatedAt as string).toISOString()).toBe(updatedAt);
  expect((updatedAt as string) > SEED_TIMESTAMP).toBe(true);
}

/**
 * A resume for `lib.user` selecting jobs [A, B], project, skill s1 and bullets
 * [a1, b1, p1], with a summary and a company. Timestamps are SEED_TIMESTAMP.
 */
async function seededResume(lib: Library) {
  const { db, schema } = await getDb();
  const resume = await seedResume(lib.user.id, {
    name: "General resume",
    template: "classic",
    summaryId: lib.summary.id,
    companyId: lib.company.id,
  });
  const resumeId = resume.id;
  db.insert(schema.resumeJobs)
    .values([
      { resumeId, jobId: lib.jobA.id, sortOrder: 0 },
      { resumeId, jobId: lib.jobB.id, sortOrder: 1 },
    ])
    .run();
  db.insert(schema.resumeProjects)
    .values({ resumeId, projectId: lib.project.id, sortOrder: 0 })
    .run();
  db.insert(schema.resumeSkills).values({ resumeId, skillId: lib.s1.id, sortOrder: 0 }).run();
  db.insert(schema.resumeBullets)
    .values([
      { resumeId, bulletId: lib.a1.id, sortOrder: 0 },
      { resumeId, bulletId: lib.b1.id, sortOrder: 1 },
      { resumeId, bulletId: lib.p1.id, sortOrder: 2 },
    ])
    .run();
  return resume;
}

async function resumeState(resumeId: number) {
  return { row: await rowById("resumes", resumeId), selection: await selection(resumeId) };
}

// ── Scope gating ──

describe("tailoring tools: scope gating", () => {
  it("are listed for a token with the write scope", async () => {
    const user = await createUser();
    const writeOnly = await mcpSession(user.id, ["mcp:write"]);
    const both = await mcpSession(user.id, ["mcp:read", "mcp:write"]);

    expect(writeOnly.toolNames).toEqual(expect.arrayContaining(NEW_TOOLS));
    expect(both.toolNames).toEqual(expect.arrayContaining(NEW_TOOLS));
  });

  // Passing guard: the read scope lists none of the write tools today, and
  // must not start listing the new ones.
  it("are not listed for a read-only token", async () => {
    const user = await createUser();
    const readOnly = await mcpSession(user.id, ["mcp:read"]);

    for (const name of [...NEW_TOOLS, ...EXISTING_WRITE_TOOLS]) {
      expect(readOnly.toolNames).not.toContain(name);
    }
    expect(readOnly.toolNames).toContain("get_application");
  });

  // Passing guard: the existing write tools stay registered.
  it("the existing write tools are still listed with the write scope", async () => {
    const user = await createUser();
    const writeOnly = await mcpSession(user.id, ["mcp:write"]);
    expect(writeOnly.toolNames).toEqual(expect.arrayContaining(EXISTING_WRITE_TOOLS));
    expect(writeOnly.toolNames).not.toContain("get_application");
  });
});

// ── create_company ──

describe("create_company", () => {
  it("creates a company for the caller and returns { id, name, existing: false }", async () => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    const result = okJson(
      await mcp.call("create_company", {
        name: "  Quillfeather Labs  ",
        tagline: "Typesetting for the web",
        industry: "Developer tools",
        location: "Bristol",
        size: "51-200",
        techStack: ["Elixir", "TypeScript"],
        values: "Craft, candour",
        culture: "Remote-first",
        notableProjects: "Quill renderer",
        notes: "Met at a meetup",
      }),
    );

    expect(result).toEqual({
      id: expect.any(Number),
      name: "Quillfeather Labs",
      existing: false,
    });
    const row = await rowById("companies", result.id as number);
    expect(row).toMatchObject({
      userId: user.id,
      name: "Quillfeather Labs",
      tagline: "Typesetting for the web",
      industry: "Developer tools",
      location: "Bristol",
      size: "51-200",
      techStack: ["Elixir", "TypeScript"],
      values: "Craft, candour",
      culture: "Remote-first",
      notableProjects: "Quill renderer",
      notes: "Met at a meetup",
    });
    expectBumped(row?.createdAt);
    expectBumped(row?.updatedAt);
  });

  it("creates a company from a name alone", async () => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    const result = okJson(await mcp.call("create_company", { name: "Harrowgate Freight" }));

    expect(result).toEqual({ id: expect.any(Number), name: "Harrowgate Freight", existing: false });
    const mine = await companiesOf(user.id);
    expect(mine.map((c) => c.id)).toEqual([result.id]);
    expect(mine[0].tagline).toBeNull();
  });

  it("returns the caller's existing company when the name matches ignoring case and outer spaces", async () => {
    const user = await createUser();
    const existing = await seedCompany(user.id, "Fernhill Robotics");
    const mcp = await mcpSession(user.id);
    const before = await counts();

    const result = okJson(
      await mcp.call("create_company", {
        name: "  fernhill ROBOTICS ",
        tagline: "Should not be stored",
      }),
    );

    expect(result).toEqual({ id: existing.id, name: "Fernhill Robotics", existing: true });
    expect(await counts()).toEqual(before);
    const row = await rowById("companies", existing.id);
    expect(row?.tagline).toBeNull();
    expect(row?.updatedAt).toBe(SEED_TIMESTAMP);
  });

  it("does not treat another user's company with the same name as existing", async () => {
    const other = await stranger();
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    const result = okJson(await mcp.call("create_company", { name: "Osprey Logistics" }));

    expect(result.existing).toBe(false);
    expect(result.id).not.toBe(other.company.id);
    expect((await rowById("companies", result.id as number))?.userId).toBe(user.id);
    expect(await companiesOf(other.user.id)).toHaveLength(1);
  });

  it.each([
    ["a missing name", {}],
    ["an empty name", { name: "" }],
    ["a whitespace-only name", { name: "   " }],
    ["a techStack that is not a list of strings", { name: "Larkspur Health", techStack: "Elixir" }],
  ])("refuses %s and writes nothing", async (_label, args) => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);
    const before = await counts();

    expectRefused(await mcp.call("create_company", args));
    expect(await counts()).toEqual(before);
  });
});

// ── create_application ──

describe("create_application", () => {
  it("defaults to a wishlist application with no applied date", async () => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    const result = okJson(await mcp.call("create_application", { jobTitle: "Platform Engineer" }));

    expect(result).toEqual({
      id: expect.any(Number),
      jobTitle: "Platform Engineer",
      status: "wishlist",
      companyId: null,
      url: `https://resume.test/applications/${result.id}`,
    });
    const row = await rowById("applications", result.id as number);
    expect(row).toMatchObject({
      userId: user.id,
      jobTitle: "Platform Engineer",
      status: "wishlist",
      appliedAt: null,
      companyId: null,
      resumeId: null,
      remote: false,
      jobDescription: null,
      notes: null,
    });
    expectBumped(row?.createdAt);
    expectBumped(row?.updatedAt);
  });

  it("stores every provided field", async () => {
    const lib = await library();
    const resume = await seedResume(lib.user.id);
    const mcp = await mcpSession(lib.user.id);
    const description = "Own the fleet scheduler.\n\nRequirements:\n- Elixir\n- On-call";

    const result = okJson(
      await mcp.call("create_application", {
        jobTitle: "Fleet Engineer",
        companyId: lib.company.id,
        jobUrl: "https://jobs.fernhill.test/fleet-engineer",
        source: "Referral",
        location: "Leeds",
        remote: true,
        salaryRange: "£90k-£110k",
        status: "wishlist",
        jobDescription: description,
        notes: "Referred by Odalys Venn",
        resumeId: resume.id,
        nextStepAt: "2026-11-20",
      }),
    );

    expect(result).toEqual({
      id: expect.any(Number),
      jobTitle: "Fleet Engineer",
      status: "wishlist",
      companyId: lib.company.id,
      url: `https://resume.test/applications/${result.id}`,
    });
    expect(await rowById("applications", result.id as number)).toMatchObject({
      userId: lib.user.id,
      companyId: lib.company.id,
      resumeId: resume.id,
      jobTitle: "Fleet Engineer",
      jobUrl: "https://jobs.fernhill.test/fleet-engineer",
      source: "Referral",
      location: "Leeds",
      remote: true,
      salaryRange: "£90k-£110k",
      status: "wishlist",
      appliedAt: null,
      nextStepAt: "2026-11-20",
      jobDescription: description,
      notes: "Referred by Odalys Venn",
    });
  });

  describe("applied date", () => {
    // 6:30pm on Nov 11 in Denver; already Nov 12 in UTC.
    const savedZone = process.env.APP_TIMEZONE;
    beforeEach(() => {
      process.env.APP_TIMEZONE = "America/Denver";
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-12T01:30:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
      if (savedZone === undefined) delete process.env.APP_TIMEZONE;
      else process.env.APP_TIMEZONE = savedZone;
    });

    it.each(["applied", "interviewing", "offer", "accepted", "rejected"])(
      "status %s stores today in APP_TIMEZONE as appliedAt",
      async (status) => {
        const user = await createUser();
        const mcp = await mcpSession(user.id);

        const result = okJson(
          await mcp.call("create_application", { jobTitle: "Data Engineer", status }),
        );

        expect(result.status).toBe(status);
        const row = await rowById("applications", result.id as number);
        expect(row?.status).toBe(status);
        expect(row?.appliedAt).toBe("2026-11-11");
      },
    );

    it("status wishlist stores no appliedAt", async () => {
      const user = await createUser();
      const mcp = await mcpSession(user.id);

      const result = okJson(
        await mcp.call("create_application", { jobTitle: "Data Engineer", status: "wishlist" }),
      );
      expect((await rowById("applications", result.id as number))?.appliedAt).toBeNull();
    });
  });

  it("companyName links the caller's existing company, matching case-insensitively", async () => {
    const lib = await library();
    const mcp = await mcpSession(lib.user.id);
    const before = await counts();

    const result = okJson(
      await mcp.call("create_application", {
        jobTitle: "Robotics Engineer",
        companyName: " FERNHILL robotics ",
      }),
    );

    expect(result.companyId).toBe(lib.company.id);
    expect((await rowById("applications", result.id as number))?.companyId).toBe(lib.company.id);
    expect(await counts()).toEqual({ ...before, applications: before.applications + 1 });
  });

  it("companyName creates the company when the caller has none by that name", async () => {
    const other = await stranger();
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    // The stranger owns "Osprey Logistics"; that one must not be linked.
    const result = okJson(
      await mcp.call("create_application", {
        jobTitle: "Logistics Engineer",
        companyName: "  Osprey Logistics ",
      }),
    );

    const mine = await companiesOf(user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe("Osprey Logistics");
    expect(mine[0].id).not.toBe(other.company.id);
    expect(result.companyId).toBe(mine[0].id);
    expect((await rowById("applications", result.id as number))?.companyId).toBe(mine[0].id);
  });

  it("refuses companyId together with companyName and writes nothing", async () => {
    const lib = await library();
    const mcp = await mcpSession(lib.user.id);
    const before = await counts();

    expectRefused(
      await mcp.call("create_application", {
        jobTitle: "Robotics Engineer",
        companyId: lib.company.id,
        companyName: "Larkspur Health",
      }),
    );
    expect(await counts()).toEqual(before);
  });

  it.each([
    ["another user's companyId", (o: Stranger) => ({ companyId: o.company.id }), (o: Stranger) => o.company.id],
    ["another user's resumeId", (o: Stranger) => ({ resumeId: o.resume.id }), (o: Stranger) => o.resume.id],
    ["a companyId that does not exist", () => ({ companyId: MISSING_ID }), () => MISSING_ID],
    ["a resumeId that does not exist", () => ({ resumeId: MISSING_ID }), () => MISSING_ID],
  ])("returns a not-found error for %s and writes nothing", async (_l, extra, id) => {
    const other = await stranger();
    const user = await createUser();
    const mcp = await mcpSession(user.id);
    const before = await counts();

    const outcome = await mcp.call("create_application", {
      jobTitle: "Platform Engineer",
      ...extra(other),
    });

    expectNotFound(outcome, id(other));
    expect(await counts()).toEqual(before);
  });

  it.each([
    ["a missing jobTitle", { companyName: "Larkspur Health" }],
    ["a status outside APPLICATION_STATUSES", { jobTitle: "Platform Engineer", status: "ghosted" }],
    ["a nextStepAt that is not YYYY-MM-DD", { jobTitle: "Platform Engineer", nextStepAt: "11/20/2026" }],
    ["a remote flag that is not a boolean", { jobTitle: "Platform Engineer", remote: "yes" }],
  ])("refuses %s and writes nothing", async (_label, args) => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);
    const before = await counts();

    expectRefused(await mcp.call("create_application", args));
    expect(await counts()).toEqual(before);
  });
});

// ── update_application ──

describe("update_application", () => {
  async function seeded(lib: Library) {
    const resume = await seedResume(lib.user.id);
    const app = await seedApplication(lib.user.id, {
      jobTitle: "Platform Engineer",
      companyId: lib.company.id,
      resumeId: resume.id,
      jobUrl: "https://jobs.fernhill.test/platform",
      source: "LinkedIn",
      location: "Leeds",
      remote: false,
      salaryRange: "£80k-£95k",
      status: "applied",
      appliedAt: "2026-10-01",
      nextStepAt: "2026-11-01",
      lastContactAt: "2026-10-15",
      notes: "Referred by Odalys Venn",
      jobDescription: "Original posting text",
    } as never);
    const row = (await rowById("applications", app.id))!;
    return { app, resume, row };
  }

  it("changes only the provided fields and bumps updatedAt", async () => {
    const lib = await library();
    const { app, row: before } = await seeded(lib);
    const mcp = await mcpSession(lib.user.id);

    const outcome = await mcp.call("update_application", {
      applicationId: app.id,
      jobTitle: "Senior Platform Engineer",
      remote: true,
    });

    okJson(outcome);
    const after = (await rowById("applications", app.id))!;
    expectBumped(after.updatedAt);
    expect(after).toEqual({
      ...before,
      jobTitle: "Senior Platform Engineer",
      remote: true,
      updatedAt: after.updatedAt,
    });
  });

  it("sets each of the text and date fields", async () => {
    const lib = await library();
    const { app, row: before } = await seeded(lib);
    const mcp = await mcpSession(lib.user.id);
    const description = "Rewritten posting.\n\n- Elixir\n- Postgres";

    okJson(
      await mcp.call("update_application", {
        applicationId: app.id,
        jobUrl: "https://jobs.fernhill.test/platform-2",
        source: "Referral",
        location: "Bristol",
        salaryRange: "£100k+",
        jobDescription: description,
        nextStepAt: "2026-12-01",
        lastContactAt: "2026-11-10",
      }),
    );

    const after = (await rowById("applications", app.id))!;
    expect(after).toEqual({
      ...before,
      jobUrl: "https://jobs.fernhill.test/platform-2",
      source: "Referral",
      location: "Bristol",
      salaryRange: "£100k+",
      jobDescription: description,
      nextStepAt: "2026-12-01",
      lastContactAt: "2026-11-10",
      updatedAt: after.updatedAt,
    });
    expect(after.jobDescription).toBe(description);
  });

  it("links the caller's own company and resume", async () => {
    const lib = await library();
    const { app } = await seeded(lib);
    const otherCompany = await seedCompany(lib.user.id, "Larkspur Health");
    const otherResume = await seedResume(lib.user.id, { name: "Larkspur resume" });
    const mcp = await mcpSession(lib.user.id);

    okJson(
      await mcp.call("update_application", {
        applicationId: app.id,
        companyId: otherCompany.id,
        resumeId: otherResume.id,
      }),
    );

    const after = (await rowById("applications", app.id))!;
    expect(after.companyId).toBe(otherCompany.id);
    expect(after.resumeId).toBe(otherResume.id);
  });

  it("clears the company and the resume when given null", async () => {
    const lib = await library();
    const { app, row: before } = await seeded(lib);
    expect(before.companyId).not.toBeNull();
    expect(before.resumeId).not.toBeNull();
    const mcp = await mcpSession(lib.user.id);

    okJson(await mcp.call("update_application", { applicationId: app.id, companyId: null }));
    let after = (await rowById("applications", app.id))!;
    expect(after.companyId).toBeNull();
    expect(after.resumeId).toBe(before.resumeId);

    okJson(await mcp.call("update_application", { applicationId: app.id, resumeId: null }));
    after = (await rowById("applications", app.id))!;
    expect(after.resumeId).toBeNull();
    expect(after.jobTitle).toBe(before.jobTitle);
  });

  it("does not change status or notes, even when they are sent", async () => {
    const lib = await library();
    const { app, row: before } = await seeded(lib);
    const mcp = await mcpSession(lib.user.id);

    // Rejecting the call and ignoring the extra keys are both acceptable; what
    // is pinned is that status, notes and appliedAt come out untouched.
    await mcp.call("update_application", {
      applicationId: app.id,
      jobTitle: "Senior Platform Engineer",
      status: "offer",
      notes: "Overwritten",
      appliedAt: "2020-01-01",
    });
    const alone = await mcp.call("update_application", {
      applicationId: app.id,
      status: "rejected",
      notes: "Overwritten",
    });

    // With nothing changeable in it, the second call is an empty update.
    expectRefused(alone);
    const after = (await rowById("applications", app.id))!;
    expect(after.status).toBe(before.status);
    expect(after.notes).toBe(before.notes);
    expect(after.appliedAt).toBe(before.appliedAt);
  });

  it("refuses an update with only applicationId and leaves the row alone", async () => {
    const lib = await library();
    const { app, row: before } = await seeded(lib);
    const mcp = await mcpSession(lib.user.id);

    expectRefused(await mcp.call("update_application", { applicationId: app.id }));
    expect(await rowById("applications", app.id)).toEqual(before);
  });

  it("returns a not-found error for an application that does not exist", async () => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    expectNotFound(
      await mcp.call("update_application", { applicationId: MISSING_ID, jobTitle: "Ghost" }),
      MISSING_ID,
    );
  });

  it("returns a not-found error for another user's application and leaves it alone", async () => {
    const other = await stranger();
    const user = await createUser();
    const mcp = await mcpSession(user.id);
    const before = await rowById("applications", other.application.id);

    expectNotFound(
      await mcp.call("update_application", {
        applicationId: other.application.id,
        jobTitle: "Hijacked",
      }),
      other.application.id,
    );
    expect(await rowById("applications", other.application.id)).toEqual(before);
  });

  it.each([
    ["another user's companyId", (o: Stranger) => ({ companyId: o.company.id }), (o: Stranger) => o.company.id],
    ["another user's resumeId", (o: Stranger) => ({ resumeId: o.resume.id }), (o: Stranger) => o.resume.id],
    ["a companyId that does not exist", () => ({ companyId: MISSING_ID }), () => MISSING_ID],
    ["a resumeId that does not exist", () => ({ resumeId: MISSING_ID }), () => MISSING_ID],
  ])("returns a not-found error for %s and writes nothing", async (_l, extra, id) => {
    const other = await stranger();
    const lib = await library();
    const { app, row: before } = await seeded(lib);
    const mcp = await mcpSession(lib.user.id);

    const outcome = await mcp.call("update_application", {
      applicationId: app.id,
      jobTitle: "Should not be stored",
      ...extra(other),
    });

    expectNotFound(outcome, id(other));
    expect(await rowById("applications", app.id)).toEqual(before);
  });
});

// ── add_summary ──

describe("add_summary", () => {
  it("stores the summary for the caller and returns { id, name }", async () => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);
    const text = "Backend engineer with ten years in logistics software.";

    const result = okJson(await mcp.call("add_summary", { name: "Logistics focus", text }));

    expect(result).toEqual({ id: expect.any(Number), name: "Logistics focus" });
    expect(await rowById("summaries", result.id as number)).toEqual({
      id: result.id,
      userId: user.id,
      name: "Logistics focus",
      text,
    });
  });

  it.each([
    ["a missing name", { text: "Some text" }],
    ["a missing text", { name: "Logistics focus" }],
    ["an empty name", { name: "", text: "Some text" }],
    ["a whitespace-only name", { name: "  \n ", text: "Some text" }],
    ["an empty text", { name: "Logistics focus", text: "" }],
    ["a whitespace-only text", { name: "Logistics focus", text: " \t\n" }],
  ])("refuses %s and writes nothing", async (_label, args) => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);
    const before = await counts();

    expectRefused(await mcp.call("add_summary", args));
    expect(await counts()).toEqual(before);
  });
});

// ── create_resume ──

describe("create_resume", () => {
  it("creates the resume and its join rows in the given order", async () => {
    const lib = await library();
    const mcp = await mcpSession(lib.user.id);

    const result = okJson(
      await mcp.call("create_resume", {
        name: "Fernhill tailored",
        template: "classic",
        summaryId: lib.summary.id,
        companyId: lib.company.id,
        jobIds: [lib.jobB.id, lib.jobA.id],
        projectIds: [lib.project.id],
        skillIds: [lib.s2.id, lib.s1.id],
        bulletIds: [lib.b1.id, lib.p1.id, lib.a2.id, lib.a1.id],
      }),
    );

    expect(result).toEqual({
      id: expect.any(Number),
      name: "Fernhill tailored",
      url: `https://resume.test/builder/${result.id}`,
    });
    const row = await rowById("resumes", result.id as number);
    expect(row).toMatchObject({
      userId: lib.user.id,
      name: "Fernhill tailored",
      template: "classic",
      summaryId: lib.summary.id,
      companyId: lib.company.id,
    });
    expectBumped(row?.createdAt);
    expectBumped(row?.updatedAt);
    expect(await selection(result.id as number)).toEqual({
      jobs: [
        [lib.jobB.id, 0],
        [lib.jobA.id, 1],
      ],
      projects: [[lib.project.id, 0]],
      skills: [
        [lib.s2.id, 0],
        [lib.s1.id, 1],
      ],
      bullets: [
        [lib.b1.id, 0],
        [lib.p1.id, 1],
        [lib.a2.id, 2],
        [lib.a1.id, 3],
      ],
    });
  });

  it("defaults to the modern template with no summary, company, projects or skills", async () => {
    const lib = await library();
    const mcp = await mcpSession(lib.user.id);

    const result = okJson(
      await mcp.call("create_resume", {
        name: "Plain resume",
        jobIds: [lib.jobA.id],
        bulletIds: [lib.a1.id],
      }),
    );

    expect(await rowById("resumes", result.id as number)).toMatchObject({
      userId: lib.user.id,
      name: "Plain resume",
      template: "modern",
      summaryId: null,
      companyId: null,
    });
    expect(await selection(result.id as number)).toEqual({
      jobs: [[lib.jobA.id, 0]],
      projects: [],
      skills: [],
      bullets: [[lib.a1.id, 0]],
    });
  });

  type Case = [
    string,
    (lib: Library, other: Stranger) => Row,
    ((lib: Library, other: Stranger) => number) | null,
  ];

  const base = (lib: Library) => ({
    name: "Should not exist",
    jobIds: [lib.jobA.id, lib.jobB.id],
    projectIds: [lib.project.id],
    skillIds: [lib.s1.id],
    bulletIds: [lib.a1.id, lib.b1.id, lib.p1.id],
  });

  const notOwned: Case[] = [
    ["another user's job", (l, o) => ({ ...base(l), jobIds: [l.jobA.id, l.jobB.id, o.job.id] }), (_l, o) => o.job.id],
    ["another user's project", (l, o) => ({ ...base(l), projectIds: [l.project.id, o.project.id] }), (_l, o) => o.project.id],
    ["another user's skill", (l, o) => ({ ...base(l), skillIds: [l.s1.id, o.skill.id] }), (_l, o) => o.skill.id],
    ["another user's bullet", (l, o) => ({ ...base(l), bulletIds: [l.a1.id, o.bullet.id] }), (_l, o) => o.bullet.id],
    ["another user's summary", (l, o) => ({ ...base(l), summaryId: o.summary.id }), (_l, o) => o.summary.id],
    ["another user's company", (l, o) => ({ ...base(l), companyId: o.company.id }), (_l, o) => o.company.id],
    ["a job that does not exist", (l) => ({ ...base(l), jobIds: [l.jobA.id, l.jobB.id, MISSING_ID] }), () => MISSING_ID],
    ["a bullet that does not exist", (l) => ({ ...base(l), bulletIds: [l.a1.id, MISSING_ID] }), () => MISSING_ID],
    ["a skill that does not exist", (l) => ({ ...base(l), skillIds: [MISSING_ID] }), () => MISSING_ID],
    ["a project that does not exist", (l) => ({ ...base(l), projectIds: [MISSING_ID] }), () => MISSING_ID],
    ["a summary that does not exist", (l) => ({ ...base(l), summaryId: MISSING_ID }), () => MISSING_ID],
    ["a company that does not exist", (l) => ({ ...base(l), companyId: MISSING_ID }), () => MISSING_ID],
  ];

  it.each(notOwned)("returns a not-found error for %s and writes nothing", async (_l, args, id) => {
    const lib = await library();
    const other = await stranger();
    const mcp = await mcpSession(lib.user.id);
    const before = await counts();

    expectNotFound(await mcp.call("create_resume", args(lib, other)), id!(lib, other));
    expect(await counts()).toEqual(before);
  });

  const refused: Case[] = [
    ["a duplicate job id", (l) => ({ ...base(l), jobIds: [l.jobA.id, l.jobB.id, l.jobA.id] }), null],
    ["a duplicate project id", (l) => ({ ...base(l), projectIds: [l.project.id, l.project.id] }), null],
    ["a duplicate skill id", (l) => ({ ...base(l), skillIds: [l.s1.id, l.s2.id, l.s1.id] }), null],
    ["a duplicate bullet id", (l) => ({ ...base(l), bulletIds: [l.a1.id, l.b1.id, l.a1.id] }), null],
    [
      "a bullet whose job is not in jobIds",
      (l) => ({ ...base(l), jobIds: [l.jobA.id], bulletIds: [l.a1.id, l.b1.id] }),
      null,
    ],
    [
      "a bullet whose project is not in projectIds",
      (l) => ({ ...base(l), projectIds: [], bulletIds: [l.a1.id, l.p1.id] }),
      null,
    ],
    [
      "a project bullet when projectIds is omitted",
      (l) => ({ name: "Should not exist", jobIds: [l.jobA.id], bulletIds: [l.a1.id, l.p1.id] }),
      null,
    ],
    ["a missing name", (l) => ({ ...base(l), name: undefined }), null],
    ["a blank name", (l) => ({ ...base(l), name: "   " }), null],
    ["a template outside modern/classic/minimal", (l) => ({ ...base(l), template: "fancy" }), null],
    ["missing jobIds", () => ({ name: "Should not exist", bulletIds: [] }), null],
    ["missing bulletIds", (l) => ({ name: "Should not exist", jobIds: [l.jobA.id] }), null],
    ["ids that are not positive integers", (l) => ({ ...base(l), jobIds: [l.jobA.id, -1] }), null],
  ];

  it.each(refused)("refuses %s and writes nothing", async (_l, args) => {
    const lib = await library();
    const other = await stranger();
    const mcp = await mcpSession(lib.user.id);
    const before = await counts();

    expectRefused(await mcp.call("create_resume", args(lib, other)));
    expect(await counts()).toEqual(before);
  });

  it("checks a bullet's parent by type: a project bullet is not covered by a job with the same id", async () => {
    const user = await createUser();
    // Seed until a job and a project of this user share an id.
    let job = await seedJob(user.id, "Staff Engineer");
    let project = await seedProject(user.id, "Trail Mapper");
    while (job.id !== project.id) {
      if (job.id < project.id) job = await seedJob(user.id, "Staff Engineer");
      else project = await seedProject(user.id, "Trail Mapper");
    }
    const projectBullet = await seedProjectBullet(user.id, project.id, "Mapped 400 km of trail");
    const mcp = await mcpSession(user.id);
    const before = await counts();

    expectRefused(
      await mcp.call("create_resume", {
        name: "Should not exist",
        jobIds: [job.id],
        projectIds: [],
        bulletIds: [projectBullet.id],
      }),
    );
    expect(await counts()).toEqual(before);

    // The same bullet is fine once its project is selected.
    const result = okJson(
      await mcp.call("create_resume", {
        name: "With the project",
        jobIds: [job.id],
        projectIds: [project.id],
        bulletIds: [projectBullet.id],
      }),
    );
    expect((await selection(result.id as number)).bullets).toEqual([[projectBullet.id, 0]]);
  });
});

// ── update_resume ──

describe("update_resume", () => {
  it("changes name and template, bumps updatedAt and leaves the lists alone", async () => {
    const lib = await library();
    const resume = await seededResume(lib);
    const before = await resumeState(resume.id);
    const mcp = await mcpSession(lib.user.id);

    const result = okJson(
      await mcp.call("update_resume", {
        resumeId: resume.id,
        name: "Fernhill tailored",
        template: "minimal",
      }),
    );

    expect(result).toEqual({
      id: resume.id,
      name: "Fernhill tailored",
      url: `https://resume.test/builder/${resume.id}`,
    });
    const after = await resumeState(resume.id);
    expectBumped(after.row?.updatedAt);
    expect(after.row).toEqual({
      ...before.row,
      name: "Fernhill tailored",
      template: "minimal",
      updatedAt: after.row?.updatedAt,
    });
    expect(after.selection).toEqual(before.selection);
  });

  it("sets and clears the summary and the company", async () => {
    const lib = await library();
    const resume = await seededResume(lib);
    const summary2 = await seedSummary(lib.user.id, "Frontend focus");
    const company2 = await seedCompany(lib.user.id, "Larkspur Health");
    const mcp = await mcpSession(lib.user.id);

    okJson(
      await mcp.call("update_resume", {
        resumeId: resume.id,
        summaryId: summary2.id,
        companyId: company2.id,
      }),
    );
    let row = await rowById("resumes", resume.id);
    expect(row?.summaryId).toBe(summary2.id);
    expect(row?.companyId).toBe(company2.id);

    const result = okJson(
      await mcp.call("update_resume", { resumeId: resume.id, summaryId: null }),
    );
    // The name was not sent, so the result carries the stored one.
    expect(result).toEqual({
      id: resume.id,
      name: "General resume",
      url: `https://resume.test/builder/${resume.id}`,
    });
    row = await rowById("resumes", resume.id);
    expect(row?.summaryId).toBeNull();
    expect(row?.companyId).toBe(company2.id);

    okJson(await mcp.call("update_resume", { resumeId: resume.id, companyId: null }));
    row = await rowById("resumes", resume.id);
    expect(row?.companyId).toBeNull();
    expect(row?.name).toBe("General resume");
    expect(row?.template).toBe("classic");
  });

  it("replaces only the provided list, in the given order", async () => {
    const lib = await library();
    const resume = await seededResume(lib);
    const before = await resumeState(resume.id);
    const mcp = await mcpSession(lib.user.id);

    okJson(
      await mcp.call("update_resume", {
        resumeId: resume.id,
        bulletIds: [lib.p1.id, lib.a2.id, lib.a1.id],
      }),
    );

    const after = await resumeState(resume.id);
    expect(after.selection).toEqual({
      ...before.selection,
      bullets: [
        [lib.p1.id, 0],
        [lib.a2.id, 1],
        [lib.a1.id, 2],
      ],
    });
    expectBumped(after.row?.updatedAt);
    expect(after.row?.name).toBe("General resume");
  });

  it("replaces several lists at once and clears a list given as empty", async () => {
    const lib = await library();
    const resume = await seededResume(lib);
    const mcp = await mcpSession(lib.user.id);

    okJson(
      await mcp.call("update_resume", {
        resumeId: resume.id,
        jobIds: [lib.jobB.id, lib.jobA.id],
        projectIds: [],
        skillIds: [lib.s2.id, lib.s1.id],
        bulletIds: [lib.b1.id, lib.a1.id],
      }),
    );
    expect(await selection(resume.id)).toEqual({
      jobs: [
        [lib.jobB.id, 0],
        [lib.jobA.id, 1],
      ],
      projects: [],
      skills: [
        [lib.s2.id, 0],
        [lib.s1.id, 1],
      ],
      bullets: [
        [lib.b1.id, 0],
        [lib.a1.id, 1],
      ],
    });

    okJson(await mcp.call("update_resume", { resumeId: resume.id, skillIds: [] }));
    const after = await selection(resume.id);
    expect(after.skills).toEqual([]);
    expect(after.jobs).toHaveLength(2);
    expect(after.bullets).toHaveLength(2);
  });

  it("accepts dropping a job when the same call drops its bullets", async () => {
    const lib = await library();
    const resume = await seededResume(lib);
    const mcp = await mcpSession(lib.user.id);

    okJson(
      await mcp.call("update_resume", {
        resumeId: resume.id,
        jobIds: [lib.jobB.id],
        bulletIds: [lib.b1.id, lib.p1.id],
      }),
    );

    const after = await selection(resume.id);
    expect(after.jobs).toEqual([[lib.jobB.id, 0]]);
    expect(after.bullets).toEqual([
      [lib.b1.id, 0],
      [lib.p1.id, 1],
    ]);
    expect(after.projects).toEqual([[lib.project.id, 0]]);
  });

  type Case = [string, (lib: Library, other: Stranger) => Row];

  const refused: Case[] = [
    // Parent rule, judged on the selection that would result.
    ["dropping a job whose bullet stays selected", (l) => ({ jobIds: [l.jobB.id] })],
    ["dropping a project whose bullet stays selected", () => ({ projectIds: [] })],
    [
      "adding a bullet whose job is not selected",
      (l) => ({ jobIds: [l.jobA.id], bulletIds: [l.a1.id, l.b1.id] }),
    ],
    ["a duplicate job id", (l) => ({ jobIds: [l.jobA.id, l.jobB.id, l.jobA.id] })],
    ["a duplicate bullet id", (l) => ({ bulletIds: [l.a1.id, l.a1.id] })],
    ["a duplicate skill id", (l) => ({ skillIds: [l.s1.id, l.s1.id] })],
    ["a duplicate project id", (l) => ({ projectIds: [l.project.id, l.project.id] })],
    ["a template outside modern/classic/minimal", () => ({ template: "fancy" })],
    ["a blank name", () => ({ name: "  " })],
  ];

  it.each(refused)("refuses %s and writes nothing", async (_l, patch) => {
    const lib = await library();
    const other = await stranger();
    const resume = await seededResume(lib);
    const before = await resumeState(resume.id);
    const mcp = await mcpSession(lib.user.id);

    // A valid rename rides along to show the call is all-or-nothing.
    const outcome = await mcp.call("update_resume", {
      resumeId: resume.id,
      name: "Should not be stored",
      ...patch(lib, other),
    });

    expectRefused(outcome);
    expect(await resumeState(resume.id)).toEqual(before);
  });

  type NotOwnedCase = [
    string,
    (lib: Library, other: Stranger) => Row,
    (lib: Library, other: Stranger) => number,
  ];

  const notOwned: NotOwnedCase[] = [
    ["another user's job", (l, o) => ({ jobIds: [l.jobA.id, l.jobB.id, o.job.id] }), (_l, o) => o.job.id],
    ["another user's project", (l, o) => ({ projectIds: [l.project.id, o.project.id] }), (_l, o) => o.project.id],
    ["another user's skill", (_l, o) => ({ skillIds: [o.skill.id] }), (_l, o) => o.skill.id],
    ["another user's bullet", (l, o) => ({ bulletIds: [l.a1.id, o.bullet.id] }), (_l, o) => o.bullet.id],
    ["another user's summary", (_l, o) => ({ summaryId: o.summary.id }), (_l, o) => o.summary.id],
    ["another user's company", (_l, o) => ({ companyId: o.company.id }), (_l, o) => o.company.id],
    ["a job that does not exist", (l) => ({ jobIds: [l.jobA.id, l.jobB.id, MISSING_ID] }), () => MISSING_ID],
    ["a bullet that does not exist", (l) => ({ bulletIds: [l.a1.id, MISSING_ID] }), () => MISSING_ID],
    ["a summary that does not exist", () => ({ summaryId: MISSING_ID }), () => MISSING_ID],
  ];

  it.each(notOwned)("returns a not-found error for %s and writes nothing", async (_l, patch, id) => {
    const lib = await library();
    const other = await stranger();
    const resume = await seededResume(lib);
    const before = await resumeState(resume.id);
    const mcp = await mcpSession(lib.user.id);

    const outcome = await mcp.call("update_resume", {
      resumeId: resume.id,
      name: "Should not be stored",
      ...patch(lib, other),
    });

    expectNotFound(outcome, id(lib, other));
    expect(await resumeState(resume.id)).toEqual(before);
  });

  it("returns a not-found error for a resume that does not exist", async () => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    expectNotFound(
      await mcp.call("update_resume", { resumeId: MISSING_ID, name: "Ghost" }),
      MISSING_ID,
    );
  });

  it("returns a not-found error for another user's resume and leaves it alone", async () => {
    const other = await stranger();
    const lib = await library();
    const before = await resumeState(other.resume.id);
    const mcp = await mcpSession(lib.user.id);

    expectNotFound(
      await mcp.call("update_resume", {
        resumeId: other.resume.id,
        name: "Hijacked",
        jobIds: [lib.jobA.id],
        bulletIds: [lib.a1.id],
      }),
      other.resume.id,
    );
    expect(await resumeState(other.resume.id)).toEqual(before);
  });
});

// ── The whole tailoring flow ──

describe("tailoring flow, tools only", () => {
  it("company -> application -> summary -> resume -> link, then the builder and get_application agree", async () => {
    const lib = await library();
    const mcp = await mcpSession(lib.user.id);
    const description =
      "Marlowe & Finch Analytics is hiring a Staff Data Engineer.\n\n" +
      "You will:\n- Own the ingestion pipeline\n- Mentor four engineers";

    const company = okJson<{ id: number; name: string; existing: boolean }>(
      await mcp.call("create_company", {
        name: "Marlowe & Finch Analytics",
        industry: "Analytics",
        techStack: ["Elixir", "ClickHouse"],
      }),
    );
    expect(company.existing).toBe(false);

    const application = okJson<{ id: number; companyId: number; status: string; url: string }>(
      await mcp.call("create_application", {
        jobTitle: "Staff Data Engineer",
        companyId: company.id,
        jobDescription: description,
        jobUrl: "https://careers.marlowefinch.test/staff-data-engineer",
      }),
    );
    expect(application.companyId).toBe(company.id);
    expect(application.status).toBe("wishlist");

    const summary = okJson<{ id: number; name: string }>(
      await mcp.call("add_summary", {
        name: "Marlowe & Finch",
        text: "Data engineer who has run ingestion pipelines at scale.",
      }),
    );

    const resume = okJson<{ id: number; name: string; url: string }>(
      await mcp.call("create_resume", {
        name: "Marlowe & Finch - Staff Data Engineer",
        template: "minimal",
        summaryId: summary.id,
        companyId: company.id,
        jobIds: [lib.jobB.id, lib.jobA.id],
        projectIds: [lib.project.id],
        skillIds: [lib.s2.id],
        bulletIds: [lib.b1.id, lib.a2.id, lib.p1.id],
      }),
    );
    expect(resume.url).toBe(`https://resume.test/builder/${resume.id}`);

    okJson(
      await mcp.call("update_application", {
        applicationId: application.id,
        resumeId: resume.id,
      }),
    );

    // The builder page for the new resume shows what the tools selected.
    const { loader } = await import("~/routes/builder");
    const page = (await run(
      loader,
      getRequest(`/builder/${resume.id}`, await sessionCookie(lib.user.id)),
      { id: String(resume.id) },
    )) as {
      resume: Row;
      selectedJobIds: number[];
      selectedProjectIds: number[];
      selectedBulletIds: number[];
      selectedSkillIds: number[];
    };
    expect(page).not.toBeInstanceOf(Response);
    expect(page.resume).toMatchObject({
      id: resume.id,
      name: "Marlowe & Finch - Staff Data Engineer",
      template: "minimal",
      summaryId: summary.id,
      companyId: company.id,
    });
    expect(page.selectedJobIds).toEqual([lib.jobB.id, lib.jobA.id]);
    expect(page.selectedProjectIds).toEqual([lib.project.id]);
    expect(page.selectedBulletIds).toEqual([lib.b1.id, lib.a2.id, lib.p1.id]);
    expect(page.selectedSkillIds).toEqual([lib.s2.id]);

    const fetched = okJson<{ application: Row; company: Row | null }>(
      await mcp.call("get_application", { id: application.id }),
    );
    expect(fetched.application).toMatchObject({
      id: application.id,
      jobTitle: "Staff Data Engineer",
      status: "wishlist",
      companyId: company.id,
      resumeId: resume.id,
      jobDescription: description,
    });
    expect(fetched.company?.name).toBe("Marlowe & Finch Analytics");
  });
});
