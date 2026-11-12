// Phase 11 — MCP tools for the server-side PDF and sent-copy snapshots.
//
//   write  snapshot_application_resume { applicationId } -> { id, fileName, url }
//            url = <public origin>/documents/<id>
//   read   get_resume_pdf_link { resumeId } -> { url, fileName }
//            url = <public origin>/api/resumes/<id>/pdf
//   read   get_application -> also `documents: [{ id, kind, fileName, createdAt, url }]`
//            (top-level key, next to `application` and `company`)
//   write  update_application_status wishlist -> applied snapshots the linked resume
//
// <public origin> is `getPublicUrl()`; tests/helpers/documents.ts sets PUBLIC_URL.
import {
  PUBLIC_ORIGIN,
  TEXT,
  at,
  documentFiles,
  documentRows,
  isPdf,
  seedRenderableResume,
  storedPath,
  withBrokenDocumentsDir,
} from "../helpers/documents";
import { createUser, getDb, seedApplication } from "../helpers/db";
import { expectNotFound, expectRefused, mcpSession, okJson } from "../helpers/mcp";
import { inspectPdf } from "../helpers/pdf";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";

type Row = Record<string, unknown>;

async function scenario(status: "wishlist" | "applied" = "applied") {
  const user = await createUser();
  const seeded = await seedRenderableResume(user.id);
  const app = await seedApplication(user.id, { resumeId: seeded.resume.id, status });
  return { user, app, ...seeded };
}

async function applicationRow(id: number) {
  const { db, schema } = await getDb();
  return db.select().from(schema.applications).where(eq(schema.applications.id, id)).get();
}

describe("MCP scope gating for the document tools", () => {
  it("lists the snapshot tool only with mcp:write and the link tool only with mcp:read", async () => {
    const user = await createUser();
    const readOnly = await mcpSession(user.id, ["mcp:read"]);
    const writeOnly = await mcpSession(user.id, ["mcp:write"]);

    expect(readOnly.toolNames).toContain("get_resume_pdf_link");
    expect(readOnly.toolNames).not.toContain("snapshot_application_resume");
    expect(writeOnly.toolNames).toContain("snapshot_application_resume");
    expect(writeOnly.toolNames).not.toContain("get_resume_pdf_link");
  });
});

describe("MCP get_resume_pdf_link", () => {
  it("returns the PDF link on the public origin and the download name", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);
    const mcp = await mcpSession(user.id);

    const data = okJson(await mcp.call("get_resume_pdf_link", { resumeId: resume.id }));

    expect(data).toEqual({
      url: `${PUBLIC_ORIGIN}/api/resumes/${resume.id}/pdf`,
      fileName: "Marisol-Venn-Resume.pdf",
    });
  });

  it("names the file after the resume's own contact when the override is on", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id, {
      useCustomContact: true,
      contactName: "M. Venn-Okafor",
      contactEmail: "mvo@example.com",
    });
    const mcp = await mcpSession(user.id);

    const data = okJson(await mcp.call("get_resume_pdf_link", { resumeId: resume.id }));

    expect(data.fileName).toBe("M-Venn-Okafor-Resume.pdf");
  });

  it("stores nothing: it is a link, not a snapshot", async () => {
    const { user, app, resume } = await scenario();
    const before = documentFiles();
    const mcp = await mcpSession(user.id);

    okJson(await mcp.call("get_resume_pdf_link", { resumeId: resume.id }));

    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });

  it("answers not found for another user's resume and for a missing id", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const { resume } = await seedRenderableResume(owner.id);
    await seedRenderableResume(stranger.id);
    const mcp = await mcpSession(stranger.id);

    expectNotFound(await mcp.call("get_resume_pdf_link", { resumeId: resume.id }), resume.id);
    expectNotFound(await mcp.call("get_resume_pdf_link", { resumeId: 987_654 }), 987_654);
  });

  it("refuses a call without a valid resumeId", async () => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    expectRefused(await mcp.call("get_resume_pdf_link", {}));
    expectRefused(await mcp.call("get_resume_pdf_link", { resumeId: "1" }));
  });
});

describe("MCP snapshot_application_resume", () => {
  it("stores a snapshot and returns its id, file name and download link", async () => {
    const { user, app, resume } = await scenario();
    const mcp = await mcpSession(user.id);

    const data = okJson<{ id: number; fileName: string; url: string }>(
      await mcp.call("snapshot_application_resume", { applicationId: app.id }),
    );

    const rows = await documentRows(app.id);
    expect(rows).toHaveLength(1);
    expect(data).toEqual({
      id: rows[0].id,
      fileName: "Marisol-Venn-Resume.pdf",
      url: `${PUBLIC_ORIGIN}/documents/${rows[0].id}`,
    });
    expect(rows[0]).toMatchObject({
      userId: user.id,
      kind: "resume",
      fileName: "Marisol-Venn-Resume.pdf",
      resumeId: resume.id,
      template: "modern",
      pageCount: 1,
    });
    const bytes = fs.readFileSync(storedPath(rows[0].storedName));
    expect(isPdf(bytes)).toBe(true);
    const text = (await inspectPdf(bytes)).pages.join(" ");
    expect(at(text, TEXT.staffThird)).toBeGreaterThanOrEqual(0);
    expect(at(text, TEXT.staffUnselected)).toBe(-1);
  });

  it("answers not found for another user's application and for a missing id", async () => {
    const { app } = await scenario();
    const stranger = await createUser();
    await seedRenderableResume(stranger.id);
    const before = documentFiles();
    const mcp = await mcpSession(stranger.id);

    expectNotFound(
      await mcp.call("snapshot_application_resume", { applicationId: app.id }),
      app.id,
    );
    expectNotFound(
      await mcp.call("snapshot_application_resume", { applicationId: 987_654 }),
      987_654,
    );
    expect(await documentRows(app.id)).toEqual([]);
    expect(documentFiles()).toEqual(before);
  });

  it("refuses when the application has no linked resume", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id, { resumeId: null });
    const mcp = await mcpSession(user.id);

    const outcome = await mcp.call("snapshot_application_resume", { applicationId: app.id });

    expectRefused(outcome);
    expect(outcome.text).toMatch(/resume/i);
    expect(await documentRows(app.id)).toEqual([]);
  });

  it("refuses a call without a valid applicationId", async () => {
    const user = await createUser();
    const mcp = await mcpSession(user.id);

    expectRefused(await mcp.call("snapshot_application_resume", {}));
    expectRefused(await mcp.call("snapshot_application_resume", { applicationId: -1 }));
  });
});

describe("MCP get_application: documents", () => {
  it("lists the application's documents with download links", async () => {
    const { db, schema } = await getDb();
    const { user, app } = await scenario();
    const other = await seedApplication(user.id);
    const insert = (applicationId: number, kind: "resume" | "cover_letter", day: string) =>
      db
        .insert(schema.applicationDocuments)
        .values({
          userId: user.id,
          applicationId,
          kind,
          fileName: kind === "resume" ? "Marisol-Venn-Resume.pdf" : "Marisol-Venn-Cover-Letter.pdf",
          storedName: `u${user.id}-${applicationId}-${day}.pdf`,
          createdAt: `2026-11-${day}T09:00:00.000Z`,
        })
        .returning()
        .get();
    const resumeDoc = insert(app.id, "resume", "01");
    const letterDoc = insert(app.id, "cover_letter", "05");
    insert(other.id, "resume", "07");
    const mcp = await mcpSession(user.id);

    const outcome = await mcp.call("get_application", { id: app.id });
    const data = okJson<{ application: Row; documents: Row[] }>(outcome);

    expect(data.application.id).toBe(app.id);
    expect([...data.documents].sort((a, b) => Number(a.id) - Number(b.id))).toEqual([
      {
        id: resumeDoc.id,
        kind: "resume",
        fileName: "Marisol-Venn-Resume.pdf",
        createdAt: "2026-11-01T09:00:00.000Z",
        url: `${PUBLIC_ORIGIN}/documents/${resumeDoc.id}`,
      },
      {
        id: letterDoc.id,
        kind: "cover_letter",
        fileName: "Marisol-Venn-Cover-Letter.pdf",
        createdAt: "2026-11-05T09:00:00.000Z",
        url: `${PUBLIC_ORIGIN}/documents/${letterDoc.id}`,
      },
    ]);
    // Where the file sits on disk is not the client's business.
    expect(outcome.text).not.toContain("storedName");
    expect(outcome.text).not.toContain(resumeDoc.storedName);
  });

  it("returns an empty list when nothing has been stored", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id);
    const mcp = await mcpSession(user.id);

    const data = okJson<{ documents: Row[] }>(await mcp.call("get_application", { id: app.id }));

    expect(data.documents).toEqual([]);
  });

  it("shows a snapshot taken through the snapshot tool", async () => {
    const { user, app } = await scenario();
    const mcp = await mcpSession(user.id);
    const made = okJson<{ id: number; url: string }>(
      await mcp.call("snapshot_application_resume", { applicationId: app.id }),
    );

    const data = okJson<{ documents: Row[] }>(await mcp.call("get_application", { id: app.id }));

    expect(data.documents).toHaveLength(1);
    expect(data.documents[0]).toMatchObject({
      id: made.id,
      kind: "resume",
      fileName: "Marisol-Venn-Resume.pdf",
      url: made.url,
    });
  });
});

describe("MCP update_application_status: automatic snapshot", () => {
  it("snapshots the linked resume when moving from wishlist to applied", async () => {
    const { user, app, resume } = await scenario("wishlist");
    const mcp = await mcpSession(user.id);

    const updated = okJson(
      await mcp.call("update_application_status", { id: app.id, status: "applied" }),
    );

    // The tool still answers with the updated application row.
    expect(updated).toMatchObject({ id: app.id, status: "applied" });
    const rows = await documentRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      kind: "resume",
      fileName: "Marisol-Venn-Resume.pdf",
      resumeId: resume.id,
    });
    expect(isPdf(fs.readFileSync(storedPath(rows[0].storedName)))).toBe(true);
  });

  it("stores nothing when no resume is linked", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id, { status: "wishlist", resumeId: null });
    const mcp = await mcpSession(user.id);

    okJson(await mcp.call("update_application_status", { id: app.id, status: "applied" }));

    expect((await applicationRow(app.id))?.status).toBe("applied");
    expect(await documentRows(app.id)).toEqual([]);
  });

  it.each([
    ["applied", "interviewing"],
    ["interviewing", "applied"],
    ["wishlist", "interviewing"],
    ["wishlist", "wishlist"],
  ] as const)("stores nothing for %s -> %s", async (from, to) => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);
    const app = await seedApplication(user.id, { status: from, resumeId: resume.id });
    const mcp = await mcpSession(user.id);

    okJson(await mcp.call("update_application_status", { id: app.id, status: to }));

    expect((await applicationRow(app.id))?.status).toBe(to);
    expect(await documentRows(app.id)).toEqual([]);
  });

  it("still changes the status when the snapshot cannot be written", async () => {
    const { user, app } = await scenario("wishlist");
    const mcp = await mcpSession(user.id);

    const outcome = await withBrokenDocumentsDir(() =>
      mcp.call("update_application_status", { id: app.id, status: "applied" }),
    );

    expect(okJson(outcome)).toMatchObject({ id: app.id, status: "applied" });
    expect((await applicationRow(app.id))?.status).toBe("applied");
    expect(await documentRows(app.id)).toEqual([]);
  });
});
