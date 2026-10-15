import { identity } from "@/lib/agent21/auth";
import { handler, readJson } from "@/lib/agent21/http";
import { warmEnvironment } from "@/lib/agent21/warm";

// The browser asks when the user starts writing, so the sandbox starts while
// they type instead of after they send.
export const POST = handler(async (request) => {
  const owner = await identity(request);
  return Response.json(await warmEnvironment(owner, await readJson(request)));
});
