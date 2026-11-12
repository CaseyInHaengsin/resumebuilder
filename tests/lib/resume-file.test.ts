// Phase 4c — download file name derived from the contact name.
import { describe, expect, it } from "vitest";
import { resumeFileName } from "~/lib/resume-file";

describe("resumeFileName", () => {
  it("joins the name parts with hyphens and appends -Resume.pdf", () => {
    expect(resumeFileName("Jane Doe")).toBe("Jane-Doe-Resume.pdf");
    expect(resumeFileName("Rosa Marlowe")).toBe("Rosa-Marlowe-Resume.pdf");
    expect(resumeFileName("Cher")).toBe("Cher-Resume.pdf");
  });

  it("trims and collapses extra whitespace", () => {
    expect(resumeFileName("  Jane   Doe ")).toBe("Jane-Doe-Resume.pdf");
    expect(resumeFileName("Jane\t Doe\n")).toBe("Jane-Doe-Resume.pdf");
  });

  it("removes characters that are unsafe in file names and keeps hyphens", () => {
    expect(resumeFileName("Jane O'Neil-Smith, Jr.")).toBe("Jane-ONeil-Smith-Jr-Resume.pdf");
    expect(resumeFileName('Jane/Doe\\: "JD" <*?|>')).toBe("JaneDoe-JD-Resume.pdf");
  });

  it("falls back to Resume.pdf when there is no usable name", () => {
    expect(resumeFileName("")).toBe("Resume.pdf");
    expect(resumeFileName("   ")).toBe("Resume.pdf");
    expect(resumeFileName(null)).toBe("Resume.pdf");
    expect(resumeFileName(undefined)).toBe("Resume.pdf");
    // Nothing is left once the unsafe characters are removed.
    expect(resumeFileName(" ./,' ")).toBe("Resume.pdf");
  });
});
