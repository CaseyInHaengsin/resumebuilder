// Phase 2 — self-hosted fonts.
//
// Font files live in public/fonts/ and are registered from there (by file path
// in Node, by /fonts/... URL in the browser). Rendering must not use the
// network, the bold Inter must really be Inter Bold, and Classic needs an
// italic Inter.
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TemplateId } from "~/components/pdf/types";

const TIMEOUT = 30_000;
const TEMPLATE_IDS: TemplateId[] = ["modern", "classic", "minimal"];
const FONT_DIR = path.resolve(process.cwd(), "public/fonts");

type Helpers = typeof import("../helpers/pdf");

let helpers: Helpers;
const fetchStub = vi.fn((..._args: unknown[]) =>
  Promise.reject(new Error("network access is disabled in the font tests")),
);

beforeAll(async () => {
  // The stub goes in before the templates (and their module-level font
  // registration) are imported, and no render has happened yet in this file,
  // so no font can have been fetched and cached beforehand.
  vi.stubGlobal("fetch", fetchStub);
  vi.resetModules();
  helpers = await import("../helpers/pdf");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

async function embeddedFonts(templateId: TemplateId): Promise<string[]> {
  const buffer = await helpers.renderResume(templateId, helpers.sampleResume);
  return (await helpers.inspectPdf(buffer)).fonts;
}

describe("fonts are self-hosted", () => {
  it.each(TEMPLATE_IDS)(
    "%s renders with the network unavailable",
    async (templateId) => {
      fetchStub.mockClear();
      const buffer = await helpers.renderResume(templateId, helpers.sampleResume);
      // The layout engine loads its WebAssembly through fetch with a data:
      // URL on first use; only real network requests count.
      const networkCalls = fetchStub.mock.calls
        .map((call) => String((call as unknown[])[0]))
        .filter((url) => /^https?:/i.test(url));
      expect(networkCalls).toEqual([]);
      expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const pdf = await helpers.inspectPdf(buffer);
      expect(pdf.pages.join("\n")).toContain(helpers.sampleResume.contact.name);
    },
    TIMEOUT,
  );

  it("registers every font from a file in public/fonts", async () => {
    const { Font } = await import("@react-pdf/renderer");
    await import("~/components/pdf/templates");

    const families = Font.getRegisteredFonts();
    for (const family of ["Inter", "Lora"]) {
      expect(families[family], `${family} is not registered`).toBeDefined();
    }

    // Only the two custom families: the registry also lists the built-in
    // standard fonts (Helvetica and so on), which have no file.
    const sources = ["Inter", "Lora"].flatMap((family) => families[family].sources.map((s) => s.src));
    expect(sources.length).toBeGreaterThanOrEqual(5);
    for (const src of sources) {
      expect(src, "font source must not be a remote URL").not.toMatch(/^https?:/i);
      const file = path.resolve(src);
      expect(file.startsWith(FONT_DIR + path.sep), `${src} is not inside public/fonts`).toBe(true);
      expect(existsSync(file), `${src} does not exist`).toBe(true);
    }
  });
});

describe("embedded font faces", () => {
  it(
    "modern embeds Inter Regular and Inter Bold, not Inter Medium",
    async () => {
      const fonts = await embeddedFonts("modern");
      expect(fonts).toContain("Inter-Regular");
      expect(fonts).toContain("Inter-Bold");
      expect(fonts).not.toContain("Inter-Medium");
    },
    TIMEOUT,
  );

  it(
    "classic embeds Inter Bold and an italic Inter",
    async () => {
      const fonts = await embeddedFonts("classic");
      expect(fonts).toContain("Inter-Bold");
      expect(fonts).not.toContain("Inter-Medium");
      expect(fonts.some((name) => /Inter.*Italic/.test(name)), `fonts: ${fonts.join(", ")}`).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "minimal embeds Lora Regular and Lora Bold",
    async () => {
      const fonts = await embeddedFonts("minimal");
      expect(fonts).toContain("Lora-Regular");
      expect(fonts).toContain("Lora-Bold");
    },
    TIMEOUT,
  );
});
