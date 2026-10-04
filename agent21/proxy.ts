import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

// Clerk generates the nonce and its own required sources (Frontend API,
// telemetry, Turnstile, avatars); these directives add only Agent 21's needs.
const clerk = clerkMiddleware({
  contentSecurityPolicy: {
    strict: true,
    directives: {
      // Presigned browser uploads go to the Vercel Blob API.
      "connect-src": ["https://vercel.com/api/blob/"],
      "img-src": ["data:", "blob:"],
      "font-src": ["self"],
      "object-src": ["none"],
      "base-uri": ["self"],
      "frame-ancestors": ["none"],
    },
  },
});
// Before Clerk is configured the app serves only the "coming soon" page.
function unconfigured(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`;
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}
export default async function proxy(
  request: NextRequest,
  event: Parameters<typeof clerk>[1],
) {
  const response = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? await clerk(request, event)
    : unconfigured(request);
  // Pages and JSON responses hold private conversation data. File downloads
  // set their own private, revalidating cache headers.
  if (response && !request.nextUrl.pathname.startsWith("/api/agent21/files/"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/",
    "/c/:path*",
    "/deletion/:path*",
    "/sign-in/:path*",
    "/sign-up/:path*",
    "/api/agent21/:path*",
  ],
};
