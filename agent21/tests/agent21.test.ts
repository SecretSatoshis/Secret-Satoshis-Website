import test from "node:test";
import assert from "node:assert/strict";
import { toolRequest, retrieveTool, boundedBytes } from "../lib/agent21/tools";
import { safeArtifact, safeFilename } from "../lib/agent21/files";
import { validateUpload } from "../lib/agent21/validation";
import { verifyOrigin } from "../lib/agent21/auth";
import {
  publicText,
  hostedEnvironment,
  environmentId,
  estimatedTokens,
} from "../lib/agent21/openai";
import catalog from "../lib/agent21/contracts/operations.json";
import { PDFDocument } from "pdf-lib";
import {
  credentialNames,
  missingCredentials,
  configured,
} from "../lib/agent21/config";

test("webhook credentials are optional only for loopback development; production stays closed", () => {
  const names = [
    ...credentialNames,
    "NODE_ENV",
    "BLOB_STORE_ID",
    "BLOB_READ_WRITE_TOKEN",
  ];
  const before = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of credentialNames) process.env[name] = "configured";
    process.env.BLOB_STORE_ID = "store_configured";
    delete process.env.OPENAI_WEBHOOK_SECRET;
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    process.env.APP_ORIGIN = "http://localhost:3000";
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.deepEqual(missingCredentials(), [
      "OPENAI_WEBHOOK_SECRET",
      "CLERK_WEBHOOK_SIGNING_SECRET",
    ]);
    assert.equal(configured(), false);
    Object.assign(process.env, { NODE_ENV: "development" });
    assert.equal(configured(), true);
    process.env.APP_ORIGIN = "https://preview.example.com";
    assert.equal(configured(), false);
    process.env.APP_ORIGIN = "http://localhost:3000";
    delete process.env.DATABASE_URL;
    assert.equal(configured(), false);
    process.env.DATABASE_URL = "configured";
    delete process.env.BLOB_STORE_ID;
    assert.deepEqual(missingCredentials(), ["BLOB_STORE_ID"]);
    process.env.BLOB_READ_WRITE_TOKEN = "local-token";
    assert.equal(
      configured(),
      true,
      "Local development may use a read-write token",
    );
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

test("public Action contracts stay read-only and fixed-host; injected paths and unknown arguments fail", () => {
  assert.equal(catalog.operations.length, 27);
  assert.equal(new Set(catalog.operations.map((o) => o.name)).size, 27);
  assert(
    catalog.operations.every((o) => o.schema.additionalProperties === false),
  );
  const github = catalog.operations.find((o) =>
    o.base.includes("api.github.com"),
  )!;
  const args = {
    owner: "SecretSatoshis",
    repo: "Bitcoin-Report-Library",
    path: "data/report.csv",
  };
  assert.equal(toolRequest(github.name, args).url.hostname, "api.github.com");
  for (const path of ["../.env", "%2e%2e/env", "data\\secret"]) {
    assert.throws(() => toolRequest(github.name, { ...args, path }));
  }
  assert.throws(() =>
    toolRequest(github.name, { ...args, url: "https://evil.example" }),
  );
  assert.throws(() => toolRequest("run_shell", {}));
});
test("address queries bypass shared cache and external failures stay explicit", async () => {
  const address = catalog.operations.find(
    (o) => o.path === "/address/{address}",
  )!;
  const args = { address: "bc1qtestexample" };
  let requests = 0;
  const fetcher: typeof fetch = async (_, options) => {
    requests++;
    assert.equal(options?.redirect, "error");
    assert(options?.signal);
    return Response.json({ chain_stats: { funded_txo_sum: 123 } });
  };
  await retrieveTool(address.name, args, fetcher);
  await retrieveTool(address.name, args, fetcher);
  assert.equal(requests, 2);
  await assert.rejects(
    retrieveTool(
      address.name,
      args,
      async () => new Response("down", { status: 503 }),
    ),
    /temporarily unavailable/,
  );
  await assert.rejects(
    retrieveTool(
      address.name,
      args,
      async () =>
        new Response("not JSON", {
          headers: { "content-type": "application/json" },
        }),
    ),
    /malformed/,
  );
});
test("bounded streaming rejects both declared and chunked oversized source responses", async () => {
  await assert.rejects(
    boundedBytes(new Response("x", { headers: { "content-length": "99" } }), 2),
  );
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    }),
  );
  await assert.rejects(boundedBytes(response, 2));
  assert.equal((await boundedBytes(new Response("ok"), 2)).toString(), "ok");
});
test("CSV validation preserves quoted delimiters/newlines and rejects corrupt files", async () => {
  for (const text of [
    "date,value\n2026-01-01,10\n",
    'name,note\r\n"a,b","two\nlines"\r\n',
    'value\n"escaped ""quote"""\n',
    "a,b\n1,2\n\n",
    "a,b\r\n\r\n1,2\r\n",
    "a,b\n  \n1,2",
  ])
    await validateUpload(Buffer.from(text), "text/csv");
  for (const text of [
    "",
    "a,b\n1\n",
    "\n\n  \n",
    'a,b\n"unclosed,2',
    'a,b\n"value"extra,2',
    "<html>bad</html>",
    "a\0,b",
  ])
    await assert.rejects(validateUpload(Buffer.from(text), "text/csv"));
  await assert.rejects(
    validateUpload(Buffer.from([0xff, 0xff]), "text/csv"),
    /UTF-8/,
  );
});
test("PDF uploads require real readable unencrypted documents within page limits", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await validateUpload(Buffer.from(await pdf.save()), "application/pdf");
  await assert.rejects(
    validateUpload(Buffer.from("%PDF-broken"), "application/pdf"),
  );
  await assert.rejects(
    validateUpload(Buffer.from("<html>pdf</html>"), "application/pdf"),
  );
  const huge = await PDFDocument.create();
  for (let i = 0; i < 201; i++) huge.addPage();
  await assert.rejects(
    validateUpload(Buffer.from(await huge.save()), "application/pdf"),
    /200 pages/,
  );
});
test("only bounded safe output files are published; control markers and credentials are rejected", () => {
  assert(
    safeArtifact(
      "/workspace/outputs/report.csv",
      Buffer.from("date,value\n2026-01-01,10"),
    ),
  );
  for (const path of [
    "/workspace/knowledge/index.md",
    "/workspace/outputs/../system_prompt.md",
    "/workspace/outputs/.env",
    "/workspace/outputs/archive.zip",
    "/workspace/outputs/subdir/report.csv",
  ])
    assert(!safeArtifact(path, Buffer.from("x")));
  for (const text of [
    "AGENT21_PRIVATE_CONTROL",
    "-----BEGIN PRIVATE KEY-----",
    "sk-proj-abcdefghijklmnopqrstuvwxyz",
  ])
    assert(!safeArtifact("/workspace/outputs/report.md", Buffer.from(text)));
  assert.equal(safeFilename('hello"\r\n.csv'), "hello___.csv");
});
test("mutation origin is exact; provider identifiers are never an authorization credential", () => {
  process.env.APP_ORIGIN = "https://secretsatoshis.com";
  verifyOrigin(
    new Request("https://secretsatoshis.com/api/agent21", {
      headers: { origin: "https://secretsatoshis.com" },
    }),
  );
  for (const origin of [
    "https://evil.example",
    "https://secretsatoshis.com.evil.example",
    "null",
  ]) {
    assert.throws(() =>
      verifyOrigin(
        new Request("https://secretsatoshis.com/api/agent21", {
          headers: { origin },
        }),
      ),
    );
  }
  assert.throws(() =>
    verifyOrigin(new Request("https://secretsatoshis.com/api/agent21")),
  );
});
test("browser output includes final assistant text only, never private reasoning/tool traces", () => {
  const items = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "user" }],
    },
    {
      type: "message",
      role: "assistant",
      phase: "commentary",
      content: [{ type: "output_text", text: "internal commentary" }],
    },
    {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "private reasoning" }],
    },
    {
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [{ type: "output_text", text: "Bitcoin answer" }],
    },
  ];
  assert.equal(
    publicText(items as unknown as Parameters<typeof publicText>[0]),
    "Bitcoin answer",
  );
  assert.equal(hostedEnvironment("template").container_size, "medium");
  assert.equal(hostedEnvironment("template").network.access, "disabled");
  assert.throws(() => environmentId({ environment: { type: "none" } }));
});
test("token estimates bill uncached input once, matching the provider's invoice", () => {
  // October 4, 2026 Agent 21 invoice: $0.0336 cache writes and $0.0003 output.
  const firstTurn = estimatedTokens({
    input_tokens: 13_444,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 30,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 13_474,
  })!;
  assert(Math.abs(firstTurn - 0.0339) < 0.0001, String(firstTurn));
  const cachedTurn = estimatedTokens({
    input_tokens: 100_000,
    input_tokens_details: { cached_tokens: 90_000 },
    output_tokens: 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 100_000,
  })!;
  assert(Math.abs(cachedTurn - 0.034) < 1e-9, String(cachedTurn));
  assert.equal(estimatedTokens(null), null);
});
test("a rate-limited source is retried after its Retry-After; GitHub calls carry the optional token", async () => {
  const github = catalog.operations.find((o) =>
    o.base.includes("api.github.com"),
  )!;
  const args = {
    owner: "SecretSatoshis",
    repo: "Bitcoin-Report-Library",
    path: "data/retry.csv",
  };
  let calls = 0;
  let authorization: string | null = null;
  process.env.AGENT21_GITHUB_TOKEN = "github-test-token";
  try {
    const result = await retrieveTool(github.name, args, async (_, options) => {
      calls++;
      authorization = new Headers(options?.headers).get("authorization");
      if (calls === 1)
        return new Response("slow down", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      return Response.json({
        type: "file",
        size: 5,
        encoding: "base64",
        content: Buffer.from("hello").toString("base64"),
        path: "data/retry.csv",
        html_url: "https://github.com/SecretSatoshis/Bitcoin-Report-Library",
        sha: "abc",
      });
    });
    assert.equal(calls, 2);
    assert.equal(authorization, "Bearer github-test-token");
    assert.match(result.text, /hello/);
  } finally {
    delete process.env.AGENT21_GITHUB_TOKEN;
  }
});
