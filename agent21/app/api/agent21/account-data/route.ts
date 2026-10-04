import { identity } from "@/lib/agent21/auth";
import { handler } from "@/lib/agent21/http";
import { deleteConversation } from "@/lib/agent21/service";

export const DELETE = handler(async (request) =>
  Response.json(await deleteConversation(await identity(request, true)), {
    status: 202,
  }),
);
