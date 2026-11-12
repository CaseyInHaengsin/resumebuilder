// Phase 13 — cover letters on applications.
//
//   table   cover_letters (schema export `coverLetters`), one per application
//   actions POST /api/applications  _action=save_cover_letter      id, body, recipient
//           POST /api/applications  _action=delete_cover_letter    id
//           POST /api/applications  _action=snapshot_cover_letter  id
//           set_status wishlist -> applied also snapshots the cover letter
//   loader  applications/:id returns `coverLetter: { recipient, body, updatedAt } | null`
//   route   GET /api/applications/:id/cover-letter.pdf
//           (app/routes/api.applications.$id.cover-letter.pdf.tsx)
//
// `id` is always the application id. Depends on phase 11's
// `application_documents` table and `/documents/:id` route for the snapshots.
import {
  LETTER,
  LETTER_BODY,
  at,
  bodyBytes,
  coverLetterRows,
  documentFiles,
  documentRows,
  isPdf,
  seedContact,
  seedCoverLetter,
  seedRenderableResume,
  storedPath,
} from "../helpers/documents";
import { createUser, getDb, seedApplication } from "../helpers/db";
import { inspectPdf } from "../helpers/pdf";
import { formRequest, getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";

const API = "/api/applications";

async function post(fields: Record<string, string | number>, cookie?: string) {
  const { action } = await import("~/routes/api.applications");
  return run(action, formRequest(API, fields, cookie));
}

async function fetchLetterPdf(id: number | string, cookie?: string, query = "") {
  const { loader } = await import("~/routes/api.applications.$id.cover-letter.pdf");
  return run(loader, getRequest(`/api/applications/${id}/cover-letter.pdf${query}`, cookie), {
    id: String(id),
  });
}

async function detail(id: number, cookie: string) {
  const { loader } = await import("~/routes/applications.$id");
  return (await run(loader, getRequest(`/applications/${id}`, cookie), {
    id: String(id),
  })) as { coverLetter?: Record<string, unknown> | null; documents?: Record<string, unknown>[] };
}

async function applicationRow(id: number) {
  const { db, schema } = await getDb();
  return db.select().from(schema.applications).where(eq(schema.applications.id, id)).get();
}

/** A user with a contact row and an application; no resume linked unless asked. */
async function scenario(options: { resume?: boolean; status?: "wishlist" | "applied" } = {}) {
  const user = await createUser();
  const cookie = await sessionCookie(user.id);
  let resumeId: number | null = null;
  if (options.resume) resumeId = (await seedRenderableResume(user.id)).resume.id;
  else await seedContact(user.id);
  const app = await seedApplication(user.id, { resumeId, status: options.status ?? "applied" });
  return { user, cookie, app, resumeId };
}

async function textOf(bytes: Uint8Array): Promise<string> {
  return (await inspectPdf(Buffer.from(bytes))).pages.join(" ");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("cover_letters table", () => {
  it("stores one letter per application", async () => {
    const { db, schema } = await getDb();
    const user = await createUser();
    const app = await seedApplication(user.id);
    const values = {
      userId: user.id,
      applicationId: app.id,
      recipient: null,
      body: "Dear team,\n\nHello.",
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-02T10:00:00.000Z",
    };

    const row = db.insert(schema.coverLetters).values(values).returning().get();

    expect(row).toEqual({ id: expect.any(Number), ...values });
    expect(() => db.insert(schema.coverLetters).values(values).run()).toThrow(/UNIQUE/i);
  });

  it("removes the letter when the application is deleted", async () => {
    const { db, schema } = await getDb();
    const user = await createUser();
    const gone = await seedApplication(user.id);
    const stays = await seedApplication(user.id);
    await seedCoverLetter(user.id, gone.id);
    await seedCoverLetter(user.id, stays.id);

    db.delete(schema.applications).where(eq(schema.applications.id, gone.id)).run();

    expect(await coverLetterRows(gone.id)).toEqual([]);
    expect(await coverLetterRows(stays.id)).toHaveLength(1);
  });
});

describe("POST /api/applications _action=save_cover_letter", () => {
  it("creates the letter, trimmed, with its line breaks intact", async () => {
    const { user, cookie, app } = await scenario();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T15:00:00.000Z"));

    const result = await post(
      {
        _action: "save_cover_letter",
        id: app.id,
        recipient: `  ${LETTER.recipient}  `,
        body: `\n\n  ${LETTER_BODY}  \n\n`,
      },
      cookie,
    );

    expect(statusOf(result)).toBeLessThan(400);
    const rows = await coverLetterRows(app.id);
    expect(rows).toEqual([
      {
        id: expect.any(Number),
        userId: user.id,
        applicationId: app.id,
        recipient: LETTER.recipient,
        body: LETTER_BODY,
        createdAt: "2026-11-10T15:00:00.000Z",
        updatedAt: "2026-11-10T15:00:00.000Z",
      },
    ]);
    expect(rows[0].body).toContain("Dear Hiring Manager,\n\nI am writing");
    expect(rows[0].body).toContain("Sincerely,\nMarisol Venn");
  });

  // A browser submits a textarea with CRLF line endings; the stored body uses
  // "\n" so "paragraphs separated by blank lines" means the same thing whether
  // the letter came from the form or from the MCP tool.
  it("stores Windows line endings from a form as plain newlines", async () => {
    const { cookie, app } = await scenario();

    await post(
      { _action: "save_cover_letter", id: app.id, body: LETTER_BODY.replace(/\n/g, "\r\n") },
      cookie,
    );

    const rows = await coverLetterRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe(LETTER_BODY);
  });

  it("stores a blank or missing recipient as null", async () => {
    const blank = await scenario();
    await post(
      { _action: "save_cover_letter", id: blank.app.id, recipient: "   ", body: "Dear team,\n\nHello." },
      blank.cookie,
    );
    const missing = await scenario();
    await post(
      { _action: "save_cover_letter", id: missing.app.id, body: "Dear team,\n\nHello." },
      missing.cookie,
    );

    const [blankRow] = await coverLetterRows(blank.app.id);
    const [missingRow] = await coverLetterRows(missing.app.id);
    expect(blankRow.body).toBe("Dear team,\n\nHello.");
    expect(blankRow.recipient).toBeNull();
    expect(missingRow.body).toBe("Dear team,\n\nHello.");
    expect(missingRow.recipient).toBeNull();
  });

  it("replaces the application's existing letter instead of adding a second", async () => {
    const { cookie, app } = await scenario();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T15:00:00.000Z"));
    await post(
      { _action: "save_cover_letter", id: app.id, recipient: LETTER.recipient, body: LETTER_BODY },
      cookie,
    );
    const [first] = await coverLetterRows(app.id);

    vi.setSystemTime(new Date("2026-11-11T09:30:00.000Z"));
    const result = await post(
      { _action: "save_cover_letter", id: app.id, recipient: "", body: "Dear team,\n\nSecond draft." },
      cookie,
    );

    expect(statusOf(result)).toBeLessThan(400);
    const rows = await coverLetterRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.id,
      recipient: null,
      body: "Dear team,\n\nSecond draft.",
      createdAt: "2026-11-10T15:00:00.000Z",
      updatedAt: "2026-11-11T09:30:00.000Z",
    });
  });

  it.each([
    ["an empty body", { body: "" }],
    ["a whitespace-only body", { body: " \n\t\n " }],
    ["no body at all", {}],
  ])("returns 400 for %s and keeps the existing letter", async (_label, fields) => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);

    const result = await post({ _action: "save_cover_letter", id: app.id, ...fields }, cookie);

    expect(statusOf(result)).toBe(400);
    const rows = await coverLetterRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe(LETTER_BODY);
  });

  it("returns 404 for another user's application or a missing one", async () => {
    const { app } = await scenario();
    const stranger = await scenario();

    const result = await post(
      { _action: "save_cover_letter", id: app.id, body: "Dear team,\n\nNot mine." },
      stranger.cookie,
    );
    const missing = await post(
      { _action: "save_cover_letter", id: 987_654, body: "Dear team,\n\nNowhere." },
      stranger.cookie,
    );

    expect(statusOf(result)).toBe(404);
    expect(statusOf(missing)).toBe(404);
    expect(await coverLetterRows(app.id)).toEqual([]);
    expect(await coverLetterRows(987_654)).toEqual([]);
  });

  it("redirects to login without a session and stores nothing", async () => {
    const { app } = await scenario();

    const result = await post({ _action: "save_cover_letter", id: app.id, body: "Dear team," });

    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toMatch(/^\/login\?/);
    expect(await coverLetterRows(app.id)).toEqual([]);
  });
});

describe("POST /api/applications _action=delete_cover_letter", () => {
  it("removes the application's letter and leaves the application", async () => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);
    const other = await seedApplication(user.id);
    await seedCoverLetter(user.id, other.id);

    const result = await post({ _action: "delete_cover_letter", id: app.id }, cookie);

    expect(statusOf(result)).toBeLessThan(400);
    expect(await coverLetterRows(app.id)).toEqual([]);
    expect(await coverLetterRows(other.id)).toHaveLength(1);
    expect(await applicationRow(app.id)).toBeDefined();
  });

  it("returns 404 for another user's application and leaves the letter", async () => {
    const { user, app } = await scenario();
    await seedCoverLetter(user.id, app.id);
    const stranger = await scenario();

    const result = await post({ _action: "delete_cover_letter", id: app.id }, stranger.cookie);

    expect(statusOf(result)).toBe(404);
    expect(await coverLetterRows(app.id)).toHaveLength(1);
  });

  it("keeps snapshots that were already taken", async () => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);
    await post({ _action: "snapshot_cover_letter", id: app.id }, cookie);
    const [doc] = await documentRows(app.id);

    await post({ _action: "delete_cover_letter", id: app.id }, cookie);

    expect(await coverLetterRows(app.id)).toEqual([]);
    expect(await documentRows(app.id)).toHaveLength(1);
    expect(fs.existsSync(storedPath(doc.storedName))).toBe(true);
  });
});

describe("application detail loader: coverLetter", () => {
  it("returns the letter's recipient, body and last update", async () => {
    const { user, cookie, app } = await scenario();
    const row = await seedCoverLetter(user.id, app.id);

    const data = await detail(app.id, cookie);

    expect(data.coverLetter).toEqual({
      recipient: LETTER.recipient,
      body: LETTER_BODY,
      updatedAt: row.updatedAt,
    });
  });

  it("returns null when the application has no letter", async () => {
    const { user, cookie, app } = await scenario();
    // Another application's letter is not this one's.
    const other = await seedApplication(user.id);
    await seedCoverLetter(user.id, other.id);

    const data = await detail(app.id, cookie);

    expect(data).toHaveProperty("coverLetter", null);
  });

  it("shows a letter saved through the action", async () => {
    const { cookie, app } = await scenario();
    await post(
      { _action: "save_cover_letter", id: app.id, recipient: LETTER.recipient, body: LETTER_BODY },
      cookie,
    );

    const data = await detail(app.id, cookie);

    expect(data.coverLetter).toMatchObject({ recipient: LETTER.recipient, body: LETTER_BODY });
  });
});

describe("GET /api/applications/:id/cover-letter.pdf", () => {
  type RouteEntry = { path?: string; file: string; children?: RouteEntry[] };

  it("is registered inside the authed layout", async () => {
    const routes = (await import("../../app/routes")).default as RouteEntry[];
    const layout = routes.find((r) => r.file === "routes/layout.tsx");
    const entry = layout?.children?.find(
      (r) => r.path === "api/applications/:id/cover-letter.pdf",
    );
    expect(entry, "no api/applications/:id/cover-letter.pdf route under routes/layout.tsx").toBeDefined();
    expect(entry!.file).toBe("routes/api.applications.$id.cover-letter.pdf.tsx");
  });

  it("serves the owner's letter as an inline PDF that is never cached", async () => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);

    const result = await fetchLetterPdf(app.id, cookie);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="Marisol-Venn-Cover-Letter.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const bytes = await bodyBytes(response);
    expect(isPdf(bytes)).toBe(true);
    const pdf = await inspectPdf(bytes);
    const text = pdf.pages.join(" ");
    expect(pdf.metadata.title).toBe("Marisol Venn Cover Letter");
    expect(at(text, LETTER.recipient)).toBeGreaterThanOrEqual(0);
    for (const paragraph of LETTER.paragraphs) {
      expect(at(text, paragraph), `"${paragraph}" is missing`).toBeGreaterThanOrEqual(0);
    }
  });

  it("serves it as an attachment with ?download=1", async () => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);

    const response = (await fetchLetterPdf(app.id, cookie, "?download=1")) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Marisol-Venn-Cover-Letter.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("redirects to login without a session", async () => {
    const { user, app } = await scenario();
    await seedCoverLetter(user.id, app.id);

    const result = await fetchLetterPdf(app.id);

    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toMatch(/^\/login\?/);
  });

  it("returns 404 for another user's application", async () => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);
    const stranger = await scenario();

    // Sanity: the owner gets it, so the 404 below is about ownership.
    expect(statusOf(await fetchLetterPdf(app.id, cookie))).toBe(200);
    expect(statusOf(await fetchLetterPdf(app.id, stranger.cookie))).toBe(404);
  });

  it("returns 404 when the application has no letter, does not exist, or the id is not a number", async () => {
    const { cookie, app } = await scenario();

    expect(statusOf(await fetchLetterPdf(app.id, cookie))).toBe(404);
    expect(statusOf(await fetchLetterPdf(987_654, cookie))).toBe(404);
    expect(statusOf(await fetchLetterPdf("abc", cookie))).toBe(404);
  });
});

describe("POST /api/applications _action=snapshot_cover_letter", () => {
  async function fetchDocument(id: number, cookie: string) {
    const { loader } = await import("~/routes/documents.$id");
    return run(loader, getRequest(`/documents/${id}`, cookie), { id: String(id) });
  }

  it("stores a frozen copy of the letter as a cover_letter document", async () => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);

    const result = await post({ _action: "snapshot_cover_letter", id: app.id }, cookie);

    expect(statusOf(result)).toBeLessThan(400);
    const rows = await documentRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      applicationId: app.id,
      kind: "cover_letter",
      fileName: "Marisol-Venn-Cover-Letter.pdf",
      pageCount: 1,
    });
    expect(rows[0].storedName.startsWith(`u${user.id}-`)).toBe(true);
    const stored = fs.readFileSync(storedPath(rows[0].storedName));
    expect(isPdf(stored)).toBe(true);
    const text = await textOf(stored);
    for (const paragraph of LETTER.paragraphs) {
      expect(at(text, paragraph), `"${paragraph}" is missing`).toBeGreaterThanOrEqual(0);
    }
  });

  it("is served by /documents/:id unchanged after the letter is edited", async () => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);
    await post({ _action: "snapshot_cover_letter", id: app.id }, cookie);
    const [doc] = await documentRows(app.id);

    const first = (await fetchDocument(doc.id, cookie)) as Response;
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe("application/pdf");
    expect(first.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Marisol-Venn-Cover-Letter.pdf"',
    );
    const before = await bodyBytes(first);
    expect(before.equals(fs.readFileSync(storedPath(doc.storedName)))).toBe(true);

    await post(
      { _action: "save_cover_letter", id: app.id, body: "Dear team,\n\nA completely different letter." },
      cookie,
    );

    const after = await bodyBytes((await fetchDocument(doc.id, cookie)) as Response);
    expect(after.equals(before)).toBe(true);
    const frozen = await textOf(after);
    expect(at(frozen, LETTER.paragraphs[1])).toBeGreaterThanOrEqual(0);
    expect(at(frozen, "A completely different letter.")).toBe(-1);

    // Sanity: the edit is real. The live PDF shows the new letter.
    const live = await textOf(await bodyBytes((await fetchLetterPdf(app.id, cookie)) as Response));
    expect(at(live, "A completely different letter.")).toBeGreaterThanOrEqual(0);
  });

  it("returns 400 when the application has no letter", async () => {
    const { cookie, app } = await scenario();
    const before = documentFiles();

    const result = await post({ _action: "snapshot_cover_letter", id: app.id }, cookie);

    expect(statusOf(result)).toBe(400);
    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });

  it("returns 404 for another user's application", async () => {
    const { user, app } = await scenario();
    await seedCoverLetter(user.id, app.id);
    const stranger = await scenario();

    const result = await post({ _action: "snapshot_cover_letter", id: app.id }, stranger.cookie);

    expect(statusOf(result)).toBe(404);
    expect(await documentRows(app.id)).toEqual([]);
  });

  it("appears in the application's documents", async () => {
    const { user, cookie, app } = await scenario();
    await seedCoverLetter(user.id, app.id);
    await post({ _action: "snapshot_cover_letter", id: app.id }, cookie);

    const data = await detail(app.id, cookie);

    expect(data.documents).toHaveLength(1);
    expect(data.documents![0]).toMatchObject({
      kind: "cover_letter",
      fileName: "Marisol-Venn-Cover-Letter.pdf",
      pageCount: 1,
    });
  });
});

describe("automatic snapshot on wishlist -> applied includes the cover letter", () => {
  async function apply(id: number, cookie: string) {
    return post({ _action: "set_status", id, status: "applied" }, cookie);
  }

  it("stores both the resume and the cover letter when both exist", async () => {
    const { user, cookie, app, resumeId } = await scenario({ resume: true, status: "wishlist" });
    await seedCoverLetter(user.id, app.id);

    const result = await apply(app.id, cookie);

    expect(statusOf(result)).toBe(200);
    expect((await applicationRow(app.id))?.status).toBe("applied");
    const rows = await documentRows(app.id);
    expect(rows.map((r) => r.kind).sort()).toEqual(["cover_letter", "resume"]);
    const resumeDoc = rows.find((r) => r.kind === "resume")!;
    const letterDoc = rows.find((r) => r.kind === "cover_letter")!;
    expect(resumeDoc).toMatchObject({ fileName: "Marisol-Venn-Resume.pdf", resumeId });
    expect(letterDoc).toMatchObject({ fileName: "Marisol-Venn-Cover-Letter.pdf" });
    expect(letterDoc.storedName).not.toBe(resumeDoc.storedName);
    const letterText = await textOf(fs.readFileSync(storedPath(letterDoc.storedName)));
    expect(at(letterText, LETTER.paragraphs[1])).toBeGreaterThanOrEqual(0);
    expect(isPdf(fs.readFileSync(storedPath(resumeDoc.storedName)))).toBe(true);
  });

  it("stores the cover letter alone when no resume is linked", async () => {
    const { user, cookie, app } = await scenario({ status: "wishlist" });
    await seedCoverLetter(user.id, app.id);

    const result = await apply(app.id, cookie);

    expect(statusOf(result)).toBe(200);
    const rows = await documentRows(app.id);
    expect(rows.map((r) => r.kind)).toEqual(["cover_letter"]);
    expect(isPdf(fs.readFileSync(storedPath(rows[0].storedName)))).toBe(true);
  });

  it("stores the resume alone when there is no letter", async () => {
    const { cookie, app } = await scenario({ resume: true, status: "wishlist" });

    await apply(app.id, cookie);

    expect((await documentRows(app.id)).map((r) => r.kind)).toEqual(["resume"]);
  });

  it("stores nothing for a transition other than wishlist -> applied", async () => {
    const { user, cookie, app } = await scenario({ resume: true, status: "applied" });
    await seedCoverLetter(user.id, app.id);

    const result = await post({ _action: "set_status", id: app.id, status: "interviewing" }, cookie);

    expect(statusOf(result)).toBe(200);
    expect(await documentRows(app.id)).toEqual([]);
  });

  it("deleting the application removes the letter and its stored copies", async () => {
    const { user, cookie, app } = await scenario({ resume: true, status: "wishlist" });
    await seedCoverLetter(user.id, app.id);
    await apply(app.id, cookie);
    const rows = await documentRows(app.id);
    expect(rows).toHaveLength(2);

    const result = await post({ _action: "delete", id: app.id }, cookie);

    expect(statusOf(result)).toBe(302);
    expect(await coverLetterRows(app.id)).toEqual([]);
    expect(await documentRows(app.id)).toEqual([]);
    for (const row of rows) expect(fs.existsSync(storedPath(row.storedName))).toBe(false);
  });
});
