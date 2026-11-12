import { requireUserId } from "~/lib/auth.server";
import { renderCoverLetterPdf } from "~/lib/cover-letter.server";
import { contentDisposition } from "~/lib/documents.server";
import type { Route } from "./+types/api.applications.$id.cover-letter.pdf";

// The application's cover letter as it is now, rendered on the server. Inline
// by default so a browser tab shows it; `?download=1` makes it a download.
export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const applicationId = Number(params.id);
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    throw new Response("Not found", { status: 404 });
  }
  const rendered = await renderCoverLetterPdf(userId, applicationId);
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
