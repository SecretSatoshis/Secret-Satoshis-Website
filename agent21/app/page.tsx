import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { hasAccess } from "../lib/agent21/auth";
import { configured } from "../lib/agent21/config";
import { SITE } from "../lib/agent21/types";
import { Chat } from "../components/agent21/chat";
export const dynamic = "force-dynamic";
export default async function AgentPage() {
  let allowed = false,
    signedIn = false;
  if (configured()) {
    const { userId } = await auth();
    signedIn = Boolean(userId);
    if (userId) {
      try {
        allowed = await hasAccess(userId);
      } catch {
        /* Public beta landing stays usable during a backend outage. */
      }
    }
  }
  if (allowed) return <Chat />;
  return (
    <main className="a21-welcome">
      <a className="a21-brand" href={SITE}>
        {"// SECRET SATOSHIS"}
      </a>
      <div className="a21-intro">
        <p className="a21-eyebrow">{"// AGENT 21 · PRIVATE BETA"}</p>
        <h1>
          Explore Bitcoin.
          <br />
          <span>Follow the evidence.</span>
        </h1>
        <p>
          Ask about Secret Satoshis research, examine current Bitcoin data, or
          upload a file for analysis.
        </p>
        <div className="a21-chips">
          <span>Research & sources</span>
          <span>Charts & calculations</span>
          <span>CSV & PDF analysis</span>
        </div>
        {configured() ? (
          <>
            <p>
              {signedIn
                ? "This account does not have access to Agent 21."
                : "Agent 21 is currently available to invited users."}
            </p>
            <Link className="a21-button" href="/sign-in">
              {signedIn ? "Manage sign-in" : "Sign in to the beta"}
            </Link>
          </>
        ) : (
          <p role="status">The website beta is coming soon.</p>
        )}
        <a
          className="a21-secondary"
          href="https://chatgpt.com/g/g-BZXtVdU6M-agent-21"
          target="_blank"
          rel="noopener noreferrer"
        >
          Use Agent 21 on ChatGPT ↗
        </a>
      </div>
      <footer>
        <a href={`${SITE}/privacy.html`}>Privacy</a>
        <span>
          Bitcoin education and research. Not personalized financial advice.
        </span>
      </footer>
    </main>
  );
}
