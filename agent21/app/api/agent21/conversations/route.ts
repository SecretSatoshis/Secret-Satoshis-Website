import { identity } from "@/lib/agent21/auth";
import { handler, readJson } from "@/lib/agent21/http";
import { createConversation, listConversations } from "@/lib/agent21/service";

export const GET = handler(async (request) =>
  Response.json(await listConversations(await identity(request))),
);
export const POST = handler(async (request) => {
  const owner = await identity(request);
  return Response.json(
    await createConversation(owner, await readJson(request)),
  );
});
