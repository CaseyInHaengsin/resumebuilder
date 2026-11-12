import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { appToday } from "~/lib/dates";
import { getPublicUrl } from "~/lib/oauth.server";
import { TEMPLATES, type TemplateId } from "~/components/pdf/types";
import {
  APPLICATION_STATUSES,
  applications,
  bullets,
  companies,
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
import { errorResult, jsonResult } from "./writes";

// The tailoring loop: create the company and application for a posting, write a
// summary, assemble a resume from the library, and link it to the application.
// Every handler validates input and ownership before its first write, and does
// all of its writes in one transaction, so a refused call leaves nothing behind.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

const id = z.number().int().positive();
const idList = z.array(id);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");
const text = z.string().trim().min(1);
const template = z.enum(TEMPLATES.map((t) => t.id) as [TemplateId, ...TemplateId[]]);

const OWNED = {
  Job: jobs,
  Project: projects,
  Skill: skills,
  Bullet: bullets,
  Summary: summaries,
  Company: companies,
  Resume: resumes,
  Application: applications,
} as const;
type Owned = keyof typeof OWNED;

/** "<Thing> <id> not found" for the first id that is missing or not the user's. */
function notOwned(kind: Owned, ids: number[], userId: number): string | null {
  if (ids.length === 0) return null;
  const table = OWNED[kind];
  const found = new Set(
    db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.userId, userId), inArray(table.id, ids)))
      .all()
      .map((r) => r.id),
  );
  const missing = ids.find((i) => !found.has(i));
  return missing === undefined ? null : `${kind} ${missing} not found`;
}

function firstDuplicate(list: number[]): number | undefined {
  const seen = new Set<number>();
  for (const n of list) {
    if (seen.has(n)) return n;
    seen.add(n);
  }
  return undefined;
}

function applicationUrl(applicationId: number) {
  return `${getPublicUrl()}/applications/${applicationId}`;
}

function resumeUrl(resumeId: number) {
  return `${getPublicUrl()}/builder/${resumeId}`;
}

const companyFields = {
  tagline: z.string().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  size: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  values: z.string().optional(),
  culture: z.string().optional(),
  notableProjects: z.string().optional(),
  notes: z.string().optional(),
};
type CompanyFields = {
  [K in keyof typeof companyFields]?: z.infer<(typeof companyFields)[K]>;
};

/** The user's company whose name matches ignoring case and outer spaces, or a new one. */
function findOrCreateCompany(
  tx: Db,
  userId: number,
  rawName: string,
  fields: CompanyFields = {},
): { id: number; name: string; existing: boolean } {
  const name = rawName.trim();
  const key = name.toLowerCase();
  const match = tx
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.userId, userId))
    .all()
    .find((c) => c.name.trim().toLowerCase() === key);
  if (match) return { ...match, existing: true };

  const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  const now = new Date().toISOString();
  const inserted = tx
    .insert(companies)
    .values({
      userId,
      name,
      tagline: blank(fields.tagline),
      industry: blank(fields.industry),
      location: blank(fields.location),
      size: blank(fields.size),
      techStack: fields.techStack ?? [],
      values: blank(fields.values),
      culture: blank(fields.culture),
      notableProjects: blank(fields.notableProjects),
      notes: blank(fields.notes),
      recentNews: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: companies.id, name: companies.name })
    .get();
  return { ...inserted, existing: false };
}

type Selection = {
  jobIds: number[];
  projectIds: number[];
  skillIds: number[];
  bulletIds: number[];
};

/**
 * Checks a full resume selection: no duplicates, every id the user's, and every
 * bullet's job or project selected. Returns an error message or null.
 */
function checkSelection(sel: Selection, userId: number): string | null {
  const lists: [keyof Selection, Owned][] = [
    ["jobIds", "Job"],
    ["projectIds", "Project"],
    ["skillIds", "Skill"],
    ["bulletIds", "Bullet"],
  ];
  for (const [key] of lists) {
    const dup = firstDuplicate(sel[key]);
    if (dup !== undefined) return `${key} lists ${dup} more than once`;
  }
  for (const [key, kind] of lists) {
    const err = notOwned(kind, sel[key], userId);
    if (err) return err;
  }
  return parentRule(sel, userId);
}

function parentRule(sel: Selection, userId: number): string | null {
  if (sel.bulletIds.length === 0) return null;
  const jobSet = new Set(sel.jobIds);
  const projectSet = new Set(sel.projectIds);
  const rows = db
    .select({ id: bullets.id, parentType: bullets.parentType, parentId: bullets.parentId })
    .from(bullets)
    .where(and(eq(bullets.userId, userId), inArray(bullets.id, sel.bulletIds)))
    .all();
  for (const b of rows) {
    const covered =
      b.parentType === "job" ? jobSet.has(b.parentId) : projectSet.has(b.parentId);
    if (!covered) {
      const list = b.parentType === "job" ? "jobIds" : "projectIds";
      return `Bullet ${b.id} belongs to ${b.parentType} ${b.parentId}, which is not in ${list}. Include it or drop the bullet.`;
    }
  }
  return null;
}

const JOIN = {
  jobIds: { table: resumeJobs, column: "jobId" },
  projectIds: { table: resumeProjects, column: "projectId" },
  skillIds: { table: resumeSkills, column: "skillId" },
  bulletIds: { table: resumeBullets, column: "bulletId" },
} as const;

/** Replaces one of a resume's join lists with `ids`, sortOrder 0..n-1. */
function replaceList(tx: Tx, resumeId: number, key: keyof Selection, ids: number[]) {
  const { table, column } = JOIN[key];
  tx.delete(table).where(eq(table.resumeId, resumeId)).run();
  if (ids.length === 0) return;
  tx.insert(table)
    .values(ids.map((libraryId, sortOrder) => ({ resumeId, [column]: libraryId, sortOrder })) as never)
    .run();
}

/** A resume's current join list of one kind, in stored order. */
function currentList(resumeId: number, key: keyof Selection): number[] {
  const { table, column } = JOIN[key];
  const col = (table as typeof resumeJobs)[column as "jobId"];
  return db
    .select({ libraryId: col })
    .from(table as typeof resumeJobs)
    .where(eq(table.resumeId, resumeId))
    .orderBy(asc(table.sortOrder), asc(table.id))
    .all()
    .map((r) => r.libraryId);
}

export function registerTailoringTools(server: McpServer, userId: number): void {
  server.registerTool(
    "create_company",
    {
      description:
        "Finds or creates a company the user is targeting. If the user already has a company with this name (ignoring case and outer spaces), returns it with existing: true and changes nothing; otherwise creates it with the given research fields. Returns { id, name, existing }.",
      inputSchema: { name: text, ...companyFields },
    },
    async ({ name, ...fields }) => {
      const result = db.transaction((tx) => findOrCreateCompany(tx, userId, name, fields));
      return jsonResult(result);
    },
  );

  server.registerTool(
    "create_application",
    {
      description:
        "Creates a job application. Pass companyId (from list_companies or create_company) or companyName (finds or creates the company), not both. Store the posting text in jobDescription. status defaults to wishlist; any other status records today as the applied date. Dates are YYYY-MM-DD. Returns { id, jobTitle, status, companyId, url }.",
      inputSchema: {
        jobTitle: text,
        companyId: id.optional(),
        companyName: text.optional(),
        jobUrl: z.string().optional(),
        source: z.string().optional(),
        location: z.string().optional(),
        remote: z.boolean().optional(),
        salaryRange: z.string().optional(),
        status: z.enum(APPLICATION_STATUSES).optional(),
        jobDescription: z.string().optional(),
        notes: z.string().optional(),
        resumeId: id.optional(),
        nextStepAt: date.optional(),
      },
    },
    async (args) => {
      if (args.companyId !== undefined && args.companyName !== undefined) {
        return errorResult("Pass companyId or companyName, not both");
      }
      if (args.companyId !== undefined) {
        const err = notOwned("Company", [args.companyId], userId);
        if (err) return errorResult(err);
      }
      if (args.resumeId !== undefined) {
        const err = notOwned("Resume", [args.resumeId], userId);
        if (err) return errorResult(err);
      }

      const status = args.status ?? "wishlist";
      const inserted = db.transaction((tx) => {
        const companyId =
          args.companyName !== undefined
            ? findOrCreateCompany(tx, userId, args.companyName).id
            : (args.companyId ?? null);
        const now = new Date().toISOString();
        return tx
          .insert(applications)
          .values({
            userId,
            companyId,
            resumeId: args.resumeId ?? null,
            jobTitle: args.jobTitle,
            jobUrl: args.jobUrl ?? null,
            source: args.source ?? null,
            location: args.location ?? null,
            remote: args.remote ?? false,
            salaryRange: args.salaryRange ?? null,
            status,
            appliedAt: status === "wishlist" ? null : appToday(),
            nextStepAt: args.nextStepAt ?? null,
            jobDescription: args.jobDescription ?? null,
            notes: args.notes ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
      });
      return jsonResult({
        id: inserted.id,
        jobTitle: inserted.jobTitle,
        status: inserted.status,
        companyId: inserted.companyId,
        url: applicationUrl(inserted.id),
      });
    },
  );

  server.registerTool(
    "update_application",
    {
      description:
        "Changes details of an existing application; only the fields you pass change. Pass null for companyId or resumeId to unlink. Use this to link a tailored resume. Status and notes are not changed here: use update_application_status and append_application_note. Dates are YYYY-MM-DD.",
      inputSchema: {
        applicationId: id,
        jobTitle: text.optional(),
        companyId: id.nullable().optional(),
        resumeId: id.nullable().optional(),
        jobUrl: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        remote: z.boolean().optional(),
        salaryRange: z.string().nullable().optional(),
        jobDescription: z.string().nullable().optional(),
        nextStepAt: date.nullable().optional(),
        lastContactAt: date.nullable().optional(),
      },
    },
    async ({ applicationId, ...fields }) => {
      const appErr = notOwned("Application", [applicationId], userId);
      if (appErr) return errorResult(appErr);

      const patch = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Partial<typeof applications.$inferInsert>;
      if (Object.keys(patch).length === 0) {
        return errorResult(
          "Nothing to update: pass at least one field to change. Status and notes have their own tools.",
        );
      }
      if (patch.companyId != null) {
        const err = notOwned("Company", [patch.companyId], userId);
        if (err) return errorResult(err);
      }
      if (patch.resumeId != null) {
        const err = notOwned("Resume", [patch.resumeId], userId);
        if (err) return errorResult(err);
      }

      const updated = db
        .update(applications)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
        .returning()
        .get();
      return jsonResult({
        id: updated.id,
        jobTitle: updated.jobTitle,
        status: updated.status,
        companyId: updated.companyId,
        url: applicationUrl(updated.id),
      });
    },
  );

  server.registerTool(
    "add_summary",
    {
      description:
        "Saves a new resume summary paragraph to the user's library, for example one tailored to a posting. 'name' is a short label such as 'Fernhill focus'. Use the returned id as summaryId in create_resume or update_resume. Returns { id, name }.",
      inputSchema: { name: text, text },
    },
    async ({ name, text: body }) => {
      const inserted = db
        .insert(summaries)
        .values({ userId, name, text: body })
        .returning({ id: summaries.id, name: summaries.name })
        .get();
      return jsonResult(inserted);
    },
  );

  server.registerTool(
    "create_resume",
    {
      description:
        "Creates a resume from the user's library. Take ids from list_jobs, list_projects, list_bullets_for, get_skills, list_summaries and list_companies. Array order is the order on the page. Every bullet's job or project must also be listed. template: modern (default), classic or minimal. Returns { id, name, url }.",
      inputSchema: {
        name: text,
        template: template.optional(),
        summaryId: id.optional(),
        companyId: id.optional(),
        jobIds: idList,
        projectIds: idList.optional(),
        skillIds: idList.optional(),
        bulletIds: idList,
      },
    },
    async (args) => {
      const sel: Selection = {
        jobIds: args.jobIds,
        projectIds: args.projectIds ?? [],
        skillIds: args.skillIds ?? [],
        bulletIds: args.bulletIds,
      };
      const err =
        checkSelection(sel, userId) ??
        (args.summaryId !== undefined ? notOwned("Summary", [args.summaryId], userId) : null) ??
        (args.companyId !== undefined ? notOwned("Company", [args.companyId], userId) : null);
      if (err) return errorResult(err);

      const created = db.transaction((tx) => {
        const now = new Date().toISOString();
        const row = tx
          .insert(resumes)
          .values({
            userId,
            name: args.name,
            template: args.template ?? "modern",
            summaryId: args.summaryId ?? null,
            companyId: args.companyId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: resumes.id, name: resumes.name })
          .get();
        for (const key of Object.keys(JOIN) as (keyof Selection)[]) {
          replaceList(tx, row.id, key, sel[key]);
        }
        return row;
      });
      return jsonResult({ ...created, url: resumeUrl(created.id) });
    },
  );

  server.registerTool(
    "update_resume",
    {
      description:
        "Edits an existing resume; only what you pass changes. Each id list you pass replaces that whole list, in page order. After the change every selected bullet's job or project must still be selected, so drop bullets with their job. Pass null to clear summaryId or companyId. Returns { id, name, url }.",
      inputSchema: {
        resumeId: id,
        name: text.optional(),
        template: template.optional(),
        summaryId: id.nullable().optional(),
        companyId: id.nullable().optional(),
        jobIds: idList.optional(),
        projectIds: idList.optional(),
        skillIds: idList.optional(),
        bulletIds: idList.optional(),
      },
    },
    async ({ resumeId, name, template: tpl, summaryId, companyId, ...lists }) => {
      const resumeErr = notOwned("Resume", [resumeId], userId);
      if (resumeErr) return errorResult(resumeErr);

      const given = (Object.keys(JOIN) as (keyof Selection)[]).filter(
        (k) => lists[k] !== undefined,
      );
      const patch: Partial<typeof resumes.$inferInsert> = {};
      if (name !== undefined) patch.name = name;
      if (tpl !== undefined) patch.template = tpl;
      if (summaryId !== undefined) patch.summaryId = summaryId;
      if (companyId !== undefined) patch.companyId = companyId;
      if (Object.keys(patch).length === 0 && given.length === 0) {
        return errorResult("Nothing to update: pass at least one field or list to change.");
      }

      if (given.length > 0) {
        const sel = {} as Selection;
        for (const k of Object.keys(JOIN) as (keyof Selection)[]) {
          sel[k] = lists[k] ?? currentList(resumeId, k);
        }
        // Lists already on the resume were valid when stored; only check what is new.
        for (const k of given) {
          const dup = firstDuplicate(sel[k]);
          if (dup !== undefined) return errorResult(`${k} lists ${dup} more than once`);
        }
        const kinds: Record<keyof Selection, Owned> = {
          jobIds: "Job",
          projectIds: "Project",
          skillIds: "Skill",
          bulletIds: "Bullet",
        };
        for (const k of given) {
          const err = notOwned(kinds[k], sel[k], userId);
          if (err) return errorResult(err);
        }
        const err = parentRule(sel, userId);
        if (err) return errorResult(err);
      }
      if (summaryId != null) {
        const err = notOwned("Summary", [summaryId], userId);
        if (err) return errorResult(err);
      }
      if (companyId != null) {
        const err = notOwned("Company", [companyId], userId);
        if (err) return errorResult(err);
      }

      const updated = db.transaction((tx) => {
        for (const k of given) replaceList(tx, resumeId, k, lists[k]!);
        return tx
          .update(resumes)
          .set({ ...patch, updatedAt: new Date().toISOString() })
          .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
          .returning({ id: resumes.id, name: resumes.name })
          .get();
      });
      return jsonResult({ ...updated, url: resumeUrl(updated.id) });
    },
  );
}
