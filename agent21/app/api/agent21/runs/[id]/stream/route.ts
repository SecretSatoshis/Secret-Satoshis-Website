import { identity } from "@/lib/agent21/auth";
import { handler } from "@/lib/agent21/http";
import { idSchema } from "@/lib/agent21/service";
import { runStream } from "@/lib/agent21/stream";

// The stream closes after 45 seconds and the browser reconnects.
export const maxDuration = 60;
export const GET = handler<{ id: string }>(async (request, { id }) => {
  const owner = await identity(request);
  return new Response(runStream(owner, idSchema.parse(id), request.signal), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
