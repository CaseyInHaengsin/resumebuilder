import { createUser, seedApplication, seedCompany } from "../helpers/db";
import { mcpSession, okJson } from "../helpers/mcp";
import { describe, expect, it } from "vitest";

type Row = Record<string, unknown>;

const DESCRIPTION = "Own the ingestion pipeline.\n\nRequirements:\n- TypeScript\n- SQLite";

function withDescription(jobDescription: string | null, extra: Row = {}) {
  return { ...extra, jobDescription } as never;
}

describe("MCP get_application: jobDescription", () => {
  it("includes the stored job description", async () => {
    const user = await createUser();
    const company = await seedCompany(user.id, "Quillfeather Labs");
    const app = await seedApplication(
      user.id,
      withDescription(DESCRIPTION, { companyId: company.id }),
    );
    const mcp = await mcpSession(user.id);

    const data = okJson<{ application: Row; company: Row | null }>(
      await mcp.call("get_application", { id: app.id }),
    );
    expect(data.application.id).toBe(app.id);
    expect(data.application.jobDescription).toBe(DESCRIPTION);
    expect(data.company?.name).toBe("Quillfeather Labs");
  });

  it("returns jobDescription null when the application has none", async () => {
    const user = await createUser();
    const app = await seedApplication(user.id);
    const mcp = await mcpSession(user.id);

    const data = okJson<{ application: Row }>(
      await mcp.call("get_application", { id: app.id }),
    );
    expect(data.application).toHaveProperty("jobDescription", null);
  });
});

describe("MCP list_applications: hasJobDescription", () => {
  it("flags each row and leaves the description text out", async () => {
    const user = await createUser();
    const withText = await seedApplication(
      user.id,
      withDescription(DESCRIPTION, { jobTitle: "Data Engineer" }),
    );
    const without = await seedApplication(user.id, { jobTitle: "Backend Engineer" });
    const mcp = await mcpSession(user.id);

    const outcome = await mcp.call("list_applications", {});
    const rows = okJson<Row[]>(outcome);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(rows).toHaveLength(2);
    expect(byId.get(withText.id)?.hasJobDescription).toBe(true);
    expect(byId.get(without.id)?.hasJobDescription).toBe(false);
    for (const row of rows) expect(row).not.toHaveProperty("jobDescription");
    expect(outcome.text).not.toContain("Own the ingestion pipeline");
    // The rest of the row is still there.
    expect(byId.get(withText.id)?.jobTitle).toBe("Data Engineer");
    expect(byId.get(without.id)?.status).toBe("applied");
  });

  it("keeps the flag when filtering by status", async () => {
    const user = await createUser();
    const wish = await seedApplication(
      user.id,
      withDescription(DESCRIPTION, { status: "wishlist" }),
    );
    await seedApplication(user.id, { status: "applied" });
    const mcp = await mcpSession(user.id);

    const rows = okJson<Row[]>(await mcp.call("list_applications", { status: "wishlist" }));
    expect(rows.map((r) => r.id)).toEqual([wish.id]);
    expect(rows[0].hasJobDescription).toBe(true);
    expect(rows[0]).not.toHaveProperty("jobDescription");
  });
});
