import { identity } from "@/lib/agent21/auth";
import { ownedRun } from "@/lib/agent21/db";
import { handler } from "@/lib/agent21/http";
import { idSchema, runView } from "@/lib/agent21/service";

export const GET = handler<{ id: string }>(async (request, { id }) =>
  Response.json(
    runView(await ownedRun(await identity(request), idSchema.parse(id))),
  ),
);
