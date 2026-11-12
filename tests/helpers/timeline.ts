/**
 * Helpers for the application timeline tests (phase 12).
 * Import `./db` (or `../helpers/db`) before this in every test file.
 */
import { getDb, SEED_TIMESTAMP } from "./db";
import { afterEach, beforeEach, vi } from "vitest";
import { asc, eq } from "drizzle-orm";

// 6:30pm on Nov 11 in Denver; already Nov 12 in UTC.
export const EVENING_IN_DENVER = new Date("2026-11-12T01:30:00Z");
export const NOW_ISO = "2026-11-12T01:30:00.000Z";
export const TODAY = "2026-11-11";
export const YESTERDAY = "2026-11-10";
/** Tomorrow in Denver, which is the date a UTC clock would call today. */
export const TOMORROW = "2026-11-12";

/** Fakes `Date` at EVENING_IN_DENVER with APP_TIMEZONE=America/Denver for each test in the file. */
export function useDenverClock(): void {
  const savedZone = process.env.APP_TIMEZONE;
  beforeEach(() => {
    process.env.APP_TIMEZONE = "America/Denver";
    // Only Date is faked, so better-sqlite3, cookie signing and the MCP
    // transport run on real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(EVENING_IN_DENVER);
  });
  afterEach(() => {
    vi.useRealTimers();
    if (savedZone === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = savedZone;
  });
}

export type EventRow = {
  id: number;
  userId: number;
  applicationId: number;
  type: string;
  occurredAt: string;
  title: string | null;
  body: string | null;
  networkContactId: number | null;
  createdAt: string;
};

/** The `applicationEvents` table from app/db/schema.ts. */
async function eventsTable() {
  const { db, schema } = await getDb();
  const table = (schema as Record<string, unknown>).applicationEvents;
  if (!table) {
    throw new Error("app/db/schema.ts does not export `applicationEvents` yet");
  }
  // Typed loosely: the table does not exist in the schema until phase 12 lands.
  return { db, table: table as any };
}

/** An application's events in insertion order. */
export async function eventsFor(applicationId: number): Promise<EventRow[]> {
  const { db, table } = await eventsTable();
  return db
    .select()
    .from(table)
    .where(eq(table.applicationId, applicationId))
    .orderBy(asc(table.id))
    .all() as EventRow[];
}

export async function eventById(id: number): Promise<EventRow | undefined> {
  const { db, table } = await eventsTable();
  return db.select().from(table).where(eq(table.id, id)).get() as EventRow | undefined;
}

export async function seedEvent(
  userId: number,
  applicationId: number,
  values: Partial<Omit<EventRow, "id" | "userId" | "applicationId">> = {},
): Promise<EventRow> {
  const { db, table } = await eventsTable();
  return db
    .insert(table)
    .values({
      userId,
      applicationId,
      type: "note",
      occurredAt: "2026-11-02",
      title: "Seeded event",
      body: null,
      networkContactId: null,
      createdAt: SEED_TIMESTAMP,
      ...values,
    })
    .returning()
    .get() as EventRow;
}

export async function seedNetworkContact(userId: number, name = "Priya Raman") {
  const { db, schema } = await getDb();
  return db
    .insert(schema.networkContacts)
    .values({ userId, name, createdAt: SEED_TIMESTAMP, updatedAt: SEED_TIMESTAMP })
    .returning()
    .get();
}

export async function applicationById(id: number) {
  const { db, schema } = await getDb();
  return db.select().from(schema.applications).where(eq(schema.applications.id, id)).get();
}
