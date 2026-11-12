// Phase 11 — server-side resume PDF (`app/lib/resume-pdf.server.ts`).
//
//   loadResumeForPdf(userId, resumeId)
//     -> { data: ResumeData; template: TemplateId; fileName: string } | null
//   renderResumePdf(userId, resumeId)
//     -> Promise<{ bytes: Uint8Array | Buffer; fileName: string; pageCount: number } | null>
//
// The content is what the builder shows: the user's library filtered and
// ordered by the resume's stored selections, through `buildResumeData`.
import {
  LIBRARY_CONTACT,
  TEXT,
  at,
  isPdf,
  seedRenderableResume,
} from "../helpers/documents";
import { createUser, getDb } from "../helpers/db";
import { inspectPdf, longResume } from "../helpers/pdf";
import { describe, expect, it } from "vitest";

async function pdfOf(bytes: Uint8Array) {
  const pdf = await inspectPdf(Buffer.from(bytes));
  return { pdf, text: pdf.pages.join(" ") };
}

describe("loadResumeForPdf", () => {
  it("returns the selected content in the resume's stored order", async () => {
    const { loadResumeForPdf } = await import("~/lib/resume-pdf.server");
    const user = await createUser();
    await seedRenderableResume(user.id);
    const { resume } = await seedRenderableResume(user.id, { template: "classic" }, { contact: false });
    // The user now has every library row twice; only this resume's selections count.

    const loaded = loadResumeForPdf(user.id, resume.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.template).toBe("classic");
    expect(loaded!.fileName).toBe("Marisol-Venn-Resume.pdf");
    expect(loaded!.data).toEqual({
      contact: { ...LIBRARY_CONTACT },
      summary: TEXT.summary,
      jobs: [
        {
          title: "Platform Engineer",
          company: "Quillfeather Labs",
          dates: "2019 - 2022",
          location: "Boise, ID",
          bullets: [TEXT.platformOnly],
        },
        {
          title: "Staff Engineer",
          company: "Fernhill Robotics",
          dates: "2022 - 2025",
          location: "Remote",
          bullets: [TEXT.staffThird, TEXT.staffFirst],
        },
      ],
      skills: [{ category: "Languages", items: ["TypeScript", "Elixir"] }],
      projects: [],
      education: { school: "Larkspur State University", degrees: ["B.S. Computer Science"] },
    });
  });

  it("uses the resume's own contact details when the override is on", async () => {
    const { loadResumeForPdf } = await import("~/lib/resume-pdf.server");
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id, {
      useCustomContact: true,
      contactName: "M. Venn-Okafor",
      contactEmail: "mvo@example.com",
      contactPhone: null,
      contactLinkedin: null,
      contactGithub: "github.com/mvo",
    });

    const loaded = loadResumeForPdf(user.id, resume.id);

    expect(loaded!.data.contact).toEqual({
      name: "M. Venn-Okafor",
      phone: null,
      email: "mvo@example.com",
      linkedin: null,
      github: "github.com/mvo",
    });
    expect(loaded!.fileName).toBe("M-Venn-Okafor-Resume.pdf");
  });

  it("returns null for another user's resume and for a missing id", async () => {
    const { loadResumeForPdf } = await import("~/lib/resume-pdf.server");
    const owner = await createUser();
    const stranger = await createUser();
    const { resume } = await seedRenderableResume(owner.id);

    expect(loadResumeForPdf(stranger.id, resume.id)).toBeNull();
    expect(loadResumeForPdf(owner.id, resume.id + 10_000)).toBeNull();
    // Sanity: the owner can load it, so the nulls above are about ownership.
    expect(loadResumeForPdf(owner.id, resume.id)).not.toBeNull();
  });
});

describe("renderResumePdf", () => {
  it("renders the selected bullets in stored order and leaves unselected ones out", async () => {
    const { renderResumePdf } = await import("~/lib/resume-pdf.server");
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id);

    const rendered = await renderResumePdf(user.id, resume.id);

    expect(rendered).not.toBeNull();
    expect(isPdf(rendered!.bytes)).toBe(true);
    expect(rendered!.fileName).toBe("Marisol-Venn-Resume.pdf");

    const { pdf, text } = await pdfOf(rendered!.bytes);
    expect(pdf.metadata.title).toBe("Marisol Venn Resume");

    const positions = [
      at(text, "Marisol Venn"),
      at(text, "Platform Engineer"),
      at(text, TEXT.platformOnly),
      at(text, "Staff Engineer"),
      at(text, TEXT.staffThird),
      at(text, TEXT.staffFirst),
    ];
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    expect(at(text, TEXT.staffUnselected)).toBe(-1);
    expect(at(text, TEXT.addedLater)).toBe(-1);
    expect(at(text, TEXT.summary)).toBeGreaterThanOrEqual(0);
  });

  it("reports the page count of the PDF it produced", async () => {
    const { renderResumePdf } = await import("~/lib/resume-pdf.server");
    const { db, schema } = await getDb();

    const short = await createUser();
    const { resume: shortResume } = await seedRenderableResume(short.id);
    const one = await renderResumePdf(short.id, shortResume.id);
    expect(one!.pageCount).toBe(1);
    expect((await pdfOf(one!.bytes)).pdf.pageCount).toBe(1);

    // Enough selected bullets to spill onto a second page.
    const long = await createUser();
    const { resume, jobs } = await seedRenderableResume(long.id);
    const texts = longResume.jobs.flatMap((j) => j.bullets).concat(longResume.jobs[0].bullets);
    texts.forEach((text, i) => {
      const row = db
        .insert(schema.bullets)
        .values({ userId: long.id, parentType: "job", parentId: jobs.staff.id, text, tags: [], sortOrder: 10 + i })
        .returning()
        .get();
      db.insert(schema.resumeBullets)
        .values({ resumeId: resume.id, bulletId: row.id, sortOrder: 10 + i })
        .run();
    });

    const many = await renderResumePdf(long.id, resume.id);
    const inspected = (await pdfOf(many!.bytes)).pdf.pageCount;
    expect(inspected).toBeGreaterThan(1);
    expect(many!.pageCount).toBe(inspected);
  });

  it("honors the custom contact override and the resume's template", async () => {
    const { renderResumePdf } = await import("~/lib/resume-pdf.server");
    const user = await createUser();
    const { resume } = await seedRenderableResume(user.id, {
      template: "minimal",
      useCustomContact: true,
      contactName: "M. Venn-Okafor",
      contactEmail: "mvo@example.com",
    });

    const rendered = await renderResumePdf(user.id, resume.id);
    const { pdf, text } = await pdfOf(rendered!.bytes);

    expect(rendered!.fileName).toBe("M-Venn-Okafor-Resume.pdf");
    expect(at(text, "M. Venn-Okafor")).toBeGreaterThanOrEqual(0);
    expect(at(text, LIBRARY_CONTACT.name)).toBe(-1);
    expect(pdf.metadata.author).toBe("M. Venn-Okafor");
    expect(pdf.links).toEqual(["mailto:mvo@example.com"]);
    // The minimal template is the one set in Lora.
    expect(pdf.fonts).toContain("Lora-Regular");
    expect(pdf.fonts.some((f) => f.startsWith("Inter"))).toBe(false);
  });

  it("returns null for another user's resume and for a missing id", async () => {
    const { renderResumePdf } = await import("~/lib/resume-pdf.server");
    const owner = await createUser();
    const stranger = await createUser();
    const { resume } = await seedRenderableResume(owner.id);

    expect(await renderResumePdf(stranger.id, resume.id)).toBeNull();
    expect(await renderResumePdf(owner.id, resume.id + 10_000)).toBeNull();
  });
});
