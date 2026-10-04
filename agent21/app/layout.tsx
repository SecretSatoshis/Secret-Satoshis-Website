import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { headers } from "next/headers";
import "./agent21.css";
export const metadata: Metadata = {
  title: "Agent 21 | Secret Satoshis",
  description: "Explore Bitcoin research and data with Agent 21.",
  robots: { index: false, follow: false },
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  const content = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
    <ClerkProvider nonce={nonce} dynamic>
      {children}
    </ClerkProvider>
  ) : (
    children
  );
  return (
    <html lang="en">
      <head>
        {/* The homepage's self-hosted font stylesheet, copied in at build
            time so both sites share one file and its font URLs. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/css/fonts.css" />
      </head>
      <body>{content}</body>
    </html>
  );
}
