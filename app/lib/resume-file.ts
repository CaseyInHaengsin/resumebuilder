/** Name part of a download file name: letters, digits and hyphens, words joined by "-". */
function nameBase(contactName: string | null | undefined): string {
  return (contactName ?? "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("-");
}

/** Download file name for a resume, derived from the contact name. */
export function resumeFileName(contactName: string | null | undefined): string {
  const base = nameBase(contactName);
  return base ? `${base}-Resume.pdf` : "Resume.pdf";
}

/** Download file name for a cover letter, derived from the contact name. */
export function coverLetterFileName(contactName: string | null | undefined): string {
  const base = nameBase(contactName);
  return base ? `${base}-Cover-Letter.pdf` : "Cover-Letter.pdf";
}
