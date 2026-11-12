import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  APPLICATION_EVENT_TYPES,
  applicationEvents,
  applications,
  networkContacts,
  type ApplicationEventType,
  type ApplicationStatus,
} from "~/db/schema";
import { appToday } from "~/lib/dates";

/** Event types a user (or Claude) may add. "status" is written only by the app. */
export const USER_EVENT_TYPES = APPLICATION_EVENT_TYPES.filter(
  (t): t is Exclude<ApplicationEventType, "status"> => t !== "status",
) as [Exclude<ApplicationEventType, "status">, ...Exclude<ApplicationEventType, "status">[]];

/** Types that count as contact with the employer and move lastContactAt forward. */
const CONTACT_TYPES: readonly string[] = ["email", "call", "interview", "follow_up"];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

export type AddEventInput = {
  applicationId: number;
  type: unknown;
  occurredAt?: string | null;
  title?: string | null;
  body?: string | null;
  networkContactId?: number | null;
};

export type AddEventResult =
  | { ok: true; event: typeof applicationEvents.$inferSelect }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "invalid"; message: string };

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t;
}

/**
 * Adds a user event to one of the user's applications and keeps the
 * application's dates in step: a contact event dated today or earlier moves
 * lastContactAt forward; a future-dated event pulls nextStepAt to the nearest
 * upcoming date. Nothing is written unless the input is valid.
 */
export function addApplicationEvent(userId: number, input: AddEventInput): AddEventResult {
  const app = db
    .select({
      id: applications.id,
      lastContactAt: applications.lastContactAt,
      nextStepAt: applications.nextStepAt,
    })
    .from(applications)
    .where(and(eq(applications.id, input.applicationId), eq(applications.userId, userId)))
    .get();
  if (!app) return { ok: false, error: "not_found" };

  const type = input.type;
  if (typeof type !== "string" || !(USER_EVENT_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      error: "invalid",
      message: `type must be one of: ${USER_EVENT_TYPES.join(", ")}`,
    };
  }

  const today = appToday();
  const occurredAt = clean(input.occurredAt) ?? today;
  if (!isCalendarDate(occurredAt)) {
    return { ok: false, error: "invalid", message: "occurredAt must be a date written as YYYY-MM-DD" };
  }

  const title = clean(input.title);
  const body = clean(input.body);
  if (!title && !body) {
    return { ok: false, error: "invalid", message: "Give the event a title or a body" };
  }

  const contactId = input.networkContactId ?? null;
  if (contactId != null) {
    const owned = db
      .select({ id: networkContacts.id })
      .from(networkContacts)
      .where(and(eq(networkContacts.id, contactId), eq(networkContacts.userId, userId)))
      .get();
    if (!owned) {
      return { ok: false, error: "invalid", message: `Network contact ${contactId} not found` };
    }
  }

  const now = new Date().toISOString();
  const patch: Partial<typeof applications.$inferInsert> = { updatedAt: now };
  if (CONTACT_TYPES.includes(type) && occurredAt <= today) {
    const current = app.lastContactAt;
    if (!current || !isCalendarDate(current) || occurredAt > current) {
      patch.lastContactAt = occurredAt;
    }
  }
  if (occurredAt > today) {
    const current = app.nextStepAt;
    const keep = current && isCalendarDate(current) && current >= today && current <= occurredAt;
    if (!keep) patch.nextStepAt = occurredAt;
  }

  const event = db.transaction((tx) => {
    const inserted = tx
      .insert(applicationEvents)
      .values({
        userId,
        applicationId: app.id,
        type: type as ApplicationEventType,
        occurredAt,
        title,
        body,
        networkContactId: contactId,
        createdAt: now,
      })
      .returning()
      .get();
    tx.update(applications)
      .set(patch)
      .where(and(eq(applications.id, app.id), eq(applications.userId, userId)))
      .run();
    return inserted;
  });
  return { ok: true, event };
}

/**
 * Records a status change as a `status` event dated today. Call it only after
 * the status really changed on one of the user's applications.
 */
export function recordStatusChange(
  userId: number,
  applicationId: number,
  status: ApplicationStatus,
): void {
  db.insert(applicationEvents)
    .values({
      userId,
      applicationId,
      type: "status",
      occurredAt: appToday(),
      title: `Moved to ${status.charAt(0).toUpperCase()}${status.slice(1)}`,
      body: null,
      networkContactId: null,
      createdAt: new Date().toISOString(),
    })
    .run();
}

/** Deletes one of the user's events. The application's dates are left as they are. */
export function deleteApplicationEvent(userId: number, eventId: number): boolean {
  const result = db
    .delete(applicationEvents)
    .where(and(eq(applicationEvents.id, eventId), eq(applicationEvents.userId, userId)))
    .run();
  return result.changes > 0;
}

/** An application's events, newest first by date then id, with the contact's name. */
export function listApplicationEvents(userId: number, applicationId: number) {
  return db
    .select({
      id: applicationEvents.id,
      type: applicationEvents.type,
      occurredAt: applicationEvents.occurredAt,
      title: applicationEvents.title,
      body: applicationEvents.body,
      networkContactId: applicationEvents.networkContactId,
      contactName: networkContacts.name,
      createdAt: applicationEvents.createdAt,
    })
    .from(applicationEvents)
    .leftJoin(networkContacts, eq(networkContacts.id, applicationEvents.networkContactId))
    .where(
      and(
        eq(applicationEvents.applicationId, applicationId),
        eq(applicationEvents.userId, userId),
      ),
    )
    .orderBy(desc(applicationEvents.occurredAt), desc(applicationEvents.id))
    .all();
}

export type ApplicationEventItem = ReturnType<typeof listApplicationEvents>[number];
