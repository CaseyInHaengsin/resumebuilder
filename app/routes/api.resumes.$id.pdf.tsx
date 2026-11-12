import { requireUserId } from "~/lib/auth.server";
import { contentDisposition } from "~/lib/documents.server";
import { renderResumePdf } from "~/lib/resume-pdf.server";
import type { Route } from "./+types/api.resumes.$id.pdf";

// The resume as it is now, rendered on the server. Inline by default so a
// browser tab shows it; `?download=1` makes it a download.
export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const resumeId = Number(params.id);
  if (!Number.isInteger(resumeId) || resumeId <= 0) {
    throw new Response("Not found", { status: 404 });
  }
  const rendered = await renderResumePdf(userId, resumeId);
  if (!rendered) throw new Response("Not found", { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(rendered.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(
        download ? "attachment" : "inline",
        rendered.fileName,
      ),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
