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

  // Output order follows the selected-id arrays; ids without a library row are skipped.
  const inSelectedOrder = <T extends { id: number }>(rows: T[], ids: number[]) => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  };

  const selectedBullets = inSelectedOrder(input.bullets, input.selectedBulletIds);
  const bulletsFor = (parentType: "job" | "project", parentId: number) =>
    selectedBullets
      .filter((b) => b.parentType === parentType && b.parentId === parentId)
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
    jobs: inSelectedOrder(input.jobs, input.selectedJobIds).map((job) => ({
        title: job.title,
        company: job.company,
        dates: job.dates,
        location: job.location,
        bullets: bulletsFor("job", job.id),
      })),
    skills: inSelectedOrder(input.skills, input.selectedSkillIds).map((s) => ({ category: s.category, items: s.items as string[] })),
    projects: inSelectedOrder(input.projects, input.selectedProjectIds).map((project) => ({
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
