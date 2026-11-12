import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  applicationDocuments,
  applications,
  type ApplicationDocumentKind,
  type ApplicationStatus,
} from "~/db/schema";
import { renderResumePdf } from "~/lib/resume-pdf.server";

// Stored PDFs (sent copies of resumes and cover letters). DOCUMENTS_DIR lets
// tests point at a throwaway directory; it is read on every call and created
// on the first write.
export function getDocumentsDir(): string {
  return path.resolve(process.env.DOCUMENTS_DIR ?? "data/documents");
}

/** Absolute path of a stored file; refuses anything but a bare file name. */
function storedPath(storedName: string): string {
  if (!storedName || storedName !== path.basename(storedName) || storedName.startsWith(".")) {
    throw new Error(`Invalid stored document name: ${storedName}`);
  }
  return path.join(getDocumentsDir(), storedName);
}

/** `Content-Disposition` value; adds an RFC 5987 name when the file name is not ASCII. */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  if (ascii === fileName) return `${type}; filename="${fileName}"`;
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export interface StoreDocumentInput {
  userId: number;
  applicationId: number;
  kind: ApplicationDocumentKind;
  fileName: string;
  bytes: Uint8Array;
  resumeId?: number | null;
  template?: string | null;
  pageCount?: number | null;
}

/**
 * Writes the file, then records it. A failed write throws before any row
 * exists; a failed insert removes the file again.
 */
export async function storeDocument(input: StoreDocumentInput): Promise<{ id: number }> {
  const dir = getDocumentsDir();
  await mkdir(dir, { recursive: true });
  const storedName = `u${input.userId}-a${input.applicationId}-${crypto.randomUUID().replace(/-/g, "")}.pdf`;
  const diskPath = storedPath(storedName);
  await writeFile(diskPath, input.bytes, { flag: "wx" });
  try {
    return db
      .insert(applicationDocuments)
      .values({
        userId: input.userId,
        applicationId: input.applicationId,
        kind: input.kind,
        fileName: input.fileName,
        storedName,
        resumeId: input.resumeId ?? null,
        template: input.template ?? null,
        pageCount: input.pageCount ?? null,
        createdAt: new Date().toISOString(),
      })
      .returning({ id: applicationDocuments.id })
      .get();
  } catch (err) {
    await rm(diskPath, { force: true });
    throw err;
  }
}

async function removeFiles(storedNames: string[]): Promise<void> {
  for (const name of storedNames) {
    try {
      await rm(storedPath(name), { force: true });
    } catch (err) {
      console.error(`[documents] could not remove ${name}:`, err);
    }
  }
}

export type SnapshotResult = { id: number } | { error: "not_found" | "no_resume" };

/**
 * Renders the application's linked resume as it is now and stores the PDF
 * with the application. `no_resume` also covers a linked resume that is not
 * the user's. Throws when the file cannot be written (no row is left behind).
 */
export async function snapshotResumeForApplication(
  userId: number,
  applicationId: number,
): Promise<SnapshotResult> {
  const app = db
    .select({ id: applications.id, resumeId: applications.resumeId })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .get();
  if (!app) return { error: "not_found" };
  if (app.resumeId == null) return { error: "no_resume" };

  const rendered = await renderResumePdf(userId, app.resumeId);
  if (!rendered) return { error: "no_resume" };

  const { id } = await storeDocument({
    userId,
    applicationId,
    kind: "resume",
    fileName: rendered.fileName,
    bytes: rendered.bytes,
    resumeId: app.resumeId,
    template: rendered.template,
    pageCount: rendered.pageCount,
  });
  return { id };
}

/**
 * The automatic sent copy: when an application moves from wishlist to
 * applied, snapshot its linked resume. Never throws, so a failure here cannot
 * undo or fail the status change.
 */
export async function snapshotOnApplied(
  userId: number,
  applicationId: number,
  from: ApplicationStatus,
  to: ApplicationStatus,
): Promise<void> {
  if (from !== "wishlist" || to !== "applied") return;
  try {
    await snapshotResumeForApplication(userId, applicationId);
  } catch (err) {
    console.error(`[documents] automatic snapshot for application ${applicationId} failed:`, err);
  }
}

/** The application's documents, newest first, without storage details. */
export function listApplicationDocuments(userId: number, applicationId: number) {
  return db
    .select({
      id: applicationDocuments.id,
      kind: applicationDocuments.kind,
      fileName: applicationDocuments.fileName,
      pageCount: applicationDocuments.pageCount,
      createdAt: applicationDocuments.createdAt,
    })
    .from(applicationDocuments)
    .where(
      and(
        eq(applicationDocuments.applicationId, applicationId),
        eq(applicationDocuments.userId, userId),
      ),
    )
    .orderBy(desc(applicationDocuments.createdAt), desc(applicationDocuments.id))
    .all();
}

/** The stored bytes of one of the user's documents, or null (missing row or file). */
export async function readDocument(userId: number, documentId: number) {
  const row = db
    .select()
    .from(applicationDocuments)
    .where(
      and(eq(applicationDocuments.id, documentId), eq(applicationDocuments.userId, userId)),
    )
    .get();
  if (!row) return null;
  try {
    const bytes = await readFile(storedPath(row.storedName));
    return { row, bytes };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Deletes one of the user's documents and its file. False when it is not theirs. */
export async function deleteDocument(userId: number, documentId: number): Promise<boolean> {
  const row = db
    .delete(applicationDocuments)
    .where(
      and(eq(applicationDocuments.id, documentId), eq(applicationDocuments.userId, userId)),
    )
    .returning({ storedName: applicationDocuments.storedName })
    .get();
  if (!row) return false;
  await removeFiles([row.storedName]);
  return true;
}

/**
 * Deletes one of the user's applications. Its document rows go with it
 * (foreign-key cascade); this also removes their files.
 */
export async function deleteApplication(userId: number, applicationId: number): Promise<boolean> {
  const storedNames = db
    .select({ storedName: applicationDocuments.storedName })
    .from(applicationDocuments)
    .where(
      and(
        eq(applicationDocuments.applicationId, applicationId),
        eq(applicationDocuments.userId, userId),
      ),
    )
    .all()
    .map((r) => r.storedName);
  const deleted = db
    .delete(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .run();
  if (deleted.changes === 0) return false;
  await removeFiles(storedNames);
  return true;
}
