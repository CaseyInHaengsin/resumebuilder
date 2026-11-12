// Phase 13 — the cover letter PDF component.
//
//   app/components/pdf/CoverLetterDocument.tsx
//     export function CoverLetterDocument({ data }: { data: CoverLetterData })
//     export type CoverLetterData = {
//       contact: ResumeContact;
//       template: TemplateId;
//       date: string;            // already formatted, e.g. "November 11, 2026"
//       recipient: string | null;
//       body: string;            // greeting through sign-off, blank line between paragraphs
//     }
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import type { CoverLetterData } from "~/components/pdf/CoverLetterDocument";
import type { TemplateId } from "~/components/pdf/types";
import { findInPdf, indexPdfText, inspectPdf, squash, type PdfInspection } from "../helpers/pdf";

const TIMEOUT = 30_000;
const TEMPLATE_IDS: TemplateId[] = ["modern", "classic", "minimal"];

const PARAGRAPHS = [
  "Dear Hiring Manager,",
  "I am writing about the Platform Engineer opening on your fleet team. For three years I kept nine thousand warehouse robots reporting home on time, and I would like to do the same for yours.",
  "Short one.",
  "What draws me to Acme Robotics is the habit of publishing your postmortems. I would like to help write the next ones, ideally shorter.",
  "Sincerely,\nJane Doe",
];

const letter: CoverLetterData = {
  contact: {
    name: "Jane Doe",
    phone: "(555) 010-2345",
    email: "jane@example.com",
    linkedin: "linkedin.com/in/jane-doe",
    github: "https://github.com/jane-doe",
  },
  template: "modern",
  date: "November 11, 2026",
  recipient: "Hiring Manager, Acme Robotics",
  body: PARAGRAPHS.join("\n\n"),
};

async function render(data: CoverLetterData): Promise<PdfInspection> {
  const { CoverLetterDocument } = await import("~/components/pdf/CoverLetterDocument");
  const buffer = await renderToBuffer(
    createElement(CoverLetterDocument, { data }) as unknown as Parameters<typeof renderToBuffer>[0],
  );
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  return inspectPdf(buffer);
}

/** Start offsets (whitespace-insensitive) of each part; every part must occur exactly once. */
function offsets(pdf: PdfInspection, parts: readonly string[]): number[] {
  const index = indexPdfText(pdf);
  return parts.map((part) => {
    const matches = findInPdf(index, part);
    expect(matches, `"${part.slice(0, 40)}" should appear exactly once`).toHaveLength(1);
    return matches[0].start;
  });
}

function expectAscending(values: number[]) {
  expect(values).toEqual([...values].sort((a, b) => a - b));
}

/**
 * True when some single run of text holds both the end of one piece and the
 * start of the next, which is what happens when they are set as one
 * paragraph instead of separate blocks or lines.
 */
function sharesARun(pdf: PdfInspection, endOfFirst: string, startOfSecond: string): boolean {
  return pdf.textItemsByPage
    .flat()
    .some((item) => {
      const s = squash(item.str);
      const a = s.indexOf(squash(endOfFirst));
      return a !== -1 && s.indexOf(squash(startOfSecond), a) !== -1;
    });
}

describe("CoverLetterDocument", () => {
  describe.each(TEMPLATE_IDS)("%s", (template) => {
    it(
      'sets title "<name> Cover Letter" and the name as author',
      async () => {
        const pdf = await render({ ...letter, template });
        expect(pdf.metadata.title).toBe("Jane Doe Cover Letter");
        expect(pdf.metadata.author).toBe("Jane Doe");
      },
      TIMEOUT,
    );

    it(
      "shows the name, the date and the recipient above the body, paragraphs in order",
      async () => {
        const pdf = await render({ ...letter, template });
        const text = pdf.pages.join(" ");
        expect(pdf.pageCount).toBe(1);

        const [date, recipient, ...paragraphs] = offsets(pdf, [
          letter.date,
          letter.recipient!,
          ...PARAGRAPHS,
        ]);
        expectAscending(paragraphs);
        expect(date).toBeLessThan(paragraphs[0]);
        expect(recipient).toBeLessThan(paragraphs[0]);

        // The name heads the letter (it appears again in the sign-off).
        const name = squash(text).indexOf(squash(letter.contact.name));
        expect(name).toBeGreaterThanOrEqual(0);
        expect(name).toBeLessThan(squash(text).indexOf(squash(letter.date)));
        expect(squash(text)).toContain("jane@example.com");
      },
      TIMEOUT,
    );

    it(
      "links the email, LinkedIn and GitHub, adding https:// to scheme-less values",
      async () => {
        const pdf = await render({ ...letter, template });
        expect([...new Set(pdf.links)].sort()).toEqual([
          "https://github.com/jane-doe",
          "https://linkedin.com/in/jane-doe",
          "mailto:jane@example.com",
        ]);
        expect(pdf.pages.join(" ")).not.toContain("mailto:");
      },
      TIMEOUT,
    );
  });

  it.each([
    ["modern", "Inter", "Lora"],
    ["classic", "Inter", "Lora"],
    ["minimal", "Lora", "Inter"],
  ] as const)(
    "%s is set in %s",
    async (template, family, other) => {
      const pdf = await render({ ...letter, template });
      expect(pdf.fonts).toContain(`${family}-Regular`);
      expect(pdf.fonts.filter((f) => f.startsWith(other))).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "links only what the contact has",
    async () => {
      const pdf = await render({
        ...letter,
        contact: { name: "Jane Doe", email: "jane@example.com", phone: null, linkedin: null, github: null },
      });
      expect(pdf.links).toEqual(["mailto:jane@example.com"]);
    },
    TIMEOUT,
  );

  it(
    "leaves the recipient out when there is none",
    async () => {
      const pdf = await render({ ...letter, recipient: null });
      const text = pdf.pages.join(" ");
      expect(text).not.toContain("Hiring Manager, Acme Robotics");
      expect(text).not.toMatch(/\bnull\b|\bundefined\b/);
      expectAscending(offsets(pdf, [letter.date, ...PARAGRAPHS]));
    },
    TIMEOUT,
  );

  it(
    "sets paragraphs separated by a blank line as separate blocks",
    async () => {
      const pdf = await render(letter);
      // A short paragraph does not run on into the next one on the same line.
      expect(sharesARun(pdf, "Dear Hiring Manager,", "I am writing")).toBe(false);
      expect(sharesARun(pdf, "do the same for yours.", "Short one.")).toBe(false);
      expect(sharesARun(pdf, "Short one.", "What draws me")).toBe(false);
      expect(sharesARun(pdf, "ideally shorter.", "Sincerely,")).toBe(false);
      // Sanity: text within one paragraph does share a run.
      expect(sharesARun(pdf, "I am writing", "about the Platform")).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "keeps a single line break inside a paragraph, as in the sign-off",
    async () => {
      const pdf = await render(letter);
      expect(sharesARun(pdf, "Sincerely,", "Jane Doe")).toBe(false);
      expectAscending(offsets(pdf, ["ideally shorter.", "Sincerely,", "Sincerely,\nJane Doe"]));
    },
    TIMEOUT,
  );

  it(
    "treats Windows line endings the same as Unix ones",
    async () => {
      const unix = await render(letter);
      const windows = await render({ ...letter, body: letter.body.replace(/\n/g, "\r\n") });

      expect(squash(windows.pages.join(" "))).toBe(squash(unix.pages.join(" ")));
      expect(windows.pageCount).toBe(unix.pageCount);
      expect(sharesARun(windows, "Dear Hiring Manager,", "I am writing")).toBe(false);
      expect(sharesARun(windows, "Short one.", "What draws me")).toBe(false);
      expect(sharesARun(windows, "Sincerely,", "Jane Doe")).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "ignores extra blank lines around and between paragraphs",
    async () => {
      const tidy = await render(letter);
      const messy = await render({
        ...letter,
        body: `\n\n${PARAGRAPHS.join("\n\n\n\n")}\n\n\n`,
      });
      expect(squash(messy.pages.join(" "))).toBe(squash(tidy.pages.join(" ")));
      expect(messy.pageCount).toBe(1);
    },
    TIMEOUT,
  );

  it.each(TEMPLATE_IDS)(
    "%s: a long letter flows onto a second page without losing text",
    async (template) => {
      const paragraphs = Array.from(
        { length: 45 },
        (_, i) =>
          `Paragraph ${String(i + 1).padStart(2, "0")} explains, at some length and with real enthusiasm, one more reason the fleet team should talk to me about this role.`,
      );
      const body = ["Dear Hiring Manager,", ...paragraphs, "Sincerely,\nJane Doe"];
      const pdf = await render({ ...letter, template, body: body.join("\n\n") });

      expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
      // Every paragraph is there once, in order, and the letter ends with the sign-off.
      const positions = offsets(pdf, body);
      expectAscending(positions);
      const index = indexPdfText(pdf);
      expect(index.pageOf[positions[0]]).toBe(1);
      expect(index.pageOf[positions[positions.length - 1]]).toBe(pdf.pageCount);
      // No page is blank.
      for (const page of pdf.pages) expect(page.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
