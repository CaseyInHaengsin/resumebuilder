import { createUser, seedApplication, seedCompany, seedResume } from "../helpers/db";
import { getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { POSTING, POSTING_FRONTEND } from "../helpers/coverage";
import { describe, expect, it } from "vitest";

type Target = {
  applicationId: number;
  jobTitle: string;
  companyName: string | null;
  jobDescription: string;
};

async function builderData(userId: number, resumeId: number) {
  const { loader } = await import("~/routes/builder");
  const result = await run(
    loader,
    getRequest(`/builder/${resumeId}`, await sessionCookie(userId)),
    { id: String(resumeId) },
  );
  expect(result).not.toBeInstanceOf(Response);
  return result as Record<string, unknown> & { coverageTargets?: Target[] };
}

describe("builder loader: coverageTargets", () => {
  it("lists this resume's applications that have a job description, most recently updated first", async () => {
    const user = await createUser();
    const resume = await seedResume(user.id, { name: "Larkspur resume" });
    const otherResume = await seedResume(user.id, { name: "Other resume" });
    const company = await seedCompany(user.id, "Larkspur Freight");

    const older = await seedApplication(user.id, {
      resumeId: resume.id,
      jobTitle: "Frontend Engineer",
      jobDescription: POSTING_FRONTEND,
      updatedAt: "2026-10-02T09:00:00.000Z",
    });
    const newer = await seedApplication(user.id, {
      resumeId: resume.id,
      companyId: company.id,
      jobTitle: "Senior Backend Engineer",
      jobDescription: POSTING,
      updatedAt: "2026-11-05T09:00:00.000Z",
    });
    // Left out: no description, blank description, another resume, no resume.
    await seedApplication(user.id, {
      resumeId: resume.id,
      jobTitle: "No description",
      updatedAt: "2026-11-09T09:00:00.000Z",
    });
    await seedApplication(user.id, {
      resumeId: resume.id,
      jobTitle: "Blank description",
      jobDescription: "  \n\t ",
      updatedAt: "2026-11-08T09:00:00.000Z",
    });
    await seedApplication(user.id, {
      resumeId: otherResume.id,
      jobTitle: "Linked to another resume",
      jobDescription: POSTING,
      updatedAt: "2026-11-07T09:00:00.000Z",
    });
    await seedApplication(user.id, {
      jobTitle: "Not linked to a resume",
      jobDescription: POSTING,
      updatedAt: "2026-11-06T09:00:00.000Z",
    });

    const data = await builderData(user.id, resume.id);
    expect(data.coverageTargets).toEqual([
      {
        applicationId: newer.id,
        jobTitle: "Senior Backend Engineer",
        companyName: "Larkspur Freight",
        jobDescription: POSTING,
      },
      {
        applicationId: older.id,
        jobTitle: "Frontend Engineer",
        companyName: null,
        jobDescription: POSTING_FRONTEND,
      },
    ]);

    const other = await builderData(user.id, otherResume.id);
    expect(other.coverageTargets?.map((t) => t.jobTitle)).toEqual(["Linked to another resume"]);
  });

  it("is an empty array when no linked application has a description", async () => {
    const user = await createUser();
    const resume = await seedResume(user.id);
    await seedApplication(user.id, { resumeId: resume.id });

    const data = await builderData(user.id, resume.id);
    expect(data.coverageTargets).toEqual([]);
  });

  it("never includes another user's application, even one pointing at this resume", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const resume = await seedResume(owner.id);
    await seedApplication(stranger.id, {
      resumeId: resume.id,
      jobTitle: "Stranger application",
      jobDescription: POSTING,
    });
    const mine = await seedApplication(owner.id, {
      resumeId: resume.id,
      jobTitle: "Platform Engineer",
      jobDescription: "TypeScript and Kafka.",
    });

    const data = await builderData(owner.id, resume.id);
    expect(data.coverageTargets?.map((t) => t.applicationId)).toEqual([mine.id]);
  });

  // Passing guards: behavior that must survive the change.
  it("still returns the resume and its selections", async () => {
    const user = await createUser();
    const resume = await seedResume(user.id, { name: "Guard resume" });
    const data = await builderData(user.id, resume.id);
    expect((data.resume as { id: number }).id).toBe(resume.id);
    for (const key of [
      "allJobs", "allProjects", "allBullets", "allSummaries", "allSkills", "allCompanies",
      "selectedJobIds", "selectedProjectIds", "selectedBulletIds", "selectedSkillIds",
    ]) {
      expect(data[key], key).toEqual([]);
    }
  });

  it("returns 404 for another user's resume", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const resume = await seedResume(owner.id);
    const { loader } = await import("~/routes/builder");
    const result = await run(
      loader,
      getRequest(`/builder/${resume.id}`, await sessionCookie(stranger.id)),
      { id: String(resume.id) },
    );
    expect(statusOf(result)).toBe(404);
  });
});
