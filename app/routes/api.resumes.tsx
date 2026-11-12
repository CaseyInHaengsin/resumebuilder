import { redirect } from "react-router";
import { db } from "~/db";
import {
  resumes,
  resumeJobs,
  resumeProjects,
  resumeBullets,
  resumeSkills,
  contact,
  jobs,
  projects,
  bullets,
  skills,
  summaries,
  companies,
} from "~/db/schema";
import { TEMPLATES } from "~/components/pdf/types";
import { and, eq, max } from "drizzle-orm";
import { requireUserId } from "~/lib/auth.server";
import type { Route } from "./+types/api.resumes";

/** Returns the resume row iff it belongs to userId. */
function ownedResume(id: number, userId: number) {
  return db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
    .get();
}

/** True iff the row with this id in an owned-by-user table belongs to userId. */
function owns(
  table:
    | typeof jobs
    | typeof projects
    | typeof bullets
    | typeof skills
    | typeof summaries
    | typeof companies,
  id: number,
  userId: number,
) {
  return !!db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, userId)))
    .get();
}

/** One past the highest sortOrder in this resume's join rows of one kind. */
function nextSortOrder(
  table:
    | typeof resumeJobs
    | typeof resumeProjects
    | typeof resumeBullets
    | typeof resumeSkills,
  resumeId: number,
) {
  const row = db
    .select({ top: max(table.sortOrder) })
    .from(table)
    .where(eq(table.resumeId, resumeId))
    .get();
  return (row?.top ?? -1) + 1;
}

const REORDER_KINDS = {
  jobs: { table: resumeJobs, column: resumeJobs.jobId },
  projects: { table: resumeProjects, column: resumeProjects.projectId },
  bullets: { table: resumeBullets, column: resumeBullets.bulletId },
  skills: { table: resumeSkills, column: resumeSkills.skillId },
} as const;

const NOT_FOUND = () => new Response("Not found", { status: 404 });

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const _action = form.get("_action") as string;

  if (_action === "create") {
    const name = (form.get("name") as string) || "Untitled Resume";
    const now = new Date().toISOString();
    const inserted = db
      .insert(resumes)
      .values({ userId, name, createdAt: now, updatedAt: now })
      .returning()
      .get();
    return redirect(`/builder/${inserted.id}`);
  }

  if (_action === "duplicate") {
    const sourceId = Number(form.get("id"));
    const source = ownedResume(sourceId, userId);
    if (!source) return new Response("Not found", { status: 404 });

    const now = new Date().toISOString();
    const copy = db
      .insert(resumes)
      .values({
        userId,
        name: `${source.name} (copy)`,
        summaryId: source.summaryId,
        companyId: source.companyId,
        template: source.template,
        useCustomContact: source.useCustomContact,
        contactName: source.contactName,
        contactPhone: source.contactPhone,
        contactEmail: source.contactEmail,
        contactLinkedin: source.contactLinkedin,
        contactGithub: source.contactGithub,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    const srcJobs = db
      .select()
      .from(resumeJobs)
      .where(eq(resumeJobs.resumeId, sourceId))
      .all();
    for (const r of srcJobs) {
      db.insert(resumeJobs)
        .values({ resumeId: copy.id, jobId: r.jobId, sortOrder: r.sortOrder })
        .run();
    }
    const srcProjects = db
      .select()
      .from(resumeProjects)
      .where(eq(resumeProjects.resumeId, sourceId))
      .all();
    for (const r of srcProjects) {
      db.insert(resumeProjects)
        .values({
          resumeId: copy.id,
          projectId: r.projectId,
          sortOrder: r.sortOrder,
        })
        .run();
    }
    const srcBullets = db
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, sourceId))
      .all();
    for (const r of srcBullets) {
      db.insert(resumeBullets)
        .values({
          resumeId: copy.id,
          bulletId: r.bulletId,
          sortOrder: r.sortOrder,
        })
        .run();
    }
    const srcSkills = db
      .select()
      .from(resumeSkills)
      .where(eq(resumeSkills.resumeId, sourceId))
      .all();
    for (const r of srcSkills) {
      db.insert(resumeSkills)
        .values({
          resumeId: copy.id,
          skillId: r.skillId,
          sortOrder: r.sortOrder,
        })
        .run();
    }

    return redirect(`/builder/${copy.id}`);
  }

  if (_action === "update") {
    const id = Number(form.get("id"));
    if (!ownedResume(id, userId))
      return new Response("Not found", { status: 404 });
    const name = form.get("name") as string;
    const summaryId = form.get("summaryId")
      ? Number(form.get("summaryId"))
      : null;
    db.update(resumes)
      .set({ name, summaryId, updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "delete") {
    const id = Number(form.get("id"));
    db.delete(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .run();
    return redirect("/builder");
  }

  if (_action === "toggle_job") {
    const resumeId = Number(form.get("resumeId"));
    if (!ownedResume(resumeId, userId))
      return new Response("Not found", { status: 404 });
    const jobId = Number(form.get("jobId"));
    if (!owns(jobs, jobId, userId)) return NOT_FOUND();
    const existing = db
      .select()
      .from(resumeJobs)
      .where(eq(resumeJobs.resumeId, resumeId))
      .all()
      .find((r) => r.jobId === jobId);
    if (existing) {
      db.delete(resumeJobs).where(eq(resumeJobs.id, existing.id)).run();
    } else {
      const next = nextSortOrder(resumeJobs, resumeId);
      db.insert(resumeJobs)
        .values({ resumeId, jobId, sortOrder: next })
        .run();
    }
    db.update(resumes)
      .set({ updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "toggle_project") {
    const resumeId = Number(form.get("resumeId"));
    if (!ownedResume(resumeId, userId))
      return new Response("Not found", { status: 404 });
    const projectId = Number(form.get("projectId"));
    if (!owns(projects, projectId, userId)) return NOT_FOUND();
    const existing = db
      .select()
      .from(resumeProjects)
      .where(eq(resumeProjects.resumeId, resumeId))
      .all()
      .find((r) => r.projectId === projectId);
    if (existing) {
      db.delete(resumeProjects)
        .where(eq(resumeProjects.id, existing.id))
        .run();
    } else {
      const next = nextSortOrder(resumeProjects, resumeId);
      db.insert(resumeProjects)
        .values({ resumeId, projectId, sortOrder: next })
        .run();
    }
    db.update(resumes)
      .set({ updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "toggle_bullet") {
    const resumeId = Number(form.get("resumeId"));
    if (!ownedResume(resumeId, userId))
      return new Response("Not found", { status: 404 });
    const bulletId = Number(form.get("bulletId"));
    if (!owns(bullets, bulletId, userId)) return NOT_FOUND();
    const existing = db
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, resumeId))
      .all()
      .find((r) => r.bulletId === bulletId);
    if (existing) {
      db.delete(resumeBullets)
        .where(eq(resumeBullets.id, existing.id))
        .run();
    } else {
      const next = nextSortOrder(resumeBullets, resumeId);
      db.insert(resumeBullets)
        .values({ resumeId, bulletId, sortOrder: next })
        .run();
    }
    db.update(resumes)
      .set({ updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "toggle_skill") {
    const resumeId = Number(form.get("resumeId"));
    if (!ownedResume(resumeId, userId))
      return new Response("Not found", { status: 404 });
    const skillId = Number(form.get("skillId"));
    if (!owns(skills, skillId, userId)) return NOT_FOUND();
    const existing = db
      .select()
      .from(resumeSkills)
      .where(eq(resumeSkills.resumeId, resumeId))
      .all()
      .find((r) => r.skillId === skillId);
    if (existing) {
      db.delete(resumeSkills).where(eq(resumeSkills.id, existing.id)).run();
    } else {
      const next = nextSortOrder(resumeSkills, resumeId);
      db.insert(resumeSkills)
        .values({ resumeId, skillId, sortOrder: next })
        .run();
    }
    db.update(resumes)
      .set({ updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "reorder") {
    const resumeId = Number(form.get("resumeId"));
    if (!ownedResume(resumeId, userId)) return NOT_FOUND();
    const kind = form.get("kind");
    const rawIds = form.get("ids");
    if (typeof kind !== "string" || !Object.hasOwn(REORDER_KINDS, kind))
      return new Response("Bad kind", { status: 400 });
    if (typeof rawIds !== "string" || rawIds === "")
      return new Response("Bad ids", { status: 400 });
    const parts = rawIds.split(",");
    if (!parts.every((p) => /^[1-9]\d*$/.test(p)))
      return new Response("Bad ids", { status: 400 });
    const ids = parts.map(Number);
    if (new Set(ids).size !== ids.length)
      return new Response("Duplicate ids", { status: 400 });

    const { table, column } = REORDER_KINDS[kind as keyof typeof REORDER_KINDS];
    const ok = db.transaction((tx) => {
      const rows = tx
        .select({ id: table.id, libraryId: column, sortOrder: table.sortOrder })
        .from(table)
        .where(eq(table.resumeId, resumeId))
        .all();
      const byLibraryId = new Map(rows.map((r) => [r.libraryId, r]));
      const listed = ids.map((id) => byLibraryId.get(id));
      if (listed.some((r) => !r)) return false;
      const slots = listed.map((r) => r!.sortOrder).sort((a, b) => a - b);
      listed.forEach((r, i) => {
        tx.update(table).set({ sortOrder: slots[i] }).where(eq(table.id, r!.id)).run();
      });
      tx.update(resumes)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(resumes.id, resumeId))
        .run();
      return true;
    });
    if (!ok) return new Response("Unknown ids", { status: 400 });
  }

  if (_action === "set_template") {
    const resumeId = Number(form.get("resumeId"));
    if (!ownedResume(resumeId, userId)) return NOT_FOUND();
    const template = form.get("template") as string;
    if (!TEMPLATES.some((t) => t.id === template))
      return new Response("Unknown template", { status: 400 });
    db.update(resumes)
      .set({ template, updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "set_summary") {
    const resumeId = Number(form.get("resumeId"));
    const summaryId = form.get("summaryId")
      ? Number(form.get("summaryId"))
      : null;
    if (!ownedResume(resumeId, userId)) return NOT_FOUND();
    if (summaryId !== null && !owns(summaries, summaryId, userId))
      return NOT_FOUND();
    db.update(resumes)
      .set({ summaryId, updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "set_company") {
    const resumeId = Number(form.get("resumeId"));
    const raw = form.get("companyId");
    const companyId = raw ? Number(raw) : null;
    if (!ownedResume(resumeId, userId)) return NOT_FOUND();
    if (companyId !== null && !owns(companies, companyId, userId))
      return NOT_FOUND();
    db.update(resumes)
      .set({ companyId, updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "toggle_custom_contact") {
    const resumeId = Number(form.get("resumeId"));
    const useCustomContact = form.get("useCustomContact") === "1";
    // On first enable, seed the override fields from the global contact row so
    // the user has sensible starting values to selectively redact.
    const resume = ownedResume(resumeId, userId);
    if (!resume) return new Response("Not found", { status: 404 });
    const set: Record<string, unknown> = {
      useCustomContact,
      updatedAt: new Date().toISOString(),
    };
    if (
      useCustomContact &&
      !resume.useCustomContact &&
      resume.contactName === null
    ) {
      const contactRow = db
        .select()
        .from(contact)
        .where(eq(contact.userId, userId))
        .get();
      if (contactRow) {
        set.contactName = contactRow.name;
        set.contactPhone = contactRow.phone;
        set.contactEmail = contactRow.email;
        set.contactLinkedin = contactRow.linkedin;
        set.contactGithub = contactRow.github;
      }
    }
    db.update(resumes)
      .set(set)
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  if (_action === "set_contact_field") {
    const resumeId = Number(form.get("resumeId"));
    const field = form.get("field") as string;
    const raw = form.get("value");
    const value = typeof raw === "string" ? raw : "";
    const allowed = new Set([
      "contactName",
      "contactPhone",
      "contactEmail",
      "contactLinkedin",
      "contactGithub",
    ]);
    if (!allowed.has(field))
      return new Response("Bad field", { status: 400 });
    if (!ownedResume(resumeId, userId)) return NOT_FOUND();
    db.update(resumes)
      .set({ [field]: value, updatedAt: new Date().toISOString() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .run();
  }

  return new Response("ok", { status: 200 });
}
