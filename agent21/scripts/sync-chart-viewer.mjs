// Copies the Chart Library's built renderer, chart runtime and styles from
// charts.secretsatoshis.com into chart-viewer/assets, so charts in a
// conversation are drawn by exactly the code the chart site serves. Run it
// after the Chart Library changes its renderer, review the diff, and commit.
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";

const SITE = "https://charts.secretsatoshis.com";
const OUT = new URL("../chart-viewer/assets/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function get(path) {
  const response = await fetch(`${SITE}/${path}`, { redirect: "error" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const manifest = JSON.parse((await get("build-manifest.json")).toString());
const catalog = JSON.parse((await get("catalog.json")).toString());
const page = (await get(catalog.charts[0].url)).toString();
// Built assets are named <stem>.<first 16 hex of their SHA-256>.<ext>.
const hashed = [
  ...page.matchAll(
    /(?:href|src)="assets\/((?:chart|renderer|lightweight-charts)\.([0-9a-f]{16})\.(?:css|js))"/g,
  ),
];
if (hashed.length !== 3)
  throw new Error("Expected chart CSS, renderer and runtime");
const files = {};
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const [, name, digest] of hashed) {
  const bytes = await get(`assets/${name}`);
  if (!sha256(bytes).startsWith(digest))
    throw new Error(`${name} hash mismatch`);
  const local = name.replace(`.${digest}`, "");
  await writeFile(new URL(local, OUT), bytes);
  files[local] = sha256(bytes);
}
for (const name of [
  "LICENSE",
  "NOTICE",
  "JetBrainsMono-OFL.txt",
  "Syne-OFL.txt",
]) {
  const bytes = await get(`assets/${name}`);
  await writeFile(new URL(name, OUT), bytes);
  files[name] = sha256(bytes);
}
await writeFile(
  new URL("../chart-viewer/lock.json", import.meta.url),
  JSON.stringify(
    {
      source: SITE,
      renderer: manifest.renderer,
      synced_from_report_date: manifest.report_date,
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Synced ${(await readdir(OUT)).length} chart viewer files from ${SITE}`,
);
