/** Download file name for a resume, derived from the contact name. */
export function resumeFileName(contactName: string | null | undefined): string {
  const base = (contactName ?? "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("-");
  return base ? `${base}-Resume.pdf` : "Resume.pdf";
}
