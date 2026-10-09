import { auth } from "@clerk/nextjs/server";
import { hasAccess } from "../lib/agent21/auth";
import { configured } from "../lib/agent21/config";
import { Chat } from "../components/agent21/chat";
import { Landing } from "../components/agent21/landing/landing";
import "./landing.css";
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
    <Landing access={!configured() ? "soon" : signedIn ? "denied" : "open"} />
  );
}
