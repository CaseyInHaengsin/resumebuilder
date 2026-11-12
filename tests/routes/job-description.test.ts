import { createUser, getDb, seedApplication, SEED_TIMESTAMP } from "../helpers/db";
import { formRequest, getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

type Row = Record<string, unknown>;

let userId: number;
let cookie: string;

beforeAll(async () => {
  userId = (await createUser()).id;
  cookie = await sessionCookie(userId);
});

async function applicationById(id: number): Promise<Row | undefined> {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.id, id))
    .get() as Row | undefined;
}

/** Seeds an application that already has a job description. */
async function seedWithDescription(ownerId: number, jobDescription: string | null) {
  return seedApplication(ownerId, {
    jobTitle: "Platform Engineer",
    notes: "Referred by Odalys Venn",
    jobDescription,
  } as never);
}

async function create(fields: Record<string, string>): Promise<Row> {
  const { action } = await import("~/routes/api.applications");
  const result = await run(
    action,
    formRequest("/api/applications", { _action: "create", ...fields }, cookie),
  );
  expect(result).toBeInstanceOf(Response);
  const location = (result as Response).headers.get("Location") ?? "";
  const match = location.match(/^\/applications\/(\d+)$/);
  expect(match, `redirect to the new application, got "${location}"`).not.toBeNull();
  const row = await applicationById(Number(match![1]));
  expect(row).toBeDefined();
  return row!;
}

async function update(id: number, fields: Record<string, string>): Promise<Row> {
  const { action } = await import("~/routes/api.applications");
  const result = await run(
    action,
    formRequest("/api/applications", { _action: "update", id, ...fields }, cookie),
  );
  expect(statusOf(result)).toBe(302);
  const row = await applicationById(id);
  expect(row).toBeDefined();
  return row!;
}

/** About 20k characters with blank lines, indentation and inner trailing spaces. */
function longDescription(): string {
  const lines: string[] = ["Senior Platform Engineer at Fernhill Robotics", ""];
  let i = 0;
  while (lines.join("\n").length < 20_000) {
    i += 1;
    lines.push(`Responsibility ${i}:   `);
    lines.push(`    - Own the delivery pipeline for fleet ${i} & its "edge" nodes <100ms>`);
    lines.push("");
  }
  lines.push("Benefits: équité, 401(k), 4-day weeks");
  return lines.join("\n");
}

describe("api.applications create: jobDescription", () => {
  it("stores the description with outer whitespace trimmed", async () => {
    const row = await create({
      jobTitle: "Platform Engineer",
      jobDescription: "  \n Build the robot fleet scheduler.\nOn-call one week in six. \n\n",
    });
    expect(row.jobDescription).toBe(
      "Build the robot fleet scheduler.\nOn-call one week in six.",
    );
  });

  it("stores null when the description is only whitespace", async () => {
    const row = await create({ jobTitle: "Data Engineer", jobDescription: "  \n\t " });
    expect(row.jobDescription).toBeNull();
  });

  it("stores null when the form has no description field", async () => {
    const row = await create({ jobTitle: "Site Reliability Engineer" });
    expect(row.jobDescription).toBeNull();
  });

  it("keeps a 20k-character multi-line description unchanged apart from the outer trim", async () => {
    const text = longDescription();
    expect(text.length).toBeGreaterThanOrEqual(20_000);
    const row = await create({
      jobTitle: "Senior Platform Engineer",
      jobDescription: `\n\n  ${text}  \n`,
    });
    expect(row.jobDescription).toBe(text);
  });
});

describe("api.applications update: jobDescription", () => {
  it("replaces the stored description, trimmed, and keeps long text intact", async () => {
    const app = await seedWithDescription(userId, "Old posting text");
    const text = longDescription();
    const row = await update(app.id, {
      jobTitle: "Platform Engineer",
      jobDescription: `  ${text}\n\n`,
    });
    expect(row.jobDescription).toBe(text);
    expect(row.updatedAt).not.toBe(SEED_TIMESTAMP);
  });

  it("leaves the stored description alone when the form has no description field", async () => {
    const app = await seedWithDescription(userId, "Keep this posting text");
    const row = await update(app.id, {
      jobTitle: "Principal Platform Engineer",
      location: "Leeds",
    });
    // The rest of the partial form still applied.
    expect(row.jobTitle).toBe("Principal Platform Engineer");
    expect(row.location).toBe("Leeds");
    expect(row.jobDescription).toBe("Keep this posting text");
  });

  it("clears the stored description when the field is present and blank", async () => {
    const app = await seedWithDescription(userId, "Posting text to remove");
    const row = await update(app.id, {
      jobTitle: "Platform Engineer",
      jobDescription: "   \n ",
    });
    expect(row.jobDescription).toBeNull();
  });

  it("clears the stored description when the field is present and empty", async () => {
    const app = await seedWithDescription(userId, "Posting text to remove");
    const row = await update(app.id, { jobTitle: "Platform Engineer", jobDescription: "" });
    expect(row.jobDescription).toBeNull();
  });
});

describe("application detail loader", () => {
  it("returns the job description with the application", async () => {
    const { loader } = await import("~/routes/applications.$id");
    const app = await seedWithDescription(userId, "Lead the telemetry team.\nRemote in the UK.");
    const result = (await run(loader, getRequest(`/applications/${app.id}`, cookie), {
      id: String(app.id),
    })) as { app: Row };

    expect(result).not.toBeInstanceOf(Response);
    expect(result.app.id).toBe(app.id);
    expect(result.app.jobDescription).toBe("Lead the telemetry team.\nRemote in the UK.");
  });

  it("returns null for an application without a description", async () => {
    const { loader } = await import("~/routes/applications.$id");
    const app = await seedApplication(userId, { jobTitle: "Backend Engineer" });
    const result = (await run(loader, getRequest(`/applications/${app.id}`, cookie), {
      id: String(app.id),
    })) as { app: Row };

    expect(result.app.jobDescription).toBeNull();
  });
});
