import { createUser, getDb, seedApplication, seedResume } from "../helpers/db";
import { expectNotFound, expectRefused, mcpSession, okJson } from "../helpers/mcp";
import { loadKeywords, resumeOf, type Coverage, type LibraryItem } from "../helpers/coverage";
import { describe, expect, it } from "vitest";

const TOOL = "get_keyword_coverage";
const MISSING_RESUME = 987_654;
const MISSING_APPLICATION = 876_543;

const DESCRIPTION = `Larkspur Freight is hiring a platform engineer for the Routing team.

Requirements:
- TypeScript and Kubernetes in production
- PostgreSQL (we run Postgres 16) and Kafka
- Python for tooling
- Terraform
- Background jobs with Oban
- Redis is a plus`;

type ToolCoverage = Omit<Coverage, "terms"> & {
  terms: (Omit<Coverage["terms"][number], "suggestions"> & {
    suggestions: { kind: "bullet" | "skill"; id: number; text: string }[];
  })[];
};

/** The tool's result with suggestion text removed, to compare with analyzeCoverage. */
function withoutText(result: ToolCoverage): Coverage {
  return {
    ...result,
    terms: result.terms.map((t) => ({
      ...t,
      suggestions: t.suggestions.map(({ kind, id }) => ({ kind, id })),
    })),
  };
}

const TEXT = {
  summary: "Backend engineer who has run Kubernetes platforms for logistics companies.",
  b1: "Rebuilt dispatch pricing in TypeScript, cutting quote latency by 40%",
  b2: "Ran the Postgres 16 upgrade with no downtime",
  b3: "Moved background jobs to Oban",
  b4: "Wrote Python tooling for on-call handoffs",
  b5: "Tuned PostgreSQL indexes for the loads table",
  pb1: "Mapped 400 km of trail",
};

/**
 * A user whose resume prints: the summary, one job with bullet b1, one project
 * (tech "Elixir, Redis") with bullet pb1, and skill group s1. Bullets b2-b5 and
 * skill groups s2, s3 are in the library but not on the resume.
 *
 * Bullet sort orders run against id order (b5 sorts before b2) so the test can
 * tell library order from insertion order.
 */
async function seedWorld() {
  const { db, schema } = await getDb();
  const user = await createUser();
  const userId = user.id;

  const summary = db
    .insert(schema.summaries)
    .values({ userId, name: "Platform focus", text: TEXT.summary })
    .returning()
    .get();
  const job = db
    .insert(schema.jobs)
    .values({
      userId,
      title: "Staff Engineer",
      company: "Fernhill Robotics",
      dates: "2021 - 2025",
      location: "Remote",
    })
    .returning()
    .get();
  const project = db
    .insert(schema.projects)
    .values({ userId, name: "Trail Mapper", dates: "2024", tech: "Elixir, Redis" })
    .returning()
    .get();

  const bullet = (
    parentType: "job" | "project",
    parentId: number,
    text: string,
    sortOrder: number,
    tags: string[] = [],
  ) =>
    db
      .insert(schema.bullets)
      .values({ userId, parentType, parentId, text, tags, sortOrder })
      .returning()
      .get();
  const b1 = bullet("job", job.id, TEXT.b1, 0);
  const b2 = bullet("job", job.id, TEXT.b2, 4);
  const b3 = bullet("job", job.id, TEXT.b3, 2, ["Oban"]);
  const b4 = bullet("job", job.id, TEXT.b4, 3);
  const b5 = bullet("job", job.id, TEXT.b5, 1);
  const pb1 = bullet("project", project.id, TEXT.pb1, 5);

  const skill = (category: string, name: string, items: string[], sortOrder: number) =>
    db
      .insert(schema.skills)
      .values({ userId, category, name, items, sortOrder })
      .returning()
      .get();
  const s1 = skill("Languages", "Default", ["TypeScript", "Elixir"], 0);
  const s2 = skill("Data", "Default", ["PostgreSQL", "Redis", "Kafka"], 1);
  const s3 = skill("Scripting", "Default", ["Python", "Bash"], 2);

  const resume = await seedResume(userId, { name: "Larkspur resume", summaryId: summary.id });
  db.insert(schema.resumeJobs).values({ resumeId: resume.id, jobId: job.id }).run();
  db.insert(schema.resumeProjects).values({ resumeId: resume.id, projectId: project.id }).run();
  db.insert(schema.resumeBullets)
    .values([
      { resumeId: resume.id, bulletId: b1.id, sortOrder: 0 },
      { resumeId: resume.id, bulletId: pb1.id, sortOrder: 1 },
    ])
    .run();
  db.insert(schema.resumeSkills).values({ resumeId: resume.id, skillId: s1.id }).run();

  // A second resume of the same user that does use b4: "selected" is per resume.
  const otherResume = await seedResume(userId, { name: "Scripting resume" });
  db.insert(schema.resumeJobs).values({ resumeId: otherResume.id, jobId: job.id }).run();
  db.insert(schema.resumeBullets).values({ resumeId: otherResume.id, bulletId: b4.id }).run();

  const application = await seedApplication(userId, {
    jobTitle: "Platform Engineer",
    resumeId: resume.id,
    jobDescription: DESCRIPTION,
  });

  // Someone else's library mentions the one term this user lacks.
  const stranger = await createUser();
  const strangerJob = db
    .insert(schema.jobs)
    .values({
      userId: stranger.id,
      title: "Site Reliability Engineer",
      company: "Osprey Logistics",
      dates: "2019 - 2024",
      location: "Remote",
    })
    .returning()
    .get();
  db.insert(schema.bullets)
    .values({
      userId: stranger.id,
      parentType: "job",
      parentId: strangerJob.id,
      text: "Operated Terraform modules for forty services",
      tags: ["Terraform"],
    })
    .run();
  const strangerResume = await seedResume(stranger.id, { name: "Stranger resume" });
  const strangerApplication = await seedApplication(stranger.id, {
    jobTitle: "Director of Engineering",
    jobDescription: DESCRIPTION,
  });

  return {
    user, resume, otherResume, application, job, project,
    b1, b2, b3, b4, b5, pb1, s1, s2, s3,
    stranger, strangerResume, strangerApplication,
  };
}

describe("MCP get_keyword_coverage: scope", () => {
  it("is listed for the read scope", async () => {
    const user = await createUser();
    expect((await mcpSession(user.id, ["mcp:read"])).toolNames).toContain(TOOL);
    expect((await mcpSession(user.id)).toolNames).toContain(TOOL);
  });

  // Passing guard today (the tool is not registered anywhere yet).
  it("is not listed for a write-only token", async () => {
    const user = await createUser();
    expect((await mcpSession(user.id, ["mcp:write"])).toolNames).not.toContain(TOOL);
  });
});

describe("MCP get_keyword_coverage: result", () => {
  it("matches analyzeCoverage for the seeded resume and adds the text of each suggestion", async () => {
    const w = await seedWorld();
    const mcp = await mcpSession(w.user.id, ["mcp:read"]);
    const result = okJson<ToolCoverage>(
      await mcp.call(TOOL, { resumeId: w.resume.id, applicationId: w.application.id }),
    );

    const expected: Coverage = {
      total: 8,
      coveredCount: 3,
      terms: [
        {
          term: "PostgreSQL",
          count: 2,
          status: "available",
          suggestions: [
            { kind: "bullet", id: w.b5.id },
            { kind: "bullet", id: w.b2.id },
            { kind: "skill", id: w.s2.id },
          ],
        },
        { term: "TypeScript", count: 1, status: "covered", suggestions: [] },
        { term: "Kubernetes", count: 1, status: "covered", suggestions: [] },
        { term: "Kafka", count: 1, status: "available", suggestions: [{ kind: "skill", id: w.s2.id }] },
        {
          term: "Python",
          count: 1,
          status: "available",
          suggestions: [
            { kind: "bullet", id: w.b4.id },
            { kind: "skill", id: w.s3.id },
          ],
        },
        { term: "Terraform", count: 1, status: "missing", suggestions: [] },
        { term: "Oban", count: 1, status: "available", suggestions: [{ kind: "bullet", id: w.b3.id }] },
        { term: "Redis", count: 1, status: "covered", suggestions: [] },
      ],
    };
    expect(withoutText(result)).toEqual(expected);

    // The same inputs through the pure function.
    const { analyzeCoverage } = await loadKeywords();
    const library: LibraryItem[] = [
      { kind: "bullet", id: w.b1.id, text: TEXT.b1, selected: true },
      { kind: "bullet", id: w.b5.id, text: TEXT.b5, selected: false },
      { kind: "bullet", id: w.b3.id, text: TEXT.b3, selected: false },
      { kind: "bullet", id: w.b4.id, text: TEXT.b4, selected: false },
      { kind: "bullet", id: w.b2.id, text: TEXT.b2, selected: false },
      { kind: "bullet", id: w.pb1.id, text: TEXT.pb1, selected: true },
      { kind: "skill", id: w.s1.id, text: "TypeScript, Elixir", selected: true },
      { kind: "skill", id: w.s2.id, text: "PostgreSQL, Redis, Kafka", selected: false },
      { kind: "skill", id: w.s3.id, text: "Python, Bash", selected: false },
    ];
    const pure = analyzeCoverage({
      description: DESCRIPTION,
      resume: resumeOf({
        summary: TEXT.summary,
        jobs: [
          {
            title: "Staff Engineer",
            company: "Fernhill Robotics",
            dates: "2021 - 2025",
            location: "Remote",
            bullets: [TEXT.b1],
          },
        ],
        projects: [{ name: "Trail Mapper", dates: "2024", tech: "Elixir, Redis", bullets: [TEXT.pb1] }],
        skills: [{ category: "Languages", items: ["TypeScript", "Elixir"] }],
      }),
      library,
      vocabulary: ["TypeScript", "Elixir", "PostgreSQL", "Redis", "Kafka", "Python", "Bash", "Oban"],
    });
    expect(withoutText(result)).toEqual(pure);

    // Suggestion text: the bullet's text, or the skill group's items.
    const suggestions = result.terms.flatMap((t) => t.suggestions);
    const textOf = (kind: string, id: number) =>
      suggestions.find((s) => s.kind === kind && s.id === id)?.text;
    expect(textOf("bullet", w.b5.id)).toBe(TEXT.b5);
    expect(textOf("bullet", w.b2.id)).toBe(TEXT.b2);
    expect(textOf("bullet", w.b4.id)).toBe(TEXT.b4);
    expect(textOf("bullet", w.b3.id)).toBe(TEXT.b3);
    for (const item of ["PostgreSQL", "Redis", "Kafka"]) {
      expect(textOf("skill", w.s2.id)).toContain(item);
    }
    for (const item of ["Python", "Bash"]) expect(textOf("skill", w.s3.id)).toContain(item);
    for (const s of suggestions) {
      expect(Object.keys(s).sort()).toEqual(["id", "kind", "text"]);
    }
  });

  it("judges 'selected' against the resume asked about", async () => {
    const w = await seedWorld();
    const mcp = await mcpSession(w.user.id);
    // otherResume prints the job with bullet b4 (Python) and nothing else.
    const result = okJson<ToolCoverage>(
      await mcp.call(TOOL, { resumeId: w.otherResume.id, applicationId: w.application.id }),
    );
    const status = Object.fromEntries(result.terms.map((t) => [t.term, t.status]));
    expect(status).toEqual({
      PostgreSQL: "available",
      TypeScript: "available",
      Kubernetes: "missing",
      Kafka: "available",
      Python: "covered",
      Terraform: "missing",
      Oban: "available",
      Redis: "available",
    });
    expect(result.coveredCount).toBe(1);
    const typescript = result.terms.find((t) => t.term === "TypeScript");
    expect(typescript?.suggestions.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: "bullet", id: w.b1.id },
      { kind: "skill", id: w.s1.id },
    ]);
  });

  it("works for an application that is not linked to the resume", async () => {
    const w = await seedWorld();
    const unlinked = await seedApplication(w.user.id, {
      jobTitle: "Data Engineer",
      jobDescription: "You will write Python and Terraform.",
    });
    const mcp = await mcpSession(w.user.id);
    const result = okJson<ToolCoverage>(
      await mcp.call(TOOL, { resumeId: w.resume.id, applicationId: unlinked.id }),
    );
    expect(result.terms.map((t) => [t.term, t.status])).toEqual([
      ["Python", "available"],
      ["Terraform", "missing"],
    ]);
    expect(result.total).toBe(2);
    expect(result.coveredCount).toBe(0);
  });
});

describe("MCP get_keyword_coverage: refusals", () => {
  it("reports a resume that is missing or someone else's as not found", async () => {
    const w = await seedWorld();
    const mcp = await mcpSession(w.user.id);

    const missing = await mcp.call(TOOL, {
      resumeId: MISSING_RESUME,
      applicationId: w.application.id,
    });
    expectNotFound(missing, MISSING_RESUME);
    expect(missing.text).toMatch(/resume/i);

    const foreign = await mcp.call(TOOL, {
      resumeId: w.strangerResume.id,
      applicationId: w.application.id,
    });
    expectNotFound(foreign, w.strangerResume.id);
    expect(foreign.text).toMatch(/resume/i);
  });

  it("reports an application that is missing or someone else's as not found", async () => {
    const w = await seedWorld();
    const mcp = await mcpSession(w.user.id);

    const missing = await mcp.call(TOOL, {
      resumeId: w.resume.id,
      applicationId: MISSING_APPLICATION,
    });
    expectNotFound(missing, MISSING_APPLICATION);
    expect(missing.text).toMatch(/application/i);

    const foreign = await mcp.call(TOOL, {
      resumeId: w.resume.id,
      applicationId: w.strangerApplication.id,
    });
    expectNotFound(foreign, w.strangerApplication.id);
    expect(foreign.text).toMatch(/application/i);
    expect(foreign.text).not.toContain("Larkspur");
  });

  it.each([
    ["no", null],
    ["an empty", ""],
    ["a blank", "  \n "],
  ])("returns an error for an application with %s job description", async (_label, jobDescription) => {
    const user = await createUser();
    const resume = await seedResume(user.id);
    const application = await seedApplication(user.id, { jobDescription });
    const mcp = await mcpSession(user.id);

    const outcome = await mcp.call(TOOL, { resumeId: resume.id, applicationId: application.id });
    expectRefused(outcome);
    expect(outcome.contentItems).toBe(1);
    expect(outcome.text).toMatch(/job description/i);
    expect(outcome.text).not.toMatch(/not found/i);
    expect(outcome.text).not.toMatch(/^MCP error/);
  });

  it.each([
    ["no applicationId", (r: number, _a: number) => ({ resumeId: r })],
    ["no resumeId", (_r: number, a: number) => ({ applicationId: a })],
    ["a non-numeric resumeId", (_r: number, a: number) => ({ resumeId: "latest", applicationId: a })],
    ["a fractional applicationId", (r: number, _a: number) => ({ resumeId: r, applicationId: 1.5 })],
  ])("refuses %s", async (_label, args) => {
    const user = await createUser();
    const resume = await seedResume(user.id);
    const application = await seedApplication(user.id, { jobDescription: "TypeScript and Kafka." });
    const mcp = await mcpSession(user.id);
    expectRefused(await mcp.call(TOOL, args(resume.id, application.id)));
  });
});
