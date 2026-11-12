/**
 * Throwaway documents directory and seed data for the server-side PDF,
 * sent-copy snapshot and cover letter tests.
 *
 * IMPORT THIS FIRST in every test file that reaches `DOCUMENTS_DIR` (through a
 * route, lib or MCP module), and load app modules with a dynamic
 * `await import("~/...")` afterwards. Importing it also imports `./db`, so the
 * temp database is in place too.
 *
 * On import this module:
 *   1. points DOCUMENTS_DIR at `<temp test dir>/documents`,
 *   2. refuses to continue unless that resolves inside the OS temp directory
 *      and outside the repository (same guard as the database path),
 *   3. sets PUBLIC_URL so links built by the MCP tools are predictable.
 *
 * The directory is NOT created here: the app has to create it on first write,
 * as it must for a fresh `data/documents`. It is removed with the rest of the
 * temp test directory by the `afterAll` in `./db`.
 *
 * The real `data/documents/` is never opened.
 */
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { TEST_DIR, assertTempPath, getDb } from "./db";

process.env.DOCUMENTS_DIR = path.join(TEST_DIR, "documents");

export const DOCUMENTS_DIR = assertTempPath(
  process.env.DOCUMENTS_DIR,
  "DOCUMENTS_DIR",
);

/** Browser-facing origin the MCP tools must use for links. */
export const PUBLIC_ORIGIN = "https://resume.example.test";
process.env.PUBLIC_URL = PUBLIC_ORIGIN;

// ── Stored documents ──

/** Names of the files currently in the documents directory (empty if it does not exist). */
export function documentFiles(): string[] {
  assertTempPath(DOCUMENTS_DIR, "DOCUMENTS_DIR");
  if (!fs.existsSync(DOCUMENTS_DIR)) return [];
  if (!fs.statSync(DOCUMENTS_DIR).isDirectory()) return [];
  return fs.readdirSync(DOCUMENTS_DIR).sort();
}

/** Absolute path of a stored document, checked to be directly inside the temp documents directory. */
export function storedPath(storedName: string): string {
  if (!storedName || storedName !== path.basename(storedName)) {
    throw new Error(`storedName must be a bare file name, got "${storedName}"`);
  }
  return assertTempPath(path.join(DOCUMENTS_DIR, storedName), "stored document");
}

/** `application_documents` rows of an application, oldest first. */
export async function documentRows(applicationId: number) {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.applicationDocuments)
    .where(eq(schema.applicationDocuments.applicationId, applicationId))
    .orderBy(asc(schema.applicationDocuments.id))
    .all();
}

export async function documentRow(id: number) {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.applicationDocuments)
    .where(eq(schema.applicationDocuments.id, id))
    .get();
}

/**
 * Makes every write to the documents directory fail while `fn` runs, by
 * putting a regular file where the directory should be. Works whether the app
 * reads DOCUMENTS_DIR at import time or at call time, and regardless of the
 * user the tests run as. Anything already stored is moved aside and restored.
 */
export async function withBrokenDocumentsDir<T>(fn: () => Promise<T>): Promise<T> {
  assertTempPath(DOCUMENTS_DIR, "DOCUMENTS_DIR");
  const aside = `${DOCUMENTS_DIR}.aside`;
  assertTempPath(aside, "DOCUMENTS_DIR aside");
  const existed = fs.existsSync(DOCUMENTS_DIR);
  if (existed) fs.renameSync(DOCUMENTS_DIR, aside);
  fs.writeFileSync(DOCUMENTS_DIR, "not a directory");
  try {
    return await fn();
  } finally {
    fs.rmSync(DOCUMENTS_DIR, { force: true });
    if (existed) fs.renameSync(aside, DOCUMENTS_DIR);
  }
}

// ── Seed data (fictional people and companies only) ──

export const TEXT = {
  summary: "Backend engineer who likes boring, dependable systems.",
  /** Bullets of the first library job (Staff Engineer at Fernhill Robotics). */
  staffFirst: "Rebuilt the telemetry ingest path to handle nine thousand robots.",
  staffUnselected: "Organized the quarterly offsite for the whole engineering group.",
  staffThird: "Cut firmware rollout time from two days to forty minutes.",
  /** Bullet of the second library job (Platform Engineer at Quillfeather Labs). */
  platformOnly: "Moved the billing ledger onto an append-only event store.",
  /** Not part of any resume until a test selects it. */
  addedLater: "Wrote the incident handbook that every new on-call engineer reads.",
} as const;

export const LIBRARY_CONTACT = {
  name: "Marisol Venn",
  phone: "(555) 010-7788",
  email: "marisol@example.com",
  linkedin: "linkedin.com/in/marisol-venn",
  github: "github.com/marisol-venn",
} as const;

export async function seedContact(
  userId: number,
  values: Partial<typeof LIBRARY_CONTACT> = {},
) {
  const { db, schema } = await getDb();
  return db
    .insert(schema.contact)
    .values({ userId, ...LIBRARY_CONTACT, ...values })
    .returning()
    .get();
}

type ResumeInsert = (typeof import("~/db/schema"))["resumes"]["$inferInsert"];

/**
 * A user's library plus one resume that selects part of it, in an order that
 * differs from both the library order and the order the rows were inserted:
 *
 *   library jobs:      Staff Engineer (sort 0), Platform Engineer (sort 1)
 *   resume jobs:       Platform Engineer, Staff Engineer
 *   resume bullets:    staffThird, staffFirst (staffUnselected is left out),
 *                      platformOnly
 *
 * So the PDF reads: Platform Engineer, platformOnly, Staff Engineer,
 * staffThird, staffFirst.
 */
export async function seedRenderableResume(
  userId: number,
  resumeValues: Partial<ResumeInsert> = {},
  options: { contact?: Partial<typeof LIBRARY_CONTACT> | false } = {},
) {
  const { db, schema } = await getDb();
  const now = "2026-01-01T00:00:00.000Z";

  const contactRow =
    options.contact === false ? null : await seedContact(userId, options.contact);
  const education = db
    .insert(schema.education)
    .values({ userId, school: "Larkspur State University", degrees: ["B.S. Computer Science"] })
    .returning()
    .get();
  const summary = db
    .insert(schema.summaries)
    .values({ userId, name: "Backend focus", text: TEXT.summary })
    .returning()
    .get();
  const staffJob = db
    .insert(schema.jobs)
    .values({
      userId,
      title: "Staff Engineer",
      company: "Fernhill Robotics",
      dates: "2022 - 2025",
      location: "Remote",
      sortOrder: 0,
    })
    .returning()
    .get();
  const platformJob = db
    .insert(schema.jobs)
    .values({
      userId,
      title: "Platform Engineer",
      company: "Quillfeather Labs",
      dates: "2019 - 2022",
      location: "Boise, ID",
      sortOrder: 1,
    })
    .returning()
    .get();
  const bullet = (parentId: number, text: string, sortOrder: number) =>
    db
      .insert(schema.bullets)
      .values({ userId, parentType: "job", parentId, text, tags: [], sortOrder })
      .returning()
      .get();
  const staffFirst = bullet(staffJob.id, TEXT.staffFirst, 0);
  const staffUnselected = bullet(staffJob.id, TEXT.staffUnselected, 1);
  const staffThird = bullet(staffJob.id, TEXT.staffThird, 2);
  const platformOnly = bullet(platformJob.id, TEXT.platformOnly, 0);
  const addedLater = bullet(staffJob.id, TEXT.addedLater, 3);
  const skill = db
    .insert(schema.skills)
    .values({ userId, category: "Languages", name: "Default", items: ["TypeScript", "Elixir"] })
    .returning()
    .get();

  const resume = db
    .insert(schema.resumes)
    .values({
      userId,
      name: "Robotics resume",
      summaryId: summary.id,
      template: "modern",
      createdAt: now,
      updatedAt: now,
      ...resumeValues,
    })
    .returning()
    .get();

  // Inserted against the stored order on purpose: sortOrder decides, not row id.
  db.insert(schema.resumeJobs)
    .values([
      { resumeId: resume.id, jobId: staffJob.id, sortOrder: 1 },
      { resumeId: resume.id, jobId: platformJob.id, sortOrder: 0 },
    ])
    .run();
  db.insert(schema.resumeBullets)
    .values([
      { resumeId: resume.id, bulletId: staffFirst.id, sortOrder: 1 },
      { resumeId: resume.id, bulletId: platformOnly.id, sortOrder: 2 },
      { resumeId: resume.id, bulletId: staffThird.id, sortOrder: 0 },
    ])
    .run();
  db.insert(schema.resumeSkills)
    .values({ resumeId: resume.id, skillId: skill.id, sortOrder: 0 })
    .run();

  return {
    resume,
    contact: contactRow,
    education,
    summary,
    jobs: { staff: staffJob, platform: platformJob },
    bullets: { staffFirst, staffUnselected, staffThird, platformOnly, addedLater },
    skill,
  };
}

/** Adds a library bullet to a resume's selection, after everything already selected. */
export async function selectBullet(resumeId: number, bulletId: number) {
  const { db, schema } = await getDb();
  db.insert(schema.resumeBullets)
    .values({ resumeId, bulletId, sortOrder: 99 })
    .run();
}

/** Removes a bullet from a resume's selection. */
export async function unselectBullet(resumeId: number, bulletId: number) {
  const { db, schema } = await getDb();
  db.delete(schema.resumeBullets)
    .where(
      and(
        eq(schema.resumeBullets.resumeId, resumeId),
        eq(schema.resumeBullets.bulletId, bulletId),
      ),
    )
    .run();
}

// ── Cover letters ──

export const LETTER = {
  recipient: "Hiring Manager, Fernhill Robotics",
  paragraphs: [
    "Dear Hiring Manager,",
    "I am writing about the Platform Engineer opening on your fleet team. For three years I kept nine thousand warehouse robots reporting home on time.",
    "What draws me to Fernhill is the habit of publishing your postmortems. I would like to help write the next ones, ideally shorter.",
    "Sincerely,\nMarisol Venn",
  ],
} as const;

export const LETTER_BODY = LETTER.paragraphs.join("\n\n");

/** Inserts a cover letter row directly (bypassing the routes). */
export async function seedCoverLetter(
  userId: number,
  applicationId: number,
  values: { recipient?: string | null; body?: string } = {},
) {
  const { db, schema } = await getDb();
  const now = "2026-01-01T00:00:00.000Z";
  return db
    .insert(schema.coverLetters)
    .values({
      userId,
      applicationId,
      recipient: values.recipient === undefined ? LETTER.recipient : values.recipient,
      body: values.body ?? LETTER_BODY,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export async function coverLetterRows(applicationId: number) {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.coverLetters)
    .where(eq(schema.coverLetters.applicationId, applicationId))
    .all();
}

// ── Responses and PDF text ──

/** Body of a Response as a Buffer. */
export async function bodyBytes(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

export function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/** Whitespace-insensitive position of `needle` in `haystack`; -1 when absent. */
export function at(haystack: string, needle: string): number {
  return haystack.replace(/\s+/g, "").indexOf(needle.replace(/\s+/g, ""));
}
