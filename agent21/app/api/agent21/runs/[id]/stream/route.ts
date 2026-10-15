import { identity } from "@/lib/agent21/auth";
import { ownedRun } from "@/lib/agent21/db";
import { handler } from "@/lib/agent21/http";
import { idSchema } from "@/lib/agent21/service";
import { runStream } from "@/lib/agent21/stream";

// The stream closes after 45 seconds and the browser reconnects.
export const maxDuration = 60;
export const GET = handler<{ id: string }>(async (request, { id }) => {
  const owner = await identity(request);
  const runId = idSchema.parse(id);
  // A run the account does not own is a 404, not a stream that asks the
  // browser to reconnect forever.
  await ownedRun(owner, runId);
  return new Response(runStream(owner, runId, request.signal), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
