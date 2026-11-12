import { createElement } from "react";
import type { ResumeData, TemplateId } from "~/components/pdf/types";

/**
 * Real page count of a resume in a template. Renders the document with
 * react-pdf and counts the pages in the produced PDF. Browser-safe: no
 * Node-only APIs. Import dynamically; react-pdf must not load during SSR.
 */
export async function countResumePages(templateId: TemplateId, data: ResumeData): Promise<number> {
  const [{ pdf }, { templateComponents }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("~/components/pdf/templates"),
  ]);
  const Template = templateComponents[templateId];
  const blob = await pdf(
    createElement(Template, { data }) as unknown as Parameters<typeof pdf>[0],
  ).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return countPdfPages(new TextDecoder("latin1").decode(bytes));
}

/** Counts `/Type /Page` objects (not `/Pages`) in the PDF source. */
export function countPdfPages(source: string): number {
  return source.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
}
