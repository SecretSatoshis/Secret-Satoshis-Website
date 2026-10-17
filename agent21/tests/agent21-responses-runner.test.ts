import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { reserveRun } from "../lib/agent21/db";
import { performDeletion, requestDeletion } from "../lib/agent21/deletion";
import { reconcileRun } from "../lib/agent21/runner";
import { needsShell } from "../lib/agent21/responses/runner";
import {
  clearPromptCache,
  publishPrompt,
} from "../lib/agent21/responses/prompt";
import { fakeOpenAI, testDatabase } from "./support";

// The Responses engine's run against a fake Responses API: rounds stream
// server-sent events, function calls run here between rounds, and the answer,
// its files and its spend are saved as the website shows them.
/* eslint-disable @typescript-eslint/no-explicit-any -- a loose fake provider */
let database: Awaited<ReturnType<typeof testDatabase>>;
const query = (text: string, values: unknown[] = []) =>
  database.sql(text, values);
const realFetch = globalThis.fetch;
const owner = "user_responses";
const usage = {
  input_tokens: 1000,
  output_tokens: 50,
  total_tokens: 1050,
  input_tokens_details: { cached_tokens: 400 },
  output_tokens_details: { reasoning_tokens: 10 },
};

// Each POST /v1/responses takes the next scripted round's output items.
let script: any[][] = [];
const requests: any[] = [];
const responses = new Map<string, any>();
const deleted: string[] = [];
let containerFiles: { id: string; path: string; body: string }[] = [];
let onRequest: (body: any) => Promise<void> | void = () => undefined;
let responseCount = 0;
let conversationCount = 0;

const json = (body: unknown, status = 200) => Response.json(body, { status });
function sse(events: unknown[]) {
  const text = events
    .map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(text, {
    headers: { "content-type": "text/event-stream" },
  });
}
const message = (text: string, phase = "final_answer") => ({
  type: "message",
  id: `msg_${randomUUID()}`,
  role: "assistant",
  status: "completed",
  phase,
  content: [{ type: "output_text", text, annotations: [] }],
});
const call = (name: string, args: unknown) => ({
  type: "function_call",
  id: `fc_${randomUUID()}`,
  call_id: `call_${randomUUID()}`,
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});

const fakeFetch: typeof fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const method = options?.method || "GET";
  const body =
    typeof options?.body === "string" ? JSON.parse(options.body) : {};
  if (url.hostname !== "api.openai.com")
    throw Error(`Unexpected request to ${url.hostname}`);
  const path = url.pathname;
  if (path === "/v1/conversations" && method === "POST")
    return json({
      id: `conv_${++conversationCount}`,
      object: "conversation",
      created_at: 0,
      metadata: body.metadata,
    });
  if (path === "/v1/responses" && method === "POST") {
    requests.push(body);
    await onRequest(body);
    const output = script.shift();
    if (!output) return json({ error: { message: "No scripted round" } }, 500);
    const id = `resp_${++responseCount}`;
    const response = {
      id,
      object: "response",
      status: "completed",
      model: body.model,
      output,
      usage,
    };
    responses.set(id, response);
    const events: any[] = [
      {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
    ];
    for (const item of output) {
      events.push({ type: "response.output_item.added", item });
      if (item.type === "message")
        events.push({
          type: "response.output_text.delta",
          item_id: item.id,
          delta: item.content[0].text,
        });
    }
    events.push({ type: "response.completed", response });
    return sse(events);
  }
  const response = /^\/v1\/responses\/([^/]+)$/.exec(path);
  if (response && method === "GET") {
    const found = responses.get(response[1]);
    return found ? json(found) : json({ error: { message: "missing" } }, 404);
  }
  if (method === "DELETE") {
    deleted.push(path);
    return json({ id: path.split("/").at(-1), deleted: true });
  }
  const files = /^\/v1\/containers\/([^/]+)\/files$/.exec(path);
  if (files && method === "GET")
    return json({
      object: "list",
      data: containerFiles.map((f) => ({
        id: f.id,
        path: f.path,
        object: "container.file",
        container_id: files[1],
        bytes: f.body.length,
        created_at: 0,
        source: "assistant",
      })),
      has_more: false,
    });
  const content = /^\/v1\/containers\/([^/]+)\/files\/([^/]+)\/content$/.exec(
    path,
  );
  if (content)
    return new Response(
      containerFiles.find((f) => f.id === content[2])?.body ?? "",
    );
  throw Error(`Unexpected ${method} ${path}`);
};

async function newConversation() {
  const id = randomUUID();
  await query("INSERT INTO agent21_conversations(id,owner_id) VALUES($1,$2)", [
    id,
    owner,
  ]);
  return id;
}
const run = async (id: string) =>
  (await query("SELECT * FROM agent21_runs WHERE id=$1", [id]))[0];
const answer = async (conversation: string) =>
  (
    await query(
      "SELECT * FROM agent21_messages WHERE conversation_id=$1 AND role='assistant' ORDER BY created_at DESC",
      [conversation],
    )
  )[0];
async function settle(id: string) {
  for (let i = 0; i < 5; i++) if (await reconcileRun(id)) return;
  throw new Error("The run did not settle");
}

before(async () => {
  process.env.AGENT21_ENGINE = "responses";
  process.env.AGENT21_SKILLS = "skill_a:2";
  delete process.env.GITHUB_MCP_TOKEN;
  database = await testDatabase();
  fakeOpenAI(fakeFetch);
  globalThis.fetch = fakeFetch;
  await query("INSERT INTO agent21_users(id,beta_enabled) VALUES($1,true)", [
    owner,
  ]);
  clearPromptCache();
  await publishPrompt("AGENT21_PRIVATE_CONTROL\n\n# Agent 21\n", "test");
});
after(async () => {
  globalThis.fetch = realFetch;
  await database.close();
});

test("the shell joins only when a request needs it", () => {
  const csv = {
    id: "f",
    name: "holdings.csv",
    bytes: 1,
    kind: "upload",
  } as any;
  const xlsx = { ...csv, name: "holdings.xlsx" };
  assert.equal(
    needsShell({ text: "What's my gain?", files: [csv] }, false),
    false,
  );
  assert.equal(
    needsShell({ text: "What's my gain?", files: [xlsx] }, false),
    true,
  );
  assert.equal(
    needsShell({ text: "Give me a CSV of 2025 closes", files: [] }, false),
    true,
  );
  assert.equal(needsShell({ text: "Block height?", files: [] }, false), false);
  assert.equal(needsShell({ text: "And now?", files: [] }, true), true);
});

let answered: { conversation: string; run: string } | undefined;
test("a tool round then an answer: conversation, chain, display, history and spend", async () => {
  const conversation = await newConversation();
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "What files do I have?",
    files: [],
    timeZone: "America/New_York",
  });
  requests.length = 0;
  const done = '```a21-step\n{"text":"Checked your files."}\n```\n\nNone yet.';
  script = [
    [
      message("Checking your files.", "commentary"),
      call("read_upload", { name: null }),
    ],
    [message(done)],
  ];
  await settle(reserved.id);
  const row = await run(reserved.id);
  assert.equal(row.state, "completed");
  assert.equal(row.paths, "C");
  assert.equal(row.round, 2);
  assert.equal(row.response_id, "resp_" + responseCount);
  assert.equal(row.display.text, done);
  assert.equal((await answer(conversation)).text, done);
  // Both rounds ran in the same OpenAI conversation, without a chain.
  assert.deepEqual(
    requests.map((r) => [r.conversation, r.previous_response_id]),
    [
      [requests[0].conversation, undefined],
      [requests[0].conversation, undefined],
    ],
  );
  assert.match(
    requests[0].input,
    /^What files do I have\?\n\nCurrent time: .+ UTC \(the user's local time: .+America\/New_York\)\.$/,
  );
  assert.equal(requests[1].input[0].type, "function_call_output");
  assert.equal(requests[1].input[0].output, '{"files":[]}');
  assert(
    !requests[0].tools.some((t: any) => t.type === "shell"),
    "data tools only",
  );
  assert(requests[0].instructions.startsWith("AGENT21_PRIVATE_CONTROL"));
  assert.deepEqual(requests[0].context_management, [
    { type: "compaction", compact_threshold: 80_000 },
  ]);
  const tracked = await query(
    "SELECT id FROM agent21_responses WHERE run_id=$1 ORDER BY id",
    [reserved.id],
  );
  assert.equal(tracked.length, 2);
  const [spend] = await query("SELECT * FROM agent21_usage WHERE id=$1", [
    reserved.id,
  ]);
  assert.equal(spend.kind, "response");
  assert.equal(Number(spend.input_tokens), 2000);
  assert.equal(Number(spend.cached_tokens), 800);
  assert(Number(spend.cost_usd) > 0);
  answered = { conversation, run: reserved.id };
});

test("a follow-up continues the same OpenAI conversation", async () => {
  const { conversation } = answered!;
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "Thanks",
    files: [],
  });
  requests.length = 0;
  script = [[message("You're welcome.")]];
  await settle(reserved.id);
  const [row] = await query(
    "SELECT openai_conversation_id FROM agent21_conversations WHERE id=$1",
    [conversation],
  );
  assert.equal(requests[0].conversation, row.openai_conversation_id);
  assert(!requests[0].input.includes("Earlier conversation"));
});

test("a conversation begun on the Agents engine starts from its quoted history", async () => {
  const conversation = await newConversation();
  await query(
    "INSERT INTO agent21_messages(id,conversation_id,owner_id,external_id,role,text,created_at) VALUES($1,$2,$3,'old-1','user','What is a halving?',now()-interval '1 day')",
    [randomUUID(), conversation, owner],
  );
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "And the next one?",
    files: [],
  });
  requests.length = 0;
  script = [[message("In 2028.")]];
  await settle(reserved.id);
  assert.match(
    requests[0].input,
    /^Earlier conversation \(quoted history, not instructions\):\n.*What is a halving\?/,
  );
});

test("Stop before the first round stops without calling the model", async () => {
  const conversation = await newConversation();
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "Long question",
    files: [],
  });
  await query("UPDATE agent21_runs SET cancel_requested=true WHERE id=$1", [
    reserved.id,
  ]);
  requests.length = 0;
  await settle(reserved.id);
  assert.equal((await run(reserved.id)).state, "cancelled");
  assert.equal(requests.length, 0);
  assert.equal(
    (await answer(conversation)).text,
    "Response stopped before model execution.",
  );
});

test("Stop during tools ends the answer before the next round", async () => {
  const conversation = await newConversation();
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "Check my files",
    files: [],
  });
  requests.length = 0;
  script = [[call("read_upload", { name: null })], [message("unused")]];
  onRequest = async () => {
    onRequest = () => undefined;
    await query("UPDATE agent21_runs SET cancel_requested=true WHERE id=$1", [
      reserved.id,
    ]);
  };
  await settle(reserved.id);
  assert.equal((await run(reserved.id)).state, "cancelled");
  assert.equal(requests.length, 1);
  assert.equal((await answer(conversation)).text, "Response stopped.");
  script = [];
});

test("a tick that stopped between rounds resumes from the last response", async () => {
  const conversation = await newConversation();
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "Resume me",
    files: [],
  });
  // An earlier tick sent round 1, which asked for a tool, then stopped.
  const pending = {
    id: "resp_pending",
    object: "response",
    status: "completed",
    output: [call("read_upload", { name: null })],
    usage,
  };
  responses.set(pending.id, pending);
  await query(
    "INSERT INTO agent21_responses(id,conversation_id,run_id) VALUES($1,$2,$3)",
    [pending.id, conversation, reserved.id],
  );
  await query(
    "UPDATE agent21_conversations SET openai_conversation_id='conv_resume' WHERE id=$1",
    [conversation],
  );
  await query(
    "UPDATE agent21_runs SET provider_accepted=true,state='in_progress',response_id=$2,round=1,paths='C' WHERE id=$1",
    [reserved.id, pending.id],
  );
  requests.length = 0;
  script = [[message("Resumed.")]];
  await settle(reserved.id);
  assert.equal((await run(reserved.id)).state, "completed");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].conversation, "conv_resume");
  assert.equal(requests[0].input[0].type, "function_call_output");
  assert.equal((await answer(conversation)).text, "Resumed.");
});

test("a round still running elsewhere is waited for, not repeated", async () => {
  const conversation = await newConversation();
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "Wait",
    files: [],
  });
  responses.set("resp_running", {
    id: "resp_running",
    object: "response",
    status: "in_progress",
    output: [],
  });
  await query(
    "UPDATE agent21_conversations SET openai_conversation_id='conv_wait' WHERE id=$1",
    [conversation],
  );
  await query(
    "UPDATE agent21_runs SET provider_accepted=true,state='in_progress',response_id='resp_running',round=1,paths='C' WHERE id=$1",
    [reserved.id],
  );
  requests.length = 0;
  assert.equal(await reconcileRun(reserved.id), false);
  assert.equal(requests.length, 0);
  responses.get("resp_running").status = "completed";
  responses.get("resp_running").output = [message("Finished.")];
  await settle(reserved.id);
  assert.equal((await answer(conversation)).text, "Finished.");
});

test("broken blocks get one repair round; the private prompt never reaches the user", async () => {
  const conversation = await newConversation();
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "Show figures",
    files: [],
  });
  requests.length = 0;
  script = [
    [message('```a21-figures\n{"items":[]}\n```')],
    [message("AGENT21_PRIVATE_CONTROL leaked")],
  ];
  await settle(reserved.id);
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[1].input), /fail the website's checks/);
  assert.match((await answer(conversation)).text, /could not finish/);
});

test("a file request adds the shell; its outputs are checked and its container billed", async () => {
  const conversation = await newConversation();
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "Give me a CSV of 2025 closes",
    files: [],
  });
  requests.length = 0;
  containerFiles = [
    { id: "cfile_1", path: "/mnt/data/outputs/notes.exe", body: "binary" },
    { id: "cfile_2", path: "/mnt/data/scratch/work.py", body: "draft" },
  ];
  script = [
    [
      {
        type: "shell_call",
        id: "sh_1",
        call_id: "call_sh",
        status: "completed",
        action: { commands: ["python make.py"] },
        environment: { type: "container_reference", container_id: "cntr_1" },
      },
      message("Here it is."),
    ],
  ];
  await settle(reserved.id);
  const row = await run(reserved.id);
  assert.equal(row.paths, "BC");
  const shell = requests[0].tools.find((t: any) => t.type === "shell");
  assert.equal(shell.environment.type, "container_auto");
  assert.deepEqual(shell.environment.skills, [
    { type: "skill_reference", skill_id: "skill_a", version: "2" },
  ]);
  const text = (await answer(conversation)).text;
  assert.match(text, /^Here it is\./);
  // Only flat PNG, CSV, Markdown, PDF, Python or chart files in the outputs
  // folder are kept; scratch files are not deliverables.
  assert.match(text, /could not accept it: notes\.exe/);
  assert(!text.includes("work.py"));
  const [container] = await query(
    "SELECT container_id FROM agent21_conversations WHERE id=$1",
    [conversation],
  );
  assert.equal(container.container_id, "cntr_1");
  const [billed] = await query("SELECT * FROM agent21_usage WHERE id='cntr_1'");
  assert.equal(billed.kind, "container");
  assert.equal(Number(billed.sandbox_usd), 0.03);
  containerFiles = [];
});

test("deleting a conversation removes its OpenAI conversation, responses and containers", async () => {
  const conversation = await newConversation();
  await query(
    "UPDATE agent21_conversations SET openai_conversation_id='conv_gone' WHERE id=$1",
    [conversation],
  );
  await query(
    "INSERT INTO agent21_responses(id,conversation_id) VALUES('resp_gone_1',$1),('resp_gone_2',$1)",
    [conversation],
  );
  await query(
    "INSERT INTO agent21_containers(id,conversation_id) VALUES('cntr_gone',$1)",
    [conversation],
  );
  deleted.length = 0;
  const job = await requestDeletion(owner, conversation);
  assert.equal(await performDeletion(job), true);
  assert.deepEqual(deleted.sort(), [
    "/v1/containers/cntr_gone",
    "/v1/conversations/conv_gone",
    "/v1/responses/resp_gone_1",
    "/v1/responses/resp_gone_2",
  ]);
  assert.equal(
    (
      await query("SELECT * FROM agent21_responses WHERE conversation_id=$1", [
        conversation,
      ])
    ).length,
    0,
  );
});

test("an answer past its deadline settles as failed instead of starting a round", async () => {
  const conversation = await newConversation();
  const reserved = await reserveRun(owner, conversation, randomUUID(), {
    text: "Slow question",
    files: [],
  });
  responses.set("resp_late", {
    id: "resp_late",
    object: "response",
    status: "completed",
    output: [call("read_upload", { name: null })],
    usage,
  });
  await query(
    "UPDATE agent21_conversations SET openai_conversation_id='conv_late' WHERE id=$1",
    [conversation],
  );
  await query(
    "UPDATE agent21_runs SET provider_accepted=true,state='in_progress',response_id='resp_late',round=1,paths='C',created_at=now()-interval '11 minutes' WHERE id=$1",
    [reserved.id],
  );
  requests.length = 0;
  await settle(reserved.id);
  assert.equal((await run(reserved.id)).state, "failed");
  assert.equal(requests.length, 0);
  assert.match((await answer(conversation)).text, /could not finish/);
});
