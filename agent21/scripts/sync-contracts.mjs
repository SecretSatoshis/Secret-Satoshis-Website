import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
// The MCP tool catalog and model prices live in the private runtime checkout; pass
// its path explicitly. Both are read from its current commit, not the working tree.
const repo = process.argv[2];
if (!repo || repo.startsWith("--"))
  throw Error("Usage: pnpm contracts <runtime checkout> [--stdout]");
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
const committed = (path) =>
  JSON.parse(
    execFileSync("git", ["show", `${sha}:${path}`], {
      cwd: repo,
      encoding: "utf8",
    }),
  );
const withSource = (value) =>
  JSON.stringify({ source_commit: sha, ...value }, null, 2) + "\n";
const catalog = committed(
  "platforms/mcp-server/lib/mcp/contracts/operations.json",
);
const operations = withSource(catalog);
// Model prices for run cost estimates come from the same release commit.
const pricing = withSource(committed("platforms/agents-api/pricing.json"));
if (process.argv.includes("--stdout")) process.stdout.write(operations);
else {
  await mkdir("lib/agent21/contracts", { recursive: true });
  await writeFile("lib/agent21/contracts/operations.json", operations);
  await writeFile("lib/agent21/contracts/pricing.json", pricing);
  console.log(
    `Synced ${catalog.operations.length} read-only MCP operations from ${sha}.`,
  );
}
