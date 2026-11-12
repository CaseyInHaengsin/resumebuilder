import type { ResumeData } from "~/components/pdf/types";
import { sampleResume } from "../helpers/pdf";

// Every string below is unique within a resume so a test can locate exactly
// one occurrence of each bullet, title and section's first line in the PDF.
const SUBJECTS = [
  "ledger", "catalog", "checkout", "inventory", "search", "billing", "notification", "onboarding",
  "reporting", "scheduling", "identity", "shipping", "pricing", "analytics", "messaging", "archive",
  "gateway", "audit", "export", "import", "preview", "upload", "routing", "caching",
  "indexing", "payroll", "booking", "review", "support", "forecast", "consent", "ticketing",
];

const CLAUSES = [
  " by replacing nightly batch jobs with an event stream that downstream teams subscribe to directly",
  ", cutting median response time from 900ms to 180ms through query caching and targeted index changes",
  ", which removed a recurring class of on-call pages and let the team retire two legacy cron hosts",
  ", then documented the rollout so three sibling teams could adopt the same approach within a quarter",
  ", and partnered with product and design to turn ambiguous customer requests into scoped milestones",
];

// Clause counts cycle so bullets run from one line up to about five lines.
const LENGTHS = [1, 3, 0, 5, 2, 4, 1, 3];

let subject = 0;
function bullets(count: number): string[] {
  return Array.from({ length: count }, () => {
    const n = subject++;
    const clauses = CLAUSES.slice(0, LENGTHS[n % LENGTHS.length]).join("");
    return `Rebuilt the ${SUBJECTS[n % SUBJECTS.length]} service${clauses}.`;
  });
}

function baseResume(compact: boolean): ResumeData {
  subject = 0;
  const per = (n: number) => (compact ? Math.ceil(n / 2) : n);
  return {
    ...sampleResume,
    jobs: [
      { title: "Staff Platform Engineer", company: "Acme Corp", dates: "2022 - Present", location: "Remote", bullets: bullets(per(8)) },
      { title: "Backend Developer", company: "Globex Inc", dates: "2019 - 2022", location: "Austin, TX", bullets: bullets(per(8)) },
      { title: "Support Technician", company: "Initech", dates: "2017 - 2019", location: "Dallas, TX", bullets: bullets(per(6)) },
    ],
    projects: [
      { name: "Open Source Linter", dates: "2021 - Present", tech: "TypeScript, Node.js", bullets: bullets(per(5)) },
      { name: "Personal Budget Tracker", dates: "2020", tech: "React, SQLite", bullets: bullets(per(4)) },
    ],
  };
}

export interface PageBreakVariant {
  label: string;
  data: ResumeData;
}

export const PAGE_BREAK_SHIFTS = 36;

/**
 * Two multi-page resumes ("full" and "compact", the latter with half the
 * bullets so the later sections sit near the first page break), each with
 * 0..PAGE_BREAK_SHIFTS-1 extra one-line bullets at the top of the first job.
 * Each extra bullet pushes everything after it down by one line, so across the
 * set the page break lands on every kind of line: mid-bullet, between a title
 * and its bullets, right after a section heading.
 */
export function pageBreakVariants(): PageBreakVariant[] {
  return [false, true].flatMap((compact) =>
    Array.from({ length: PAGE_BREAK_SHIFTS }, (_, shift) => {
      const data = baseResume(compact);
      const padding = Array.from(
        { length: shift },
        (_, i) => `Closed out maintenance window number ${i + 1} without customer impact.`,
      );
      data.jobs[0] = { ...data.jobs[0], bullets: [...padding, ...data.jobs[0].bullets] };
      return { label: `${compact ? "compact" : "full"} resume, shift ${shift}`, data };
    }),
  );
}
