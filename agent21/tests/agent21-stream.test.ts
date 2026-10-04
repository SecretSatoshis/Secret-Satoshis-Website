import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runStream } from "../lib/agent21/stream";
import { fakeOpenAI, testDatabase } from "./support";
let database: Awaited<ReturnType<typeof testDatabase>>;
const query = (text: string, values: unknown[] = []) =>
  database.sql(text, values);
const owner = "user_stream",
  conversation = randomUUID(),
  run = randomUUID();
let subscribed = false;
const fakeFetch: typeof fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.pathname === "/v1/agents/sessions/session-stream/events") {
    subscribed = true;
    // The provider stream is live-only: the turn already ended, so it stays silent.
    const body = new ReadableStream({
      start(controller) {
        options?.signal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream" },
    });
  }
  if (url.pathname === "/v1/agents/sessions/session-stream/items")
    return Response.json({
      object: "list",
      has_more: false,
      data: [
        {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          id: "item-1",
          turn_id: "turn-stream",
          content: [{ type: "output_text", text: "Final answer." }],
        },
      ],
    });
  throw Error(`Unexpected fake provider request ${url.pathname}`);
};
before(async () => {
  database = await testDatabase();
  fakeOpenAI(fakeFetch);
  await query("INSERT INTO agent21_users(id,beta_enabled) VALUES($1,true)", [
    owner,
  ]);
  await query(
    "INSERT INTO agent21_conversations(id,owner_id,session_id,agent_id,template_id,runtime_version) VALUES($1,$2,'session-stream','agent','template','runtime')",
    [conversation, owner],
  );
  await query(
    "INSERT INTO agent21_runs(id,conversation_id,owner_id,request_id,state,session_id,turn_id,provider_accepted,display) VALUES($1,$2,$3,$4,'in_progress','session-stream','turn-stream',true,$5)",
    [
      run,
      conversation,
      owner,
      randomUUID(),
      JSON.stringify({ text: "Final", progress: "Working on your response…" }),
    ],
  );
});
after(() => database.close());
test("a stream that subscribes after the turn ended closes once the run settles", async () => {
  const started = Date.now();
  const body = new Response(
    runStream(owner, run, new AbortController().signal),
  ).text();
  // Reconciliation saves files and settles shortly after the turn ends.
  setTimeout(
    () =>
      void query(
        "UPDATE agent21_runs SET state='completed',finished_at=now(),display=$2 WHERE id=$1",
        [
          run,
          JSON.stringify({ text: "Final answer.", progress: "", files: [] }),
        ],
      ),
    1500,
  );
  const events = (await body)
    .trim()
    .split("\n\n")
    .map((frame) => JSON.parse(frame.slice("data: ".length)));
  const elapsed = Date.now() - started;
  assert(subscribed);
  assert(elapsed < 10_000, `The stream stayed open for ${elapsed}ms`);
  assert.deepEqual(
    events.map((event) => event.type),
    ["snapshot", "text", "snapshot"],
    "No interim snapshot can overwrite the streamed text",
  );
  assert.equal(events[1].text, "Final answer.");
  assert.equal(events[2].run.state, "completed");
});
