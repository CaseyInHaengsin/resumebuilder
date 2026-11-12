// Phase 13 — MCP tools for cover letters.
//
//   write  save_cover_letter { applicationId, body, recipient? } (upsert)
//            -> { applicationId, updatedAt, url }
//            url = <public origin>/api/applications/<id>/cover-letter.pdf
//   read   get_application -> also
//            `coverLetter: { recipient, body, updatedAt, url } | null`
//            (top-level key, next to `application`, `company` and `documents`)
//   write  update_application_status wishlist -> applied also snapshots the letter
import {
  LETTER,
  LETTER_BODY,
  PUBLIC_ORIGIN,
  at,
  coverLetterRows,
  documentRows,
  seedContact,
  seedCoverLetter,
  seedRenderableResume,
  storedPath,
} from "../helpers/documents";
import { createUser, seedApplication } from "../helpers/db";
import { expectNotFound, expectRefused, mcpSession, okJson } from "../helpers/mcp";
import { inspectPdf } from "../helpers/pdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

type Row = Record<string, unknown>;

const letterUrl = (applicationId: number) =>
  `${PUBLIC_ORIGIN}/api/applications/${applicationId}/cover-letter.pdf`;

async function scenario(status: "wishlist" | "applied" = "applied") {
  const user = await createUser();
  await seedContact(user.id);
  const app = await seedApplication(user.id, { status, resumeId: null });
  return { user, app };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MCP save_cover_letter", () => {
  it("is listed only with mcp:write", async () => {
    const user = await createUser();
    expect((await mcpSession(user.id, ["mcp:write"])).toolNames).toContain("save_cover_letter");
    expect((await mcpSession(user.id, ["mcp:read"])).toolNames).not.toContain("save_cover_letter");
  });

  it("creates the letter and returns where to read it as a PDF", async () => {
    const { user, app } = await scenario();
    const mcp = await mcpSession(user.id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T15:00:00.000Z"));

    const data = okJson(
      await mcp.call("save_cover_letter", {
        applicationId: app.id,
        recipient: LETTER.recipient,
        body: `\n${LETTER_BODY}\n\n`,
      }),
    );

    expect(data).toEqual({
      applicationId: app.id,
      updatedAt: "2026-11-10T15:00:00.000Z",
      url: letterUrl(app.id),
    });
    expect(await coverLetterRows(app.id)).toEqual([
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
  });

  it("stores no recipient when none is given", async () => {
    const { user, app } = await scenario();
    const mcp = await mcpSession(user.id);

    okJson(await mcp.call("save_cover_letter", { applicationId: app.id, body: "Dear team,\n\nHello." }));

    const [row] = await coverLetterRows(app.id);
    expect(row.recipient).toBeNull();
    expect(row.body).toBe("Dear team,\n\nHello.");
  });

  it("replaces the application's existing letter instead of adding a second", async () => {
    const { user, app } = await scenario();
    const existing = await seedCoverLetter(user.id, app.id);
    const mcp = await mcpSession(user.id);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T09:30:00.000Z"));

    const data = okJson(
      await mcp.call("save_cover_letter", {
        applicationId: app.id,
        recipient: "Talent Team, Quillfeather Labs",
        body: "Dear team,\n\nSecond draft.",
      }),
    );

    expect(data.updatedAt).toBe("2026-11-11T09:30:00.000Z");
    const rows = await coverLetterRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: existing.id,
      recipient: "Talent Team, Quillfeather Labs",
      body: "Dear team,\n\nSecond draft.",
      createdAt: existing.createdAt,
      updatedAt: "2026-11-11T09:30:00.000Z",
    });
  });

  it("refuses a blank or missing body and keeps the existing letter", async () => {
    const { user, app } = await scenario();
    await seedCoverLetter(user.id, app.id);
    const mcp = await mcpSession(user.id);

    expectRefused(await mcp.call("save_cover_letter", { applicationId: app.id, body: "" }));
    expectRefused(await mcp.call("save_cover_letter", { applicationId: app.id, body: "  \n\n " }));
    expectRefused(await mcp.call("save_cover_letter", { applicationId: app.id }));
    expectRefused(await mcp.call("save_cover_letter", { body: "Dear team," }));

    const rows = await coverLetterRows(app.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe(LETTER_BODY);
  });

  it("answers not found for another user's application and for a missing id", async () => {
    const { app } = await scenario();
    const stranger = await createUser();
    const mcp = await mcpSession(stranger.id);

    expectNotFound(
      await mcp.call("save_cover_letter", { applicationId: app.id, body: "Dear team,\n\nNot mine." }),
      app.id,
    );
    expectNotFound(
      await mcp.call("save_cover_letter", { applicationId: 987_654, body: "Dear team,\n\nNowhere." }),
      987_654,
    );
    expect(await coverLetterRows(app.id)).toEqual([]);
  });
});

describe("MCP get_application: coverLetter", () => {
  it("includes the letter with a link to its PDF", async () => {
    const { user, app } = await scenario();
    const row = await seedCoverLetter(user.id, app.id);
    const mcp = await mcpSession(user.id);

    const data = okJson<{ application: Row; coverLetter: Row | null }>(
      await mcp.call("get_application", { id: app.id }),
    );

    expect(data.application.id).toBe(app.id);
    expect(data.coverLetter).toEqual({
      recipient: LETTER.recipient,
      body: LETTER_BODY,
      updatedAt: row.updatedAt,
      url: letterUrl(app.id),
    });
  });

  it("returns coverLetter null when the application has none", async () => {
    const { user, app } = await scenario();
    const other = await seedApplication(user.id);
    await seedCoverLetter(user.id, other.id);
    const mcp = await mcpSession(user.id);

    const data = okJson<Row>(await mcp.call("get_application", { id: app.id }));

    expect(data).toHaveProperty("coverLetter", null);
  });

  it("shows a letter saved through save_cover_letter", async () => {
    const { user, app } = await scenario();
    const mcp = await mcpSession(user.id);
    const saved = okJson<{ updatedAt: string; url: string }>(
      await mcp.call("save_cover_letter", { applicationId: app.id, body: LETTER_BODY }),
    );

    const data = okJson<{ coverLetter: Row | null }>(
      await mcp.call("get_application", { id: app.id }),
    );

    expect(data.coverLetter).toEqual({
      recipient: null,
      body: LETTER_BODY,
      updatedAt: saved.updatedAt,
      url: saved.url,
    });
  });
});

describe("MCP update_application_status: automatic snapshot includes the cover letter", () => {
  it("stores the resume and the letter when moving from wishlist to applied", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);
    const app = await seedApplication(user.id, { status: "wishlist", resumeId: resume.id });
    await seedCoverLetter(user.id, app.id);
    const mcp = await mcpSession(user.id);

    okJson(await mcp.call("update_application_status", { id: app.id, status: "applied" }));

    const rows = await documentRows(app.id);
    expect(rows.map((r) => r.kind).sort()).toEqual(["cover_letter", "resume"]);
    const letterDoc = rows.find((r) => r.kind === "cover_letter")!;
    expect(letterDoc.fileName).toBe("Marisol-Venn-Cover-Letter.pdf");
    const text = (await inspectPdf(fs.readFileSync(storedPath(letterDoc.storedName)))).pages.join(" ");
    expect(at(text, LETTER.paragraphs[1])).toBeGreaterThanOrEqual(0);
  });

  it("stores the letter alone when no resume is linked", async () => {
    const { user, app } = await scenario("wishlist");
    await seedCoverLetter(user.id, app.id);
    const mcp = await mcpSession(user.id);

    okJson(await mcp.call("update_application_status", { id: app.id, status: "applied" }));

    expect((await documentRows(app.id)).map((r) => r.kind)).toEqual(["cover_letter"]);
  });

  it("lists the stored letter among the application's documents", async () => {
    const { user, app } = await scenario("wishlist");
    await seedCoverLetter(user.id, app.id);
    const mcp = await mcpSession(user.id);
    okJson(await mcp.call("update_application_status", { id: app.id, status: "applied" }));
    const [doc] = await documentRows(app.id);

    const data = okJson<{ documents: Row[] }>(await mcp.call("get_application", { id: app.id }));

    expect(data.documents).toHaveLength(1);
    expect(data.documents[0]).toMatchObject({
      id: doc.id,
      kind: "cover_letter",
      fileName: "Marisol-Venn-Cover-Letter.pdf",
      url: `${PUBLIC_ORIGIN}/documents/${doc.id}`,
    });
  });
});
