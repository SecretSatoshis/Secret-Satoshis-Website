"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SITE } from "../../lib/agent21/types";
export function DeletionStatus({ id }: { id: string }) {
  const [status, setStatus] = useState("Checking deletion status…");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const response = await fetch(`/api/agent21/deletions/${id}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok)
          throw Error(result.error || "Sign in to view this deletion receipt.");
        setStatus(
          result.state === "completed"
            ? "Deletion completed across the application stores."
            : "Deletion is in progress. Incomplete cleanup will be retried automatically.",
        );
        if (result.state !== "completed") timer = setTimeout(check, 5000);
      } catch (error) {
        if (!controller.signal.aborted)
          setStatus(
            error instanceof Error ? error.message : "Status unavailable.",
          );
      }
    };
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id]);
  return (
    <main className="a21-gate">
      <a className="a21-brand" href={SITE}>
        {"// SECRET SATOSHIS"}
      </a>
      <h1>Agent 21 data deletion</h1>
      <p role="status" aria-live="polite">
        {status}
      </p>
      <p>Provider security-log retention follows each provider’s policy.</p>
      <a href={`${SITE}/privacy.html`}>Privacy</a> ·{" "}
      <Link href="/">Return to Agent 21</Link>
    </main>
  );
}
