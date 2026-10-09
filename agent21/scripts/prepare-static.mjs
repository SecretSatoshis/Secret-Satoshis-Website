// The homepage stays on GitHub Pages; the app copies only its shared fonts and icon.
import { cp, mkdir, copyFile, writeFile } from "node:fs/promises";
await mkdir("public/css", { recursive: true });
await copyFile("../css/fonts.css", "public/css/fonts.css");
await cp("../assets/fonts", "public/assets/fonts", { recursive: true });
await copyFile("../favicon.ico", "public/favicon.ico");
// Charts in a conversation are drawn by the Chart Library renderer copied here.
await cp("chart-viewer", "public/agent21-chart", { recursive: true });
// Only the landing page is indexed; the app, sign-in and API routes are not.
await writeFile(
  "public/robots.txt",
  [
    "User-agent: *",
    "Disallow: /c/",
    "Disallow: /api/",
    "Disallow: /deletion/",
    "Disallow: /sign-in",
    "Disallow: /sign-up",
    "Disallow: /waitlist",
    "Disallow: /agent21-chart/",
    "",
  ].join("\n"),
);
