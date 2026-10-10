import Link from "next/link";

/** Who is looking at the landing page: anyone signed out, a signed-in
 * account without beta access, a signed-in account whose access could not be
 * checked (a database outage), or anyone before sign-in is configured. */
export type Access = "open" | "denied" | "unavailable" | "soon";

export const UNAVAILABLE =
  "Agent 21 is briefly unavailable. Please try again in a few minutes.";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="nx-eyebrow">
      <span aria-hidden="true">{"//"}</span> {children}
    </p>
  );
}

/** A section label in the homepage style: "// Label", centered above the
 * section title. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="ss-label">
      <span className="acc">{"//"}</span> {children}
    </p>
  );
}

/** The page's one call-to-action button: the waitlist by default. */
export function AccessLink({
  href = "/waitlist",
  children = "Join the private beta",
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link className="a21-button" href={href}>
      {children}
      <span aria-hidden="true">↗</span>
    </Link>
  );
}

export function Beta({ access }: { access: Access }) {
  return (
    <section className="nx-beta" id="beta">
      <div>
        <Eyebrow>Private beta</Eyebrow>
        <h2>Ask Agent 21 your next Bitcoin question.</h2>
        <p>
          From the fundamentals to this week&apos;s market move, with our
          frameworks and sources behind every answer.
        </p>
      </div>
      <div className="nx-beta-action">
        {access === "open" && (
          <>
            <AccessLink />
            <p>
              Free during beta · Invite-only ·{" "}
              <Link className="r9-signin" href="/sign-in">
                Already invited? Sign in →
              </Link>
            </p>
          </>
        )}
        {access === "denied" && (
          <>
            <AccessLink href="/sign-in">Manage sign-in</AccessLink>
            <p role="status">This account does not have access to Agent 21.</p>
          </>
        )}
        {access === "unavailable" && <p role="status">{UNAVAILABLE}</p>}
        {access === "soon" && (
          <p role="status">The website beta is coming soon.</p>
        )}
      </div>
    </section>
  );
}
