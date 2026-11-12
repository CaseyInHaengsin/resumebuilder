import { createUser, getDb, seedApplication, seedCompany, SEED_TIMESTAMP } from "../helpers/db";
import { formRequest, getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import {
  applicationById,
  eventById,
  eventsFor,
  NOW_ISO,
  seedEvent,
  seedNetworkContact,
  TODAY,
  TOMORROW,
  useDenverClock,
  YESTERDAY,
} from "../helpers/timeline";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

useDenverClock();

let userId: number;
let cookie: string;
let strangerId: number;
let strangerCookie: string;

beforeAll(async () => {
  userId = (await createUser()).id;
  cookie = await sessionCookie(userId);
  strangerId = (await createUser()).id;
  strangerCookie = await sessionCookie(strangerId);
});

/** Posts to the api.applications action as the signed-in user (or `as`). */
async function post(fields: Record<string, string | number>, as: string | undefined = cookie) {
  const { action } = await import("~/routes/api.applications");
  return run(action, formRequest("/api/applications", fields, as));
}

function addEvent(id: number, fields: Record<string, string | number>, as?: string) {
  return post({ _action: "add_event", id, ...fields }, as);
}

/** A 2xx or a redirect: the action accepted the request. */
function expectAccepted(result: unknown) {
  expect(statusOf(result)).toBeGreaterThanOrEqual(200);
  expect(statusOf(result)).toBeLessThan(400);
}

async function detail(applicationId: number, as: string = cookie) {
  const { loader } = await import("~/routes/applications.$id");
  return run(loader, getRequest(`/applications/${applicationId}`, as), {
    id: String(applicationId),
  });
}

describe("schema: application event types", () => {
  it("exports APPLICATION_EVENT_TYPES in the agreed order", async () => {
    const schema = (await getDb()).schema as Record<string, unknown>;
    expect(schema.APPLICATION_EVENT_TYPES).toEqual([
      "note", "status", "email", "call", "interview", "offer", "rejection", "follow_up", "other",
    ]);
  });
});

describe("api.applications add_event", () => {
  it("stores the event and bumps the application's updatedAt", async () => {
    const app = await seedApplication(userId);
    const contact = await seedNetworkContact(userId, "Priya Raman");

    const result = await addEvent(app.id, {
      type: "call",
      occurredAt: "2026-11-09",
      title: "  Recruiter screen ",
      body: "Talked through the role with Priya.\nNext: take-home exercise.",
      networkContactId: contact.id,
    });
    expectAccepted(result);

    const events = await eventsFor(app.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId,
      applicationId: app.id,
      type: "call",
      occurredAt: "2026-11-09",
      title: "Recruiter screen",
      body: "Talked through the role with Priya.\nNext: take-home exercise.",
      networkContactId: contact.id,
    });
    expect(events[0].createdAt).toBeTruthy();
    expect((await applicationById(app.id))?.updatedAt).toBe(NOW_ISO);
  });

  it.each([
    ["omitted", {}],
    ["blank", { occurredAt: "" }],
  ])("defaults occurredAt to today in APP_TIMEZONE when it is %s", async (_label, extra) => {
    const app = await seedApplication(userId);
    expectAccepted(await addEvent(app.id, { type: "note", title: "Read the engineering blog", ...extra }));
    const events = await eventsFor(app.id);
    expect(events.map((e) => e.occurredAt)).toEqual([TODAY]);
  });

  it("accepts a title without a body and a body without a title", async () => {
    const app = await seedApplication(userId);
    expectAccepted(await addEvent(app.id, { type: "note", title: "Title only" }));
    expectAccepted(await addEvent(app.id, { type: "note", title: "  ", body: "Body only" }));
    const events = await eventsFor(app.id);
    expect(events.map((e) => [e.title, e.body, e.networkContactId])).toEqual([
      ["Title only", null, null],
      [null, "Body only", null],
    ]);
  });

  it.each(["note", "email", "call", "interview", "offer", "rejection", "follow_up", "other"])(
    "accepts type %s",
    async (type) => {
      const app = await seedApplication(userId);
      expectAccepted(await addEvent(app.id, { type, occurredAt: YESTERDAY, title: `A ${type}` }));
      expect((await eventsFor(app.id)).map((e) => e.type)).toEqual([type]);
    },
  );

  it("returns 404 for another user's application and writes nothing", async () => {
    const theirs = await seedApplication(strangerId, { jobTitle: "Director of Engineering" });
    const result = await addEvent(theirs.id, { type: "interview", occurredAt: TODAY, title: "Sneaky" });
    expect(statusOf(result)).toBe(404);
    expect(await eventsFor(theirs.id)).toEqual([]);
    const row = await applicationById(theirs.id);
    expect(row?.updatedAt).toBe(SEED_TIMESTAMP);
    expect(row?.lastContactAt).toBeNull();
  });

  it("returns 404 for an application that does not exist", async () => {
    const result = await addEvent(987_654, { type: "note", title: "Nowhere" });
    expect(statusOf(result)).toBe(404);
    expect(await eventsFor(987_654)).toEqual([]);
  });

  describe("rejects with 400 and writes nothing", () => {
    const cases: [string, Record<string, string>][] = [
      ["an unknown type", { type: "meeting", title: "Coffee" }],
      ["a missing type", { title: "Coffee" }],
      ["type status, which only the system writes", { type: "status", title: "Moved to Offer" }],
      ["a date in another format", { type: "call", occurredAt: "11/10/2026", title: "Call" }],
      ["a date without zero padding", { type: "call", occurredAt: "2026-11-1", title: "Call" }],
      ["a date in words", { type: "call", occurredAt: "tomorrow", title: "Call" }],
      ["a date with month 13", { type: "call", occurredAt: "2026-13-01", title: "Call" }],
      ["a date that is not on the calendar", { type: "call", occurredAt: "2026-02-30", title: "Call" }],
      ["a timestamp instead of a date", { type: "call", occurredAt: "2026-11-10T09:00:00Z", title: "Call" }],
      ["no title and no body", { type: "note" }],
      ["a blank title and a blank body", { type: "email", title: "   ", body: " \n " }],
      ["a network contact that does not exist", { type: "call", title: "Call", networkContactId: "987654" }],
    ];

    it.each(cases)("%s", async (_label, fields) => {
      const app = await seedApplication(userId);
      const result = await addEvent(app.id, fields);
      expect(statusOf(result)).toBe(400);
      expect(await eventsFor(app.id)).toEqual([]);
      const row = await applicationById(app.id);
      expect(row?.updatedAt).toBe(SEED_TIMESTAMP);
      expect(row?.lastContactAt).toBeNull();
      expect(row?.nextStepAt).toBeNull();
    });

    it("a network contact that belongs to another user", async () => {
      const app = await seedApplication(userId);
      const theirContact = await seedNetworkContact(strangerId, "Tobias Okafor");
      const result = await addEvent(app.id, {
        type: "call",
        occurredAt: YESTERDAY,
        title: "Call",
        networkContactId: theirContact.id,
      });
      expect(statusOf(result)).toBe(400);
      expect(await eventsFor(app.id)).toEqual([]);
      expect((await applicationById(app.id))?.lastContactAt).toBeNull();
    });
  });

  // Passing guard: the action already requires a session.
  it("redirects to login when signed out", async () => {
    const app = await seedApplication(userId);
    const { action } = await import("~/routes/api.applications");
    const result = await run(
      action,
      formRequest("/api/applications", { _action: "add_event", id: app.id, type: "note", title: "Hi" }),
    );
    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toMatch(/^\/login/);
    expect((await applicationById(app.id))?.updatedAt).toBe(SEED_TIMESTAMP);
  });
});

describe("add_event: lastContactAt", () => {
  it.each(["email", "call", "interview", "follow_up"])(
    "a %s dated today sets lastContactAt and leaves nextStepAt alone",
    async (type) => {
      const app = await seedApplication(userId);
      expectAccepted(await addEvent(app.id, { type, occurredAt: TODAY, title: "Spoke with the team" }));
      const row = await applicationById(app.id);
      expect(row?.lastContactAt).toBe(TODAY);
      expect(row?.nextStepAt).toBeNull();
    },
  );

  it("a contact event with no date counts as today", async () => {
    const app = await seedApplication(userId, { lastContactAt: "2026-11-01" });
    expectAccepted(await addEvent(app.id, { type: "email", body: "Sent a thank-you note" }));
    expect((await applicationById(app.id))?.lastContactAt).toBe(TODAY);
  });

  it("keeps the later of the current value and the event date", async () => {
    const app = await seedApplication(userId, { lastContactAt: "2026-11-08" });

    expectAccepted(await addEvent(app.id, { type: "call", occurredAt: "2026-11-03", title: "Logged late" }));
    expect((await applicationById(app.id))?.lastContactAt).toBe("2026-11-08");

    expectAccepted(await addEvent(app.id, { type: "email", occurredAt: "2026-11-08", title: "Same day" }));
    expect((await applicationById(app.id))?.lastContactAt).toBe("2026-11-08");

    expectAccepted(await addEvent(app.id, { type: "email", occurredAt: YESTERDAY, title: "Follow-up sent" }));
    expect((await applicationById(app.id))?.lastContactAt).toBe(YESTERDAY);
  });

  it.each(["note", "offer", "rejection", "other"])(
    "a %s does not change lastContactAt",
    async (type) => {
      const app = await seedApplication(userId, { lastContactAt: "2026-11-01" });
      expectAccepted(await addEvent(app.id, { type, occurredAt: YESTERDAY, title: "Logged" }));
      const row = await applicationById(app.id);
      expect(row?.lastContactAt).toBe("2026-11-01");
      expect(row?.nextStepAt).toBeNull();
      expect(row?.updatedAt).toBe(NOW_ISO);
    },
  );

  it("a contact event dated after today does not change lastContactAt", async () => {
    const app = await seedApplication(userId, { lastContactAt: "2026-11-01" });
    expectAccepted(
      await addEvent(app.id, { type: "interview", occurredAt: "2026-11-18", title: "Onsite" }),
    );
    const row = await applicationById(app.id);
    expect(row?.lastContactAt).toBe("2026-11-01");
    expect(row?.nextStepAt).toBe("2026-11-18");
  });

  it("uses the Denver date, not the UTC date, to decide what is in the future", async () => {
    // TOMORROW is already "today" on a UTC clock.
    const app = await seedApplication(userId);
    expectAccepted(await addEvent(app.id, { type: "interview", occurredAt: TOMORROW, title: "Phone screen" }));
    const row = await applicationById(app.id);
    expect(row?.lastContactAt).toBeNull();
    expect(row?.nextStepAt).toBe(TOMORROW);
  });
});

describe("add_event: nextStepAt", () => {
  it.each([
    ["is empty", null, "2026-11-20"],
    ["is in the past", "2026-11-05", "2026-11-20"],
    ["was yesterday", YESTERDAY, "2026-11-20"],
    ["is later than the event", "2026-12-01", "2026-11-20"],
    ["is an earlier upcoming date", "2026-11-15", "2026-11-15"],
    ["is today", TODAY, TODAY],
    ["is the same date", "2026-11-20", "2026-11-20"],
  ])("an event on 2026-11-20 when nextStepAt %s", async (_label, before, after) => {
    const app = await seedApplication(userId, { nextStepAt: before });
    expectAccepted(await addEvent(app.id, { type: "note", occurredAt: "2026-11-20", title: "Offer deadline" }));
    const row = await applicationById(app.id);
    expect(row?.nextStepAt).toBe(after);
    expect(row?.lastContactAt).toBeNull();
  });

  it.each([
    ["today", TODAY],
    ["yesterday", YESTERDAY],
  ])("an event dated %s leaves nextStepAt alone, even a past one", async (_label, occurredAt) => {
    const empty = await seedApplication(userId);
    const past = await seedApplication(userId, { nextStepAt: "2026-11-05" });
    const upcoming = await seedApplication(userId, { nextStepAt: "2026-11-30" });
    for (const app of [empty, past, upcoming]) {
      expectAccepted(await addEvent(app.id, { type: "call", occurredAt, title: "Caught up" }));
    }
    expect((await applicationById(empty.id))?.nextStepAt).toBeNull();
    expect((await applicationById(past.id))?.nextStepAt).toBe("2026-11-05");
    expect((await applicationById(upcoming.id))?.nextStepAt).toBe("2026-11-30");
  });

  it("keeps pointing at the nearest upcoming event as more are added", async () => {
    const app = await seedApplication(userId);
    expectAccepted(await addEvent(app.id, { type: "interview", occurredAt: "2026-11-25", title: "Onsite" }));
    expect((await applicationById(app.id))?.nextStepAt).toBe("2026-11-25");
    expectAccepted(await addEvent(app.id, { type: "call", occurredAt: "2026-11-14", title: "Prep call" }));
    expect((await applicationById(app.id))?.nextStepAt).toBe("2026-11-14");
    expectAccepted(await addEvent(app.id, { type: "other", occurredAt: "2026-12-05", title: "Decision due" }));
    expect((await applicationById(app.id))?.nextStepAt).toBe("2026-11-14");
    expect((await applicationById(app.id))?.lastContactAt).toBeNull();
    expect(await eventsFor(app.id)).toHaveLength(3);
  });
});

describe("api.applications delete_event", () => {
  it("deletes the user's own event and leaves the others", async () => {
    const app = await seedApplication(userId);
    const keep = await seedEvent(userId, app.id, { title: "Keep me" });
    const drop = await seedEvent(userId, app.id, { title: "Drop me" });

    expectAccepted(await post({ _action: "delete_event", eventId: drop.id }));
    expect((await eventsFor(app.id)).map((e) => e.id)).toEqual([keep.id]);
  });

  it("does not recompute lastContactAt or nextStepAt", async () => {
    const app = await seedApplication(userId);
    expectAccepted(await addEvent(app.id, { type: "call", occurredAt: YESTERDAY, title: "Call" }));
    expectAccepted(await addEvent(app.id, { type: "interview", occurredAt: "2026-11-19", title: "Onsite" }));
    const events = await eventsFor(app.id);
    expect(events).toHaveLength(2);

    for (const e of events) {
      expectAccepted(await post({ _action: "delete_event", eventId: e.id }));
    }
    expect(await eventsFor(app.id)).toEqual([]);
    const row = await applicationById(app.id);
    expect(row?.lastContactAt).toBe(YESTERDAY);
    expect(row?.nextStepAt).toBe("2026-11-19");
  });

  it("returns 404 for another user's event and keeps it", async () => {
    const theirs = await seedApplication(strangerId);
    const event = await seedEvent(strangerId, theirs.id, { title: "Not yours" });
    const result = await post({ _action: "delete_event", eventId: event.id });
    expect(statusOf(result)).toBe(404);
    expect((await eventById(event.id))?.title).toBe("Not yours");
  });

  it("returns 404 for an event that does not exist", async () => {
    const app = await seedApplication(userId);
    const keep = await seedEvent(userId, app.id);
    expect(statusOf(await post({ _action: "delete_event", eventId: 987_654 }))).toBe(404);
    expect((await eventsFor(app.id)).map((e) => e.id)).toEqual([keep.id]);
  });
});

describe("status changes write a status event", () => {
  it.each([
    ["wishlist", "Moved to Wishlist"],
    ["applied", "Moved to Applied"],
    ["interviewing", "Moved to Interviewing"],
    ["offer", "Moved to Offer"],
    ["accepted", "Moved to Accepted"],
    ["rejected", "Moved to Rejected"],
  ])("set_status to %s adds '%s' dated today", async (status, title) => {
    const app = await seedApplication(userId, {
      status: status === "applied" ? "wishlist" : "applied",
      appliedAt: "2026-10-20",
    });
    expectAccepted(await post({ _action: "set_status", id: app.id, status }));

    const events = await eventsFor(app.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId,
      applicationId: app.id,
      type: "status",
      occurredAt: TODAY,
      title,
      body: null,
      networkContactId: null,
    });
    const row = await applicationById(app.id);
    expect(row?.status).toBe(status);
    // A status event is not contact and not a next step.
    expect(row?.lastContactAt).toBeNull();
    expect(row?.nextStepAt).toBeNull();
  });

  it("set_status to the current status adds nothing", async () => {
    const app = await seedApplication(userId, { status: "interviewing" });
    expectAccepted(await post({ _action: "set_status", id: app.id, status: "interviewing" }));
    expect(await eventsFor(app.id)).toEqual([]);
  });

  it("records each change in order", async () => {
    const app = await seedApplication(userId, { status: "wishlist" });
    for (const status of ["applied", "interviewing", "interviewing", "offer"]) {
      expectAccepted(await post({ _action: "set_status", id: app.id, status }));
    }
    expect((await eventsFor(app.id)).map((e) => e.title)).toEqual([
      "Moved to Applied",
      "Moved to Interviewing",
      "Moved to Offer",
    ]);
  });

  it("set_status on another user's application adds nothing and changes nothing", async () => {
    const theirs = await seedApplication(strangerId, { status: "applied" });
    await post({ _action: "set_status", id: theirs.id, status: "rejected" });
    expect(await eventsFor(theirs.id)).toEqual([]);
    expect((await applicationById(theirs.id))?.status).toBe("applied");
  });

  it("set_status with an unknown status adds nothing", async () => {
    const app = await seedApplication(userId);
    expect(statusOf(await post({ _action: "set_status", id: app.id, status: "ghosted" }))).toBe(400);
    expect(await eventsFor(app.id)).toEqual([]);
  });

  it("update adds an event when the status changes", async () => {
    const app = await seedApplication(userId, { status: "interviewing", jobTitle: "Platform Engineer" });
    expectAccepted(
      await post({ _action: "update", id: app.id, jobTitle: "Platform Engineer", status: "offer" }),
    );
    const events = await eventsFor(app.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId,
      type: "status",
      occurredAt: TODAY,
      title: "Moved to Offer",
      body: null,
    });
    expect((await applicationById(app.id))?.status).toBe("offer");
  });

  it("update adds nothing when the status is the same or not sent", async () => {
    const app = await seedApplication(userId, { status: "interviewing" });
    expectAccepted(
      await post({ _action: "update", id: app.id, jobTitle: "Renamed role", status: "interviewing" }),
    );
    expectAccepted(await post({ _action: "update", id: app.id, jobTitle: "Renamed again" }));
    expect(await eventsFor(app.id)).toEqual([]);
    const row = await applicationById(app.id);
    expect(row?.jobTitle).toBe("Renamed again");
    expect(row?.status).toBe("interviewing");
  });

  it("update on another user's application adds nothing and changes nothing", async () => {
    const theirs = await seedApplication(strangerId, { status: "applied", jobTitle: "Their role" });
    await post({ _action: "update", id: theirs.id, jobTitle: "Hijacked", status: "offer" });
    expect(await eventsFor(theirs.id)).toEqual([]);
    const row = await applicationById(theirs.id);
    expect(row?.status).toBe("applied");
    expect(row?.jobTitle).toBe("Their role");
  });

  it("create adds no event", async () => {
    const result = await post({ _action: "create", jobTitle: "Data Engineer", status: "interviewing" });
    const location = (result as Response).headers.get("Location") ?? "";
    const id = Number(location.match(/^\/applications\/(\d+)$/)?.[1]);
    expect(Number.isInteger(id)).toBe(true);
    expect(await eventsFor(id)).toEqual([]);
  });
});

describe("application detail loader: events", () => {
  type LoaderEvent = {
    id: number;
    type: string;
    occurredAt: string;
    title: string | null;
    body: string | null;
    networkContactId: number | null;
    contactName?: string | null;
  };
  type Detail = { app: { id: number }; events?: LoaderEvent[]; companies: unknown[]; resumes: unknown[] };

  it("returns the application's events newest first by date then id, with the contact's name", async () => {
    const app = await seedApplication(userId);
    const other = await seedApplication(userId, { jobTitle: "Another role" });
    const contact = await seedNetworkContact(userId, "Priya Raman");

    const first = await seedEvent(userId, app.id, { occurredAt: "2026-11-05", title: "Applied through the site" });
    const call = await seedEvent(userId, app.id, {
      type: "call",
      occurredAt: "2026-11-09",
      title: "Recruiter screen",
      body: "Thirty minutes",
      networkContactId: contact.id,
    });
    const sameDay = await seedEvent(userId, app.id, { type: "email", occurredAt: "2026-11-05", title: "Confirmation email" });
    const future = await seedEvent(userId, app.id, { type: "interview", occurredAt: "2026-11-20", title: "Onsite" });
    await seedEvent(userId, other.id, { occurredAt: "2026-11-10", title: "Belongs to the other application" });

    const data = (await detail(app.id)) as Detail;
    expect(data).not.toBeInstanceOf(Response);
    expect(
      data.events?.map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurredAt,
        title: e.title,
        body: e.body,
        networkContactId: e.networkContactId,
        contactName: e.contactName ?? null,
      })),
    ).toEqual([
      { id: future.id, type: "interview", occurredAt: "2026-11-20", title: "Onsite", body: null, networkContactId: null, contactName: null },
      { id: call.id, type: "call", occurredAt: "2026-11-09", title: "Recruiter screen", body: "Thirty minutes", networkContactId: contact.id, contactName: "Priya Raman" },
      { id: sameDay.id, type: "email", occurredAt: "2026-11-05", title: "Confirmation email", body: null, networkContactId: null, contactName: null },
      { id: first.id, type: "note", occurredAt: "2026-11-05", title: "Applied through the site", body: null, networkContactId: null, contactName: null },
    ]);
  });

  it("returns an empty list for an application with no events", async () => {
    const app = await seedApplication(userId);
    const data = (await detail(app.id)) as Detail;
    expect(data.events).toEqual([]);
  });

  it("shows events added through the action, including status changes", async () => {
    const app = await seedApplication(userId, { status: "applied" });
    await addEvent(app.id, { type: "email", occurredAt: YESTERDAY, title: "Sent portfolio" });
    await post({ _action: "set_status", id: app.id, status: "interviewing" });
    await addEvent(app.id, { type: "note", title: "Researched the team" });

    const data = (await detail(app.id)) as Detail;
    expect(data.events?.map((e) => [e.type, e.occurredAt, e.title])).toEqual([
      ["note", TODAY, "Researched the team"],
      ["status", TODAY, "Moved to Interviewing"],
      ["email", YESTERDAY, "Sent portfolio"],
    ]);
  });

  it("keeps an event when its network contact is deleted", async () => {
    const { db, schema } = await getDb();
    const app = await seedApplication(userId);
    const contact = await seedNetworkContact(userId, "Marisol Etxeberria");
    const event = await seedEvent(userId, app.id, { type: "call", networkContactId: contact.id });

    db.delete(schema.networkContacts).where(eq(schema.networkContacts.id, contact.id)).run();

    expect((await eventById(event.id))?.networkContactId).toBeNull();
    const data = (await detail(app.id)) as Detail;
    expect(data.events?.map((e) => [e.id, e.networkContactId, e.contactName ?? null])).toEqual([
      [event.id, null, null],
    ]);
  });

  it("deleting the application deletes its events", async () => {
    const app = await seedApplication(userId);
    const keepApp = await seedApplication(userId);
    const gone = await seedEvent(userId, app.id);
    const kept = await seedEvent(userId, keepApp.id);

    await post({ _action: "delete", id: app.id });

    expect(await applicationById(app.id)).toBeUndefined();
    expect(await eventById(gone.id)).toBeUndefined();
    expect((await eventById(kept.id))?.id).toBe(kept.id);
  });

  // Passing guards: behavior that must survive the change.
  it("still returns the application with the company and resume lists", async () => {
    const owner = await createUser();
    const company = await seedCompany(owner.id, "Quillfeather Labs");
    const app = await seedApplication(owner.id, { companyId: company.id });
    const data = (await detail(app.id, await sessionCookie(owner.id))) as Detail;
    expect(data.app.id).toBe(app.id);
    expect(data.companies).toEqual([{ id: company.id, name: "Quillfeather Labs" }]);
    expect(data.resumes).toEqual([]);
  });

  it("returns 404 for another user's application", async () => {
    const app = await seedApplication(userId);
    expect(statusOf(await detail(app.id, strangerCookie))).toBe(404);
  });
});
