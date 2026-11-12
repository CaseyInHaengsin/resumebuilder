// Phase 4d — buildResumeData: the pure assembly of ResumeData from what the
// builder loader returns. Pins the behavior of the inline `previewData`
// useMemo in app/routes/builder.tsx, except that a missing contact row gives
// an empty name/email and a missing education row gives `education: null`
// (no "Your Name" / "email@example.com" / "University" placeholders).
import { describe, expect, it } from "vitest";
import { buildResumeData } from "~/lib/resume-data";

type Input = Parameters<typeof buildResumeData>[0];
type Row<K extends "jobs" | "projects" | "bullets" | "skills" | "summaries"> = Input[K][number];

const USER = 1;

function job(id: number, title: string, sortOrder = id): Row<"jobs"> {
  return { id, userId: USER, title, company: `${title} Co`, dates: `20${10 + id} - 20${11 + id}`, location: `City ${id}`, sortOrder };
}

function project(id: number, name: string, sortOrder = id): Row<"projects"> {
  return { id, userId: USER, name, dates: `20${10 + id}`, tech: `Tech ${id}`, sortOrder };
}

function bullet(id: number, parentType: "job" | "project", parentId: number, text: string): Row<"bullets"> {
  return { id, userId: USER, parentType, parentId, text, tags: [], priority: 2, sortOrder: id };
}

function skill(id: number, category: string, items: string[]): Row<"skills"> {
  return { id, userId: USER, category, name: `${category} set`, items, sortOrder: id };
}

function makeInput(overrides: Partial<Input> = {}, resume: Partial<Input["resume"]> = {}): Input {
  return {
    resume: {
      id: 10,
      userId: USER,
      name: "Platform roles",
      summaryId: 2,
      companyId: null,
      template: "modern",
      useCustomContact: false,
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      contactLinkedin: null,
      contactGithub: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...resume,
    },
    contact: {
      id: 1,
      userId: USER,
      name: "Jane Doe",
      phone: "(555) 010-2345",
      email: "jane@example.com",
      linkedin: "linkedin.com/in/jane-doe",
      github: "github.com/jane-doe",
    },
    education: { id: 1, userId: USER, school: "University of Texas at Austin", degrees: ["B.S. Computer Science, 2017"] },
    summaries: [
      { id: 1, userId: USER, name: "API focus", text: "Summary about APIs." },
      { id: 2, userId: USER, name: "Platform focus", text: "Summary about platforms." },
    ],
    // Library order is the order of these arrays (the loader sorts by sortOrder).
    // It does not decide the output order: the selected-id arrays below do.
    jobs: [job(1, "Staff Engineer"), job(2, "Backend Developer"), job(3, "Support Technician")],
    projects: [project(1, "Open Source Linter"), project(2, "Budget Tracker")],
    bullets: [
      bullet(101, "job", 1, "Job one, first"),
      bullet(102, "job", 1, "Job one, second"),
      bullet(103, "job", 1, "Job one, third"),
      bullet(104, "job", 2, "Job two, first"),
      bullet(105, "job", 3, "Job three, first"),
      bullet(106, "job", 3, "Job three, second"),
      // Project 1 shares its id with job 1: parentType must tell them apart.
      bullet(107, "project", 1, "Project one, first"),
      bullet(108, "project", 1, "Project one, second"),
      bullet(109, "project", 2, "Project two, first"),
    ],
    skills: [
      skill(1, "Languages", ["TypeScript", "Go"]),
      skill(2, "Frameworks", ["React"]),
      skill(3, "Tools", ["Docker", "Terraform"]),
    ],
    selectedJobIds: [3, 1],
    selectedProjectIds: [1],
    selectedBulletIds: [106, 103, 101, 104, 108, 109],
    selectedSkillIds: [3, 1],
    ...overrides,
  };
}

describe("buildResumeData", () => {
  it("includes only selected jobs, in selectedJobIds order, with their fields", () => {
    const data = buildResumeData(makeInput());
    expect(data.jobs.map((j) => j.title)).toEqual(["Support Technician", "Staff Engineer"]);
    expect(data.jobs[1]).toEqual({
      title: "Staff Engineer",
      company: "Staff Engineer Co",
      dates: "2011 - 2012",
      location: "City 1",
      bullets: ["Job one, third", "Job one, first"],
    });
  });

  it("includes only selected bullets, under their own parent, in selectedBulletIds order", () => {
    const data = buildResumeData(makeInput());
    // 104 is selected but its job (2) is not: it appears nowhere.
    expect(data.jobs.map((j) => j.bullets)).toEqual([
      ["Job three, second"],
      ["Job one, third", "Job one, first"],
    ]);
    // 109 is selected but its project (2) is not; job 1's bullets do not leak into project 1.
    expect(data.projects).toEqual([
      { name: "Open Source Linter", dates: "2011", tech: "Tech 1", bullets: ["Project one, second"] },
    ]);
  });

  it("keeps a selected job or project that has no selected bullets", () => {
    const data = buildResumeData(makeInput({ selectedJobIds: [2], selectedProjectIds: [2], selectedBulletIds: [] }));
    expect(data.jobs).toEqual([
      { title: "Backend Developer", company: "Backend Developer Co", dates: "2012 - 2013", location: "City 2", bullets: [] },
    ]);
    expect(data.projects).toEqual([{ name: "Budget Tracker", dates: "2012", tech: "Tech 2", bullets: [] }]);
  });

  it("includes only selected skills, in selectedSkillIds order, as category and items", () => {
    const data = buildResumeData(makeInput());
    expect(data.skills).toEqual([
      { category: "Tools", items: ["Docker", "Terraform"] },
      { category: "Languages", items: ["TypeScript", "Go"] },
    ]);
  });

  it("lists projects in selectedProjectIds order, each with its bullets in selectedBulletIds order", () => {
    const data = buildResumeData(
      makeInput({ selectedProjectIds: [2, 1], selectedBulletIds: [108, 109, 107] }),
    );
    expect(data.projects).toEqual([
      { name: "Budget Tracker", dates: "2012", tech: "Tech 2", bullets: ["Project two, first"] },
      {
        name: "Open Source Linter",
        dates: "2011",
        tech: "Tech 1",
        bullets: ["Project one, second", "Project one, first"],
      },
    ]);
  });

  it("orders one parent's bullets by selectedBulletIds even when other parents' ids sit between them", () => {
    const data = buildResumeData(
      makeInput({ selectedJobIds: [1, 3], selectedBulletIds: [102, 106, 103, 105, 101] }),
    );
    expect(data.jobs.map((j) => j.bullets)).toEqual([
      ["Job one, second", "Job one, third", "Job one, first"],
      ["Job three, second", "Job three, first"],
    ]);
  });

  it("ignores the order and sortOrder of the library rows", () => {
    const base = makeInput();
    const shuffled = makeInput({
      jobs: [job(2, "Backend Developer", 0), job(3, "Support Technician", 9), job(1, "Staff Engineer", 5)],
      projects: [project(2, "Budget Tracker", 0), project(1, "Open Source Linter", 1)],
      bullets: [...base.bullets].reverse().map((b, i) => ({ ...b, sortOrder: i })),
      skills: [...base.skills].reverse().map((s, i) => ({ ...s, sortOrder: i })),
    });
    expect(buildResumeData(shuffled)).toEqual(buildResumeData(base));
  });

  // A selection whose library row is gone is skipped, not rendered or thrown on.
  it("skips selected ids that have no library row", () => {
    const data = buildResumeData(
      makeInput({
        selectedJobIds: [99, 3, 1],
        selectedProjectIds: [98, 1],
        selectedBulletIds: [97, 106, 103, 101, 108],
        selectedSkillIds: [96, 3, 1],
      }),
    );
    expect(data.jobs.map((j) => j.title)).toEqual(["Support Technician", "Staff Engineer"]);
    expect(data.jobs[1].bullets).toEqual(["Job one, third", "Job one, first"]);
    expect(data.projects.map((p) => p.name)).toEqual(["Open Source Linter"]);
    expect(data.skills.map((s) => s.category)).toEqual(["Tools", "Languages"]);
  });

  it("returns empty lists when nothing is selected", () => {
    const data = buildResumeData(
      makeInput({ selectedJobIds: [], selectedProjectIds: [], selectedBulletIds: [], selectedSkillIds: [] }),
    );
    expect(data.jobs).toEqual([]);
    expect(data.projects).toEqual([]);
    expect(data.skills).toEqual([]);
  });

  it("uses the text of the summary named by resume.summaryId", () => {
    expect(buildResumeData(makeInput()).summary).toBe("Summary about platforms.");
    expect(buildResumeData(makeInput({}, { summaryId: 1 })).summary).toBe("Summary about APIs.");
  });

  it("uses an empty summary when none is chosen or the chosen one is gone", () => {
    expect(buildResumeData(makeInput({}, { summaryId: null })).summary).toBe("");
    expect(buildResumeData(makeInput({}, { summaryId: 99 })).summary).toBe("");
  });

  it("uses the library contact row by default", () => {
    const data = buildResumeData(
      makeInput({}, { contactName: "Ignored Name", contactEmail: "ignored@example.com" }),
    );
    expect(data.contact).toEqual({
      name: "Jane Doe",
      phone: "(555) 010-2345",
      email: "jane@example.com",
      linkedin: "linkedin.com/in/jane-doe",
      github: "github.com/jane-doe",
    });
  });

  it("uses the resume's custom contact when useCustomContact is set", () => {
    const data = buildResumeData(
      makeInput(
        {},
        {
          useCustomContact: true,
          contactName: "Rosa Marlowe",
          contactPhone: "(555) 010-9999",
          contactEmail: "rosa@example.com",
          contactLinkedin: "linkedin.com/in/rosa-marlowe",
          contactGithub: null,
        },
      ),
    );
    expect(data.contact).toEqual({
      name: "Rosa Marlowe",
      phone: "(555) 010-9999",
      email: "rosa@example.com",
      linkedin: "linkedin.com/in/rosa-marlowe",
      github: null,
    });
  });

  it("gives an empty name and email for a custom contact that is not filled in", () => {
    const data = buildResumeData(makeInput({ contact: undefined }, { useCustomContact: true }));
    expect(data.contact.name).toBe("");
    expect(data.contact.email).toBe("");
    expect(data.contact.phone ?? null).toBeNull();
    expect(data.contact.linkedin ?? null).toBeNull();
    expect(data.contact.github ?? null).toBeNull();
  });

  it("gives an empty name and email, not placeholders, when there is no contact row", () => {
    const data = buildResumeData(makeInput({ contact: undefined }));
    expect(data.contact.name).toBe("");
    expect(data.contact.email).toBe("");
    expect(data.contact.phone ?? null).toBeNull();
    expect(data.contact.linkedin ?? null).toBeNull();
    expect(data.contact.github ?? null).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/Your Name|email@example\.com/);
  });

  it("maps the education row to school and degrees", () => {
    expect(buildResumeData(makeInput()).education).toEqual({
      school: "University of Texas at Austin",
      degrees: ["B.S. Computer Science, 2017"],
    });
  });

  it("gives education null, not a placeholder, when there is no education row", () => {
    const data = buildResumeData(makeInput({ education: undefined }));
    expect(data.education).toBeNull();
    expect(JSON.stringify(data)).not.toContain("University");
  });

  it("does not modify its input", () => {
    const input = makeInput();
    const before = structuredClone(input);
    buildResumeData(input);
    expect(input).toEqual(before);
  });
});
