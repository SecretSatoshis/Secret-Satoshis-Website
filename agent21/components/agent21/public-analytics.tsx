"use client";

import { useEffect, useRef } from "react";

// Only public landing/waitlist components mount this frame. Google never runs
// in the app document. The separate origin prevents access to private forms,
// and its separate browser history prevents tracking private chat navigation.
export function PublicAnalytics({ path }: { path: "/" | "/waitlist" }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (location.hostname !== "agent21.secretsatoshis.com") return;
    const params = new URLSearchParams(location.search);
    const allowed = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]);
    for (const key of [...params.keys()]) {
      const value = params.get(key) || "";
      if (!allowed.has(key) || value.length > 200 || value.includes("@"))
        params.delete(key);
    }
    params.set("path", path);
    params.set("host", location.hostname);
    try {
      const previous = new URL(document.referrer);
      const privateAgent =
        previous.hostname === "agent21.secretsatoshis.com" &&
        !["/", "/waitlist"].includes(previous.pathname);
      params.set(
        "referrer",
        previous.origin + (privateAgent ? "/" : previous.pathname),
      );
    } catch {}
    frame.current?.setAttribute(
      "src",
      "https://secretsatoshis.com/analytics.html#" + params.toString(),
    );
  }, [path]);
  return (
    <iframe
      ref={frame}
      hidden
      aria-hidden="true"
      title="Website analytics"
      referrerPolicy="origin"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
