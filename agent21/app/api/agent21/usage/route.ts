import { identity } from "@/lib/agent21/auth";
import { handler } from "@/lib/agent21/http";
import { spendSummary } from "@/lib/agent21/usage";

// The account's estimated Agent 21 spend against its beta allowance, shown in
// the conversation header.
export const GET = handler(async (request) => {
  const owner = await identity(request);
  return Response.json(await spendSummary(owner), {
    headers: { "Cache-Control": "no-store" },
  });
});
