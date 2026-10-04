import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { parse } from "yaml";
// The Action contracts live in the private runtime checkout; pass its path explicitly.
const repo = process.argv[2];
if (!repo || repo.startsWith("--"))
  throw Error("Usage: pnpm contracts <runtime checkout> [--stdout]");
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
const files = [
  "platforms/chatgpt/tools/brk_api/openapi_metrics.json",
  "platforms/chatgpt/tools/mempool_space/openapi.json",
  "platforms/chatgpt/tools/polymarket/openapi.json",
  "platforms/chatgpt/tools/github/openapi_spec.yaml",
];
const operations = [];
for (const file of files) {
  const doc = parse(
    execFileSync("git", ["show", `${sha}:${file}`], {
      cwd: repo,
      encoding: "utf8",
    }),
  );
  function resolve(value) {
    if (Array.isArray(value)) return value.map(resolve);
    if (!value || typeof value !== "object") return value;
    if (value.$ref) {
      if (!value.$ref.startsWith("#/"))
        throw Error("External schema references are not allowed");
      return resolve(
        value.$ref
          .slice(2)
          .split("/")
          .reduce((o, k) => o[k], doc),
      );
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolve(v)]),
    );
  }
  for (const [path, routes] of Object.entries(doc.paths)) {
    const op = routes.get;
    if (!op) continue;
    const parameters = [
      ...(routes.parameters || []),
      ...(op.parameters || []),
    ].map(resolve);
    operations.push({
      name: op.operationId,
      description: op.description || op.summary || op.operationId,
      base: doc.servers[0].url,
      path,
      parameters,
      schema: {
        type: "object",
        properties: Object.fromEntries(
          parameters.map((p) => [p.name, p.schema]),
        ),
        required: parameters.filter((p) => p.required).map((p) => p.name),
        additionalProperties: false,
      },
    });
  }
}
const output =
  JSON.stringify({ source_commit: sha, operations }, null, 2) + "\n";
// Model prices for run cost estimates come from the same release commit.
const pricing =
  JSON.stringify(
    {
      source_commit: sha,
      ...JSON.parse(
        execFileSync(
          "git",
          ["show", `${sha}:platforms/agents-api/pricing.json`],
          { cwd: repo, encoding: "utf8" },
        ),
      ),
    },
    null,
    2,
  ) + "\n";
if (process.argv.includes("--stdout")) process.stdout.write(output);
else {
  await mkdir("lib/agent21/contracts", { recursive: true });
  await writeFile("lib/agent21/contracts/operations.json", output);
  await writeFile("lib/agent21/contracts/pricing.json", pricing);
  console.log(
    `Synced ${operations.length} public read-only operations from ${sha}.`,
  );
}
