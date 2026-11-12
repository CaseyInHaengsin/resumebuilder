import { createUser, getDb, seedApplication } from "../helpers/db";
import { formRequest, getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// 6:30pm on Nov 11 in Denver; already Nov 12 in UTC.
const EVENING_IN_DENVER = new Date("2026-11-12T01:30:00Z");
const DENVER_DATE = "2026-11-11";

const savedZone = process.env.APP_TIMEZONE;
let userId: number;
let cookie: string;

beforeAll(async () => {
  userId = (await createUser()).id;
  cookie = await sessionCookie(userId);
});

beforeEach(() => {
  process.env.APP_TIMEZONE = "America/Denver";
  // Only Date is faked, so better-sqlite3 and cookie signing run on real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(EVENING_IN_DENVER);
});

afterEach(() => {
  vi.useRealTimers();
  if (savedZone === undefined) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = savedZone;
});

async function applicationById(id: number) {
  const { db, schema } = await getDb();
  return db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.id, id))
    .get();
}

async function createdApplication(response: unknown) {
  expect(response).toBeInstanceOf(Response);
  const location = (response as Response).headers.get("Location") ?? "";
  const match = location.match(/^\/applications\/(\d+)$/);
  expect(match, `redirect to the new application, got "${location}"`).not.toBeNull();
  return applicationById(Number(match![1]));
}

describe("api.applications: applied date defaults to today in APP_TIMEZONE", () => {
  it.each(["applied", "interviewing"])(
    "create with status %s and no appliedAt stores the Denver date",
    async (status) => {
      const { action } = await import("~/routes/api.applications");
      const result = await run(
        action,
        formRequest(
          "/api/applications",
          { _action: "create", jobTitle: "Platform Engineer", status },
          cookie,
        ),
      );
      const row = await createdApplication(result);
      expect(row?.status).toBe(status);
      expect(row?.appliedAt).toBe(DENVER_DATE);
    },
  );

  it("create with no status and no appliedAt stores the Denver date", async () => {
    const { action } = await import("~/routes/api.applications");
    const result = await run(
      action,
      formRequest(
        "/api/applications",
        { _action: "create", jobTitle: "Data Engineer" },
        cookie,
      ),
    );
    const row = await createdApplication(result);
    expect(row?.appliedAt).toBe(DENVER_DATE);
  });

  it("set_status from wishlist to applied stores the Denver date", async () => {
    const { action } = await import("~/routes/api.applications");
    const app = await seedApplication(userId, { status: "wishlist" });
    const result = await run(
      action,
      formRequest(
        "/api/applications",
        { _action: "set_status", id: app.id, status: "applied" },
        cookie,
      ),
    );
    expect(statusOf(result)).toBe(200);
    const row = await applicationById(app.id);
    expect(row?.status).toBe("applied");
    expect(row?.appliedAt).toBe(DENVER_DATE);
  });

  // Passing guards: behavior that must survive the change.
  it("create keeps an appliedAt the form supplied", async () => {
    const { action } = await import("~/routes/api.applications");
    const result = await run(
      action,
      formRequest(
        "/api/applications",
        {
          _action: "create",
          jobTitle: "Site Reliability Engineer",
          status: "applied",
          appliedAt: "2026-10-30",
        },
        cookie,
      ),
    );
    const row = await createdApplication(result);
    expect(row?.appliedAt).toBe("2026-10-30");
  });

  it("create as wishlist leaves appliedAt empty", async () => {
    const { action } = await import("~/routes/api.applications");
    const result = await run(
      action,
      formRequest(
        "/api/applications",
        { _action: "create", jobTitle: "Engineering Manager", status: "wishlist" },
        cookie,
      ),
    );
    const row = await createdApplication(result);
    expect(row?.appliedAt).toBeNull();
  });

  it("set_status keeps an appliedAt that is already set", async () => {
    const { action } = await import("~/routes/api.applications");
    const app = await seedApplication(userId, {
      status: "applied",
      appliedAt: "2026-10-01",
    });
    await run(
      action,
      formRequest(
        "/api/applications",
        { _action: "set_status", id: app.id, status: "interviewing" },
        cookie,
      ),
    );
    const row = await applicationById(app.id);
    expect(row?.status).toBe("interviewing");
    expect(row?.appliedAt).toBe("2026-10-01");
  });
});

describe("applications list loader", () => {
  it("returns today in APP_TIMEZONE alongside its rows", async () => {
    const { loader } = await import("~/routes/applications._index");
    const owner = await createUser();
    const app = await seedApplication(owner.id, { jobTitle: "Backend Engineer" });
    const result = (await run(
      loader,
      getRequest("/applications", await sessionCookie(owner.id)),
    )) as { today?: string; rows: { id: number }[]; companies: unknown[]; resumes: unknown[] };

    expect(result).not.toBeInstanceOf(Response);
    expect(result.today).toBe(DENVER_DATE);
    expect(result.rows.map((r) => r.id)).toEqual([app.id]);
    expect(result.companies).toEqual([]);
    expect(result.resumes).toEqual([]);
  });
});

describe("MCP update_application_status", () => {
  type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
  type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

  /** Registers the write tools on a stand-in server and returns one handler. */
  async function writeTool(name: string, forUserId: number): Promise<ToolHandler> {
    const { registerWriteTools } = await import("~/mcp/tools/writes");
    const handlers = new Map<string, ToolHandler>();
    const server = {
      registerTool(toolName: string, _config: unknown, handler: ToolHandler) {
        handlers.set(toolName, handler);
      },
    };
    registerWriteTools(server as never, forUserId);
    const handler = handlers.get(name);
    if (!handler) throw new Error(`tool ${name} was not registered`);
    return handler;
  }

  it("moving a wishlist application to applied stores the Denver date", async () => {
    const app = await seedApplication(userId, { status: "wishlist" });
    const tool = await writeTool("update_application_status", userId);
    const result = await tool({ id: app.id, status: "applied" });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text).appliedAt).toBe(DENVER_DATE);
    const row = await applicationById(app.id);
    expect(row?.status).toBe("applied");
    expect(row?.appliedAt).toBe(DENVER_DATE);
  });

  // Passing guard.
  it("keeps an appliedAt that is already set", async () => {
    const app = await seedApplication(userId, {
      status: "applied",
      appliedAt: "2026-10-01",
    });
    const tool = await writeTool("update_application_status", userId);
    await tool({ id: app.id, status: "offer" });
    const row = await applicationById(app.id);
    expect(row?.status).toBe("offer");
    expect(row?.appliedAt).toBe("2026-10-01");
  });
});
