import type { ResumeData } from "~/components/pdf/types";
import type {
  bullets,
  contact,
  education,
  jobs,
  projects,
  resumes,
  skills,
  summaries,
} from "~/db/schema";

// Types only: this module runs in the browser and must not import server code.
export interface ResumeDataInput {
  resume: typeof resumes.$inferSelect;
  contact?: typeof contact.$inferSelect | null;
  education?: typeof education.$inferSelect | null;
  summaries: (typeof summaries.$inferSelect)[];
  jobs: (typeof jobs.$inferSelect)[];
  projects: (typeof projects.$inferSelect)[];
  bullets: (typeof bullets.$inferSelect)[];
  skills: (typeof skills.$inferSelect)[];
  selectedJobIds: number[];
  selectedProjectIds: number[];
  selectedBulletIds: number[];
  selectedSkillIds: number[];
}

/** Assembles the ResumeData for the PDF templates from library rows and selections. */
export function buildResumeData(input: ResumeDataInput): ResumeData {
  const { resume, contact: contactRow, education: educationRow } = input;

  const bulletsFor = (parentType: "job" | "project", parentId: number) =>
    input.bullets
      .filter(
        (b) =>
          b.parentType === parentType &&
          b.parentId === parentId &&
          input.selectedBulletIds.includes(b.id),
      )
      .map((b) => b.text);

  const summary = resume.summaryId
    ? input.summaries.find((s) => s.id === resume.summaryId)?.text ?? ""
    : "";

  const contact: ResumeData["contact"] = resume.useCustomContact
    ? {
        name: resume.contactName ?? "",
        phone: resume.contactPhone,
        email: resume.contactEmail ?? "",
        linkedin: resume.contactLinkedin,
        github: resume.contactGithub,
      }
    : contactRow
      ? {
          name: contactRow.name,
          phone: contactRow.phone,
          email: contactRow.email,
          linkedin: contactRow.linkedin,
          github: contactRow.github,
        }
      : { name: "", email: "" };

  return {
    contact,
    summary,
    jobs: input.jobs
      .filter((j) => input.selectedJobIds.includes(j.id))
      .map((job) => ({
        title: job.title,
        company: job.company,
        dates: job.dates,
        location: job.location,
        bullets: bulletsFor("job", job.id),
      })),
    skills: input.skills
      .filter((s) => input.selectedSkillIds.includes(s.id))
      .map((s) => ({ category: s.category, items: s.items as string[] })),
    projects: input.projects
      .filter((p) => input.selectedProjectIds.includes(p.id))
      .map((project) => ({
        name: project.name,
        dates: project.dates,
        tech: project.tech,
        bullets: bulletsFor("project", project.id),
      })),
    education: educationRow
      ? { school: educationRow.school, degrees: educationRow.degrees as string[] }
      : null,
  };
}
