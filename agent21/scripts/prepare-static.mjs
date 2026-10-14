// The homepage stays on GitHub Pages; the app copies only its shared fonts and icon.
import { cp, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
await mkdir("public/css", { recursive: true });
await copyFile("../css/fonts.css", "public/css/fonts.css");
await cp("../assets/fonts", "public/assets/fonts", { recursive: true });
await copyFile("../favicon.ico", "public/favicon.ico");
// Charts in a conversation are drawn by the Chart Library renderer copied here.
await cp("chart-viewer", "public/agent21-chart", { recursive: true });
// Only maintained public homepage copy is included in the agent map.
const site = JSON.parse(await readFile("site.json", "utf8"));
await writeFile(
  "public/llms.txt",
  [
    "# Agent 21",
    "",
    `> ${site.description}`,
    "",
    "Agent 21 is a Secret Satoshis product. Access is currently invite-only during beta.",
    "",
    "## Start here",
    "",
    `- [Agent 21 homepage](${site.url}): capabilities and example responses, including charts and sources.`,
    "- [Agent 21 FAQ](https://newsletter.secretsatoshis.com/p/agent-21): how to use the agent, its research and data sources, and beta access.",
    `- [Join the beta waitlist](${site.url}waitlist): request an invitation.`,
    "",
    "## Capabilities",
    "",
    ...Object.values(site.useCases).map(
      (useCase) => `- ${useCase.title}: ${useCase.summary}`,
    ),
    "",
    "## Related research and data",
    "",
    "- [Secret Satoshis guide](https://secretsatoshis.com/llms.txt): the newsletter, products, public data releases, and code.",
    "- [Newsletter](https://newsletter.secretsatoshis.com/): the yearly price outlook, weekly recaps, quarterly reviews, and year-end reviews.",
    "- [Market Dashboard guide](https://dashboard.secretsatoshis.com/llms.txt): daily indicators, metric definitions, and data files.",
    "- [Chart Library guide](https://charts.secretsatoshis.com/llms.txt): interactive charts and their definitions.",
    "- [Start Here](https://newsletter.secretsatoshis.com/p/start-here): an introduction to the newsletter and tools.",
    "",
    "## Optional",
    "",
    "- [Disclaimer and licensing](https://newsletter.secretsatoshis.com/p/secret-satoshis-newsletter-disclaimer): research disclosures and terms. Nothing published here is investment advice.",
    "",
  ].join("\n"),
);
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
    "Sitemap: https://agent21.secretsatoshis.com/sitemap.xml",
    "",
  ].join("\n"),
);
