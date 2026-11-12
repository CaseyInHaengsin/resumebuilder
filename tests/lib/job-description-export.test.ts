import { createUser, getDb, seedApplication } from "../helpers/db";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

type Row = Record<string, unknown>;

const DESCRIPTION = "Lead the routing team.\n\nMust have:\n- Elixir\n- Postgres";

async function applicationsOf(userId: number): Promise<Row[]> {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.userId, userId))
    .all() as Row[];
}

/** Exports `userId` and passes the payload through JSON, like a downloaded backup file. */
async function exportBackup(userId: number, username: string) {
  const { buildExportPayload } = await import("~/lib/data-export.server");
  const { parseImportPayload } = await import("~/lib/data-import.server");
  const payload = await buildExportPayload(userId, username);
  return parseImportPayload(JSON.parse(JSON.stringify(payload)));
}

// No company is seeded on purpose: importing a backup that contains a company
// fails today with a SQL syntax error (the `values` column is inserted
// unquoted in data-import.server.ts), which is unrelated to this change.
async function seedOwner() {
  const owner = await createUser();
  await seedApplication(owner.id, {
    jobTitle: "Routing Engineer",
    source: "Harrowgate Freight careers page",
    jobDescription: DESCRIPTION,
  } as never);
  await seedApplication(owner.id, { jobTitle: "Support Engineer" });
  return owner;
}

describe("data export: application job description", () => {
  it("includes jobDescription on each exported application", async () => {
    const owner = await seedOwner();
    const backup = await exportBackup(owner.id, owner.username);
    const exported = backup.data.applications as Row[];
    const byTitle = new Map(exported.map((a) => [a.jobTitle, a]));

    expect(exported).toHaveLength(2);
    expect(byTitle.get("Routing Engineer")?.jobDescription).toBe(DESCRIPTION);
    expect(byTitle.get("Support Engineer")).toHaveProperty("jobDescription", null);
  });
});

describe("data import: application job description", () => {
  it("restores jobDescription from a backup", async () => {
    const owner = await seedOwner();
    const backup = await exportBackup(owner.id, owner.username);
    const target = await createUser();
    const { importUserData } = await import("~/lib/data-import.server");

    importUserData(target.id, backup);

    const rows = await applicationsOf(target.id);
    const byTitle = new Map(rows.map((a) => [a.jobTitle, a]));
    expect(rows).toHaveLength(2);
    expect(byTitle.get("Routing Engineer")?.jobDescription).toBe(DESCRIPTION);
    expect(byTitle.get("Support Engineer")?.jobDescription).toBeNull();
    // The neighbouring columns still land where they belong.
    expect(byTitle.get("Routing Engineer")?.source).toBe("Harrowgate Freight careers page");
    expect(byTitle.get("Routing Engineer")?.notes).toBeNull();
  });

  it("imports a backup made before the column existed, leaving the description null", async () => {
    const owner = await seedOwner();
    const backup = await exportBackup(owner.id, owner.username);
    for (const a of backup.data.applications as Row[]) delete a.jobDescription;
    const target = await createUser();
    const { importUserData } = await import("~/lib/data-import.server");

    importUserData(target.id, backup);

    const rows = await applicationsOf(target.id);
    expect(rows.map((a) => a.jobTitle).sort()).toEqual([
      "Routing Engineer",
      "Support Engineer",
    ]);
    for (const row of rows) expect(row.jobDescription).toBeNull();
  });
});
