// Phase 4 — PDF polish: metadata, links, no placeholder text, real page count.
//
// Requirement that a test cannot enforce: `countResumePages` (app/lib/pdf-pages.ts)
// is called from the builder in the browser, so it must not depend on
// pdfjs-dist or on Node-only APIs (fs, path, Buffer, renderToBuffer, ...).
// These tests can only check that it also runs, and counts correctly, in Node.
import { describe, expect, it } from "vitest";
import type { ResumeContact, ResumeData, TemplateId } from "~/components/pdf/types";
import {
  inspectPdf,
  longResume,
  renderResume,
  sampleResume,
  shortResume,
  squash,
  type PdfInspection,
} from "../helpers/pdf";

const TIMEOUT = 30_000;
const TEMPLATE_IDS: TemplateId[] = ["modern", "classic", "minimal"];

async function render(templateId: TemplateId, data: ResumeData): Promise<PdfInspection> {
  return inspectPdf(await renderResume(templateId, data));
}

function withContact(contact: ResumeContact): ResumeData {
  return { ...sampleResume, contact };
}

/** All text of the document in reading order, whitespace removed. */
function docText(pdf: PdfInspection): string {
  return squash(pdf.textItemsByPage.flat().map((item) => item.str).join(""));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A section heading in the squashed text: a run of capitals. Every template
// puts the first heading directly after the header block.
const HEADING = "[A-Z]{4,}";

describe.each(TEMPLATE_IDS)("%s template", (templateId) => {
  describe("metadata", () => {
    it.each(["Jane Doe", "Rosa Marlowe"])(
      'sets title "%s Resume" and the name as author',
      async (name) => {
        const pdf = await render(templateId, withContact({ ...sampleResume.contact, name }));
        expect(pdf.metadata.title).toBe(`${name} Resume`);
        expect(pdf.metadata.author).toBe(name);
      },
      TIMEOUT,
    );
  });

  describe("contact links", () => {
    it(
      "links the email, LinkedIn and GitHub, adding https:// to scheme-less values",
      async () => {
        const pdf = await render(templateId, sampleResume);
        expect([...new Set(pdf.links)].sort()).toEqual([
          "https://github.com/jane-doe",
          "https://linkedin.com/in/jane-doe",
          "mailto:jane@example.com",
        ]);
      },
      TIMEOUT,
    );

    it(
      "keeps the visible text as stored",
      async () => {
        const pdf = await render(templateId, sampleResume);
        expect(pdf.links.length).toBeGreaterThan(0);
        const text = docText(pdf);
        expect(text).toContain("jane@example.com");
        expect(text).toContain("linkedin.com/in/jane-doe");
        expect(text).toContain("github.com/jane-doe");
        expect(text).not.toContain("https://");
        expect(text).not.toContain("mailto:");
      },
      TIMEOUT,
    );

    it(
      "uses a stored http:// or https:// value as is",
      async () => {
        const pdf = await render(
          templateId,
          withContact({
            ...sampleResume.contact,
            linkedin: "https://www.linkedin.com/in/rosa-marlowe",
            github: "http://github.com/rosa-marlowe",
          }),
        );
        expect([...new Set(pdf.links)].sort()).toEqual([
          "http://github.com/rosa-marlowe",
          "https://www.linkedin.com/in/rosa-marlowe",
          "mailto:jane@example.com",
        ]);
        const text = docText(pdf);
        expect(text).toContain("https://www.linkedin.com/in/rosa-marlowe");
        expect(text).toContain("http://github.com/rosa-marlowe");
      },
      TIMEOUT,
    );

    it(
      "renders no link and no stray separator for a missing LinkedIn and GitHub",
      async () => {
        const { name, phone, email } = sampleResume.contact;
        const pdf = await render(templateId, withContact({ name, phone, email, linkedin: null, github: "" }));
        expect(pdf.links).toEqual(["mailto:jane@example.com"]);

        // name, phone, one short separator, email, then straight into the first heading.
        const text = docText(pdf);
        expect(text).toMatch(
          new RegExp(`^${escapeRegExp(squash(name + phone!))}[^A-Za-z0-9]{1,3}${escapeRegExp(email)}${HEADING}`),
        );
      },
      TIMEOUT,
    );

    it(
      "renders only the email, with no separator, when it is the only contact detail",
      async () => {
        const { name, email } = sampleResume.contact;
        const pdf = await render(templateId, withContact({ name, email }));
        expect(pdf.links).toEqual(["mailto:jane@example.com"]);
        expect(docText(pdf)).toMatch(new RegExp(`^${escapeRegExp(squash(name))}${escapeRegExp(email)}${HEADING}`));
      },
      TIMEOUT,
    );
  });

  describe("missing contact and education", () => {
    // `education: null` is what buildResumeData returns when there is no education row.
    const noEducation: ResumeData = { ...sampleResume, education: null };
    const nothingEntered: ResumeData = { ...noEducation, contact: { name: "", email: "" } };

    it(
      "renders no EDUCATION section when education is null",
      async () => {
        const control = docText(await render(templateId, sampleResume));
        expect(control).toContain("EDUCATION");
        expect(control).toContain(squash(sampleResume.education!.school));

        const pdf = await render(templateId, noEducation);
        const text = docText(pdf);
        expect(text).not.toContain("EDUCATION");
        expect(text).not.toContain("University");
        // The rest of the resume is still there, ending with the last project bullet.
        expect(text).toContain("PROJECTS");
        expect(text.endsWith(squash(sampleResume.projects.at(-1)!.bullets.at(-1)!))).toBe(true);
      },
      TIMEOUT,
    );

    it(
      "renders no placeholder text and no links when name and email are empty",
      async () => {
        const pdf = await render(templateId, nothingEntered);
        const text = docText(pdf);
        expect(text).not.toContain(squash("Your Name"));
        expect(text).not.toContain("email@example.com");
        expect(text).not.toContain("University");
        expect(text).not.toContain("EDUCATION");
        expect(pdf.links).toEqual([]);
        // With nothing in the header, the document starts with the first section heading.
        expect(text).toMatch(new RegExp(`^${HEADING}${escapeRegExp(squash(sampleResume.summary.slice(0, 30)))}`));
      },
      TIMEOUT,
    );

    it(
      "does not leave an empty contact line under the name",
      async () => {
        // Distance from the name down to the first section heading. Without any
        // contact detail it must be smaller than with one: no blank line is kept.
        const gap = (pdf: PdfInspection) => {
          const items = pdf.textItemsByPage[0].filter((item) => item.str.trim() !== "");
          const nameItem = items.find((item) => item.str === "Jane Doe");
          const heading = items.find((item) => /^[A-Z ]{4,}$/.test(item.str));
          expect(nameItem).toBeDefined();
          expect(heading).toBeDefined();
          return nameItem!.y - heading!.y;
        };
        const withEmail = gap(await render(templateId, withContact({ name: "Jane Doe", email: "jane@example.com" })));
        const withoutDetails = gap(await render(templateId, withContact({ name: "Jane Doe", email: "" })));
        expect(withoutDetails).toBeGreaterThan(0);
        expect(withoutDetails).toBeLessThan(withEmail);
      },
      TIMEOUT,
    );
  });

  describe("countResumePages", () => {
    // Imported lazily so the rest of this file reports its own failures while
    // app/lib/pdf-pages.ts does not exist yet.
    const load = async () => (await import("~/lib/pdf-pages")).countResumePages;

    it(
      "reports 1 for a resume that fits on one page",
      async () => {
        const countResumePages = await load();
        expect((await render(templateId, shortResume)).pageCount).toBe(1);
        expect(await countResumePages(templateId, shortResume)).toBe(1);
      },
      TIMEOUT,
    );

    it(
      "reports 2 or more for longResume",
      async () => {
        const countResumePages = await load();
        expect(await countResumePages(templateId, longResume)).toBeGreaterThanOrEqual(2);
      },
      TIMEOUT,
    );

    it.each([
      ["shortResume", shortResume],
      ["sampleResume", sampleResume],
      ["longResume", longResume],
      ["longResume twice over", { ...longResume, jobs: [...longResume.jobs, ...longResume.jobs] }],
    ])(
      "agrees with the rendered PDF for %s",
      async (_label, data) => {
        const countResumePages = await load();
        const expected = (await render(templateId, data)).pageCount;
        expect(await countResumePages(templateId, data)).toBe(expected);
      },
      TIMEOUT,
    );
  });
});

describe("countResumePages on sampleResume", () => {
  it(
    "reports 1 for the modern template",
    async () => {
      const { countResumePages } = await import("~/lib/pdf-pages");
      expect(await countResumePages("modern", sampleResume)).toBe(1);
    },
    TIMEOUT,
  );
});
