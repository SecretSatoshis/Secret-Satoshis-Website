import { after } from "next/server";
import { identity } from "@/lib/agent21/auth";
import { handler, readJson } from "@/lib/agent21/http";
import { reconcileRun } from "@/lib/agent21/runner";
import { idSchema, submitMessage } from "@/lib/agent21/service";

export const POST = handler<{ id: string }>(async (request, { id }) => {
  const owner = await identity(request);
  const run = await submitMessage(
    owner,
    idSchema.parse(id),
    await readJson(request),
  );
  // The run starts as soon as the response is sent instead of when its
  // workflow first runs; the run's lease lets only one of them work on it, and
  // a failure here is retried by the workflow.
  after(() => reconcileRun(run.id).catch(() => undefined));
  return Response.json(run, { status: 202 });
});
