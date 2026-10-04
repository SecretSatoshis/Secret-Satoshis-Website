// The homepage stays on GitHub Pages; the app copies only its shared fonts and icon.
import { cp, mkdir, copyFile, writeFile } from "node:fs/promises";
await mkdir("public/css", { recursive: true });
await copyFile("../css/fonts.css", "public/css/fonts.css");
await cp("../assets/fonts", "public/assets/fonts", { recursive: true });
await copyFile("../favicon.ico", "public/favicon.ico");
// The invited beta lives on its own subdomain and is never indexed.
await writeFile("public/robots.txt", "User-agent: *\nDisallow: /\n");
