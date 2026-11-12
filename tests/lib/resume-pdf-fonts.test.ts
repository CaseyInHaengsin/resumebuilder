// Phase 11 — where the server finds the PDF fonts.
//
// Today `app/components/pdf/fonts.ts` registers fonts from
// `<cwd>/public/fonts` in Node, but the production image only contains
// `build/client/fonts`, so server-side rendering there has no fonts.
//
// Target:
//   - fonts.ts (Node): directory is `process.env.FONTS_DIR` when set,
//     otherwise `<cwd>/public/fonts`.
//   - `app/lib/resume-pdf.server.ts` exports `resolveFontsDir(cwd?)`:
//     `<cwd>/public/fonts` when it exists, else `<cwd>/build/client/fonts`
//     when that exists; and the module sets FONTS_DIR from it before the
//     templates (and their font registration) load. A FONTS_DIR that is
//     already set is left alone.
//
// Every scenario starts from a clean module registry and an empty react-pdf
// font registry, so the font files it uses are the ones registered in it.
import { isPdf, seedRenderableResume } from "../helpers/documents";
import { TEST_DIR, assertTempPath, createUser } from "../helpers/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const REPO_FONTS = path.join(REPO_ROOT, "public/fonts");
const savedFontsDir = process.env.FONTS_DIR;

let scratch = 0;
/** A new empty directory inside the temp test directory. */
function tempDir(label: string): string {
  const dir = path.join(TEST_DIR, `fonts-${label}-${++scratch}`);
  assertTempPath(dir, "fonts scratch directory");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function copyFontsTo(dir: string): string {
  assertTempPath(dir, "fonts copy");
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.cpSync(REPO_FONTS, dir, { recursive: true });
  return dir;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function registeredFontFiles(): Promise<string[]> {
  const { Font } = await import("@react-pdf/renderer");
  const families = Font.getRegisteredFonts();
  return ["Inter", "Lora"].flatMap((family) =>
    (families[family]?.sources ?? []).map((s) => String(s.src)),
  );
}

beforeEach(async () => {
  delete process.env.FONTS_DIR;
  vi.resetModules();
  // Drop only the app's families: the registry object is live, and
  // `Font.clear()` would also remove the built-in standard fonts.
  const { Font } = await import("@react-pdf/renderer");
  const families = Font.getRegisteredFonts() as Record<string, unknown>;
  delete families.Inter;
  delete families.Lora;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedFontsDir === undefined) delete process.env.FONTS_DIR;
  else process.env.FONTS_DIR = savedFontsDir;
});

describe("resolveFontsDir", () => {
  it("returns <cwd>/public/fonts when it exists", async () => {
    const { resolveFontsDir } = await import("~/lib/resume-pdf.server");
    const cwd = tempDir("dev");
    fs.mkdirSync(path.join(cwd, "public/fonts"), { recursive: true });

    expect(path.resolve(resolveFontsDir(cwd))).toBe(path.join(cwd, "public/fonts"));
  });

  it("falls back to <cwd>/build/client/fonts when there is no public/fonts", async () => {
    const { resolveFontsDir } = await import("~/lib/resume-pdf.server");
    const cwd = tempDir("prod");
    fs.mkdirSync(path.join(cwd, "build/client/fonts"), { recursive: true });
    // A `public` directory without fonts in it does not count.
    fs.mkdirSync(path.join(cwd, "public"), { recursive: true });

    expect(path.resolve(resolveFontsDir(cwd))).toBe(path.join(cwd, "build/client/fonts"));
  });

  it("prefers public/fonts when both exist", async () => {
    const { resolveFontsDir } = await import("~/lib/resume-pdf.server");
    const cwd = tempDir("both");
    fs.mkdirSync(path.join(cwd, "public/fonts"), { recursive: true });
    fs.mkdirSync(path.join(cwd, "build/client/fonts"), { recursive: true });

    expect(path.resolve(resolveFontsDir(cwd))).toBe(path.join(cwd, "public/fonts"));
  });

  it("defaults to the process working directory", async () => {
    const { resolveFontsDir } = await import("~/lib/resume-pdf.server");
    const cwd = tempDir("default");
    fs.mkdirSync(path.join(cwd, "build/client/fonts"), { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    expect(path.resolve(resolveFontsDir())).toBe(path.join(cwd, "build/client/fonts"));
  });
});

describe("fonts.ts reads FONTS_DIR", () => {
  it("registers every font from FONTS_DIR when it is set", async () => {
    const fontsDir = copyFontsTo(path.join(tempDir("explicit"), "typefaces"));
    process.env.FONTS_DIR = fontsDir;
    vi.spyOn(process, "cwd").mockReturnValue(tempDir("empty-cwd"));

    const { renderResume, sampleResume, inspectPdf } = await import("../helpers/pdf");

    const sources = await registeredFontFiles();
    expect(sources.length).toBeGreaterThanOrEqual(5);
    for (const src of sources) {
      expect(isInside(fontsDir, src), `${src} is not inside FONTS_DIR`).toBe(true);
      expect(fs.existsSync(src), `${src} does not exist`).toBe(true);
    }

    const pdf = await inspectPdf(await renderResume("modern", sampleResume));
    expect(pdf.fonts).toContain("Inter-Regular");
    expect(pdf.fonts).toContain("Inter-Bold");
    expect(pdf.pages.join(" ")).toContain(sampleResume.contact.name);
  });
});

describe("resume-pdf.server sets FONTS_DIR before the templates load", () => {
  it("renders in the production layout: only build/client/fonts under the working directory", async () => {
    const cwd = tempDir("image");
    const fontsDir = copyFontsTo(path.join(cwd, "build/client/fonts"));
    vi.spyOn(process, "cwd").mockReturnValue(cwd);

    const { renderResumePdf } = await import("~/lib/resume-pdf.server");
    expect(path.resolve(process.env.FONTS_DIR ?? "")).toBe(fontsDir);

    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);
    const rendered = await renderResumePdf(user.id, resume.id);
    expect(isPdf(rendered!.bytes)).toBe(true);

    const sources = await registeredFontFiles();
    expect(sources.length).toBeGreaterThanOrEqual(5);
    for (const src of sources) {
      expect(isInside(fontsDir, src), `${src} is not inside build/client/fonts`).toBe(true);
    }

    const { inspectPdf } = await import("../helpers/pdf");
    const pdf = await inspectPdf(Buffer.from(rendered!.bytes));
    expect(pdf.fonts).toContain("Inter-Regular");
    expect(pdf.pages.join(" ")).toContain("Marisol Venn");
  });

  it("leaves an explicit FONTS_DIR alone and renders from it", async () => {
    const fontsDir = copyFontsTo(path.join(tempDir("override"), "typefaces"));
    process.env.FONTS_DIR = fontsDir;
    // Nothing under this working directory: neither public/fonts nor build/client/fonts.
    vi.spyOn(process, "cwd").mockReturnValue(tempDir("empty-cwd"));

    const { renderResumePdf } = await import("~/lib/resume-pdf.server");
    expect(process.env.FONTS_DIR).toBe(fontsDir);

    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id, { template: "minimal" });
    const rendered = await renderResumePdf(user.id, resume.id);
    expect(isPdf(rendered!.bytes)).toBe(true);

    for (const src of await registeredFontFiles()) {
      expect(isInside(fontsDir, src), `${src} is not inside FONTS_DIR`).toBe(true);
    }
    const { inspectPdf } = await import("../helpers/pdf");
    const pdf = await inspectPdf(Buffer.from(rendered!.bytes));
    expect(pdf.fonts).toContain("Lora-Regular");
  });

  it("points FONTS_DIR at public/fonts in a checkout", async () => {
    await import("~/lib/resume-pdf.server");
    expect(path.resolve(process.env.FONTS_DIR ?? "")).toBe(REPO_FONTS);
  });
});
