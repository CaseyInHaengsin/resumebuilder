// Phase 13 — cover letters: file name, long date, server-side rendering.
//
//   app/lib/resume-file.ts        coverLetterFileName(contactName)
//   app/lib/dates.ts              formatLongDate(ymd)
//   app/lib/cover-letter.server.ts
//     renderCoverLetterPdf(userId, applicationId)
//       -> Promise<{ bytes; fileName; pageCount } | null>
import {
  LETTER,
  LIBRARY_CONTACT,
  at,
  isPdf,
  seedContact,
  seedCoverLetter,
  seedRenderableResume,
} from "../helpers/documents";
import { createUser, seedApplication } from "../helpers/db";
import { inspectPdf } from "../helpers/pdf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("coverLetterFileName", () => {
  it.each([
    ["Jane Doe", "Jane-Doe-Cover-Letter.pdf"],
    ["  Jane   Q.  Doe ", "Jane-Q-Doe-Cover-Letter.pdf"],
    ["Zoë O'Brien-Núñez", "Zoë-OBrien-Núñez-Cover-Letter.pdf"],
    ['Jane "JD" Doe / Sr.', "Jane-JD-Doe-Sr-Cover-Letter.pdf"],
    ["Prince", "Prince-Cover-Letter.pdf"],
  ])("%j -> %s", async (name, expected) => {
    const { coverLetterFileName } = await import("~/lib/resume-file");
    expect(coverLetterFileName(name)).toBe(expected);
  });

  it.each([[""], ["   "], ["!!!"], [null], [undefined]])(
    "%j -> Cover-Letter.pdf",
    async (name) => {
      const { coverLetterFileName } = await import("~/lib/resume-file");
      expect(coverLetterFileName(name)).toBe("Cover-Letter.pdf");
    },
  );

  it("sanitizes a name exactly as resumeFileName does", async () => {
    const { coverLetterFileName, resumeFileName } = await import("~/lib/resume-file");
    for (const name of ["Jane Doe", "  A.  B-C  ", "Иван Петров", "x/y\\z", "tab\tseparated name"]) {
      expect(coverLetterFileName(name)).toBe(
        resumeFileName(name).replace(/Resume\.pdf$/, "Cover-Letter.pdf"),
      );
    }
  });
});

describe("formatLongDate", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it.each([
    ["2026-11-11", "November 11, 2026"],
    ["2026-01-01", "January 1, 2026"],
    ["2026-12-31", "December 31, 2026"],
    ["2024-02-29", "February 29, 2024"],
    ["2026-03-08", "March 8, 2026"],
  ])("%s -> %s", async (ymd, expected) => {
    const { formatLongDate } = await import("~/lib/dates");
    expect(formatLongDate(ymd)).toBe(expected);
  });

  // The value is a calendar date, not an instant: no zone may move it.
  it.each(["America/Los_Angeles", "Pacific/Kiritimati", "UTC"])(
    "does not shift the day when the process zone is %s",
    async (zone) => {
      process.env.TZ = zone;
      const { formatLongDate } = await import("~/lib/dates");
      expect(formatLongDate("2026-11-11")).toBe("November 11, 2026");
      expect(formatLongDate("2026-01-01")).toBe("January 1, 2026");
      expect(formatLongDate("2026-12-31")).toBe("December 31, 2026");
    },
  );

  it("ignores APP_TIMEZONE", async () => {
    const saved = process.env.APP_TIMEZONE;
    process.env.APP_TIMEZONE = "Pacific/Pago_Pago";
    try {
      const { formatLongDate } = await import("~/lib/dates");
      expect(formatLongDate("2026-11-11")).toBe("November 11, 2026");
    } finally {
      if (saved === undefined) delete process.env.APP_TIMEZONE;
      else process.env.APP_TIMEZONE = saved;
    }
  });
});

describe("renderCoverLetterPdf", () => {
  // 6:30pm on Nov 11 in Denver; already Nov 12 in UTC.
  const EVENING_IN_DENVER = new Date("2026-11-12T01:30:00Z");
  const savedZone = process.env.APP_TIMEZONE;

  beforeEach(() => {
    process.env.APP_TIMEZONE = "America/Denver";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_IN_DENVER);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedZone === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = savedZone;
  });

  async function render(userId: number, applicationId: number) {
    const { renderCoverLetterPdf } = await import("~/lib/cover-letter.server");
    const rendered = await renderCoverLetterPdf(userId, applicationId);
    expect(rendered).not.toBeNull();
    expect(isPdf(rendered!.bytes)).toBe(true);
    const pdf = await inspectPdf(Buffer.from(rendered!.bytes));
    return { rendered: rendered!, pdf, text: pdf.pages.join(" ") };
  }

  function expectInOrder(text: string, parts: readonly string[]) {
    const positions = parts.map((p) => at(text, p));
    positions.forEach((p, i) => expect(p, `"${parts[i]}" is missing`).toBeGreaterThanOrEqual(0));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  }

  it("uses the user's contact row and the modern template when no resume is linked", async () => {
    const user = await createUser();
    await seedContact(user.id);
    const app = await seedApplication(user.id, { resumeId: null });
    await seedCoverLetter(user.id, app.id);

    const { rendered, pdf, text } = await render(user.id, app.id);

    expect(rendered.fileName).toBe("Marisol-Venn-Cover-Letter.pdf");
    expect(rendered.pageCount).toBe(1);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.metadata.title).toBe("Marisol Venn Cover Letter");
    expect(pdf.metadata.author).toBe("Marisol Venn");
    expect([...new Set(pdf.links)].sort()).toEqual([
      `https://${LIBRARY_CONTACT.github}`,
      `https://${LIBRARY_CONTACT.linkedin}`,
      `mailto:${LIBRARY_CONTACT.email}`,
    ]);
    // modern is set in Inter.
    expect(pdf.fonts).toContain("Inter-Regular");
    expect(pdf.fonts.some((f) => f.startsWith("Lora"))).toBe(false);

    expectInOrder(text, ["Marisol Venn", ...LETTER.paragraphs]);
    expect(at(text, LETTER.recipient)).toBeGreaterThanOrEqual(0);
    expect(at(text, LETTER.recipient)).toBeLessThan(at(text, LETTER.paragraphs[0]));
  });

  it("dates the letter today in APP_TIMEZONE, in English long form", async () => {
    const user = await createUser();
    await seedContact(user.id);
    const app = await seedApplication(user.id, { resumeId: null });
    await seedCoverLetter(user.id, app.id);

    const { text } = await render(user.id, app.id);

    expect(text).toContain("November 11, 2026");
    expect(text).not.toContain("November 12, 2026");
    expect(at(text, "November 11, 2026")).toBeLessThan(at(text, LETTER.paragraphs[0]));
  });

  it("takes contact and template from the linked resume", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id, { template: "minimal" });
    const app = await seedApplication(user.id, { resumeId: resume.id });
    await seedCoverLetter(user.id, app.id);

    const { rendered, pdf, text } = await render(user.id, app.id);

    expect(rendered.fileName).toBe("Marisol-Venn-Cover-Letter.pdf");
    expect(pdf.metadata.title).toBe("Marisol Venn Cover Letter");
    // minimal is set in Lora.
    expect(pdf.fonts).toContain("Lora-Regular");
    expect(pdf.fonts.some((f) => f.startsWith("Inter"))).toBe(false);
    expectInOrder(text, ["Marisol Venn", ...LETTER.paragraphs]);
  });

  it("honors the linked resume's custom contact override", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id, {
      template: "classic",
      useCustomContact: true,
      contactName: "M. Venn-Okafor",
      contactEmail: "mvo@example.com",
      contactGithub: "github.com/mvo",
    });
    const app = await seedApplication(user.id, { resumeId: resume.id });
    await seedCoverLetter(user.id, app.id, {
      recipient: null,
      body: "Dear team,\n\nShort and to the point.\n\nRegards,\nM. Venn-Okafor",
    });

    const { rendered, pdf, text } = await render(user.id, app.id);

    expect(rendered.fileName).toBe("M-Venn-Okafor-Cover-Letter.pdf");
    expect(pdf.metadata.title).toBe("M. Venn-Okafor Cover Letter");
    expect(pdf.metadata.author).toBe("M. Venn-Okafor");
    expect([...new Set(pdf.links)].sort()).toEqual([
      "https://github.com/mvo",
      "mailto:mvo@example.com",
    ]);
    expect(pdf.fonts).toContain("Inter-Regular");
    expect(at(text, LIBRARY_CONTACT.name)).toBe(-1);
    expect(at(text, LIBRARY_CONTACT.email)).toBe(-1);
    expect(at(text, LETTER.recipient)).toBe(-1);
    expectInOrder(text, ["M. Venn-Okafor", "Dear team,", "Short and to the point.", "Regards,"]);
  });

  it("reports the page count of the PDF it produced", async () => {
    const user = await createUser();
    await seedContact(user.id);
    const app = await seedApplication(user.id, { resumeId: null });
    const paragraphs = Array.from(
      { length: 45 },
      (_, i) =>
        `Paragraph ${String(i + 1).padStart(2, "0")} explains, at some length and with real enthusiasm, one more reason the fleet team should talk to me about this role.`,
    );
    await seedCoverLetter(user.id, app.id, { body: paragraphs.join("\n\n") });

    const { rendered, pdf, text } = await render(user.id, app.id);

    expect(pdf.pageCount).toBeGreaterThan(1);
    expect(rendered.pageCount).toBe(pdf.pageCount);
    expectInOrder(text, paragraphs);
  });

  it("returns null for another user's application, a missing one, and one without a letter", async () => {
    const { renderCoverLetterPdf } = await import("~/lib/cover-letter.server");
    const owner = await createUser();
    await seedContact(owner.id);
    const stranger = await createUser();
    await seedContact(stranger.id);
    const withLetter = await seedApplication(owner.id);
    await seedCoverLetter(owner.id, withLetter.id);
    const withoutLetter = await seedApplication(owner.id);

    expect(await renderCoverLetterPdf(stranger.id, withLetter.id)).toBeNull();
    expect(await renderCoverLetterPdf(owner.id, withLetter.id + 10_000)).toBeNull();
    expect(await renderCoverLetterPdf(owner.id, withoutLetter.id)).toBeNull();
    // Sanity: the owner's letter renders, so the nulls above are not a broken setup.
    expect(await renderCoverLetterPdf(owner.id, withLetter.id)).not.toBeNull();
  });
});
