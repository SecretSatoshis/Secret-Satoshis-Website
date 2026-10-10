import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { hasAccess } from "../lib/agent21/auth";
import { configured } from "../lib/agent21/config";
import { Chat } from "../components/agent21/chat";
import { loadExampleFacts } from "../components/agent21/landing/example-facts";
import { Landing } from "../components/agent21/landing/landing";
import type { Access } from "../components/agent21/landing/parts";
import {
  loadChainHeight,
  loadPriceOdds,
} from "../components/agent21/landing/live-examples";
import "./landing.css";
export const dynamic = "force-dynamic";

// The landing page is the public front door, so unlike the app's other routes
// it is indexed and carries a share card (the homepage's).
const DESCRIPTION =
  "Agent 21 is the Bitcoin-native AI agent built by Secret Satoshis: our market frameworks, open-source code and live market data in one conversation.";
const CARD = {
  url: "https://secretsatoshis.com/assets/images/social-card.jpg",
  width: 1200,
  height: 630,
  alt: "Secret Satoshis orange Bitcoin smile mark on a black background",
};
export const metadata: Metadata = {
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Secret Satoshis",
    title: "Agent 21 | Secret Satoshis",
    description: DESCRIPTION,
    images: [CARD],
  },
  twitter: {
    card: "summary_large_image",
    site: "@SecretSatoshis",
    creator: "@SecretSatoshis",
    title: "Agent 21 | Secret Satoshis",
    description: DESCRIPTION,
    images: [CARD],
  },
};

export default async function AgentPage() {
  let access: Access = "soon";
  if (configured()) {
    access = "open";
    const { userId } = await auth();
    if (userId) {
      // The landing stays up during a database outage, and says so rather
      // than telling an invited account it has no access.
      const allowed = await hasAccess(userId).catch(() => null);
      if (allowed) return <Chat />;
      access = allowed === null ? "unavailable" : "denied";
    }
  }
  // All three sources load together; the Polymarket ladder waits only for the
  // close it is drawn around.
  const factsLoad = loadExampleFacts();
  const [facts, chain, odds] = await Promise.all([
    factsLoad,
    loadChainHeight(),
    loadPriceOdds(
      factsLoad.then((f) => ({
        date: f.report_date,
        price: f.cost_basis.close,
      })),
    ),
  ]);
  return <Landing access={access} facts={facts} live={{ chain, odds }} />;
}
