import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { templateComponents } from "~/components/pdf/templates";
import type { ResumeData, TemplateId } from "~/components/pdf/types";

const bullet = (n: number) =>
  [
    "Led migration of a monolithic billing service to event-driven microservices, cutting deploy time from 45 minutes to 6 and reducing incidents by 40%.",
    "Designed and shipped a customer-facing reporting dashboard in React and TypeScript used by over 2,000 accounts, improving weekly retention by 12%.",
    "Mentored four junior engineers through code review and pairing, with two promoted to mid-level within eighteen months of joining the team.",
    "Reduced p95 API latency from 900ms to 180ms by introducing query caching, connection pooling, and targeted database index changes across hot paths.",
    "Built an internal CI tooling platform that parallelized test suites, shrinking median pipeline duration by 55% and saving roughly 300 engineer hours monthly.",
    "Partnered with product and design to define quarterly roadmaps, translating ambiguous customer requests into scoped technical plans with clear milestones.",
    "Introduced structured logging and distributed tracing across twelve services, enabling on-call engineers to diagnose production issues in minutes, not hours.",
    "Automated infrastructure provisioning with Terraform and GitHub Actions, eliminating manual environment setup and enabling reproducible staging environments.",
    "Owned the authentication overhaul adding OAuth and SSO support, unblocking three enterprise contracts worth a combined $1.2M in annual recurring revenue.",
  ][n % 9];

export const sampleResume: ResumeData = {
  contact: {
    name: "Jane Doe",
    phone: "(555) 010-2345",
    email: "jane@example.com",
    linkedin: "linkedin.com/in/jane-doe",
    github: "github.com/jane-doe",
  },
  summary:
    "Senior software engineer with eight years of experience building reliable web platforms, leading small teams, and shipping products that customers rely on every day.",
  jobs: [
    {
      title: "Senior Software Engineer",
      company: "Acme Corp",
      dates: "2022 - Present",
      location: "Remote",
      bullets: [bullet(0), bullet(1), bullet(2)],
    },
    {
      title: "Software Engineer",
      company: "Globex Inc",
      dates: "2019 - 2022",
      location: "Austin, TX",
      bullets: [bullet(3), bullet(4), bullet(5)],
    },
    {
      title: "Junior Developer",
      company: "Initech",
      dates: "2017 - 2019",
      location: "Dallas, TX",
      bullets: [bullet(6), bullet(7), bullet(8)],
    },
  ],
  skills: [
    { category: "Languages", items: ["TypeScript", "JavaScript", "Python", "SQL", "Go"] },
    { category: "Frameworks", items: ["React", "Node.js", "Express", "React Router"] },
    { category: "Tools", items: ["PostgreSQL", "Docker", "Terraform", "GitHub Actions"] },
  ],
  projects: [
    {
      name: "Open Source Linter",
      dates: "2021 - Present",
      tech: "TypeScript, Node.js",
      bullets: [bullet(1), bullet(4)],
    },
    {
      name: "Personal Budget Tracker",
      dates: "2020",
      tech: "React, SQLite",
      bullets: [bullet(7)],
    },
  ],
  education: {
    school: "University of Texas at Austin",
    degrees: ["B.S. Computer Science, 2017"],
  },
};

export const longResume: ResumeData = {
  ...sampleResume,
  jobs: sampleResume.jobs.map((job, j) => ({
    ...job,
    bullets: Array.from({ length: 10 }, (_, i) => bullet(i + j)),
  })),
  projects: sampleResume.projects.map((p, j) => ({
    ...p,
    bullets: Array.from({ length: 5 }, (_, i) => bullet(i + j + 2)),
  })),
};

export async function renderResume(
  templateId: TemplateId,
  data: ResumeData,
): Promise<Buffer> {
  const Template = templateComponents[templateId];
  return renderToBuffer(
    createElement(Template, { data }) as unknown as Parameters<typeof renderToBuffer>[0],
  );
}

export interface PdfTextItem {
  str: string;
  fontName: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfInspection {
  pageCount: number;
  pages: string[];
  textItemsByPage: PdfTextItem[][];
  fonts: string[];
  metadata: {
    title: string | null;
    author: string | null;
    subject: string | null;
    keywords: string | null;
  };
  links: string[];
}

export async function inspectPdf(buffer: Buffer): Promise<PdfInspection> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    verbosity: 0,
    fontExtraProperties: true,
  });
  const doc = await task.promise;

  const pages: string[] = [];
  const textItemsByPage: PdfTextItem[][] = [];
  const links: string[] = [];
  const fontSet = new Set<string>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      items.push({
        str: item.str,
        fontName: item.fontName,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      });
    }
    textItemsByPage.push(items);
    pages.push(items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());

    // Real embedded font names: loaded fonts land in commonObjs once the
    // operator list has been processed.
    await page.getOperatorList();
    for (const item of items) {
      if (!item.fontName || !item.fontName.startsWith("g_")) continue;
      try {
        const font = page.commonObjs.get(item.fontName) as { name?: string } | undefined;
        if (font?.name) fontSet.add(font.name.replace(/^[A-Z]{6}\+/, ""));
      } catch {
        /* font object not resolved */
      }
    }

    for (const annot of await page.getAnnotations()) {
      if (annot.subtype === "Link" && (annot.url || annot.unsafeUrl)) {
        links.push(annot.url ?? annot.unsafeUrl);
      }
    }
  }

  const info = ((await doc.getMetadata()).info ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const pageCount = doc.numPages;
  await task.destroy();

  return {
    pageCount,
    pages,
    textItemsByPage,
    fonts: [...fontSet].sort(),
    metadata: {
      title: str(info.Title),
      author: str(info.Author),
      subject: str(info.Subject),
      keywords: str(info.Keywords),
    },
    links,
  };
}
