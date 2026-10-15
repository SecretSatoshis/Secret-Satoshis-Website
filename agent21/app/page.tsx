import type { Metadata } from "next";
import site from "../site.json";
import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { hasAccess } from "../lib/agent21/auth";
import { configured } from "../lib/agent21/config";
import { Chat } from "../components/agent21/chat";
import { loadExampleFacts } from "../components/agent21/landing/example-facts";
import { Landing } from "../components/agent21/landing/landing";
import type { Access } from "../components/agent21/landing/parts";
import {
  loadChainHeight,
  loadPrice,
  loadPriceOdds,
  loadRealizedLevels,
} from "../components/agent21/landing/live-examples";
import "./landing.css";
export const dynamic = "force-dynamic";

// The landing page is the public front door, so unlike the app's other routes
// it is indexed and carries a share card (the homepage's).
const { title: TITLE, url: URL, description: DESCRIPTION } = site;
const CARD = {
  url: "https://secretsatoshis.com/assets/images/agent21-social-card.jpg?v=3",
  width: 1200,
  height: 630,
  alt: "Agent 21, the Bitcoin-native AI agent from Secret Satoshis",
};
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://secretsatoshis.com/#organization",
      name: "Secret Satoshis",
      url: "https://secretsatoshis.com/",
    },
    {
      "@type": "WebPage",
      "@id": `${URL}#webpage`,
      url: URL,
      name: TITLE,
      description: DESCRIPTION,
      publisher: { "@id": "https://secretsatoshis.com/#organization" },
      mainEntity: { "@id": `${URL}#application` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${URL}#application`,
      name: "Agent 21",
      url: URL,
      description: DESCRIPTION,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web browser",
      publisher: { "@id": "https://secretsatoshis.com/#organization" },
    },
  ],
};
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: URL },
  openGraph: {
    type: "website",
    url: URL,
    locale: "en_US",
    siteName: "Secret Satoshis",
    title: TITLE,
    description: DESCRIPTION,
    images: [CARD],
  },
  twitter: {
    card: "summary_large_image",
    site: "@SecretSatoshis",
    creator: "@SecretSatoshis",
    title: TITLE,
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
  // Every source loads together. The price now and the realized prices fall
  // back to the release's, so they wait for the release; the Polymarket
  // ladder waits only for the price it is drawn around.
  const factsLoad = loadExampleFacts();
  const priceLoad = loadPrice(
    factsLoad.then((f) => ({
      date: f.report_date,
      price: f.cost_basis.close,
    })),
  );
  const [facts, chain, price, odds, levels] = await Promise.all([
    factsLoad,
    loadChainHeight(),
    priceLoad,
    loadPriceOdds(priceLoad),
    loadRealizedLevels(
      factsLoad.then((f) => ({
        realized: f.cost_basis.realized_price,
        sth: f.cost_basis.sth_realized_price,
      })),
    ),
  ]);
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c"),
        }}
      />
      <Landing
        access={access}
        facts={facts}
        live={{ chain, odds, price, levels }}
      />
    </>
  );
}
