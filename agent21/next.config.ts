import path from "node:path";
import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
// The website repo: Agent 21's face (js/agent21-face.js and its stylesheet) is
// shared with the homepage from its root. Vercel builds from agent21 with files
// outside the root directory included. Next uses this root for file tracing
// too (outputFileTracingRoot).
const repo = path.resolve(import.meta.dirname, "..");
const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: repo },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // The beta app is private; only the landing page at / is indexed.
        source: "/:path+",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // The chart viewer is framed only by the conversation page and runs
        // only its own scripts; chart data arrives as JSON by postMessage. As
        // the later rule, it overrides the frame header above.
        // The style hash is Lightweight Charts' TradingView attribution logo
        // stylesheet; tests/agent21-charts.test.ts checks it after each sync.
        source: "/agent21-chart/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; script-src 'self'; style-src 'self' 'sha256-3pRED1tOXas1FXFoPb9TGCjmYe9XQsmO9OV23khV2nY='; font-src data:; img-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
          },
        ],
      },
    ];
  },
};
export default withWorkflow(config);
