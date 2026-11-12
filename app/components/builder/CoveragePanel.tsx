import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import type { ResumeData } from "~/components/pdf/types";
import { analyzeCoverage, type CoverageTerm, type LibraryItem } from "~/lib/keywords";

export type CoverageTarget = {
  applicationId: number;
  jobTitle: string;
  companyName: string | null;
  jobDescription: string;
};

type BulletRow = { id: number; text: string; tags: string[]; parentType: string; parentId: number };
type SkillRow = { id: number; category: string; items: unknown };

const chipStyles = {
  missing: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
  available: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  covered: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
} as const;

function Chips({ terms, status }: { terms: CoverageTerm[]; status: keyof typeof chipStyles }) {
  return (
    <div className="flex flex-wrap gap-1">
      {terms.map((t) => (
        <span key={t.term} className={`rounded px-1.5 py-0.5 text-[11px] ${chipStyles[status]}`}>
          {t.term}
        </span>
      ))}
    </div>
  );
}

function AddButton({ resumeId, action, field, id }: { resumeId: number; action: string; field: string; id: number }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form method="post" action="/api/resumes" className="shrink-0">
      <input type="hidden" name="_action" value={action} />
      <input type="hidden" name="resumeId" value={resumeId} />
      <input type="hidden" name={field} value={id} />
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        className="rounded border border-gray-300 dark:border-gray-600 px-1.5 text-[11px] text-blue-700 dark:text-blue-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
      >
        Add
      </button>
    </fetcher.Form>
  );
}

const clip = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

export function CoveragePanel({
  resumeId,
  targets,
  previewData,
  bullets,
  skills,
  selectedBulletIds,
  selectedSkillIds,
  selectedJobIds,
  selectedProjectIds,
}: {
  resumeId: number;
  targets: CoverageTarget[];
  previewData: ResumeData;
  bullets: BulletRow[];
  skills: SkillRow[];
  selectedBulletIds: number[];
  selectedSkillIds: number[];
  selectedJobIds: number[];
  selectedProjectIds: number[];
}) {
  const [chosenId, setChosenId] = useState<number | null>(null);
  const target = targets.find((t) => t.applicationId === chosenId) ?? targets[0];

  const coverage = useMemo(() => {
    if (!target) return null;
    const bulletSel = new Set(selectedBulletIds);
    const skillSel = new Set(selectedSkillIds);
    const library: LibraryItem[] = [
      ...bullets.map((b) => ({ kind: "bullet" as const, id: b.id, text: b.text, selected: bulletSel.has(b.id) })),
      ...skills.map((s) => ({
        kind: "skill" as const,
        id: s.id,
        text: (s.items as string[]).join(", "),
        selected: skillSel.has(s.id),
      })),
    ];
    const vocabulary = [...skills.flatMap((s) => s.items as string[]), ...bullets.flatMap((b) => b.tags ?? [])];
    return analyzeCoverage({ description: target.jobDescription, resume: previewData, library, vocabulary });
  }, [target, previewData, bullets, skills, selectedBulletIds, selectedSkillIds]);

  if (!target || !coverage) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Link this resume to an application with a job description to see keyword coverage.
      </p>
    );
  }

  const byStatus = (status: CoverageTerm["status"]) => coverage.terms.filter((t) => t.status === status);
  const missing = byStatus("missing");
  const available = byStatus("available");
  const covered = byStatus("covered");

  const bulletById = new Map(bullets.map((b) => [b.id, b]));
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const printable = (b: BulletRow) =>
    (b.parentType === "job" ? selectedJobIds : selectedProjectIds).includes(b.parentId);

  const suggestion = (s: CoverageTerm["suggestions"][number]) => {
    if (s.kind === "bullet") {
      const bullet = bulletById.get(s.id);
      if (!bullet) return null;
      return (
        <li key={`b${s.id}`} className="flex items-start justify-between gap-2">
          <span className="text-[11px] text-gray-600 dark:text-gray-400">{clip(bullet.text)}</span>
          {printable(bullet) ? (
            <AddButton resumeId={resumeId} action="toggle_bullet" field="bulletId" id={s.id} />
          ) : (
            <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">(job not on this resume)</span>
          )}
        </li>
      );
    }
    const skill = skillById.get(s.id);
    if (!skill) return null;
    return (
      <li key={`s${s.id}`} className="flex items-start justify-between gap-2">
        <span className="text-[11px] text-gray-600 dark:text-gray-400">
          {clip(`${skill.category}: ${(skill.items as string[]).join(", ")}`)}
        </span>
        <AddButton resumeId={resumeId} action="toggle_skill" field="skillId" id={s.id} />
      </li>
    );
  };

  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Keyword coverage</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {coverage.coveredCount} of {coverage.total} posting terms covered
        </span>
      </div>
      {targets.length > 1 && (
        <select
          value={target.applicationId}
          onChange={(e) => setChosenId(Number(e.target.value))}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 py-0.5 text-xs text-gray-900 dark:text-gray-100"
        >
          {targets.map((t) => (
            <option key={t.applicationId} value={t.applicationId}>
              {t.jobTitle} — {t.companyName ?? "No company"}
            </option>
          ))}
        </select>
      )}
      {missing.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Missing</div>
          <Chips terms={missing} status="missing" />
        </div>
      )}
      {available.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">In your library</div>
          <ul className="space-y-1.5">
            {available.map((t) => (
              <li key={t.term} className="space-y-0.5">
                <Chips terms={[t]} status="available" />
                <ul className="space-y-0.5 pl-1">{t.suggestions.map(suggestion)}</ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {covered.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] font-medium text-gray-500 dark:text-gray-400">
            Covered ({covered.length})
          </summary>
          <div className="mt-1">
            <Chips terms={covered} status="covered" />
          </div>
        </details>
      )}
    </div>
  );
}
