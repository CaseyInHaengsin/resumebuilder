import { requireUserId } from "~/lib/auth.server";
import { contentDisposition, readDocument } from "~/lib/documents.server";
import type { Route } from "./+types/documents.$id";

// A stored copy of a document sent with an application. Owner only.
export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Response("Not found", { status: 404 });
  }
  const found = await readDocument(userId, id);
  if (!found) throw new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition("attachment", found.row.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
