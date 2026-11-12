import { useLoaderData, useFetcher } from "react-router";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { db } from "~/db";
import {
  resumes,
  jobs,
  projects,
  bullets,
  summaries,
  skills,
  contact,
  education,
  resumeJobs,
  resumeProjects,
  resumeBullets,
  resumeSkills,
  companies,
  applications,
} from "~/db/schema";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { and, eq, asc, desc } from "drizzle-orm";
import type { Route } from "./+types/builder";
import type { ResumeData, TemplateId } from "~/components/pdf/ResumeDocument";
import { TEMPLATES } from "~/components/pdf/ResumeDocument";
import { requireUserId } from "~/lib/auth.server";
import { buildResumeData } from "~/lib/resume-data";
import { resumeFileName } from "~/lib/resume-file";
import { CoveragePanel } from "~/components/builder/CoveragePanel";

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const resumeId = Number(params.id);
  const resume = db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
    .get();
  if (!resume) throw new Response("Not found", { status: 404 });

  const allJobs = db
    .select()
    .from(jobs)
    .where(eq(jobs.userId, userId))
    .orderBy(asc(jobs.sortOrder))
    .all();
  const allProjects = db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(asc(projects.sortOrder))
    .all();
  const allBullets = db
    .select()
    .from(bullets)
    .where(eq(bullets.userId, userId))
    .orderBy(asc(bullets.sortOrder))
    .all();
  const allSummaries = db
    .select()
    .from(summaries)
    .where(eq(summaries.userId, userId))
    .all();
  const allSkills = db
    .select()
    .from(skills)
    .where(eq(skills.userId, userId))
    .orderBy(asc(skills.sortOrder))
    .all();
  const contactRow = db
    .select()
    .from(contact)
    .where(eq(contact.userId, userId))
    .get();
  const educationRow = db
    .select()
    .from(education)
    .where(eq(education.userId, userId))
    .get();
  const allCompanies = db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.userId, userId))
    .all();

  const coverageTargets = db
    .select({
      applicationId: applications.id,
      jobTitle: applications.jobTitle,
      companyName: companies.name,
      jobDescription: applications.jobDescription,
    })
    .from(applications)
    .leftJoin(companies, eq(applications.companyId, companies.id))
    .where(and(eq(applications.userId, userId), eq(applications.resumeId, resumeId)))
    .orderBy(desc(applications.updatedAt), desc(applications.id))
    .all()
    .flatMap((a) =>
      a.jobDescription?.trim() ? [{ ...a, jobDescription: a.jobDescription }] : [],
    );

  // Current selections
  const selectedJobs = db
    .select()
    .from(resumeJobs)
    .where(eq(resumeJobs.resumeId, resumeId))
    .orderBy(asc(resumeJobs.sortOrder), asc(resumeJobs.id))
    .all();
  const selectedProjects = db
    .select()
    .from(resumeProjects)
    .where(eq(resumeProjects.resumeId, resumeId))
    .orderBy(asc(resumeProjects.sortOrder), asc(resumeProjects.id))
    .all();
  const selectedBullets = db
    .select()
    .from(resumeBullets)
    .where(eq(resumeBullets.resumeId, resumeId))
    .orderBy(asc(resumeBullets.sortOrder), asc(resumeBullets.id))
    .all();
  const selectedSkills = db
    .select()
    .from(resumeSkills)
    .where(eq(resumeSkills.resumeId, resumeId))
    .orderBy(asc(resumeSkills.sortOrder), asc(resumeSkills.id))
    .all();

  return {
    resume,
    allJobs,
    allProjects,
    allBullets,
    allSummaries,
    allSkills,
    allCompanies,
    coverageTargets,
    contact: contactRow,
    education: educationRow,
    selectedJobIds: selectedJobs.map((r) => r.jobId),
    selectedProjectIds: selectedProjects.map((r) => r.projectId),
    selectedBulletIds: selectedBullets.map((r) => r.bulletId),
    selectedSkillIds: selectedSkills.map((r) => r.skillId),
  };
}

// ── Selector Components (inline for now, can extract later) ──

function ContactOverride({
  resumeId,
  useCustomContact,
  defaults,
  values,
}: {
  resumeId: number;
  useCustomContact: boolean;
  defaults: {
    name: string | null;
    phone: string | null;
    email: string | null;
    linkedin: string | null;
    github: string | null;
  };
  values: {
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    contactLinkedin: string | null;
    contactGithub: string | null;
  };
}) {
  const toggleFetcher = useFetcher();
  const fieldFetcher = useFetcher();
  // Optimistic toggle: reflect the submitting value while in flight
  const optimisticToggle = toggleFetcher.formData
    ? toggleFetcher.formData.get("useCustomContact") === "1"
    : useCustomContact;

  const fields: {
    key: keyof typeof values;
    label: string;
    defaultValue: string | null;
  }[] = [
    { key: "contactName", label: "Name", defaultValue: defaults.name },
    { key: "contactPhone", label: "Phone", defaultValue: defaults.phone },
    { key: "contactEmail", label: "Email", defaultValue: defaults.email },
    { key: "contactLinkedin", label: "LinkedIn", defaultValue: defaults.linkedin },
    { key: "contactGithub", label: "GitHub", defaultValue: defaults.github },
  ];

  return (
    <div className="mb-4 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
      <toggleFetcher.Form method="post" action="/api/resumes">
        <input type="hidden" name="_action" value="toggle_custom_contact" />
        <input type="hidden" name="resumeId" value={resumeId} />
        <input
          type="hidden"
          name="useCustomContact"
          value={optimisticToggle ? "0" : "1"}
        />
        <label className="flex items-center gap-2 cursor-pointer">
          <button
            type="submit"
            className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
              optimisticToggle
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-gray-300 dark:border-gray-600"
            }`}
          >
            {optimisticToggle && "✓"}
          </button>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Anonymize contact info
          </span>
        </label>
      </toggleFetcher.Form>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        Override personal details for this resume. Leave a field blank to hide it.
      </p>
      {optimisticToggle && (
        <div className="mt-3 space-y-2">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                {f.label}
              </label>
              <fieldFetcher.Form method="post" action="/api/resumes">
                <input type="hidden" name="_action" value="set_contact_field" />
                <input type="hidden" name="resumeId" value={resumeId} />
                <input type="hidden" name="field" value={f.key} />
                <input
                  name="value"
                  defaultValue={values[f.key] ?? ""}
                  placeholder={f.defaultValue ?? "(empty)"}
                  onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                  className="w-full rounded border px-2 py-1 text-xs dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                />
              </fieldFetcher.Form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyPicker({
  resumeId,
  companies,
  currentId,
}: {
  resumeId: number;
  companies: { id: number; name: string }[];
  currentId: number | null;
}) {
  const fetcher = useFetcher();
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        Target company
      </label>
      <fetcher.Form method="post" action="/api/resumes">
        <input type="hidden" name="_action" value="set_company" />
        <input type="hidden" name="resumeId" value={resumeId} />
        <select
          name="companyId"
          defaultValue={currentId ?? ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded border px-2 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white"
        >
          <option value="">-- None --</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </fetcher.Form>
      {companies.length === 0 && (
        <p className="mt-1 text-xs text-gray-500">
          No companies yet — add one under Companies to target a resume.
        </p>
      )}
    </div>
  );
}

function SummaryPicker({
  resumeId,
  summaries,
  currentId,
}: {
  resumeId: number;
  summaries: { id: number; name: string; text: string }[];
  currentId: number | null;
}) {
  const fetcher = useFetcher();
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        Summary
      </label>
      <fetcher.Form method="post" action="/api/resumes">
        <input type="hidden" name="_action" value="set_summary" />
        <input type="hidden" name="resumeId" value={resumeId} />
        <select
          name="summaryId"
          defaultValue={currentId ?? ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded border px-2 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white"
        >
          <option value="">-- None --</option>
          {summaries.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </fetcher.Form>
      {currentId && (
        <p className="mt-1 text-xs text-gray-500 line-clamp-2">
          {summaries.find((s) => s.id === currentId)?.text}
        </p>
      )}
    </div>
  );
}

type ReorderKind = "jobs" | "projects" | "bullets" | "skills";
type OnReorder = (kind: ReorderKind, ids: number[]) => void;

/** Puts the listed ids into the slots they already occupy, in the listed order (mirrors the server). */
function applyReorder(selected: number[], ids: number[]): number[] {
  const listed = new Set(ids);
  if (!ids.every((id) => selected.includes(id))) return selected;
  let next = 0;
  return selected.map((id) => (listed.has(id) ? ids[next++] : id));
}

/** Selected ids first (in resume order), then the rest in library order. */
function selectedFirst<T extends { id: number }>(rows: T[], selectedIds: number[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const selected = selectedIds.flatMap((id) => byId.get(id) ?? []);
  const chosen = new Set(selected.map((r) => r.id));
  return { selected, unselected: rows.filter((r) => !chosen.has(r.id)) };
}

/** Drag-and-drop scope for one list of selected rows. */
function SortableGroup({
  scope,
  kind,
  ids,
  onReorder,
  children,
}: {
  scope: string;
  kind: ReorderKind;
  ids: number[];
  onReorder: OnReorder;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    onReorder(kind, arrayMove(ids, from, to));
  };
  return (
    <DndContext
      id={scope}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** Wrapper for a selected row; hands the grip button to its render prop. */
function SortableRow({
  id,
  children,
}: {
  id: number;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const handle = (
    <button
      type="button"
      aria-label="Reorder"
      className="shrink-0 cursor-grab touch-none select-none px-0.5 text-xs leading-none text-gray-400 hover:text-gray-600 active:cursor-grabbing dark:hover:text-gray-200"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      {children(handle)}
    </div>
  );
}

function ToggleItem({
  resumeId,
  action,
  fieldName,
  itemId,
  selected,
  label,
  sublabel,
  handle,
  children,
}: {
  resumeId: number;
  action: string;
  fieldName: string;
  itemId: number;
  selected: boolean;
  label: string;
  sublabel?: string;
  handle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const fetcher = useFetcher();
  const isSelected = fetcher.formData
    ? !selected // optimistic toggle
    : selected;

  return (
    <div className={`rounded border px-3 py-2 ${isSelected ? "border-blue-300 bg-blue-50 dark:bg-blue-950 dark:border-blue-700" : "border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-700"}`}>
      <div className="flex items-center gap-2">
        {handle}
        <fetcher.Form method="post" action="/api/resumes">
          <input type="hidden" name="_action" value={action} />
          <input type="hidden" name="resumeId" value={resumeId} />
          <input type="hidden" name={fieldName} value={itemId} />
          <button
            type="submit"
            className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
              isSelected
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-gray-300 dark:border-gray-600"
            }`}
          >
            {isSelected && "✓"}
          </button>
        </fetcher.Form>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {label}
          </p>
          {sublabel && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {sublabel}
            </p>
          )}
        </div>
      </div>
      {isSelected && children && <div className="mt-2 ml-6">{children}</div>}
    </div>
  );
}

const priorityColors: Record<number, string> = {
  0: "bg-gray-200 text-gray-600",
  1: "bg-yellow-100 text-yellow-800",
  2: "bg-blue-100 text-blue-800",
  3: "bg-green-100 text-green-800",
};

function BulletToggle({
  resumeId,
  bullet,
  selected,
  handle,
}: {
  resumeId: number;
  bullet: { id: number; text: string; priority: number };
  selected: boolean;
  handle?: React.ReactNode;
}) {
  const fetcher = useFetcher();
  const isSelected = fetcher.formData ? !selected : selected;

  return (
    <div className="flex items-start gap-2 py-0.5">
      {handle}
      <fetcher.Form method="post" action="/api/resumes">
        <input type="hidden" name="_action" value="toggle_bullet" />
        <input type="hidden" name="resumeId" value={resumeId} />
        <input type="hidden" name="bulletId" value={bullet.id} />
        <button
          type="submit"
          className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${
            isSelected
              ? "bg-blue-600 border-blue-600 text-white"
              : "border-gray-300 dark:border-gray-600"
          }`}
        >
          {isSelected && "✓"}
        </button>
      </fetcher.Form>
      <span
        className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${priorityColors[bullet.priority] || priorityColors[0]}`}
      >
        P{bullet.priority}
      </span>
      <span className="text-xs text-gray-700 dark:text-gray-300 leading-tight">
        {bullet.text}
      </span>
    </div>
  );
}

/** Bullets of one job or project: selected first (draggable), then the rest. */
function BulletList({
  resumeId,
  scope,
  bullets,
  selectedBulletIds,
  onReorder,
}: {
  resumeId: number;
  scope: string;
  bullets: { id: number; text: string; priority: number }[];
  selectedBulletIds: number[];
  onReorder: OnReorder;
}) {
  const { selected, unselected } = selectedFirst(bullets, selectedBulletIds);
  return (
    <div className="space-y-0.5">
      <SortableGroup
        scope={scope}
        kind="bullets"
        ids={selected.map((b) => b.id)}
        onReorder={onReorder}
      >
        {selected.map((bullet) => (
          <SortableRow key={bullet.id} id={bullet.id}>
            {(handle) => (
              <BulletToggle resumeId={resumeId} bullet={bullet} selected handle={handle} />
            )}
          </SortableRow>
        ))}
      </SortableGroup>
      {unselected.map((bullet) => (
        <BulletToggle key={bullet.id} resumeId={resumeId} bullet={bullet} selected={false} />
      ))}
    </div>
  );
}

// ── Preview Panel ──

function PreviewPanel({ data, template }: { data: ResumeData; template: TemplateId }) {
  const [Viewer, setViewer] = useState<React.ComponentType<any> | null>(null);
  const [templates, setTemplates] = useState<Record<string, React.ComponentType<any>> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  useEffect(() => {
    Promise.all([
      import("@react-pdf/renderer"),
      import("~/components/pdf/templates"),
    ]).then(([pdf, tmpl]) => {
      setViewer(() => pdf.PDFViewer);
      setTemplates(tmpl.templateComponents);
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ width: Math.floor(width), height: Math.floor(height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const Doc = templates?.[template];

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      {Viewer && Doc && dims.width > 0 && dims.height > 0 ? (
        <Viewer
          width={dims.width}
          height={dims.height}
          showToolbar={false}
        >
          <Doc data={data} />
        </Viewer>
      ) : (
        <div className="text-gray-500 py-12 text-center">
          Loading PDF preview...
        </div>
      )}
    </div>
  );
}

// ── Export Button ──

function ExportButton({ data, filename, template }: { data: ResumeData; filename: string; template: TemplateId }) {
  const [ready, setReady] = useState(false);
  const [DownloadLink, setDownloadLink] = useState<React.ComponentType<any> | null>(null);
  const [templates, setTemplatesState] = useState<Record<string, React.ComponentType<any>> | null>(null);

  useEffect(() => {
    Promise.all([
      import("@react-pdf/renderer"),
      import("~/components/pdf/templates"),
    ]).then(([pdf, tmpl]) => {
      setDownloadLink(() => pdf.PDFDownloadLink);
      setTemplatesState(tmpl.templateComponents);
      setReady(true);
    });
  }, []);

  const DocComponent = templates?.[template];
  if (!ready || !DownloadLink || !DocComponent) return null;

  return (
    <DownloadLink
      document={<DocComponent data={data} />}
      fileName={filename}
      className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
    >
      {({ loading }: { loading: boolean }) =>
        loading ? "Generating..." : "Download PDF"
      }
    </DownloadLink>
  );
}

// ── Main Builder ──

export default function Builder() {
  const {
    resume,
    allJobs,
    allProjects,
    allBullets,
    allSummaries,
    allSkills,
    allCompanies,
    coverageTargets,
    contact: contactRow,
    education: educationRow,
    selectedJobIds: loadedJobIds,
    selectedProjectIds: loadedProjectIds,
    selectedBulletIds: loadedBulletIds,
    selectedSkillIds: loadedSkillIds,
  } = useLoaderData<typeof loader>();

  // Show a drop immediately; the loader arrays take over once the request settles.
  const reorderFetcher = useFetcher();
  const onReorder: OnReorder = (kind, ids) => {
    reorderFetcher.submit(
      { _action: "reorder", resumeId: String(resume.id), kind, ids: ids.join(",") },
      { method: "post", action: "/api/resumes" },
    );
  };
  const pending = reorderFetcher.formData;
  const pendingKind = pending?.get("kind");
  const pendingIds = String(pending?.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter(Boolean);
  const optimistic = (kind: ReorderKind, loaded: number[]) =>
    pending && pendingKind === kind ? applyReorder(loaded, pendingIds) : loaded;
  const selectedJobIds = optimistic("jobs", loadedJobIds);
  const selectedProjectIds = optimistic("projects", loadedProjectIds);
  const selectedBulletIds = optimistic("bullets", loadedBulletIds);
  const selectedSkillIds = optimistic("skills", loadedSkillIds);

  const getBullets = (parentType: string, parentId: number) =>
    allBullets.filter(
      (b) => b.parentType === parentType && b.parentId === parentId
    );

  const orderedJobs = selectedFirst(allJobs, selectedJobIds);
  const orderedProjects = selectedFirst(allProjects, selectedProjectIds);
  const orderedSkills = selectedFirst(allSkills, selectedSkillIds);

  const renderJob = (job: (typeof allJobs)[number], selected: boolean, handle?: React.ReactNode) => (
    <ToggleItem
      key={job.id}
      resumeId={resume.id}
      action="toggle_job"
      fieldName="jobId"
      itemId={job.id}
      selected={selected}
      label={job.title}
      sublabel={`${job.company} | ${job.dates}`}
      handle={handle}
    >
      <BulletList
        resumeId={resume.id}
        scope={`job-${job.id}-bullets`}
        bullets={getBullets("job", job.id)}
        selectedBulletIds={selectedBulletIds}
        onReorder={onReorder}
      />
    </ToggleItem>
  );
  const renderProject = (project: (typeof allProjects)[number], selected: boolean, handle?: React.ReactNode) => (
    <ToggleItem
      key={project.id}
      resumeId={resume.id}
      action="toggle_project"
      fieldName="projectId"
      itemId={project.id}
      selected={selected}
      label={project.name}
      sublabel={project.tech}
      handle={handle}
    >
      <BulletList
        resumeId={resume.id}
        scope={`project-${project.id}-bullets`}
        bullets={getBullets("project", project.id)}
        selectedBulletIds={selectedBulletIds}
        onReorder={onReorder}
      />
    </ToggleItem>
  );
  const renderSkill = (skill: (typeof allSkills)[number], selected: boolean, handle?: React.ReactNode) => (
    <ToggleItem
      key={skill.id}
      resumeId={resume.id}
      action="toggle_skill"
      fieldName="skillId"
      itemId={skill.id}
      selected={selected}
      label={skill.category}
      sublabel={`${skill.name}: ${(skill.items as string[]).join(", ")}`}
      handle={handle}
    />
  );

  // Build the ResumeData for preview from current selections
  const previewData: ResumeData = useMemo(
    () =>
      buildResumeData({
        resume,
        contact: contactRow,
        education: educationRow,
        summaries: allSummaries,
        jobs: allJobs,
        projects: allProjects,
        bullets: allBullets,
        skills: allSkills,
        selectedJobIds,
        selectedProjectIds,
        selectedBulletIds,
        selectedSkillIds,
      }),
    [
      resume,
      allJobs,
      allProjects,
      allBullets,
      allSummaries,
      allSkills,
      contactRow,
      educationRow,
      selectedJobIds,
      selectedProjectIds,
      selectedBulletIds,
      selectedSkillIds,
    ],
  );

  const fetcher = useFetcher();

  // Real page count, computed in the browser only. Stale or failed runs are dropped.
  const activeTemplate = (resume.template || "modern") as TemplateId;
  const [pageCount, setPageCount] = useState(1);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { countResumePages } = await import("~/lib/pdf-pages");
        const count = await countResumePages(activeTemplate, previewData);
        if (!cancelled) setPageCount(count);
      } catch {
        if (!cancelled) setPageCount(1);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeTemplate, previewData]);
  const templateName = TEMPLATES.find((t) => t.id === activeTemplate)?.name ?? activeTemplate;

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {/* Left: Selectors */}
      <div className="w-96 shrink-0 overflow-y-auto space-y-4 pr-2">
        {/* Resume name */}
        <div className="flex items-center gap-2 mb-2">
          <fetcher.Form method="post" action="/api/resumes" className="flex-1">
            <input type="hidden" name="_action" value="update" />
            <input type="hidden" name="id" value={resume.id} />
            <input type="hidden" name="summaryId" value={resume.summaryId ?? ""} />
            <input
              name="name"
              defaultValue={resume.name}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-full text-lg font-semibold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none text-gray-900 dark:text-white"
            />
          </fetcher.Form>
          <fetcher.Form method="post" action="/api/resumes">
            <input type="hidden" name="_action" value="duplicate" />
            <input type="hidden" name="id" value={resume.id} />
            <button
              type="submit"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Duplicate
            </button>
          </fetcher.Form>
          <ExportButton data={previewData} filename={resumeFileName(previewData.contact.name)} template={(resume.template || "modern") as TemplateId} />
        </div>

        {/* Template picker */}
        <div className="mb-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Template
          </label>
          <div className="flex gap-2">
            {TEMPLATES.map((t) => {
              const isActive = (resume.template || "modern") === t.id;
              return (
                <fetcher.Form key={t.id} method="post" action="/api/resumes">
                  <input type="hidden" name="_action" value="set_template" />
                  <input type="hidden" name="resumeId" value={resume.id} />
                  <input type="hidden" name="template" value={t.id} />
                  <button
                    type="submit"
                    className={`rounded px-3 py-1.5 text-xs font-medium border ${
                      isActive
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    {t.name}
                  </button>
                </fetcher.Form>
              );
            })}
          </div>
        </div>

        {pageCount > 1 && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-200">
            This resume is {pageCount} pages in the {templateName} template.
          </div>
        )}

        <CoveragePanel
          resumeId={resume.id}
          targets={coverageTargets}
          previewData={previewData}
          bullets={allBullets}
          skills={allSkills}
          selectedBulletIds={selectedBulletIds}
          selectedSkillIds={selectedSkillIds}
          selectedJobIds={selectedJobIds}
          selectedProjectIds={selectedProjectIds}
        />

        {/* Contact override (anonymization) */}
        <ContactOverride
          resumeId={resume.id}
          useCustomContact={resume.useCustomContact}
          defaults={{
            name: contactRow?.name ?? null,
            phone: contactRow?.phone ?? null,
            email: contactRow?.email ?? null,
            linkedin: contactRow?.linkedin ?? null,
            github: contactRow?.github ?? null,
          }}
          values={{
            contactName: resume.contactName,
            contactPhone: resume.contactPhone,
            contactEmail: resume.contactEmail,
            contactLinkedin: resume.contactLinkedin,
            contactGithub: resume.contactGithub,
          }}
        />

        {/* Target company */}
        <CompanyPicker
          resumeId={resume.id}
          companies={allCompanies}
          currentId={resume.companyId}
        />

        {/* Summary */}
        <SummaryPicker
          resumeId={resume.id}
          summaries={allSummaries}
          currentId={resume.summaryId}
        />

        {/* Jobs */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Jobs
          </h3>
          <div className="space-y-2">
            <SortableGroup scope="jobs" kind="jobs" ids={orderedJobs.selected.map((j) => j.id)} onReorder={onReorder}>
              {orderedJobs.selected.map((job) => (
                <SortableRow key={job.id} id={job.id}>
                  {(handle) => renderJob(job, true, handle)}
                </SortableRow>
              ))}
            </SortableGroup>
            {orderedJobs.unselected.map((job) => renderJob(job, false))}
          </div>
        </div>

        {/* Projects */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Projects
          </h3>
          <div className="space-y-2">
            <SortableGroup scope="projects" kind="projects" ids={orderedProjects.selected.map((p) => p.id)} onReorder={onReorder}>
              {orderedProjects.selected.map((project) => (
                <SortableRow key={project.id} id={project.id}>
                  {(handle) => renderProject(project, true, handle)}
                </SortableRow>
              ))}
            </SortableGroup>
            {orderedProjects.unselected.map((project) => renderProject(project, false))}
          </div>
        </div>

        {/* Skills */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Skills
          </h3>
          <div className="space-y-2">
            <SortableGroup scope="skills" kind="skills" ids={orderedSkills.selected.map((k) => k.id)} onReorder={onReorder}>
              {orderedSkills.selected.map((skill) => (
                <SortableRow key={skill.id} id={skill.id}>
                  {(handle) => renderSkill(skill, true, handle)}
                </SortableRow>
              ))}
            </SortableGroup>
            {orderedSkills.unselected.map((skill) => renderSkill(skill, false))}
          </div>
        </div>
      </div>

      {/* Right: PDF Preview */}
      <div className="flex-1 flex flex-col min-h-0 rounded-lg border border-gray-200 bg-gray-100 dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
        <div className="flex-1 min-h-0">
          <PreviewPanel data={previewData} template={(resume.template || "modern") as TemplateId} />
        </div>
      </div>
    </div>
  );
}
