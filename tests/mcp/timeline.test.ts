import { createUser, seedApplication, seedCompany, SEED_TIMESTAMP } from "../helpers/db";
import { expectNotFound, expectRefused, mcpSession, okJson } from "../helpers/mcp";
import {
  applicationById,
  eventsFor,
  NOW_ISO,
  seedEvent,
  seedNetworkContact,
  TODAY,
  TOMORROW,
  useDenverClock,
  YESTERDAY,
} from "../helpers/timeline";
import { describe, expect, it } from "vitest";

useDenverClock();

const ADD = "add_application_event";
const MISSING_ID = 987_654;

type Row = Record<string, unknown>;

describe("MCP add_application_event: scope", () => {
  it("is listed for the write scope", async () => {
    const user = await createUser();
    expect((await mcpSession(user.id, ["mcp:write"])).toolNames).toContain(ADD);
    expect((await mcpSession(user.id)).toolNames).toContain(ADD);
  });

  // Passing guard today (the tool is not registered anywhere yet).
  it("is not listed for a read-only token", async () => {
    const user = await createUser();
    const readOnly = await mcpSession(user.id, ["mcp:read"]);
    expect(readOnly.toolNames).not.toContain(ADD);
    expect(readOnly.toolNames).toContain("get_application");
  });
});

describe("MCP add_application_event", () => {
  it("stores the event, returns its id, application, type and date, and bumps updatedAt", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id);
    const contact = await seedNetworkContact(user.id, "Priya Raman");
    const mcp = await mcpSession(user.id, ["mcp:write"]);

    const result = okJson(
      await mcp.call(ADD, {
        applicationId: app.id,
        type: "interview",
        occurredAt: "2026-11-18",
        title: "Onsite loop",
        body: "Four interviews, system design first.",
        networkContactId: contact.id,
      }),
    );

    const events = await eventsFor(app.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: user.id,
      applicationId: app.id,
      type: "interview",
      occurredAt: "2026-11-18",
      title: "Onsite loop",
      body: "Four interviews, system design first.",
      networkContactId: contact.id,
    });
    expect(result).toEqual({
      id: events[0].id,
      applicationId: app.id,
      type: "interview",
      occurredAt: "2026-11-18",
    });

    const row = await applicationById(app.id);
    expect(row?.updatedAt).toBe(NOW_ISO);
    expect(row?.nextStepAt).toBe("2026-11-18");
    expect(row?.lastContactAt).toBeNull();
  });

  it("defaults occurredAt to today in APP_TIMEZONE and records contact", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id, { lastContactAt: "2026-11-01" });
    const mcp = await mcpSession(user.id);

    const result = okJson(
      await mcp.call(ADD, { applicationId: app.id, type: "email", body: "Sent a thank-you note." }),
    );
    expect(result.occurredAt).toBe(TODAY);
    const events = await eventsFor(app.id);
    expect(events.map((e) => [e.type, e.occurredAt, e.title, e.body])).toEqual([
      ["email", TODAY, null, "Sent a thank-you note."],
    ]);
    const row = await applicationById(app.id);
    expect(row?.lastContactAt).toBe(TODAY);
    expect(row?.nextStepAt).toBeNull();
  });

  it("keeps the later lastContactAt and ignores non-contact types", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id, { lastContactAt: "2026-11-08" });
    const mcp = await mcpSession(user.id);

    okJson(await mcp.call(ADD, { applicationId: app.id, type: "call", occurredAt: "2026-11-03", title: "Logged late" }));
    expect((await applicationById(app.id))?.lastContactAt).toBe("2026-11-08");

    okJson(await mcp.call(ADD, { applicationId: app.id, type: "note", occurredAt: YESTERDAY, title: "Read their blog" }));
    okJson(await mcp.call(ADD, { applicationId: app.id, type: "offer", occurredAt: YESTERDAY, title: "Verbal offer" }));
    expect((await applicationById(app.id))?.lastContactAt).toBe("2026-11-08");

    okJson(await mcp.call(ADD, { applicationId: app.id, type: "follow_up", occurredAt: YESTERDAY, title: "Nudged recruiter" }));
    const row = await applicationById(app.id);
    expect(row?.lastContactAt).toBe(YESTERDAY);
    expect(row?.nextStepAt).toBeNull();
    expect(await eventsFor(app.id)).toHaveLength(4);
  });

  it.each([
    ["is empty", null, "2026-11-20"],
    ["is in the past", "2026-11-05", "2026-11-20"],
    ["is later than the event", "2026-12-01", "2026-11-20"],
    ["is an earlier upcoming date", "2026-11-15", "2026-11-15"],
    ["is today", TODAY, TODAY],
  ])("an event on 2026-11-20 when nextStepAt %s", async (_label, before, after) => {
    const user = await createUser();
    const app = await seedApplication(user.id, { nextStepAt: before });
    const mcp = await mcpSession(user.id);
    okJson(await mcp.call(ADD, { applicationId: app.id, type: "call", occurredAt: "2026-11-20", title: "Hiring manager call" }));
    const row = await applicationById(app.id);
    expect(row?.nextStepAt).toBe(after);
    expect(row?.lastContactAt).toBeNull();
  });

  it("treats tomorrow in Denver as upcoming even though UTC is already there", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id);
    const mcp = await mcpSession(user.id);
    okJson(await mcp.call(ADD, { applicationId: app.id, type: "interview", occurredAt: TOMORROW, title: "Phone screen" }));
    const row = await applicationById(app.id);
    expect(row?.lastContactAt).toBeNull();
    expect(row?.nextStepAt).toBe(TOMORROW);
  });

  it("reports an application that is missing or someone else's as not found", async () => {
    const user = await createUser();
    const stranger = await createUser();
    const theirs = await seedApplication(stranger.id);
    const mcp = await mcpSession(user.id);

    expectNotFound(
      await mcp.call(ADD, { applicationId: theirs.id, type: "call", occurredAt: TODAY, title: "Sneaky" }),
      theirs.id,
    );
    expectNotFound(
      await mcp.call(ADD, { applicationId: MISSING_ID, type: "note", title: "Nowhere" }),
      MISSING_ID,
    );
    expect(await eventsFor(theirs.id)).toEqual([]);
    const row = await applicationById(theirs.id);
    expect(row?.updatedAt).toBe(SEED_TIMESTAMP);
    expect(row?.lastContactAt).toBeNull();
  });

  describe("refuses and writes nothing", () => {
    const cases: [string, Row][] = [
      ["type status, which only the system writes", { type: "status", title: "Moved to Offer" }],
      ["an unknown type", { type: "meeting", title: "Coffee" }],
      ["a missing type", { title: "Coffee" }],
      ["a date in another format", { type: "call", occurredAt: "11/10/2026", title: "Call" }],
      ["a date that is not on the calendar", { type: "call", occurredAt: "2026-02-30", title: "Call" }],
      ["a timestamp instead of a date", { type: "call", occurredAt: "2026-11-10T09:00:00Z", title: "Call" }],
      ["no title and no body", { type: "note" }],
      ["a blank title and a blank body", { type: "email", title: "   ", body: " \n " }],
      ["a network contact that does not exist", { type: "call", title: "Call", networkContactId: MISSING_ID }],
    ];

    it.each(cases)("%s", async (_label, args) => {
      const user = await createUser();
      const app = await seedApplication(user.id);
      const mcp = await mcpSession(user.id);
      expectRefused(await mcp.call(ADD, { applicationId: app.id, ...args }));
      expect(await eventsFor(app.id)).toEqual([]);
      const row = await applicationById(app.id);
      expect(row?.updatedAt).toBe(SEED_TIMESTAMP);
      expect(row?.lastContactAt).toBeNull();
      expect(row?.nextStepAt).toBeNull();
    });

    it("a network contact that belongs to another user", async () => {
      const user = await createUser();
      const stranger = await createUser();
      const app = await seedApplication(user.id);
      const theirContact = await seedNetworkContact(stranger.id, "Tobias Okafor");
      const mcp = await mcpSession(user.id);
      const outcome = await mcp.call(ADD, {
        applicationId: app.id,
        type: "call",
        occurredAt: YESTERDAY,
        title: "Call",
        networkContactId: theirContact.id,
      });
      expectRefused(outcome);
      expect(outcome.text).not.toContain("Tobias");
      expect(await eventsFor(app.id)).toEqual([]);
      expect((await applicationById(app.id))?.lastContactAt).toBeNull();
    });
  });
});

describe("MCP update_application_status: status event", () => {
  it("adds 'Moved to <Label>' dated today when the status changes", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id, { status: "applied", appliedAt: "2026-10-20" });
    const mcp = await mcpSession(user.id);

    okJson(await mcp.call("update_application_status", { id: app.id, status: "interviewing" }));
    okJson(await mcp.call("update_application_status", { id: app.id, status: "rejected" }));

    const events = await eventsFor(app.id);
    expect(events.map((e) => [e.type, e.occurredAt, e.title, e.body, e.userId])).toEqual([
      ["status", TODAY, "Moved to Interviewing", null, user.id],
      ["status", TODAY, "Moved to Rejected", null, user.id],
    ]);
    const row = await applicationById(app.id);
    expect(row?.status).toBe("rejected");
    expect(row?.lastContactAt).toBeNull();
    expect(row?.nextStepAt).toBeNull();
  });

  it("adds nothing when the status is unchanged", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id, { status: "offer" });
    const mcp = await mcpSession(user.id);
    okJson(await mcp.call("update_application_status", { id: app.id, status: "offer" }));
    expect(await eventsFor(app.id)).toEqual([]);
  });

  it("adds nothing for another user's application", async () => {
    const user = await createUser();
    const stranger = await createUser();
    const theirs = await seedApplication(stranger.id, { status: "applied" });
    const mcp = await mcpSession(user.id);
    expectNotFound(
      await mcp.call("update_application_status", { id: theirs.id, status: "offer" }),
      theirs.id,
    );
    expect(await eventsFor(theirs.id)).toEqual([]);
    expect((await applicationById(theirs.id))?.status).toBe("applied");
  });
});

describe("MCP get_application: events", () => {
  type Detail = {
    application: Row;
    company: Row | null;
    events?: (Row & { id: number; contactName?: string | null })[];
  };

  it("includes the events newest first by date then id, with the contact's name", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id);
    const other = await seedApplication(user.id, { jobTitle: "Another role" });
    const contact = await seedNetworkContact(user.id, "Priya Raman");

    const first = await seedEvent(user.id, app.id, { occurredAt: "2026-11-05", title: "Applied through the site" });
    const call = await seedEvent(user.id, app.id, {
      type: "call",
      occurredAt: "2026-11-09",
      title: "Recruiter screen",
      body: "Thirty minutes",
      networkContactId: contact.id,
    });
    const sameDay = await seedEvent(user.id, app.id, { type: "email", occurredAt: "2026-11-05", title: "Confirmation email" });
    const future = await seedEvent(user.id, app.id, { type: "interview", occurredAt: "2026-11-20", title: "Onsite" });
    await seedEvent(user.id, other.id, { occurredAt: "2026-11-10", title: "Belongs to the other application" });

    const mcp = await mcpSession(user.id, ["mcp:read"]);
    const data = okJson<Detail>(await mcp.call("get_application", { id: app.id }));

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

  it("returns an empty events list for an application with none", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id);
    const mcp = await mcpSession(user.id);
    const data = okJson<Detail>(await mcp.call("get_application", { id: app.id }));
    expect(data.events).toEqual([]);
  });

  it("shows an event added through add_application_event", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id);
    const mcp = await mcpSession(user.id);
    const added = okJson<{ id: number }>(
      await mcp.call(ADD, { applicationId: app.id, type: "note", title: "Researched the team" }),
    );
    const data = okJson<Detail>(await mcp.call("get_application", { id: app.id }));
    expect(data.events?.map((e) => [e.id, e.type, e.occurredAt, e.title])).toEqual([
      [added.id, "note", TODAY, "Researched the team"],
    ]);
  });

  // Passing guard: the existing shape must survive.
  it("still returns the application and its company", async () => {
    const user = await createUser();
    const company = await seedCompany(user.id, "Quillfeather Labs");
    const app = await seedApplication(user.id, { companyId: company.id });
    const mcp = await mcpSession(user.id);
    const data = okJson<Detail>(await mcp.call("get_application", { id: app.id }));
    expect(data.application.id).toBe(app.id);
    expect(data.company?.name).toBe("Quillfeather Labs");
  });
});
