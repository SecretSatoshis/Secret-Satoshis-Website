import { identity } from "@/lib/agent21/auth";
import { handler } from "@/lib/agent21/http";
import { completeUpload, idSchema } from "@/lib/agent21/service";

export const POST = handler<{ id: string }>(async (request, { id }) =>
  Response.json(
    await completeUpload(await identity(request), idSchema.parse(id)),
  ),
);
