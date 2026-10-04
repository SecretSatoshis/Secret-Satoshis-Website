import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { reserveRun } from "../lib/agent21/db";
import { reconcileRun, markUncertain } from "../lib/agent21/runner";
import { requestDeletion, performDeletion } from "../lib/agent21/deletion";
import { fakeOpenAI, testDatabase } from "./support";
const MCP_KEY = "mcp-test-key-0123456789abcdef0123456789";
const MCP_SERVER_URL = "https://data.example.test/api/mcp";
let database: Awaited<ReturnType<typeof testDatabase>>;
const query = (text: string, values: unknown[] = []) =>
  database.sql(text, values);
const realFetch = globalThis.fetch;
const owner = "user_recovery",
  conversation = randomUUID();
/* eslint-disable @typescript-eslint/no-explicit-any -- a loose fake provider */
const sessions = new Map<string, any>(),
  turns = new Map<string, any[]>(),
  inputs = new Map<string, string>(),
  creations = new Map<string, any>(),
  environmentFiles = new Map<string, Set<string>>();
const expired = new Set<string>();
const artifacts = new Map<string, any[]>();
let createCount = 0,
  rejectCreation = 0,
  environmentFileCopies = 0,
  rejectSubmission = false,
  loseSubmission = false,
  loseCreation = false,
  failArtifacts = false,
  failSessionDelete = false;
const response = (body: unknown, status = 200) =>
  Response.json(body, { status });
const list = (data: unknown[]) =>
  response({ object: "list", data, has_more: false });
const saved = async (id = conversation) =>
  query(
    "SELECT * FROM agent21_messages WHERE conversation_id=$1 ORDER BY created_at",
    [id],
  );
const usage = {
  input_tokens: 100,
  output_tokens: 100,
  total_tokens: 200,
  input_tokens_details: { cached_tokens: 0 },
};
function startTurn(session: string) {
  const turn = {
    id: `turn-${session}-${turns.get(session)!.length + 1}`,
    session_id: session,
    agent_id: "agent-selected",
    status: "in_progress",
    created_at: Math.floor(Date.now() / 1000),
    subagent_id: null,
    usage,
  };
  turns.get(session)!.unshift(turn);
}
const fakeFetch: typeof fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const method = options?.method || "GET";
  const body =
    typeof options?.body === "string" ? JSON.parse(options.body) : {};
  const key = new Headers(options?.headers).get("idempotency-key");
  if (url.hostname !== "api.openai.com")
    throw Error(`Unexpected request to ${url.hostname}`);
  if (url.pathname === "/v1/agents/agent-selected" && method === "GET")
    return response({
      id: "agent-selected",
      tools: [
        {
          type: "mcp",
          server_label: "agent21_data",
          transport: { type: "http", server_url: MCP_SERVER_URL, headers: {} },
          allowed_tools: ["mempoolGetRecommendedFees"],
          connection_origin: "service",
          credential_id: null,
          request_metadata: null,
          required: true,
        },
      ],
    });
  if (url.pathname === "/v1/agents/sessions" && method === "GET")
    return list([...sessions.values()].reverse());
  if (url.pathname === "/v1/agents/sessions" && method === "POST") {
    if (rejectCreation) {
      rejectCreation--;
      return response({ error: { message: "Rate limited" } }, 429);
    }
    if (rejectSubmission && body.input)
      return response({ error: { message: "Input too long" } }, 400);
    assert.equal(body.environment.container_size, "medium");
    assert(!body.environment.network, "Network access comes from the template");
    assert.equal(body.agent_id, "agent-selected");
    const [mcp] = body.agent.tools;
    assert.equal(mcp.transport.server_url, MCP_SERVER_URL);
    assert.equal(mcp.transport.headers["X-Agent21-MCP-Key"], MCP_KEY);
    assert.equal(
      mcp.transport.headers["OAI-Sites-Authorization"],
      `Bearer ${MCP_KEY}`,
    );
    const id = `session-${++createCount}`;
    const session = {
      id,
      status: "in_progress",
      environment: { type: "openai_hosted", id: `env-${id}` },
      required_actions: [],
      metadata: body.metadata,
      created_at: Math.floor(Date.now() / 1000),
    };
    sessions.set(id, session);
    turns.set(id, []);
    environmentFiles.set(
      `env-${id}`,
      new Set((body.environment.files ?? []).map((f: any) => f.path)),
    );
    creations.set(body.metadata.run, { session: id, body });
    if (body.input) startTurn(id);
    if (loseCreation) {
      loseCreation = false;
      throw Error("Connection lost after sandbox creation");
    }
    return response(session);
  }
  const files = url.pathname.match(/\/environments\/(env-session-\d+)\/files$/);
  if (files) {
    const present = environmentFiles.get(files[1])!;
    if (method === "GET")
      return response({
        object: "list",
        data: [...present]
          .filter((path) => path.startsWith(`${url.searchParams.get("path")}/`))
          .map((path) => ({
            object: "agent.environment.file",
            environment_id: files[1],
            path,
            size_bytes: 1,
          })),
        has_more: false,
        next_cursor: null,
      });
    environmentFileCopies++;
    if (present.has(body.path))
      return response(
        { error: { message: "destination already exists", param: "path" } },
        400,
      );
    present.add(body.path);
    return response({ object: "agent.environment.file", path: body.path });
  }
  const env = url.pathname.match(/\/environments\/(env-session-\d+)$/);
  if (env)
    return response({
      id: env[1],
      status: expired.has(env[1]) ? "expired" : "connected",
    });
  const content = url.pathname.match(
    /\/sessions\/(session-\d+)\/artifacts\/([^/]+)\/content$/,
  );
  if (content)
    return new Response(
      artifacts.get(content[1])!.find((a) => a.id === content[2]).body,
    );
  const match = url.pathname.match(
    /\/sessions\/(session-\d+)(?:\/(events|turns|items|artifacts))?$/,
  );
  if (match) {
    const [, id, resource] = match;
    const session = sessions.get(id);
    if (!session) return response({ error: { message: "not found" } }, 404);
    if (!resource) {
      if (method === "DELETE") {
        if (failSessionDelete) {
          failSessionDelete = false;
          return response({ error: { message: "unavailable" } }, 503);
        }
        sessions.delete(id);
        turns.delete(id);
        return response({ id, deleted: true });
      }
      return response(session);
    }
    if (resource === "events" && method === "POST") {
      for (const event of body.events) {
        if (event.type === "agent.session.input.message") {
          if (rejectSubmission)
            return response({ error: { message: "Input too long" } }, 400);
          assert(key!.startsWith("message-"));
          const serialized = JSON.stringify(body);
          if (inputs.has(key!)) {
            assert.equal(
              serialized,
              inputs.get(key!),
              "A retry must use the identical persisted payload",
            );
            continue;
          }
          inputs.set(key!, serialized);
          startTurn(id);
          if (loseSubmission) {
            loseSubmission = false;
            throw Error("Connection lost after acceptance");
          }
        }
        if (event.type === "agent.session.input.cancel") {
          for (const turn of turns.get(id)!)
            if (turn.status === "in_progress") turn.status = "cancelled";
          session.required_actions = [];
        }
      }
      return new Response(null, { status: 202 });
    }
    if (resource === "turns") return list(turns.get(id)!);
    if (resource === "items")
      return list(
        turns
          .get(id)!
          .filter((t) => t.status === "completed")
          .map((t) => ({
            type: "message",
            role: "assistant",
            phase: "final_answer",
            id: `answer-${t.id}`,
            turn_id: t.id,
            content: [
              {
                type: "output_text",
                text: "Bitcoin answer from verified data.",
              },
            ],
          })),
      );
    if (resource === "artifacts") {
      if (failArtifacts) {
        failArtifacts = false;
        return response({ error: { message: "unavailable" } }, 503);
      }
      return list(artifacts.get(id) || []);
    }
  }
  throw Error(`Unexpected fake provider request ${method} ${url.pathname}`);
};
const creationFor = (run: string) =>
  [...creations.values()].find((c) => c.body.metadata.run === run)?.body;
before(async () => {
  database = await testDatabase();
  fakeOpenAI(fakeFetch);
  process.env.AGENT21_MCP_KEY = MCP_KEY;
  process.env.AGENT21_MCP_URL = MCP_SERVER_URL;
  await query("INSERT INTO agent21_users(id,beta_enabled) VALUES($1,true)", [
    owner,
  ]);
  await query(
    "INSERT INTO agent21_conversations(id,owner_id,agent_id,template_id,runtime_version) VALUES($1,$2,'agent-selected','template-selected','runtime-selected')",
    [conversation, owner],
  );
  globalThis.fetch = fakeFetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await database.close();
});
let first: any;
test("a lost creation response is recovered: one sandbox, one turn, the message sent with it", async () => {
  first = await reserveRun(owner, conversation, randomUUID(), {
    text: "Explain Bitcoin fees",
    files: [],
  });
  loseCreation = true;
  await assert.rejects(reconcileRun(first.id), (error: Error) => {
    // Workflow error records carry only a diagnostic reference, never provider text.
    assert.match(
      error.message,
      /^Agent 21 run reconciliation failed\. Reference: [0-9a-f-]{36}$/,
    );
    assert.equal(error.cause, undefined);
    return true;
  });
  const [pending] = await query(
    "SELECT submission::text AS submission FROM agent21_runs WHERE id=$1",
    [first.id],
  );
  assert(pending.submission, "The creation request is kept for recovery");
  assert(
    !pending.submission.includes(MCP_KEY),
    "The data server credential is never stored",
  );
  await markUncertain(first.id);
  assert.equal(await reconcileRun(first.id), false);
  assert.equal(createCount, 1);
  assert.equal(turns.get("session-1")!.length, 1);
  assert.match(creationFor(first.id).input, /^Explain Bitcoin fees/);
  const [stored] = await query("SELECT * FROM agent21_runs WHERE id=$1", [
    first.id,
  ]);
  assert.equal(stored.provider_accepted, true);
  assert.equal(
    stored.state,
    "in_progress",
    "A recovered run is no longer delayed",
  );
  assert.equal(stored.submission, null);
  assert.equal((await saved()).filter((m) => m.role === "user").length, 1);
});
test("terminal output survives a provider outage; retry persists and settles only once", async () => {
  turns.get("session-1")![0].status = "completed";
  failArtifacts = true;
  await assert.rejects(reconcileRun(first.id));
  assert.equal(
    (await query("SELECT display FROM agent21_runs WHERE id=$1", [first.id]))[0]
      .display.text,
    "Bitcoin answer from verified data.",
  );
  assert.equal(await reconcileRun(first.id), true);
  assert.equal(await reconcileRun(first.id), true);
  assert.equal((await saved()).filter((m) => m.role === "assistant").length, 1);
  const [run] = await query(
    "SELECT cost_usd::float AS cost,usage_known FROM agent21_runs WHERE id=$1",
    [first.id],
  );
  assert(run.cost > 0 && run.cost < 1);
  assert.equal(run.usage_known, true);
});
test("a follow-up reuses the session; an ambiguous message send is retried identically", async () => {
  const next = await reserveRun(owner, conversation, randomUUID(), {
    text: "And next week's fees?",
    files: [],
  });
  loseSubmission = true;
  await assert.rejects(reconcileRun(next.id));
  assert.equal(await reconcileRun(next.id), false);
  assert.equal(createCount, 1, "The live sandbox was reused");
  assert.equal(turns.get("session-1")!.length, 2, "One provider turn");
  const sent = inputs.get(`message-${next.id}`)!;
  assert(
    !sent.includes("Earlier conversation"),
    "The session keeps its own memory",
  );
  turns.get("session-1")![0].status = "completed";
  assert.equal(await reconcileRun(next.id), true);
});
test("an expired sandbox gets a new session with retained history and the pinned runtime", async () => {
  expired.add("env-session-1");
  const next = await reserveRun(owner, conversation, randomUUID(), {
    text: "Continue the Bitcoin discussion",
    files: [],
  });
  await reconcileRun(next.id);
  assert.equal(createCount, 2);
  const body = creationFor(next.id);
  assert.match(body.input, /Earlier conversation/);
  assert.match(body.input, /Explain Bitcoin fees/);
  assert.equal(body.metadata.runtime, "runtime-selected");
  await query("UPDATE agent21_runs SET cancel_requested=true WHERE id=$1", [
    next.id,
  ]);
  assert.equal(await reconcileRun(next.id), true);
  assert.equal(turns.get("session-2")![0].status, "cancelled");
});
test("stop before provider submission preserves the user message without creating a sandbox", async () => {
  const count = createCount;
  const run = await reserveRun(owner, conversation, randomUUID(), {
    text: "Cancel this Bitcoin question",
    files: [],
  });
  await query("UPDATE agent21_runs SET cancel_requested=true WHERE id=$1", [
    run.id,
  ]);
  await reconcileRun(run.id);
  assert.equal(await reconcileRun(run.id), true);
  assert.equal(createCount, count);
  const [stored] = await query(
    "SELECT state,cost_usd FROM agent21_runs WHERE id=$1",
    [run.id],
  );
  assert.equal(stored.state, "cancelled");
  assert.equal(Number(stored.cost_usd), 0);
  const history = await saved();
  const question = history.find((m) => m.external_id === `user-${run.id}`);
  const answer = history.find((m) => m.external_id === `assistant-${run.id}`);
  assert(question);
  assert(answer);
  assert(new Date(answer.created_at) >= new Date(question.created_at));
});
test("turn deadlines cancel explicitly without confusing the previous terminal turn", async () => {
  const run = await reserveRun(owner, conversation, randomUUID(), {
    text: "Explain Bitcoin adoption",
    files: [],
  });
  await reconcileRun(run.id);
  assert.equal(turns.get("session-2")!.length, 2);
  await query(
    "UPDATE agent21_runs SET created_at=now()-interval '11 minutes' WHERE id=$1",
    [run.id],
  );
  assert.equal(await reconcileRun(run.id), true);
  const [stored] = await query(
    "SELECT state,turn_id FROM agent21_runs WHERE id=$1",
    [run.id],
  );
  assert.equal(stored.state, "cancelled");
  assert.equal(stored.turn_id, turns.get("session-2")![0].id);
});
test("stop after a lost creation response recovers the sandbox without creating another", async () => {
  expired.add("env-session-2");
  const count = createCount;
  const run = await reserveRun(owner, conversation, randomUUID(), {
    text: "Analyze Bitcoin in a fresh sandbox",
    files: [],
  });
  loseCreation = true;
  await assert.rejects(reconcileRun(run.id));
  await markUncertain(run.id);
  assert.equal(createCount, count + 1);
  await query("UPDATE agent21_runs SET cancel_requested=true WHERE id=$1", [
    run.id,
  ]);
  assert.equal(await reconcileRun(run.id), false);
  assert.equal(await reconcileRun(run.id), true);
  assert.equal(createCount, count + 1);
  const [stored] = await query("SELECT * FROM agent21_runs WHERE id=$1", [
    run.id,
  ]);
  assert.equal(stored.state, "cancelled");
  assert.equal(stored.session_id, `session-${createCount}`);
  assert.equal(turns.get(stored.session_id)![0].status, "cancelled");
  assert.equal(stored.usage_known, true);
  assert(Number(stored.cost_usd) > 0, "The sandbox ran, so it is costed");
  const tracked = await query("SELECT id FROM agent21_sessions WHERE id=$1", [
    stored.session_id,
  ]);
  assert.equal(
    tracked.length,
    1,
    "Deletion must be able to find the recovered sandbox",
  );
});
test("deletion recovers an uncertain sandbox and resumes cleanup after a provider failure", async () => {
  expired.add("env-session-3");
  const run = await reserveRun(owner, conversation, randomUUID(), {
    text: "Recover this sandbox before deleting the conversation",
    files: [],
  });
  loseCreation = true;
  await assert.rejects(reconcileRun(run.id));
  await markUncertain(run.id);
  const count = createCount;
  const job = await requestDeletion(owner, conversation);
  assert.equal(await performDeletion(job), false);
  assert.equal(
    createCount,
    count,
    "Cleanup must recover, not create another sandbox",
  );
  const [recovered] = await query(
    "SELECT session_id FROM agent21_runs WHERE id=$1",
    [run.id],
  );
  assert.equal(recovered.session_id, `session-${count}`);
  assert.equal(
    await performDeletion(job),
    false,
    "The running turn is stopped first",
  );
  assert.equal(turns.get(`session-${count}`)![0].status, "cancelled");
  failSessionDelete = true;
  await assert.rejects(performDeletion(job));
  assert.equal(
    (
      await query("SELECT deleting FROM agent21_conversations WHERE id=$1", [
        conversation,
      ])
    )[0].deleting,
    true,
  );
  assert.equal(await performDeletion(job), true);
  assert.equal(await performDeletion(job), true);
  assert.equal(sessions.size, 0);
  assert.equal((await saved(conversation)).length, 0);
  assert.equal(
    (
      await query("SELECT * FROM agent21_conversations WHERE id=$1", [
        conversation,
      ])
    ).length,
    0,
  );
  assert.equal(
    (await query("SELECT state FROM agent21_deletions WHERE id=$1", [job]))[0]
      .state,
    "completed",
  );
});

async function freshConversation() {
  const id = randomUUID();
  await query(
    "INSERT INTO agent21_conversations(id,owner_id,agent_id,template_id,runtime_version) VALUES($1,$2,'agent-selected','template-selected','runtime-selected')",
    [id, owner],
  );
  return id;
}
async function completeTurn(runId: string) {
  const [stored] = await query(
    "SELECT session_id FROM agent21_runs WHERE id=$1",
    [runId],
  );
  const turn = turns.get(stored.session_id)![0];
  turn.status = "completed";
  return { session: stored.session_id as string, turn: turn.id as string };
}
const activeRuns = async () =>
  (
    await query(
      "SELECT id FROM agent21_runs WHERE owner_id=$1 AND finished_at IS NULL",
      [owner],
    )
  ).length;
test("a rate-limited sandbox creation is sent again once the provider listing confirms it is absent", async () => {
  const id = await freshConversation();
  const run = await reserveRun(owner, id, randomUUID(), {
    text: "Explain the halving",
    files: [],
  });
  const count = createCount;
  rejectCreation = 1;
  await assert.rejects(reconcileRun(run.id));
  assert.equal(createCount, count, "The rejected request created nothing");
  assert.equal(
    await reconcileRun(run.id),
    false,
    "A fresh creation is not retried before the provider listing settles",
  );
  assert.equal(createCount, count);
  await query(
    "UPDATE agent21_runs SET session_creation_started_at=now()-interval '2 minutes' WHERE id=$1",
    [run.id],
  );
  assert.equal(await reconcileRun(run.id), false);
  assert.equal(createCount, count + 1);
  const [stored] = await query(
    "SELECT provider_accepted,session_id FROM agent21_runs WHERE id=$1",
    [run.id],
  );
  assert.equal(stored.provider_accepted, true);
  assert.equal(stored.session_id, `session-${createCount}`);
  await completeTurn(run.id);
  assert.equal(await reconcileRun(run.id), true);
  assert.equal(await activeRuns(), 0);
});
test("a request the provider rejects fails at once instead of at the hard stop", async () => {
  const id = await freshConversation();
  const run = await reserveRun(owner, id, randomUUID(), {
    text: "Summarize this very long conversation",
    files: [],
  });
  rejectSubmission = true;
  assert.equal(await reconcileRun(run.id), true);
  rejectSubmission = false;
  const [stored] = await query(
    "SELECT state,cost_usd,usage_known,submission,display,last_diagnostic FROM agent21_runs WHERE id=$1",
    [run.id],
  );
  assert.equal(stored.state, "failed");
  assert.equal(
    Number(stored.cost_usd),
    0,
    "Nothing is estimated for an unknown outcome",
  );
  assert.equal(stored.usage_known, false);
  assert.equal(stored.submission, null);
  assert.equal(stored.last_diagnostic.status, 400);
  assert.match(stored.display.error, /could not finish/);
  assert(
    (await saved(id)).some((m) => m.external_id === `assistant-${run.id}`),
  );
  assert.equal(await activeRuns(), 0, "The user can send again");
});
test("a run that keeps failing temporarily is abandoned at the hard deadline", async () => {
  const id = await freshConversation();
  const run = await reserveRun(owner, id, randomUUID(), {
    text: "Explain mining difficulty",
    files: [],
  });
  rejectCreation = 100;
  await assert.rejects(reconcileRun(run.id));
  await query(
    "UPDATE agent21_runs SET created_at=now()-interval '16 minutes' WHERE id=$1",
    [run.id],
  );
  assert.equal(await reconcileRun(run.id), true);
  rejectCreation = 0;
  const [stored] = await query("SELECT state FROM agent21_runs WHERE id=$1", [
    run.id,
  ]);
  assert.equal(stored.state, "failed");
  assert.equal(await activeRuns(), 0);
});
test("an answer is delivered without files that exceed the storage allowance", async () => {
  const id = await freshConversation();
  const storage = await freshConversation();
  const filler = randomUUID();
  await query(
    "INSERT INTO agent21_files(id,owner_id,conversation_id,kind,state,name,content_type,bytes,blob_path) VALUES($1,$2,$3,'upload','ready','full.csv','text/csv',$4,$5)",
    [filler, owner, storage, 250 * 1024 ** 2 - 4, `test/${filler}`],
  );
  const run = await reserveRun(owner, id, randomUUID(), {
    text: "Chart Bitcoin fees",
    files: [],
  });
  assert.equal(await reconcileRun(run.id), false);
  const { session, turn } = await completeTurn(run.id);
  artifacts.set(session, [
    {
      id: "artifact-1",
      object: "agent.session.artifact",
      session_id: session,
      environment_id: `env-${session}`,
      turn_id: turn,
      path: "/workspace/outputs/fees.csv",
      size_bytes: 9,
      created_at: Math.floor(Date.now() / 1000),
      body: "fee,rate\n1,2\n",
    },
  ]);
  assert.equal(await reconcileRun(run.id), true);
  const [stored] = await query("SELECT state FROM agent21_runs WHERE id=$1", [
    run.id,
  ]);
  assert.equal(stored.state, "completed");
  const answer = (await saved(id)).find(
    (m) => m.external_id === `assistant-${run.id}`,
  );
  assert.match(answer.text, /file storage is full: fees\.csv/);
  assert.equal(
    (await query("SELECT id FROM agent21_files WHERE run_id=$1", [run.id]))
      .length,
    0,
  );
  await query("DELETE FROM agent21_files WHERE id=$1", [filler]);
});
test("files go into a new session with its creation and are never copied twice", async () => {
  const id = await freshConversation();
  const file = randomUUID();
  await query(
    "INSERT INTO agent21_files(id,owner_id,conversation_id,kind,state,name,content_type,bytes,blob_path,openai_file_id) VALUES($1,$2,$3,'upload','ready','prices.csv','text/csv',10,$4,'file-prices')",
    [file, owner, id, `test/${file}`],
  );
  const firstRun = await reserveRun(owner, id, randomUUID(), {
    text: "Summarize my prices",
    files: [],
  });
  const copies = environmentFileCopies;
  assert.equal(await reconcileRun(firstRun.id), false);
  assert.deepEqual(creationFor(firstRun.id).environment.files, [
    {
      type: "file_id",
      file_id: "file-prices",
      path: `/workspace/inputs/${file}/prices.csv`,
    },
  ]);
  assert.equal(
    environmentFileCopies,
    copies,
    "Sent with the session, not copied",
  );
  await completeTurn(firstRun.id);
  assert.equal(await reconcileRun(firstRun.id), true);
  // A file added later is copied into the live sandbox once. A copy whose
  // response was lost is already there: "already exists" counts as success.
  const later = randomUUID();
  await query(
    "INSERT INTO agent21_files(id,owner_id,conversation_id,kind,state,name,content_type,bytes,blob_path,openai_file_id) VALUES($1,$2,$3,'upload','ready','fees.csv','text/csv',10,$4,'file-fees')",
    [later, owner, id, `test/${later}`],
  );
  const [{ session_id: session }] = await query(
    "SELECT session_id FROM agent21_runs WHERE id=$1",
    [firstRun.id],
  );
  environmentFiles
    .get(`env-${session}`)!
    .add(`/workspace/inputs/${later}/fees.csv`);
  const second = await reserveRun(owner, id, randomUUID(), {
    text: "Now chart both",
    files: [],
  });
  assert.equal(await reconcileRun(second.id), false);
  const [stored] = await query(
    "SELECT provider_accepted,session_id FROM agent21_runs WHERE id=$1",
    [second.id],
  );
  assert.equal(stored.session_id, session, "The sandbox was reused");
  assert.equal(stored.provider_accepted, true);
  assert.equal(
    environmentFileCopies,
    copies + 1,
    "Only the new file was copied",
  );
  await completeTurn(second.id);
  assert.equal(await reconcileRun(second.id), true);
  const third = await reserveRun(owner, id, randomUUID(), {
    text: "Summarize again",
    files: [],
  });
  assert.equal(await reconcileRun(third.id), false);
  assert.equal(environmentFileCopies, copies + 1, "No file is copied twice");
  await completeTurn(third.id);
  assert.equal(await reconcileRun(third.id), true);
});
