import { UPLOADS_DIR, assertTempPath, createUser } from "../helpers/db";
import { getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG_TEXT =
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

/** Users whose ids are 1 and 12, so `u1-` is a string prefix of `u12-`. */
let userOne: { id: number };
let userTwelve: { id: number };
let cookieOne: string;
let cookieTwelve: string;

beforeAll(async () => {
  const users = [];
  for (let i = 0; i < 12; i++) users.push(await createUser());
  userOne = users[0];
  userTwelve = users[11];
  expect(userOne.id).toBe(1);
  expect(userTwelve.id).toBe(12);
  cookieOne = await sessionCookie(userOne.id);
  cookieTwelve = await sessionCookie(userTwelve.id);
});

/** Stores a file through the app's own saveUpload and returns its file name. */
async function upload(userId: number, name: string, type: string, body: Buffer | string) {
  const { saveUpload, getUploadsDir } = await import("~/lib/uploads.server");
  assertTempPath(getUploadsDir(), "the uploads directory used by the app");
  const url = await saveUpload(new File([body as BlobPart], name, { type }), userId);
  const filename = url.replace(/^\/uploads\//, "");
  expect(filename.startsWith(`u${userId}-`)).toBe(true);
  expect(fs.existsSync(path.join(UPLOADS_DIR, filename))).toBe(true);
  return filename;
}

async function fetchUpload(filename: string, cookie?: string) {
  const { loader } = await import("~/routes/uploads.$file");
  return run(loader, getRequest(`/uploads/${filename}`, cookie), { file: filename });
}

describe("uploads are private to their owner", () => {
  it("returns 404 for another user's file", async () => {
    const theirs = await upload(userTwelve.id, "logo.png", "image/png", PNG_BYTES);
    // Sanity: the owner can read it, so a 404 below is about ownership.
    expect(statusOf(await fetchUpload(theirs, cookieTwelve))).toBe(200);

    const result = await fetchUpload(theirs, cookieOne);

    expect(statusOf(result)).toBe(404);
  });

  it("does not let user 1 read a file named u12-…", async () => {
    const theirs = await upload(userTwelve.id, "logo.png", "image/png", PNG_BYTES);
    expect(theirs.startsWith("u12-")).toBe(true);

    const result = await fetchUpload(theirs, cookieOne);

    expect(statusOf(result)).toBe(404);
    if (result instanceof Response) {
      const body = Buffer.from(await result.arrayBuffer());
      expect(body.equals(PNG_BYTES)).toBe(false);
    }
  });

  it("does not let user 12 read a file named u1-…", async () => {
    const theirs = await upload(userOne.id, "logo.png", "image/png", PNG_BYTES);
    expect(statusOf(await fetchUpload(theirs, cookieTwelve))).toBe(404);
  });

  it("returns 404 for a file with no owner prefix", async () => {
    fs.writeFileSync(path.join(UPLOADS_DIR, "stray.png"), PNG_BYTES);
    expect(statusOf(await fetchUpload("stray.png", cookieOne))).toBe(404);
  });

  it("sends X-Content-Type-Options: nosniff with a served file", async () => {
    const mine = await upload(userOne.id, "photo.png", "image/png", PNG_BYTES);
    const result = (await fetchUpload(mine, cookieOne)) as Response;
    expect(result.status).toBe(200);
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("serves SVG with a sandboxing Content-Security-Policy and nosniff", async () => {
    const mine = await upload(userOne.id, "logo.svg", "image/svg+xml", SVG_TEXT);
    const result = (await fetchUpload(mine, cookieOne)) as Response;
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await result.text()).toBe(SVG_TEXT);
    const csp = result.headers.get("Content-Security-Policy") ?? "";
    expect(csp.split(";").map((d) => d.trim().split(/\s+/)[0])).toContain("sandbox");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  // Passing guards: what already works must keep working.
  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.webp", "image/webp"],
  ])("serves the owner's %s as %s", async (name, type) => {
    const mine = await upload(userOne.id, name, type, PNG_BYTES);
    const result = (await fetchUpload(mine, cookieOne)) as Response;
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe(type);
    expect(Buffer.from(await result.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it("serves user 12 their own file", async () => {
    const mine = await upload(userTwelve.id, "photo.png", "image/png", PNG_BYTES);
    const result = (await fetchUpload(mine, cookieTwelve)) as Response;
    expect(result.status).toBe(200);
    expect(Buffer.from(await result.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it("returns 404 for the owner's prefix on a file that does not exist", async () => {
    expect(statusOf(await fetchUpload("u1-000000000000-missing.png", cookieOne))).toBe(404);
  });

  it("redirects to login without a session", async () => {
    const mine = await upload(userOne.id, "photo.png", "image/png", PNG_BYTES);
    const result = await fetchUpload(mine);
    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toContain("/login");
  });
});
