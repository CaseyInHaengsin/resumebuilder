import { createUser } from "../helpers/db";
import { getRequest, sessionCookie } from "../helpers/routes";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

describe("session cookie", () => {
  it("lasts 30 days", async () => {
    const { createUserSession } = await import("~/lib/auth.server");
    const user = await createUser();
    const response = await createUserSession({
      request: getRequest("/login"),
      userId: user.id,
      redirectTo: "/",
    });
    const attributes = (response.headers.get("Set-Cookie") ?? "")
      .split(";")
      .map((part) => part.trim());
    expect(attributes).toContain("Max-Age=2592000");
  });

  // Passing guard: the longer-lived cookie still signs a user in.
  it("still identifies the user it was issued for", async () => {
    const { getUserId } = await import("~/lib/auth.server");
    const user = await createUser();
    const cookie = await sessionCookie(user.id);
    expect(await getUserId(getRequest("/", cookie))).toBe(user.id);
    expect(await getUserId(getRequest("/"))).toBeNull();
    expect(await getUserId(getRequest("/", `${cookie}tampered`))).toBeNull();
  });
});

describe("/pdf-test", () => {
  it("has no route module", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "app/routes/pdf-test.tsx"))).toBe(false);
  });

  it("is not registered in app/routes.ts", () => {
    const routes = fs.readFileSync(path.join(REPO_ROOT, "app/routes.ts"), "utf8");
    expect(routes).not.toMatch(/pdf-test/);
  });
});
