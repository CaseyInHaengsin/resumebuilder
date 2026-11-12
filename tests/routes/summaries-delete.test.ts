import { createUser, getDb, seedResume, seedSummary } from "../helpers/db";
import { formRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

async function summaryExists(id: number) {
  const { db, schema } = await getDb();
  return (
    db.select().from(schema.summaries).where(eq(schema.summaries.id, id)).get() !==
    undefined
  );
}

async function resumeSummaryId(resumeId: number) {
  const { db, schema } = await getDb();
  const row = db
    .select({ summaryId: schema.resumes.summaryId })
    .from(schema.resumes)
    .where(eq(schema.resumes.id, resumeId))
    .get();
  if (!row) throw new Error(`resume ${resumeId} is gone`);
  return row.summaryId;
}

async function deleteSummary(id: number, cookie: string) {
  const { action } = await import("~/routes/api.summaries");
  return run(
    action,
    formRequest("/api/summaries", { _action: "delete", id }, cookie),
  );
}

describe("api.summaries delete", () => {
  it("deletes a summary that resumes use and clears it from those resumes", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const used = await seedSummary(user.id, "Backend focus");
    const kept = await seedSummary(user.id, "Frontend focus");
    const first = await seedResume(user.id, { name: "First", summaryId: used.id });
    const second = await seedResume(user.id, { name: "Second", summaryId: used.id });
    const other = await seedResume(user.id, { name: "Other", summaryId: kept.id });

    const result = await deleteSummary(used.id, cookie);

    expect(statusOf(result)).toBe(200);
    expect(await summaryExists(used.id)).toBe(false);
    expect(await resumeSummaryId(first.id)).toBeNull();
    expect(await resumeSummaryId(second.id)).toBeNull();
    // Resumes on a different summary are untouched.
    expect(await summaryExists(kept.id)).toBe(true);
    expect(await resumeSummaryId(other.id)).toBe(kept.id);
  });

  // Passing guards: must stay true once the action starts clearing resumes.
  it("deletes a summary no resume uses", async () => {
    const user = await createUser();
    const summary = await seedSummary(user.id);
    const result = await deleteSummary(summary.id, await sessionCookie(user.id));
    expect(statusOf(result)).toBe(200);
    expect(await summaryExists(summary.id)).toBe(false);
  });

  it("does not delete another user's summary or detach it from their resumes", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const used = await seedSummary(owner.id, "In use");
    const unused = await seedSummary(owner.id, "Not in use");
    const resume = await seedResume(owner.id, { summaryId: used.id });
    const cookie = await sessionCookie(intruder.id);

    await deleteSummary(used.id, cookie);
    await deleteSummary(unused.id, cookie);

    expect(await summaryExists(used.id)).toBe(true);
    expect(await summaryExists(unused.id)).toBe(true);
    expect(await resumeSummaryId(resume.id)).toBe(used.id);
  });

  it("redirects to login without a session and deletes nothing", async () => {
    const user = await createUser();
    const summary = await seedSummary(user.id);
    const { action } = await import("~/routes/api.summaries");
    const result = await run(
      action,
      formRequest("/api/summaries", { _action: "delete", id: summary.id }),
    );
    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toContain("/login");
    expect(await summaryExists(summary.id)).toBe(true);
  });
});
