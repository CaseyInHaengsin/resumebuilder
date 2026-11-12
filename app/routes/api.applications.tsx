import { redirect } from "react-router";
import { db } from "~/db";
import {
  applications,
  companies,
  resumes,
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "~/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUserId } from "~/lib/auth.server";
import { appToday } from "~/lib/dates";
import {
  deleteApplication,
  deleteDocument,
  snapshotOnApplied,
  snapshotResumeForApplication,
} from "~/lib/documents.server";
import {
  addApplicationEvent,
  deleteApplicationEvent,
  recordStatusChange,
} from "~/lib/timeline.server";
import type { Route } from "./+types/api.applications";

function isStatus(s: unknown): s is ApplicationStatus {
  return (
    typeof s === "string" &&
    (APPLICATION_STATUSES as readonly string[]).includes(s)
  );
}

function strOrNull(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * A company or resume id from the form: null when blank (clears the link),
 * the id when it is one of the user's rows, "invalid" otherwise.
 */
function ownedId(
  form: FormData,
  key: "companyId" | "resumeId",
  userId: number,
): number | null | "invalid" {
  const v = form.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) return "invalid";
  const table = key === "companyId" ? companies : resumes;
  const row = db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, userId)))
    .get();
  return row ? id : "invalid";
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const _action = form.get("_action") as string;

  if (_action === "create") {
    const companyId = ownedId(form, "companyId", userId);
    const resumeId = ownedId(form, "resumeId", userId);
    if (companyId === "invalid") return new Response("Unknown company", { status: 400 });
    if (resumeId === "invalid") return new Response("Unknown resume", { status: 400 });
    const jobTitle = strOrNull(form, "jobTitle") ?? "Untitled Role";
    const statusRaw = form.get("status");
    const status = isStatus(statusRaw) ? statusRaw : "applied";
    const appliedAt =
      strOrNull(form, "appliedAt") ??
      (status === "wishlist" ? null : appToday());
    const now = new Date().toISOString();
    const inserted = db
      .insert(applications)
      .values({
        userId,
        companyId,
        resumeId,
        jobTitle,
        jobUrl: strOrNull(form, "jobUrl"),
        source: strOrNull(form, "source"),
        location: strOrNull(form, "location"),
        remote: form.get("remote") === "1",
        salaryRange: strOrNull(form, "salaryRange"),
        status,
        appliedAt,
        nextStepAt: strOrNull(form, "nextStepAt"),
        lastContactAt: strOrNull(form, "lastContactAt"),
        notes: strOrNull(form, "notes"),
        jobDescription: strOrNull(form, "jobDescription"),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: applications.id })
      .get();
    const redirectTo = strOrNull(form, "redirectTo");
    return redirect(redirectTo ?? `/applications/${inserted.id}`);
  }

  if (_action === "update") {
    const id = Number(form.get("id"));
    const companyId = ownedId(form, "companyId", userId);
    const resumeId = ownedId(form, "resumeId", userId);
    if (companyId === "invalid") return new Response("Unknown company", { status: 400 });
    if (resumeId === "invalid") return new Response("Unknown resume", { status: 400 });
    const statusRaw = form.get("status");
    const status = isStatus(statusRaw) ? statusRaw : undefined;
    const next: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      jobTitle: strOrNull(form, "jobTitle") ?? "Untitled Role",
      companyId,
      resumeId,
      jobUrl: strOrNull(form, "jobUrl"),
      source: strOrNull(form, "source"),
      location: strOrNull(form, "location"),
      remote: form.get("remote") === "1",
      salaryRange: strOrNull(form, "salaryRange"),
      appliedAt: strOrNull(form, "appliedAt"),
      nextStepAt: strOrNull(form, "nextStepAt"),
      lastContactAt: strOrNull(form, "lastContactAt"),
      notes: strOrNull(form, "notes"),
    };
    if (status) next.status = status;
    if (form.has("jobDescription"))
      next.jobDescription = strOrNull(form, "jobDescription");
    const before = db
      .select({ status: applications.status })
      .from(applications)
      .where(
        and(eq(applications.id, id), eq(applications.userId, userId)),
      )
      .get();
    db.update(applications)
      .set(next)
      .where(
        and(eq(applications.id, id), eq(applications.userId, userId)),
      )
      .run();
    if (before && status && status !== before.status)
      recordStatusChange(userId, id, status);
    return redirect(`/applications/${id}`);
  }

  if (_action === "set_status") {
    const id = Number(form.get("id"));
    const statusRaw = form.get("status");
    if (!isStatus(statusRaw))
      return new Response("Bad status", { status: 400 });
    const patch: Record<string, unknown> = {
      status: statusRaw,
      updatedAt: new Date().toISOString(),
    };
    const row = db
      .select({ status: applications.status, appliedAt: applications.appliedAt })
      .from(applications)
      .where(
        and(eq(applications.id, id), eq(applications.userId, userId)),
      )
      .get();
    // Convenience: if moving out of wishlist, set applied_at to today when unset.
    if (statusRaw !== "wishlist" && row && !row.appliedAt) {
      patch.appliedAt = appToday();
    }
    db.update(applications)
      .set(patch)
      .where(
        and(eq(applications.id, id), eq(applications.userId, userId)),
      )
      .run();
    if (row && row.status !== statusRaw) recordStatusChange(userId, id, statusRaw);
    // Keep a copy of the resume that went out. Never fails the status change.
    if (row) await snapshotOnApplied(userId, id, row.status, statusRaw);
    return new Response("ok");
  }

  if (_action === "add_event") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0)
      return new Response("Not found", { status: 404 });
    const contactRaw = strOrNull(form, "networkContactId");
    let networkContactId: number | null = null;
    if (contactRaw != null) {
      networkContactId = Number(contactRaw);
      if (!Number.isInteger(networkContactId) || networkContactId <= 0)
        return new Response("Unknown network contact", { status: 400 });
    }
    const result = addApplicationEvent(userId, {
      applicationId: id,
      type: form.get("type"),
      occurredAt: strOrNull(form, "occurredAt"),
      title: strOrNull(form, "title"),
      body: strOrNull(form, "body"),
      networkContactId,
    });
    if (!result.ok) {
      return result.error === "not_found"
        ? new Response("Not found", { status: 404 })
        : new Response(result.message, { status: 400 });
    }
    return { ok: true, eventId: result.event.id };
  }

  if (_action === "delete_event") {
    const eventId = Number(form.get("eventId"));
    if (!Number.isInteger(eventId) || eventId <= 0 || !deleteApplicationEvent(userId, eventId))
      return new Response("Not found", { status: 404 });
    return { ok: true };
  }

  if (_action === "snapshot_resume") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0)
      return new Response("Not found", { status: 404 });
    let result;
    try {
      result = await snapshotResumeForApplication(userId, id);
    } catch (err) {
      console.error(`[documents] snapshot for application ${id} failed:`, err);
      return new Response("Could not save the PDF", { status: 500 });
    }
    if ("error" in result) {
      return result.error === "not_found"
        ? new Response("Not found", { status: 404 })
        : new Response("Link a resume to this application first", { status: 400 });
    }
    return { ok: true, documentId: result.id };
  }

  if (_action === "delete_document") {
    const documentId = Number(form.get("documentId"));
    if (!Number.isInteger(documentId) || documentId <= 0)
      return new Response("Not found", { status: 404 });
    if (!(await deleteDocument(userId, documentId)))
      return new Response("Not found", { status: 404 });
    return { ok: true };
  }

  if (_action === "delete") {
    const id = Number(form.get("id"));
    await deleteApplication(userId, id);
    return redirect("/applications");
  }

  return new Response("Unknown action", { status: 400 });
}
