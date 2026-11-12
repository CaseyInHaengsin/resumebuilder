import {
  createUser,
  getDb,
  seedApplication,
  seedCompany,
  seedResume,
} from "../helpers/db";
import { formRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// An application must only ever point at its owner's company and resume.

let userId: number;
let cookie: string;
let ownCompanyId: number;
let ownResumeId: number;
let otherCompanyId: number;
let otherResumeId: number;

beforeAll(async () => {
  userId = (await createUser()).id;
  cookie = await sessionCookie(userId);
  const other = await createUser();
  ownCompanyId = (await seedCompany(userId, "Fernhill Robotics")).id;
  ownResumeId = (await seedResume(userId)).id;
  otherCompanyId = (await seedCompany(other.id, "Quarry Labs")).id;
  otherResumeId = (await seedResume(other.id)).id;
});

async function post(fields: Record<string, string | number>) {
  const { action } = await import("~/routes/api.applications");
  return run(action, formRequest("/api/applications", fields, cookie));
}

async function countApplications(): Promise<number> {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.userId, userId))
    .all().length;
}

async function applicationById(id: number) {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.id, id))
    .get();
}

describe("create", () => {
  it.each([
    ["another user's company", () => ({ companyId: otherCompanyId })],
    ["another user's resume", () => ({ resumeId: otherResumeId })],
    ["a company that does not exist", () => ({ companyId: 999_999 })],
    ["a resume that does not exist", () => ({ resumeId: 999_999 })],
  ])("rejects %s and creates nothing", async (_label, fields) => {
    const before = await countApplications();
    const result = await post({
      _action: "create",
      jobTitle: "Platform Engineer",
      ...fields(),
    });
    expect(statusOf(result)).toBe(400);
    expect(await countApplications()).toBe(before);
  });

  it("accepts the user's own company and resume", async () => {
    const before = await countApplications();
    const result = await post({
      _action: "create",
      jobTitle: "Platform Engineer",
      companyId: ownCompanyId,
      resumeId: ownResumeId,
    });
    expect(statusOf(result)).toBe(302);
    expect(await countApplications()).toBe(before + 1);
  });
});

describe("update", () => {
  it.each([
    ["another user's company", () => ({ companyId: otherCompanyId })],
    ["another user's resume", () => ({ resumeId: otherResumeId })],
    ["a company that does not exist", () => ({ companyId: 999_999 })],
    ["a resume that does not exist", () => ({ resumeId: 999_999 })],
  ])("rejects %s and changes nothing", async (_label, fields) => {
    const seeded = await seedApplication(userId, {
      companyId: ownCompanyId,
      resumeId: ownResumeId,
    } as never);
    const before = await applicationById(seeded.id);
    const result = await post({
      _action: "update",
      id: seeded.id,
      jobTitle: "Changed title",
      companyId: ownCompanyId,
      resumeId: ownResumeId,
      ...fields(),
    });
    expect(statusOf(result)).toBe(400);
    expect(await applicationById(seeded.id)).toEqual(before);
  });

  it("accepts the user's own ids and clears them when blank", async () => {
    const seeded = await seedApplication(userId);
    let result = await post({
      _action: "update",
      id: seeded.id,
      jobTitle: "Platform Engineer",
      companyId: ownCompanyId,
      resumeId: ownResumeId,
    });
    expect(statusOf(result)).toBe(302);
    let row = await applicationById(seeded.id);
    expect(row?.companyId).toBe(ownCompanyId);
    expect(row?.resumeId).toBe(ownResumeId);

    result = await post({
      _action: "update",
      id: seeded.id,
      jobTitle: "Platform Engineer",
      companyId: "",
      resumeId: "",
    });
    expect(statusOf(result)).toBe(302);
    row = await applicationById(seeded.id);
    expect(row?.companyId).toBeNull();
    expect(row?.resumeId).toBeNull();
  });
});
