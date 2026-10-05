import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  reserveRun,
  settle,
  ownedConversation,
  ownedRun,
} from "../lib/agent21/db";
import { reserveFile } from "../lib/agent21/files";
import { requestDeletion, requestFileDeletion } from "../lib/agent21/deletion";
import { messages, recordFeedback, saveMessage } from "../lib/agent21/history";
import { testDatabase } from "./support";
let database: Awaited<ReturnType<typeof testDatabase>>;
const query = (text: string, values: unknown[] = []) =>
  database.sql(text, values);
const input = (text = "Bitcoin") => ({ text, files: [] });
const owner = "user_owner",
  other = "user_other",
  uninvited = "user_uninvited";
const conversation = randomUUID(),
  otherConversation = randomUUID();
before(async () => {
  database = await testDatabase();
  for (const id of [owner, other, uninvited])
    await query("INSERT INTO agent21_users(id,beta_enabled) VALUES($1,$2)", [
      id,
      id !== uninvited,
    ]);
  for (const [id, user] of [
    [conversation, owner],
    [otherConversation, other],
  ])
    await query(
      "INSERT INTO agent21_conversations(id,owner_id,agent_id,template_id,runtime_version) VALUES($1,$2,'saved','template','release')",
      [id, user],
    );
});
after(() => database.close());
test("ownership is enforced in SQL for threads and runs; uninvited users cannot reserve", async () => {
  assert.equal((await ownedConversation(owner, conversation)).owner_id, owner);
  await assert.rejects(ownedConversation(other, conversation), /not found/);
  await assert.rejects(
    reserveRun(other, conversation, randomUUID(), input()),
    /not found/,
  );
  const privateThread = randomUUID();
  await query(
    "INSERT INTO agent21_conversations(id,owner_id,agent_id,template_id,runtime_version) VALUES($1,$2,'saved','template','release')",
    [privateThread, uninvited],
  );
  await assert.rejects(
    reserveRun(uninvited, privateThread, randomUUID(), input()),
    /not found/,
  );
});
test("request retries return the same run; settlement is recorded once and releases the active slot", async () => {
  const request = randomUUID();
  const first = await reserveRun(owner, conversation, request, input());
  const retry = await reserveRun(
    owner,
    conversation,
    request,
    input("changed request"),
  );
  assert.equal(first.id, retry.id);
  await assert.rejects(
    reserveRun(owner, conversation, randomUUID(), input()),
    /current response/,
  );
  await assert.rejects(ownedRun(other, first.id), /not found/);
  await settle(first.id, "completed");
  await settle(first.id, "failed");
  const [run] = await query("SELECT * FROM agent21_runs WHERE id=$1", [
    first.id,
  ]);
  assert.equal(run.state, "completed", "The first settlement stands");
  assert.equal(run.input, null);
  const next = await reserveRun(owner, conversation, randomUUID(), input());
  await settle(next.id, "failed");
  const [failed] = await query(
    "SELECT state,finished_at FROM agent21_runs WHERE id=$1",
    [next.id],
  );
  assert.equal(failed.state, "failed");
  assert(failed.finished_at, "A settled run frees the user's active slot");
});
test("file ownership, attachment count, storage quota and idempotent artifacts are enforced", async () => {
  await assert.rejects(
    reserveFile(other, conversation, "bad.csv", 10, "text/csv", "upload"),
    /not found/,
  );
  for (let i = 0; i < 5; i++)
    await reserveFile(
      owner,
      conversation,
      `${i}.csv`,
      10,
      "text/csv",
      "upload",
    );
  await assert.rejects(
    reserveFile(owner, conversation, "six.csv", 10, "text/csv", "upload"),
    /allowance/,
  );
  for (let i = 0; i < 12; i++)
    await reserveFile(
      owner,
      conversation,
      `output-${i}.md`,
      20 * 1024 ** 2,
      "text/markdown",
      "artifact",
    );
  await assert.rejects(
    reserveFile(
      owner,
      conversation,
      "extra.md",
      20 * 1024 ** 2,
      "text/markdown",
      "artifact",
    ),
    /allowance/,
  );
  const a = await reserveFile(
    other,
    otherConversation,
    "answer.md",
    10,
    "text/markdown",
    "artifact",
    undefined,
    "artifact-key",
  );
  const b = await reserveFile(
    other,
    otherConversation,
    "answer.md",
    10,
    "text/markdown",
    "artifact",
    undefined,
    "artifact-key",
  );
  assert.equal(a.id, b.id);
});
test("individual file deletion hides attachments and blocks new turns during cleanup", async () => {
  const [file] = await query(
    "SELECT id FROM agent21_files WHERE owner_id=$1 AND kind='upload' LIMIT 1",
    [owner],
  );
  await assert.rejects(requestFileDeletion(other, file.id), /not found/);
  const id = await requestFileDeletion(owner, file.id);
  assert.equal(await requestFileDeletion(owner, file.id), id);
  const [hidden] = await query("SELECT state FROM agent21_files WHERE id=$1", [
    file.id,
  ]);
  assert.equal(hidden.state, "deleting");
  await assert.rejects(
    reserveRun(owner, conversation, randomUUID(), input()),
    /File deletion/,
  );
});
test("deletion requests immediately hide data, reject new work and deduplicate cleanup jobs", async () => {
  const request = await requestDeletion(owner, conversation);
  assert.equal(await requestDeletion(owner, conversation), request);
  await assert.rejects(ownedConversation(owner, conversation), /not found/);
  await assert.rejects(
    reserveRun(owner, conversation, randomUUID(), input()),
    /not found/,
  );
  await requestDeletion(other);
  const [user] = await query(
    "SELECT beta_enabled,deleting FROM agent21_users WHERE id=$1",
    [other],
  );
  assert.equal(user.beta_enabled, false);
  assert.equal(user.deleting, true);
  await assert.rejects(
    ownedConversation(other, otherConversation),
    /not found/,
  );
});
test("history writes are idempotent and feedback is limited to the owner's answers", async () => {
  const thread = randomUUID();
  await query(
    "INSERT INTO agent21_conversations(id,owner_id,agent_id,template_id,runtime_version) VALUES($1,$2,'saved','template','release')",
    [thread, owner],
  );
  const question = await saveMessage(thread, owner, "user-history", {
    role: "user",
    text: "First",
    createdAt: "2026-10-03T00:00:00.000Z",
  });
  assert.equal(
    await saveMessage(thread, owner, "user-history", {
      role: "user",
      text: "Retried copy",
      createdAt: "2026-10-03T00:00:01.000Z",
    }),
    question,
    "A retried write keeps the first saved message",
  );
  const answer = await saveMessage(thread, owner, "assistant-history", {
    role: "assistant",
    text: "Answer",
    createdAt: "2026-10-03T00:00:02.000Z",
  });
  const history = await messages(thread);
  assert.deepEqual(
    history.map((m) => [m.id, m.text]),
    [
      [question, "First"],
      [answer, "Answer"],
    ],
  );
  await assert.rejects(
    recordFeedback(other, thread, answer, "positive"),
    /not found/,
  );
  await assert.rejects(
    recordFeedback(owner, thread, question, "positive"),
    /not found/,
    "Only assistant answers take feedback",
  );
  await recordFeedback(owner, thread, answer, "negative");
  const [row] = await query(
    "SELECT feedback FROM agent21_messages WHERE id=$1",
    [answer],
  );
  assert.equal(row.feedback, "negative");
});
test("migrations are recorded once and the database allows one unfinished answer per user", async () => {
  const { migrateToLatest } = await import("../lib/agent21/migrations");
  const { db } = await import("../lib/agent21/db");
  assert.deepEqual(await migrateToLatest(db()), [], "Nothing re-runs");
  const user = "user_index";
  await query("INSERT INTO agent21_users(id,beta_enabled) VALUES($1,true)", [
    user,
  ]);
  const [first, second] = [randomUUID(), randomUUID()];
  for (const id of [first, second])
    await query(
      "INSERT INTO agent21_conversations(id,owner_id,agent_id,template_id,runtime_version) VALUES($1,$2,'saved','template','release')",
      [id, user],
    );
  const run = await reserveRun(user, first, randomUUID(), input());
  await assert.rejects(
    reserveRun(user, second, randomUUID(), input()),
    /current response/,
    "A second conversation cannot start another answer",
  );
  await assert.rejects(
    query(
      "INSERT INTO agent21_runs(id,conversation_id,owner_id,request_id) VALUES($1,$2,$3,$4)",
      [randomUUID(), second, user, randomUUID()],
    ),
    /agent21_runs_one_active/,
    "The unique index holds even outside reserveRun",
  );
  await settle(run.id, "completed");
  await reserveRun(user, second, randomUUID(), input());
});
