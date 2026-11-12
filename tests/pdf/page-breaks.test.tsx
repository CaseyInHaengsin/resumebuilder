// Phase 3 — page breaks.
//
// Across a set of multi-page resumes that move the page break one line at a
// time (see page-break-fixtures.ts):
//   - a bullet is never split across two pages;
//   - a job title / project name is on the same page as its first bullet;
//   - a section heading is on the same page as the first line under it.
import { beforeAll, describe, expect, it } from "vitest";
import type { TemplateId } from "~/components/pdf/types";
import {
  findInPdf,
  indexPdfText,
  inspectPdf,
  renderResume,
  type PdfTextIndex,
} from "../helpers/pdf";
import { pageBreakVariants, type PageBreakVariant } from "./page-break-fixtures";

const RENDER_TIMEOUT = 180_000;
const TEMPLATE_IDS: TemplateId[] = ["modern", "classic", "minimal"];

interface Rendered extends PageBreakVariant {
  pageCount: number;
  index: PdfTextIndex;
}

/** The single occurrence of `text` in the PDF; anything else is a broken fixture or render. */
function locate(r: Rendered, text: string) {
  const matches = findInPdf(r.index, text);
  if (matches.length !== 1) {
    throw new Error(`${r.label}: expected "${text}" once in the PDF text, found ${matches.length}`);
  }
  return matches[0];
}

function entries(r: Rendered) {
  return [
    ...r.data.jobs.map((j) => ({ name: j.title, bullets: j.bullets })),
    ...r.data.projects.map((p) => ({ name: p.name, bullets: p.bullets })),
  ];
}

describe.each(TEMPLATE_IDS)("%s template page breaks", (templateId) => {
  let rendered: Rendered[] = [];

  beforeAll(async () => {
    rendered = [];
    for (const variant of pageBreakVariants()) {
      const pdf = await inspectPdf(await renderResume(templateId, variant.data));
      rendered.push({ ...variant, pageCount: pdf.pageCount, index: indexPdfText(pdf) });
    }
  }, RENDER_TIMEOUT);

  it("every variant spans more than one page", () => {
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.filter((r) => r.pageCount < 2).map((r) => r.label)).toEqual([]);
  });

  it("never splits a bullet across pages", () => {
    const violations: string[] = [];
    for (const r of rendered) {
      for (const entry of entries(r)) {
        for (const bullet of entry.bullets) {
          const match = locate(r, bullet);
          if (match.pages.length > 1) {
            violations.push(`${r.label}: bullet split across pages ${match.pages.join(" and ")}: "${bullet.slice(0, 50)}..."`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps each job title and project name on the page of its first bullet", () => {
    const violations: string[] = [];
    for (const r of rendered) {
      for (const entry of entries(r)) {
        const title = locate(r, entry.name);
        const firstBullet = locate(r, entry.bullets[0]);
        const titlePage = title.pages[0];
        const bulletPage = firstBullet.pages[0];
        if (title.pages.length > 1 || titlePage !== bulletPage) {
          violations.push(`${r.label}: "${entry.name}" is on page ${title.pages.join("/")}, its first bullet starts on page ${bulletPage}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps each section heading on the page of the first line under it", () => {
    const violations: string[] = [];
    for (const r of rendered) {
      const { data, index } = r;
      const firstLines = [
        data.summary.slice(0, 40),
        data.jobs[0].title,
        data.skills[0].category,
        data.projects[0].name,
        data.education!.school,
      ];
      for (const line of firstLines) {
        const content = locate(r, line);
        // The heading is the run of capitals directly before the content. The
        // fixtures end every preceding block with a lowercase letter or a
        // period, so the run is the heading and nothing else.
        let start = content.start;
        while (start > 0 && /[A-Z&]/.test(index.text[start - 1])) start--;
        const heading = index.text.slice(start, content.start);
        expect(heading.length, `${r.label}: no section heading directly before "${line}"`).toBeGreaterThanOrEqual(4);

        const headingPages = [...new Set(index.pageOf.slice(start, content.start))];
        if (headingPages.length > 1 || headingPages[0] !== content.pages[0]) {
          violations.push(`${r.label}: heading ${heading} is on page ${headingPages.join("/")}, "${line}" starts on page ${content.pages[0]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
