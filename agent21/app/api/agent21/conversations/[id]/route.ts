import { identity } from "@/lib/agent21/auth";
import { handler, readJson } from "@/lib/agent21/http";
import {
  deleteConversation,
  idSchema,
  loadConversation,
  updateConversation,
} from "@/lib/agent21/service";

export const GET = handler<{ id: string }>(async (request, { id }) =>
  Response.json(
    await loadConversation(await identity(request), idSchema.parse(id)),
  ),
);
export const PATCH = handler<{ id: string }>(async (request, { id }) => {
  const owner = await identity(request);
  return Response.json(
    await updateConversation(
      owner,
      idSchema.parse(id),
      await readJson(request),
    ),
  );
});
export const DELETE = handler<{ id: string }>(async (request, { id }) =>
  Response.json(
    await deleteConversation(await identity(request), idSchema.parse(id)),
    { status: 202 },
  ),
);
