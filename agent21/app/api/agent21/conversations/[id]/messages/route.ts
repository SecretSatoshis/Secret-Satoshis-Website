import { identity } from "@/lib/agent21/auth";
import { handler, readJson } from "@/lib/agent21/http";
import { idSchema, submitMessage } from "@/lib/agent21/service";

export const POST = handler<{ id: string }>(async (request, { id }) => {
  const owner = await identity(request);
  return Response.json(
    await submitMessage(owner, idSchema.parse(id), await readJson(request)),
    { status: 202 },
  );
});
