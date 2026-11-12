import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { and, eq, max } from "drizzle-orm";
import { db } from "~/db";
import { appToday } from "~/lib/dates";
import { getPublicUrl } from "~/lib/oauth.server";
import {
  snapshotOnApplied,
  snapshotResumeForApplication,
} from "~/lib/documents.server";
import {
  addApplicationEvent,
  recordStatusChange,
  USER_EVENT_TYPES,
} from "~/lib/timeline.server";
import {
  APPLICATION_STATUSES,
  applicationDocuments,
  applications,
  bullets,
  coverLetters,
  jobs,
  projects,
  skills,
} from "~/db/schema";

export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function registerWriteTools(server: McpServer, userId: number): void {
  server.registerTool(
    "update_application_status",
    {
      description:
        "Updates the status of an application. Valid statuses: wishlist, applied, interviewing, offer, accepted, rejected. A real change also adds a 'status' event ('Moved to <Status>') to the application's timeline. If the status moves out of 'wishlist' and appliedAt is unset, appliedAt is backfilled with today's date. Moving from 'wishlist' to 'applied' also saves a PDF copy of the linked resume and of the cover letter (when there is one) with the application (see get_application documents); if that copy cannot be made, the status still changes.",
      inputSchema: {
        id: z.number().int().positive(),
        status: z.enum(APPLICATION_STATUSES),
      },
    },
    async ({ id, status }) => {
      const existing = db
        .select()
        .from(applications)
        .where(and(eq(applications.id, id), eq(applications.userId, userId)))
        .get();
      if (!existing) return errorResult(`Application ${id} not found`);

      const patch: Record<string, unknown> = {
        status,
        updatedAt: new Date().toISOString(),
      };
      if (status !== "wishlist" && !existing.appliedAt) {
        patch.appliedAt = appToday();
      }
      db.update(applications)
        .set(patch)
        .where(and(eq(applications.id, id), eq(applications.userId, userId)))
        .run();
      if (existing.status !== status) recordStatusChange(userId, id, status);
      await snapshotOnApplied(userId, id, existing.status, status);
      const updated = db
        .select()
        .from(applications)
        .where(and(eq(applications.id, id), eq(applications.userId, userId)))
        .get();
      return jsonResult(updated);
    },
  );

  server.registerTool(
    "snapshot_application_resume",
    {
      description:
        "Saves a PDF copy of the resume linked to an application, rendered as the resume is right now, and stores it with the application as a record of what was sent. Later edits to the resume do not change the copy. Use it when the user says they sent or are about to send the resume. Each call stores a new copy. Fails if the application has no linked resume. Returns { id, fileName, url }; the url downloads the copy and needs the user to be signed in to the app in their browser.",
      inputSchema: {
        applicationId: z.number().int().positive(),
      },
    },
    async ({ applicationId }) => {
      let result;
      try {
        result = await snapshotResumeForApplication(userId, applicationId);
      } catch {
        return errorResult(
          `Could not save a PDF copy for application ${applicationId}. Try again later.`,
        );
      }
      if ("error" in result) {
        return result.error === "not_found"
          ? errorResult(`Application ${applicationId} not found`)
          : errorResult(
              `Application ${applicationId} has no linked resume. Link one of the user's resumes to it first.`,
            );
      }
      const row = db
        .select({ id: applicationDocuments.id, fileName: applicationDocuments.fileName })
        .from(applicationDocuments)
        .where(eq(applicationDocuments.id, result.id))
        .get();
      return jsonResult({
        id: result.id,
        fileName: row?.fileName,
        url: `${getPublicUrl()}/documents/${result.id}`,
      });
    },
  );

  server.registerTool(
    "save_cover_letter",
    {
      description:
        "Stores the full cover letter text, from greeting through sign-off, for one application, replacing any existing letter. Separate paragraphs with blank lines. The app adds the sender's header and the date itself when it renders the PDF, so the body should not repeat the sender's contact block or the date. 'recipient' is optional (for example 'Hiring Manager, Company') and is printed under the date. Returns { applicationId, updatedAt, url }; the url is a PDF link the signed-in user can open in their browser (it needs the user to be signed in to the app, so you cannot fetch it yourself). get_application returns the stored letter.",
      inputSchema: {
        applicationId: z.number().int().positive(),
        body: z.string(),
        recipient: z.string().optional(),
      },
    },
    async ({ applicationId, body, recipient }) => {
      const text = body.replace(/\r\n?/g, "\n").trim();
      if (!text) return errorResult("The cover letter body cannot be empty");
      const owned = db
        .select({ id: applications.id })
        .from(applications)
        .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
        .get();
      if (!owned) return errorResult(`Application ${applicationId} not found`);

      const to = recipient?.trim() || null;
      const now = new Date().toISOString();
      db.insert(coverLetters)
        .values({ userId, applicationId, recipient: to, body: text, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: coverLetters.applicationId,
          set: { recipient: to, body: text, updatedAt: now },
        })
        .run();
      return jsonResult({
        applicationId,
        updatedAt: now,
        url: `${getPublicUrl()}/api/applications/${applicationId}/cover-letter.pdf`,
      });
    },
  );

  server.registerTool(
    "add_application_event",
    {
      description:
        "Adds a dated event to an application's timeline: something that happened (an email, call, interview, offer, rejection, follow-up) or something scheduled for a future date. Use this, not append_application_note, whenever the thing has a date; append_application_note is for undated free-text notes. Types: note, email, call, interview, offer, rejection, follow_up, other ('status' events are written by the app on status changes). occurredAt is YYYY-MM-DD and defaults to today in the user's time zone. Give a title, a body, or both. networkContactId optionally links one of the user's network contacts. An email, call, interview or follow_up dated today or earlier moves the application's lastContactAt forward; an event dated after today sets nextStepAt when it is the nearest upcoming date. Returns { id, applicationId, type, occurredAt }; get_application lists the events.",
      inputSchema: {
        applicationId: z.number().int().positive(),
        type: z.enum(USER_EVENT_TYPES),
        occurredAt: z.string().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        networkContactId: z.number().int().positive().optional(),
      },
    },
    async ({ applicationId, type, occurredAt, title, body, networkContactId }) => {
      const result = addApplicationEvent(userId, {
        applicationId,
        type,
        occurredAt,
        title,
        body,
        networkContactId,
      });
      if (!result.ok) {
        return result.error === "not_found"
          ? errorResult(`Application ${applicationId} not found`)
          : errorResult(result.message);
      }
      const { event } = result;
      return jsonResult({
        id: event.id,
        applicationId: event.applicationId,
        type: event.type,
        occurredAt: event.occurredAt,
      });
    },
  );

  server.registerTool(
    "append_application_note",
    {
      description:
        "Appends a note to an application's free-text notes field, with an ISO timestamp header. Never overwrites prior content. For something that happened or is scheduled on a date (an email, call, interview, deadline), use add_application_event instead.",
      inputSchema: {
        id: z.number().int().positive(),
        note: z.string().trim().min(1),
      },
    },
    async ({ id, note }) => {
      const existing = db
        .select()
        .from(applications)
        .where(and(eq(applications.id, id), eq(applications.userId, userId)))
        .get();
      if (!existing) return errorResult(`Application ${id} not found`);

      const entry = `[${new Date().toISOString()}]\n${note}`;
      const nextNotes = existing.notes
        ? `${existing.notes}\n\n${entry}`
        : entry;
      db.update(applications)
        .set({ notes: nextNotes, updatedAt: new Date().toISOString() })
        .where(and(eq(applications.id, id), eq(applications.userId, userId)))
        .run();
      const updated = db
        .select()
        .from(applications)
        .where(and(eq(applications.id, id), eq(applications.userId, userId)))
        .get();
      return jsonResult(updated);
    },
  );

  server.registerTool(
    "add_skill",
    {
      description:
        "Creates a new skill group. 'category' is the broad bucket (e.g. 'Languages', 'Frameworks'); 'name' is the variant label (e.g. 'JS-first'); 'items' is the list of tech keywords. Rejects if a (category, name) pair already exists for this user — update that row from the app instead.",
      inputSchema: {
        category: z.string().min(1),
        name: z.string().min(1),
        items: z.array(z.string().min(1)).min(1),
      },
    },
    async ({ category, name, items }) => {
      const existing = db
        .select({ id: skills.id })
        .from(skills)
        .where(
          and(
            eq(skills.userId, userId),
            eq(skills.category, category),
            eq(skills.name, name),
          ),
        )
        .get();
      if (existing) {
        return errorResult(
          `Skill group (category=${category}, name=${name}) already exists as id=${existing.id}. Update that row instead.`,
        );
      }
      const nextSortOrderRow = db
        .select({ m: max(skills.sortOrder) })
        .from(skills)
        .where(eq(skills.userId, userId))
        .get();
      const sortOrder = (nextSortOrderRow?.m ?? -1) + 1;
      const inserted = db
        .insert(skills)
        .values({ userId, category, name, items, sortOrder })
        .returning()
        .get();
      return jsonResult(inserted);
    },
  );

  server.registerTool(
    "add_bullet",
    {
      description:
        "Adds a resume bullet to a job or project. Validates that the parent belongs to the authenticated user. 'tags' default to []; 'priority' defaults to 2 (1=high, 2=mid, 3=low).",
      inputSchema: {
        parentType: z.enum(["job", "project"]),
        parentId: z.number().int().positive(),
        text: z.string().min(1),
        tags: z.array(z.string()).optional(),
        priority: z.number().int().min(1).max(3).optional(),
      },
    },
    async ({ parentType, parentId, text, tags, priority }) => {
      const ownsParent =
        parentType === "job"
          ? !!db
              .select({ id: jobs.id })
              .from(jobs)
              .where(and(eq(jobs.id, parentId), eq(jobs.userId, userId)))
              .get()
          : !!db
              .select({ id: projects.id })
              .from(projects)
              .where(
                and(eq(projects.id, parentId), eq(projects.userId, userId)),
              )
              .get();
      if (!ownsParent) {
        return errorResult(`${parentType} ${parentId} not found`);
      }
      const nextSortOrderRow = db
        .select({ m: max(bullets.sortOrder) })
        .from(bullets)
        .where(
          and(
            eq(bullets.userId, userId),
            eq(bullets.parentType, parentType),
            eq(bullets.parentId, parentId),
          ),
        )
        .get();
      const sortOrder = (nextSortOrderRow?.m ?? -1) + 1;
      const inserted = db
        .insert(bullets)
        .values({
          userId,
          parentType,
          parentId,
          text,
          tags: tags ?? [],
          priority: priority ?? 2,
          sortOrder,
        })
        .returning()
        .get();
      return jsonResult(inserted);
    },
  );
}
