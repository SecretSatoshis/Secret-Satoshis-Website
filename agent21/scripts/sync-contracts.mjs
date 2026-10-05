import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
// The MCP tool catalog lives in the private runtime checkout; pass its path
// explicitly. It is read from the checkout's current commit, not its working tree.
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
if (process.argv.includes("--stdout")) process.stdout.write(operations);
else {
  await mkdir("lib/agent21/contracts", { recursive: true });
  await writeFile("lib/agent21/contracts/operations.json", operations);
  console.log(
    `Synced ${catalog.operations.length} read-only MCP operations from ${sha}.`,
  );
}
