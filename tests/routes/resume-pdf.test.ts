// Phase 11 — `GET /api/resumes/:id/pdf`
// (route module `app/routes/api.resumes.$id.pdf.tsx`, exporting `loader`).
import { TEXT, at, bodyBytes, isPdf, seedRenderableResume } from "../helpers/documents";
import { createUser } from "../helpers/db";
import { inspectPdf } from "../helpers/pdf";
import { getRequest, run, sessionCookie, statusOf } from "../helpers/routes";
import { describe, expect, it } from "vitest";

async function fetchPdf(resumeId: number | string, cookie?: string, query = "") {
  const { loader } = await import("~/routes/api.resumes.$id.pdf");
  return run(loader, getRequest(`/api/resumes/${resumeId}/pdf${query}`, cookie), {
    id: String(resumeId),
  });
}

type RouteEntry = { path?: string; file: string; children?: RouteEntry[] };

describe("GET /api/resumes/:id/pdf", () => {
  it("is registered inside the authed layout", async () => {
    const routes = (await import("../../app/routes")).default as RouteEntry[];
    const layout = routes.find((r) => r.file === "routes/layout.tsx");
    const entry = layout?.children?.find((r) => r.path === "api/resumes/:id/pdf");
    expect(entry, "no api/resumes/:id/pdf route under routes/layout.tsx").toBeDefined();
    expect(entry!.file).toBe("routes/api.resumes.$id.pdf.tsx");
  });

  it("redirects to login without a session", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);

    const result = await fetchPdf(resume.id);

    expect(statusOf(result)).toBe(302);
    expect((result as Response).headers.get("Location")).toMatch(/^\/login\?/);
  });

  it("serves the owner's resume as an inline PDF that is never cached", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);

    const result = await fetchPdf(resume.id, await sessionCookie(user.id));

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="Marisol-Venn-Resume.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const bytes = await bodyBytes(response);
    expect(isPdf(bytes)).toBe(true);
    const pdf = await inspectPdf(bytes);
    const text = pdf.pages.join(" ");
    expect(pdf.metadata.title).toBe("Marisol Venn Resume");
    expect(at(text, TEXT.staffThird)).toBeGreaterThanOrEqual(0);
    expect(at(text, TEXT.staffThird)).toBeLessThan(at(text, TEXT.staffFirst));
    expect(at(text, TEXT.staffUnselected)).toBe(-1);
  });

  it("serves it as an attachment with ?download=1", async () => {
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);

    const result = await fetchPdf(resume.id, await sessionCookie(user.id), "?download=1");

    const response = result as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Marisol-Venn-Resume.pdf"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(isPdf(await bodyBytes(response))).toBe(true);
  });

  it("returns 404 for another user's resume", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const { resume } = await seedRenderableResume(owner.id);
    await seedRenderableResume(stranger.id);

    // Sanity: the owner gets it, so the 404 below is about ownership.
    expect(statusOf(await fetchPdf(resume.id, await sessionCookie(owner.id)))).toBe(200);
    expect(statusOf(await fetchPdf(resume.id, await sessionCookie(stranger.id)))).toBe(404);
  });

  it("returns 404 for an id that does not exist or is not a number", async () => {
    const user = await createUser();
    const cookie = await sessionCookie(user.id);

    expect(statusOf(await fetchPdf(987_654, cookie))).toBe(404);
    expect(statusOf(await fetchPdf("abc", cookie))).toBe(404);
  });
});
