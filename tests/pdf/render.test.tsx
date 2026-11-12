import { describe, expect, it } from "vitest";
import type { TemplateId } from "~/components/pdf/types";
import { inspectPdf, renderResume, sampleResume } from "../helpers/pdf";

const TIMEOUT = 30_000;

describe("resume PDF templates render", () => {
  it.each<TemplateId>(["modern", "classic", "minimal"])(
    "%s renders sampleResume",
    async (templateId) => {
      const buffer = await renderResume(templateId, sampleResume);
      expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      const pdf = await inspectPdf(buffer);
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1);
      const text = pdf.pages.join("\n");
      expect(text).toContain(sampleResume.contact.name);
      expect(text).toContain(sampleResume.jobs[0].bullets[0].slice(0, 40));
    },
    TIMEOUT,
  );
});
