import { createElement } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { applications, contact, coverLetters, resumes } from "~/db/schema";
import { TEMPLATES, type ResumeContact, type TemplateId } from "~/components/pdf/types";
import { appToday, formatLongDate } from "~/lib/dates";
import { countPdfPages } from "~/lib/pdf-pages";
import { coverLetterFileName } from "~/lib/resume-file";
// Importing this module also makes sure FONTS_DIR is set before fonts register.
import "~/lib/resume-pdf.server";

export interface RenderedCoverLetterPdf {
  bytes: Buffer;
  fileName: string;
  pageCount: number;
}

/**
 * Renders the application's cover letter to PDF bytes. The header comes from
 * the linked resume (its custom contact when it uses one, and its template),
 * else from the user's contact row and the modern template. Null when the
 * application is not the user's or has no letter.
 */
export async function renderCoverLetterPdf(
  userId: number,
  applicationId: number,
): Promise<RenderedCoverLetterPdf | null> {
  const app = db
    .select({ id: applications.id, resumeId: applications.resumeId })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .get();
  if (!app) return null;
  const letter = db
    .select()
    .from(coverLetters)
    .where(and(eq(coverLetters.applicationId, applicationId), eq(coverLetters.userId, userId)))
    .get();
  if (!letter) return null;

  const resume =
    app.resumeId == null
      ? undefined
      : db
          .select()
          .from(resumes)
          .where(and(eq(resumes.id, app.resumeId), eq(resumes.userId, userId)))
          .get();
  const contactRow = db.select().from(contact).where(eq(contact.userId, userId)).get();

  let sender: ResumeContact;
  if (resume?.useCustomContact) {
    sender = {
      name: resume.contactName ?? "",
      phone: resume.contactPhone,
      email: resume.contactEmail ?? "",
      linkedin: resume.contactLinkedin,
      github: resume.contactGithub,
    };
  } else if (contactRow) {
    sender = {
      name: contactRow.name,
      phone: contactRow.phone,
      email: contactRow.email,
      linkedin: contactRow.linkedin,
      github: contactRow.github,
    };
  } else {
    sender = { name: "", email: "" };
  }
  const template: TemplateId = TEMPLATES.some((t) => t.id === resume?.template)
    ? (resume!.template as TemplateId)
    : "modern";

  const [{ renderToBuffer }, { CoverLetterDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("~/components/pdf/CoverLetterDocument"),
  ]);
  const bytes = await renderToBuffer(
    createElement(CoverLetterDocument, {
      data: {
        contact: sender,
        template,
        date: formatLongDate(appToday()),
        recipient: letter.recipient,
        body: letter.body,
      },
    }) as unknown as Parameters<typeof renderToBuffer>[0],
  );

  return {
    bytes,
    fileName: coverLetterFileName(sender.name),
    pageCount: countPdfPages(bytes.toString("latin1")),
  };
}
