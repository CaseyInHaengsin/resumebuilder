// Phase 11 — sent-copy snapshots of the resume attached to an application.
//
//   table   application_documents (schema export `applicationDocuments`,
//           `APPLICATION_DOCUMENT_KINDS`)
//   lib     app/lib/documents.server.ts
//             snapshotResumeForApplication(userId, applicationId)
//               -> Promise<{ id: number } | { error: "not_found" | "no_resume" }>
//   actions POST /api/applications  _action=snapshot_resume  id
//           POST /api/applications  _action=delete_document  documentId
//           set_status wishlist -> applied snapshots automatically
//   route   GET /documents/:id  (app/routes/documents.$id.tsx)
//   loader  applications/:id returns `documents`
//
// Files live in DOCUMENTS_DIR, which tests/helpers/documents.ts points at a
// temp directory before any app module loads.
import {
  DOCUMENTS_DIR,
  TEXT,
  at,
  bodyBytes,
  documentFiles,
  documentRow,
  documentRows,
  isPdf,
  seedRenderableResume,
  selectBullet,
  storedPath,
  unselectBullet,
  withBrokenDocumentsDir,
} from "../helpers/documents";
import { createUser, getDb, seedApplication, seedResume } from "../helpers/db";
import { inspectPdf } from "../helpers/pdf";
import { formRequest, getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

const API = "/api/applications";

async function post(fields: Record<string, string | number>, cookie?: string) {
  const { action } = await import("~/routes/api.applications");
  return run(action, formRequest(API, fields, cookie));
}

async function fetchDocument(id: number | string, cookie?: string) {
  const { loader } = await import("~/routes/documents.$id");
  return run(loader, getRequest(`/documents/${id}`, cookie), { id: String(id) });
}

async function applicationRow(id: number) {
  const { db, schema } = await getDb();
  return db.select().from(schema.applications).where(eq(schema.applications.id, id)).get();
}

/** A user with a renderable resume and an application linked to it. */
async function scenario(status: "wishlist" | "applied" = "applied") {
  const user = await createUser();
  const cookie = await sessionCookie(user.id);
  const seeded = await seedRenderableResume(user.id);
  const app = await seedApplication(user.id, { resumeId: seeded.resume.id, status });
  return { user, cookie, app, ...seeded };
}

async function snapshot(userId: number, applicationId: number): Promise<number> {
  const { snapshotResumeForApplication } = await import("~/lib/documents.server");
  const result = await snapshotResumeForApplication(userId, applicationId);
  expect(result).toEqual({ id: expect.any(Number) });
  return (result as { id: number }).id;
}

async function textOf(bytes: Uint8Array): Promise<string> {
  return (await inspectPdf(Buffer.from(bytes))).pages.join(" ");
}

describe("application_documents table", () => {
  it("exports the document kinds", async () => {
    const { schema } = await getDb();
    expect([...schema.APPLICATION_DOCUMENT_KINDS]).toEqual(["resume", "cover_letter"]);
  });

  it("stores a row with every column, nullable ones included", async () => {
    const { db, schema } = await getDb();
    const user = await createUser();
    const resume = await seedResume(user.id);
    const app = await seedApplication(user.id, { resumeId: resume.id });

    const full = db
      .insert(schema.applicationDocuments)
      .values({
        userId: user.id,
        applicationId: app.id,
        kind: "resume",
        fileName: "Marisol-Venn-Resume.pdf",
        storedName: `u${user.id}-full.pdf`,
        resumeId: resume.id,
        template: "classic",
        pageCount: 2,
        createdAt: "2026-11-01T10:00:00.000Z",
      })
      .returning()
      .get();
    expect(full).toEqual({
      id: expect.any(Number),
      userId: user.id,
      applicationId: app.id,
      kind: "resume",
      fileName: "Marisol-Venn-Resume.pdf",
      storedName: `u${user.id}-full.pdf`,
      resumeId: resume.id,
      template: "classic",
      pageCount: 2,
      createdAt: "2026-11-01T10:00:00.000Z",
    });

    const bare = db
      .insert(schema.applicationDocuments)
      .values({
        userId: user.id,
        applicationId: app.id,
        kind: "cover_letter",
        fileName: "Marisol-Venn-Cover-Letter.pdf",
        storedName: `u${user.id}-bare.pdf`,
        createdAt: "2026-11-01T10:00:00.000Z",
      })
      .returning()
      .get();
    expect(bare.resumeId).toBeNull();
    expect(bare.template).toBeNull();
    expect(bare.pageCount).toBeNull();
  });

  it("keeps the row with resumeId null when the resume is deleted", async () => {
    const { db, schema } = await getDb();
    const user = await createUser();
    const resume = await seedResume(user.id);
    const app = await seedApplication(user.id, { resumeId: resume.id });
    const doc = db
      .insert(schema.applicationDocuments)
      .values({
        userId: user.id,
        applicationId: app.id,
        kind: "resume",
        fileName: "Resume.pdf",
        storedName: `u${user.id}-kept.pdf`,
        resumeId: resume.id,
        createdAt: "2026-11-01T10:00:00.000Z",
      })
      .returning()
      .get();

    db.delete(schema.resumes).where(eq(schema.resumes.id, resume.id)).run();

    const after = await documentRow(doc.id);
    expect(after).toBeDefined();
    expect(after!.resumeId).toBeNull();
    expect(after!.applicationId).toBe(app.id);
  });

  it("removes the rows when the application or the user is deleted", async () => {
    const { db, schema } = await getDb();
    const user = await createUser();
    const doomedUser = await createUser();
    const values = (userId: number, applicationId: number, tag: string) => ({
      userId,
      applicationId,
      kind: "resume" as const,
      fileName: "Resume.pdf",
      storedName: `u${userId}-${tag}.pdf`,
      createdAt: "2026-11-01T10:00:00.000Z",
    });
    const gone = await seedApplication(user.id);
    const stays = await seedApplication(user.id);
    const theirs = await seedApplication(doomedUser.id);
    db.insert(schema.applicationDocuments)
      .values([
        values(user.id, gone.id, "gone"),
        values(user.id, stays.id, "stays"),
        values(doomedUser.id, theirs.id, "theirs"),
      ])
      .run();

    db.delete(schema.applications).where(eq(schema.applications.id, gone.id)).run();
    db.delete(schema.users).where(eq(schema.users.id, doomedUser.id)).run();

    expect(await documentRows(gone.id)).toEqual([]);
    expect(await documentRows(theirs.id)).toEqual([]);
    expect(await documentRows(stays.id)).toHaveLength(1);
  });
});

describe("snapshotResumeForApplication", () => {
  it("renders the linked resume, stores the file under the user's prefix and records it", async () => {
    const { user, app, resume } = await scenario();

    const id = await snapshot(user.id, app.id);

    const row = await documentRow(id);
    expect(row).toMatchObject({
      id,
      userId: user.id,
      applicationId: app.id,
      kind: "resume",
      fileName: "Marisol-Venn-Resume.pdf",
      resumeId: resume.id,
      template: "modern",
      pageCount: 1,
    });
    // Same timestamp format as the rest of the application tables.
    expect(row!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(row!.storedName.startsWith(`u${user.id}-`)).toBe(true);

    // The file is directly inside DOCUMENTS_DIR (which the app had to create).
    expect(fs.statSync(DOCUMENTS_DIR).isDirectory()).toBe(true);
    expect(documentFiles()).toContain(row!.storedName);
    const bytes = fs.readFileSync(storedPath(row!.storedName));
    expect(isPdf(bytes)).toBe(true);

    const pdf = await inspectPdf(bytes);
    expect(pdf.pageCount).toBe(row!.pageCount);
    const text = pdf.pages.join(" ");
    expect(at(text, TEXT.staffThird)).toBeGreaterThanOrEqual(0);
    expect(at(text, TEXT.staffThird)).toBeLessThan(at(text, TEXT.staffFirst));
    expect(at(text, TEXT.staffUnselected)).toBe(-1);
  });

  it("records the template the resume had when it was sent", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id, { template: "minimal" });
    const app = await seedApplication(user.id, { resumeId: resume.id });

    const row = await documentRow(await snapshot(user.id, app.id));

    expect(row!.template).toBe("minimal");
    const pdf = await inspectPdf(fs.readFileSync(storedPath(row!.storedName)));
    expect(pdf.fonts).toContain("Lora-Regular");
  });

  it("gives each snapshot its own file", async () => {
    const { user, app } = await scenario();

    const first = await documentRow(await snapshot(user.id, app.id));
    const second = await documentRow(await snapshot(user.id, app.id));

    expect(second!.id).not.toBe(first!.id);
    expect(second!.storedName).not.toBe(first!.storedName);
    expect(fs.existsSync(storedPath(first!.storedName))).toBe(true);
    expect(fs.existsSync(storedPath(second!.storedName))).toBe(true);
    expect(await documentRows(app.id)).toHaveLength(2);
  });

  it("reports not_found for another user's application or a missing one, storing nothing", async () => {
    const { snapshotResumeForApplication } = await import("~/lib/documents.server");
    const { app } = await scenario();
    const stranger = await createUser();
    const before = documentFiles();

    expect(await snapshotResumeForApplication(stranger.id, app.id)).toEqual({ error: "not_found" });
    expect(await snapshotResumeForApplication(stranger.id, app.id + 10_000)).toEqual({
      error: "not_found",
    });
    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });

  it("reports no_resume when the application has no linked resume", async () => {
    const { snapshotResumeForApplication } = await import("~/lib/documents.server");
    const user = await createUser();
    await seedRenderableResume(user.id);
    const app = await seedApplication(user.id, { resumeId: null });
    const before = documentFiles();

    expect(await snapshotResumeForApplication(user.id, app.id)).toEqual({ error: "no_resume" });
    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });

  // The `update` action stores whatever resumeId the form sends, so an
  // application can point at a resume that belongs to someone else.
  it("never snapshots a resume that belongs to another user", async () => {
    const { snapshotResumeForApplication } = await import("~/lib/documents.server");
    const owner = await createUser();
    const other = await createUser();
    const { resume: theirs } = await seedRenderableResume(other.id);
    const app = await seedApplication(owner.id, { resumeId: theirs.id });
    const before = documentFiles();

    const result = await snapshotResumeForApplication(owner.id, app.id);

    expect(result).toEqual({ error: expect.stringMatching(/^(not_found|no_resume)$/) });
    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });
});

describe("POST /api/applications _action=snapshot_resume", () => {
  it("stores a snapshot of the linked resume", async () => {
    const { user, cookie, app, resume } = await scenario();

    const result = await post({ _action: "snapshot_resume", id: app.id }, cookie);

    expect(statusOf(result)).toBeLessThan(400);
    const rows = await documentRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      kind: "resume",
      fileName: "Marisol-Venn-Resume.pdf",
      resumeId: resume.id,
      template: "modern",
      pageCount: 1,
    });
    expect(isPdf(fs.readFileSync(storedPath(rows[0].storedName)))).toBe(true);
  });

  it("returns 404 for another user's application", async () => {
    const { app } = await scenario();
    const stranger = await createUser();
    await seedRenderableResume(stranger.id);
    const before = documentFiles();

    const result = await post(
      { _action: "snapshot_resume", id: app.id },
      await sessionCookie(stranger.id),
    );

    expect(statusOf(result)).toBe(404);
    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });

  it("returns 400 when no resume is linked", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id, { resumeId: null });

    const result = await post(
      { _action: "snapshot_resume", id: app.id },
      await sessionCookie(user.id),
    );

    expect(statusOf(result)).toBe(400);
    expect(await documentRows(app.id)).toEqual([]);
  });

  it("redirects to login without a session and stores nothing", async () => {
    const { app } = await scenario();

    const result = await post({ _action: "snapshot_resume", id: app.id });

    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toMatch(/^\/login\?/);
    expect(await documentRows(app.id)).toEqual([]);
  });
});

describe("POST /api/applications _action=delete_document", () => {
  it("deletes the row and the stored file", async () => {
    const { user, cookie, app } = await scenario();
    const doomed = await documentRow(await snapshot(user.id, app.id));
    const kept = await documentRow(await snapshot(user.id, app.id));

    const result = await post({ _action: "delete_document", documentId: doomed!.id }, cookie);

    expect(statusOf(result)).toBeLessThan(400);
    expect(await documentRow(doomed!.id)).toBeUndefined();
    expect(fs.existsSync(storedPath(doomed!.storedName))).toBe(false);
    // The application's other snapshot is untouched.
    expect(await documentRow(kept!.id)).toBeDefined();
    expect(fs.existsSync(storedPath(kept!.storedName))).toBe(true);
  });

  it("returns 404 for another user's document and leaves it in place", async () => {
    const { user, app } = await scenario();
    const doc = await documentRow(await snapshot(user.id, app.id));
    const stranger = await createUser();

    const result = await post(
      { _action: "delete_document", documentId: doc!.id },
      await sessionCookie(stranger.id),
    );

    expect(statusOf(result)).toBe(404);
    expect(await documentRow(doc!.id)).toBeDefined();
    expect(fs.existsSync(storedPath(doc!.storedName))).toBe(true);
  });

  it("returns 404 for a document that does not exist", async () => {
    const { cookie } = await scenario();
    expect(statusOf(await post({ _action: "delete_document", documentId: 987_654 }, cookie))).toBe(404);
  });

  it("still deletes the row when the file is already gone", async () => {
    const { user, cookie, app } = await scenario();
    const doc = await documentRow(await snapshot(user.id, app.id));
    fs.rmSync(storedPath(doc!.storedName));

    const result = await post({ _action: "delete_document", documentId: doc!.id }, cookie);

    expect(statusOf(result)).toBeLessThan(400);
    expect(await documentRow(doc!.id)).toBeUndefined();
  });
});

describe("automatic snapshot when an application moves from wishlist to applied", () => {
  async function setStatus(id: number, status: string, cookie: string) {
    return post({ _action: "set_status", id, status }, cookie);
  }

  it("stores a resume snapshot when a resume is linked", async () => {
    const { user, cookie, app, resume } = await scenario("wishlist");

    const result = await setStatus(app.id, "applied", cookie);

    expect(statusOf(result)).toBe(200);
    expect((await applicationRow(app.id))?.status).toBe("applied");
    const rows = await documentRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      kind: "resume",
      fileName: "Marisol-Venn-Resume.pdf",
      resumeId: resume.id,
    });
    const text = await textOf(fs.readFileSync(storedPath(rows[0].storedName)));
    expect(at(text, TEXT.staffThird)).toBeGreaterThanOrEqual(0);
  });

  it("stores nothing when no resume is linked", async () => {
    const user = await createUser();
    await seedRenderableResume(user.id);
    const app = await seedApplication(user.id, { status: "wishlist", resumeId: null });
    const before = documentFiles();

    const result = await setStatus(app.id, "applied", await sessionCookie(user.id));

    expect(statusOf(result)).toBe(200);
    expect((await applicationRow(app.id))?.status).toBe("applied");
    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });

  it.each([
    ["applied", "interviewing"],
    ["applied", "applied"],
    ["interviewing", "applied"],
    ["wishlist", "interviewing"],
    ["wishlist", "rejected"],
    ["wishlist", "wishlist"],
  ] as const)("stores nothing for %s -> %s", async (from, to) => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);
    const app = await seedApplication(user.id, { status: from, resumeId: resume.id });
    const before = documentFiles();

    const result = await setStatus(app.id, to, await sessionCookie(user.id));

    expect(statusOf(result)).toBe(200);
    expect((await applicationRow(app.id))?.status).toBe(to);
    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });

  it("stores nothing for another user's application", async () => {
    const { app } = await scenario("wishlist");
    const stranger = await createUser();

    await setStatus(app.id, "applied", await sessionCookie(stranger.id));

    expect((await applicationRow(app.id))?.status).toBe("wishlist");
    expect(await documentRows(app.id)).toEqual([]);
  });

  it("still changes the status when the snapshot cannot be written", async () => {
    const { cookie, app } = await scenario("wishlist");

    const result = await withBrokenDocumentsDir(() => setStatus(app.id, "applied", cookie));

    expect(statusOf(result)).toBe(200);
    const row = await applicationRow(app.id);
    expect(row?.status).toBe("applied");
    expect(row?.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No row is left pointing at a file that was never written.
    expect(await documentRows(app.id)).toEqual([]);
  });

  it("still changes the status when the linked resume cannot be rendered for this user", async () => {
    const owner = await createUser();
    const other = await createUser();
    const { resume: theirs } = await seedRenderableResume(other.id);
    const app = await seedApplication(owner.id, { status: "wishlist", resumeId: theirs.id });

    const result = await setStatus(app.id, "applied", await sessionCookie(owner.id));

    expect(statusOf(result)).toBe(200);
    expect((await applicationRow(app.id))?.status).toBe("applied");
    expect(await documentRows(app.id)).toEqual([]);
  });

  // Passing guard on the helper the failure test relies on.
  it("withBrokenDocumentsDir blocks writes and restores what was stored", async () => {
    const marker = path.join(DOCUMENTS_DIR, "marker.txt");
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
    fs.writeFileSync(marker, "kept");

    await withBrokenDocumentsDir(async () => {
      expect(() => fs.mkdirSync(DOCUMENTS_DIR, { recursive: true })).toThrow();
      expect(() => fs.writeFileSync(path.join(DOCUMENTS_DIR, "x.pdf"), "x")).toThrow();
    });

    expect(fs.readFileSync(marker, "utf8")).toBe("kept");
    fs.rmSync(marker);
  });
});

describe("GET /documents/:id", () => {
  type RouteEntry = { path?: string; file: string; children?: RouteEntry[] };

  it("is registered in app/routes.ts", async () => {
    const routes = (await import("../../app/routes")).default as RouteEntry[];
    const flat = (entries: RouteEntry[]): RouteEntry[] =>
      entries.flatMap((e) => [e, ...flat(e.children ?? [])]);
    const entry = flat(routes).find((r) => r.path === "documents/:id");
    expect(entry, "no documents/:id route").toBeDefined();
    expect(entry!.file).toBe("routes/documents.$id.tsx");
  });

  it("serves the owner the stored bytes as a PDF attachment", async () => {
    const { user, cookie, app } = await scenario();
    const row = await documentRow(await snapshot(user.id, app.id));

    const result = await fetchDocument(row!.id, cookie);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Marisol-Venn-Resume.pdf"',
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const served = await bodyBytes(response);
    const stored = fs.readFileSync(storedPath(row!.storedName));
    expect(served.length).toBeGreaterThan(1000);
    expect(served.equals(stored)).toBe(true);
  });

  it("serves the snapshot as it was, however the resume changes afterwards", async () => {
    const { user, cookie, app, resume, bullets } = await scenario();
    const row = await documentRow(await snapshot(user.id, app.id));
    const before = await bodyBytes((await fetchDocument(row!.id, cookie)) as Response);

    await unselectBullet(resume.id, bullets.staffFirst.id);
    await selectBullet(resume.id, bullets.addedLater.id);
    const { db, schema } = await getDb();
    db.update(schema.resumes)
      .set({ template: "minimal", useCustomContact: true, contactName: "Someone Else", contactEmail: "else@example.com" })
      .where(eq(schema.resumes.id, resume.id))
      .run();

    const after = await bodyBytes((await fetchDocument(row!.id, cookie)) as Response);
    expect(after.equals(before)).toBe(true);
    const frozen = await textOf(after);
    expect(at(frozen, TEXT.staffFirst)).toBeGreaterThanOrEqual(0);
    expect(at(frozen, TEXT.addedLater)).toBe(-1);
    expect(at(frozen, "Marisol Venn")).toBeGreaterThanOrEqual(0);
    expect((await documentRow(row!.id))!.fileName).toBe("Marisol-Venn-Resume.pdf");

    // Sanity: the edit is real. A new snapshot shows the changed resume.
    const fresh = await documentRow(await snapshot(user.id, app.id));
    const current = await textOf(
      await bodyBytes((await fetchDocument(fresh!.id, cookie)) as Response),
    );
    expect(at(current, TEXT.addedLater)).toBeGreaterThanOrEqual(0);
    expect(at(current, TEXT.staffFirst)).toBe(-1);
    expect(at(current, "Someone Else")).toBeGreaterThanOrEqual(0);
    expect(fresh!.template).toBe("minimal");
  });

  it("still serves the snapshot after the resume is deleted", async () => {
    const { user, cookie, app, resume } = await scenario();
    const row = await documentRow(await snapshot(user.id, app.id));
    const { db, schema } = await getDb();
    db.delete(schema.resumes).where(eq(schema.resumes.id, resume.id)).run();

    const result = await fetchDocument(row!.id, cookie);

    expect(statusOf(result)).toBe(200);
    expect(isPdf(await bodyBytes(result as Response))).toBe(true);
    expect((await documentRow(row!.id))!.resumeId).toBeNull();
  });

  it("returns 404 for another user's document", async () => {
    const { user, cookie, app } = await scenario();
    const row = await documentRow(await snapshot(user.id, app.id));
    const stranger = await scenario();

    // Sanity: the owner can read it, so the 404 below is about ownership.
    expect(statusOf(await fetchDocument(row!.id, cookie))).toBe(200);
    expect(statusOf(await fetchDocument(row!.id, stranger.cookie))).toBe(404);
  });

  it("returns 404 for an id that does not exist or is not a number", async () => {
    const { cookie } = await scenario();
    expect(statusOf(await fetchDocument(987_654, cookie))).toBe(404);
    expect(statusOf(await fetchDocument("abc", cookie))).toBe(404);
  });

  it("returns 404 when the stored file is missing on disk", async () => {
    const { user, cookie, app } = await scenario();
    const row = await documentRow(await snapshot(user.id, app.id));
    fs.rmSync(storedPath(row!.storedName));

    expect(statusOf(await fetchDocument(row!.id, cookie))).toBe(404);
  });

  it("redirects to login without a session", async () => {
    const { user, app } = await scenario();
    const id = await snapshot(user.id, app.id);

    const result = await fetchDocument(id);

    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toMatch(/^\/login\?/);
  });
});

describe("application detail loader: documents", () => {
  async function detail(id: number, cookie: string) {
    const { loader } = await import("~/routes/applications.$id");
    return (await run(loader, getRequest(`/applications/${id}`, cookie), {
      id: String(id),
    })) as { documents?: Record<string, unknown>[] };
  }

  it("lists the application's documents newest first, without storage details", async () => {
    const { db, schema } = await getDb();
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    const app = await seedApplication(user.id);
    const other = await seedApplication(user.id);
    const insert = (applicationId: number, kind: "resume" | "cover_letter", day: string, pageCount: number | null) =>
      db
        .insert(schema.applicationDocuments)
        .values({
          userId: user.id,
          applicationId,
          kind,
          fileName: kind === "resume" ? "Marisol-Venn-Resume.pdf" : "Marisol-Venn-Cover-Letter.pdf",
          storedName: `u${user.id}-${applicationId}-${day}.pdf`,
          template: "modern",
          pageCount,
          createdAt: `2026-11-${day}T09:00:00.000Z`,
        })
        .returning()
        .get();
    const oldest = insert(app.id, "resume", "01", 1);
    const middle = insert(app.id, "cover_letter", "05", null);
    const newest = insert(app.id, "resume", "09", 2);
    insert(other.id, "resume", "07", 1);

    const data = await detail(app.id, cookie);

    expect(data.documents).toEqual([
      {
        id: newest.id,
        kind: "resume",
        fileName: "Marisol-Venn-Resume.pdf",
        pageCount: 2,
        createdAt: "2026-11-09T09:00:00.000Z",
      },
      {
        id: middle.id,
        kind: "cover_letter",
        fileName: "Marisol-Venn-Cover-Letter.pdf",
        pageCount: null,
        createdAt: "2026-11-05T09:00:00.000Z",
      },
      {
        id: oldest.id,
        kind: "resume",
        fileName: "Marisol-Venn-Resume.pdf",
        pageCount: 1,
        createdAt: "2026-11-01T09:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list when nothing has been stored", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id);

    const data = await detail(app.id, await sessionCookie(user.id));

    expect(data.documents).toEqual([]);
  });

  it("includes a snapshot taken through the action", async () => {
    const { cookie, app } = await scenario();
    await post({ _action: "snapshot_resume", id: app.id }, cookie);

    const data = await detail(app.id, cookie);

    expect(data.documents).toHaveLength(1);
    expect(data.documents![0]).toMatchObject({
      kind: "resume",
      fileName: "Marisol-Venn-Resume.pdf",
      pageCount: 1,
    });
  });
});

describe("deleting an application removes its stored documents", () => {
  const deleteViaApi = (id: number, cookie: string) => post({ _action: "delete", id }, cookie);
  const deleteViaDetail = async (id: number, cookie: string) => {
    const { action } = await import("~/routes/applications.$id");
    return run(action, formRequest(`/applications/${id}`, { _action: "delete" }, cookie), {
      id: String(id),
    });
  };
  const DELETE_PATHS = [
    ["POST /api/applications _action=delete", deleteViaApi],
    ["POST /applications/:id _action=delete", deleteViaDetail],
  ] as const;

  // The application can be deleted through two actions today; both must clean up.
  it.each(DELETE_PATHS)("%s removes the rows and the files", async (_label, remove) => {
    const { user, cookie, app, resume } = await scenario();
    const keptApp = await seedApplication(user.id, { resumeId: resume.id });
    const first = await documentRow(await snapshot(user.id, app.id));
    const second = await documentRow(await snapshot(user.id, app.id));
    const kept = await documentRow(await snapshot(user.id, keptApp.id));

    const result = await remove(app.id, cookie);

    expect(statusOf(result)).toBe(302);
    expect(await applicationRow(app.id)).toBeUndefined();
    expect(await documentRows(app.id)).toEqual([]);
    expect(fs.existsSync(storedPath(first!.storedName))).toBe(false);
    expect(fs.existsSync(storedPath(second!.storedName))).toBe(false);
    // Another application's snapshot is untouched.
    expect(await documentRow(kept!.id)).toBeDefined();
    expect(fs.existsSync(storedPath(kept!.storedName))).toBe(true);
  });

  it.each(DELETE_PATHS)("%s by another user removes nothing", async (_label, remove) => {
    const { user, app } = await scenario();
    const row = await documentRow(await snapshot(user.id, app.id));
    const stranger = await createUser();

    await remove(app.id, await sessionCookie(stranger.id));

    expect(await applicationRow(app.id)).toBeDefined();
    expect(await documentRow(row!.id)).toBeDefined();
    expect(fs.existsSync(storedPath(row!.storedName))).toBe(true);
  });
});
