import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  bullets,
  contact,
  education,
  jobs,
  projects,
  resumeBullets,
  resumeJobs,
  resumeProjects,
  resumeSkills,
  resumes,
  skills,
  summaries,
} from "~/db/schema";
import { TEMPLATES, type ResumeData, type TemplateId } from "~/components/pdf/types";
import { buildResumeData } from "~/lib/resume-data";
import { resumeFileName } from "~/lib/resume-file";
import { countPdfPages } from "~/lib/pdf-pages";

/**
 * Directory holding the PDF fonts: `<cwd>/public/fonts` in a checkout, else
 * `<cwd>/build/client/fonts`, which is all the production image contains.
 */
export function resolveFontsDir(cwd: string = process.cwd()): string {
  const source = path.join(cwd, "public", "fonts");
  if (fs.existsSync(source)) return source;
  const built = path.join(cwd, "build", "client", "fonts");
  if (fs.existsSync(built)) return built;
  return source;
}

// `app/components/pdf/fonts.ts` reads FONTS_DIR when the templates register
// their fonts, so it must be set before they load (they are imported lazily in
// renderResumePdf). An explicit FONTS_DIR wins.
if (!process.env.FONTS_DIR) process.env.FONTS_DIR = resolveFontsDir();

export interface ResumeForPdf {
  data: ResumeData;
  template: TemplateId;
  fileName: string;
}

function asTemplate(value: string): TemplateId {
  return TEMPLATES.some((t) => t.id === value) ? (value as TemplateId) : "modern";
}

/** The resume's content as the builder shows it, or null when it is not the user's. */
export function loadResumeForPdf(userId: number, resumeId: number): ResumeForPdf | null {
  const resume = db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
    .get();
  if (!resume) return null;

  // Selections in stored order, as the builder loader reads them.
  const selectedJobIds = db
    .select({ id: resumeJobs.jobId })
    .from(resumeJobs)
    .where(eq(resumeJobs.resumeId, resumeId))
    .orderBy(asc(resumeJobs.sortOrder), asc(resumeJobs.id))
    .all()
    .map((r) => r.id);
  const selectedProjectIds = db
    .select({ id: resumeProjects.projectId })
    .from(resumeProjects)
    .where(eq(resumeProjects.resumeId, resumeId))
    .orderBy(asc(resumeProjects.sortOrder), asc(resumeProjects.id))
    .all()
    .map((r) => r.id);
  const selectedBulletIds = db
    .select({ id: resumeBullets.bulletId })
    .from(resumeBullets)
    .where(eq(resumeBullets.resumeId, resumeId))
    .orderBy(asc(resumeBullets.sortOrder), asc(resumeBullets.id))
    .all()
    .map((r) => r.id);
  const selectedSkillIds = db
    .select({ id: resumeSkills.skillId })
    .from(resumeSkills)
    .where(eq(resumeSkills.resumeId, resumeId))
    .orderBy(asc(resumeSkills.sortOrder), asc(resumeSkills.id))
    .all()
    .map((r) => r.id);

  const data = buildResumeData({
    resume,
    contact: db.select().from(contact).where(eq(contact.userId, userId)).get(),
    education: db.select().from(education).where(eq(education.userId, userId)).get(),
    summaries: db.select().from(summaries).where(eq(summaries.userId, userId)).all(),
    jobs: db.select().from(jobs).where(eq(jobs.userId, userId)).all(),
    projects: db.select().from(projects).where(eq(projects.userId, userId)).all(),
    bullets: db.select().from(bullets).where(eq(bullets.userId, userId)).all(),
    skills: db.select().from(skills).where(eq(skills.userId, userId)).all(),
    selectedJobIds,
    selectedProjectIds,
    selectedBulletIds,
    selectedSkillIds,
  });

  return {
    data,
    template: asTemplate(resume.template),
    fileName: resumeFileName(data.contact.name),
  };
}

export interface RenderedResumePdf {
  bytes: Buffer;
  fileName: string;
  pageCount: number;
  template: TemplateId;
}

/** Renders the user's resume to PDF bytes, or null when it is not the user's. */
export async function renderResumePdf(
  userId: number,
  resumeId: number,
): Promise<RenderedResumePdf | null> {
  const loaded = loadResumeForPdf(userId, resumeId);
  if (!loaded) return null;

  // Loaded here, not at the top, so font registration sees FONTS_DIR.
  const [{ renderToBuffer }, { templateComponents }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("~/components/pdf/templates"),
  ]);
  const Template = templateComponents[loaded.template];
  const bytes = await renderToBuffer(
    createElement(Template, { data: loaded.data }) as unknown as Parameters<
      typeof renderToBuffer
    >[0],
  );

  return {
    bytes,
    fileName: loaded.fileName,
    pageCount: countPdfPages(bytes.toString("latin1")),
    template: loaded.template,
  };
}
