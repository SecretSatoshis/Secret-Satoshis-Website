import Link from "next/link";

/** Who is looking at the landing page: anyone signed out, a signed-in
 * account without beta access, or anyone before sign-in is configured. */
export type Access = "open" | "denied" | "soon";

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="nx-eyebrow">
      <span aria-hidden="true">{"//"}</span> {children}
    </p>
  );
}

export function AccessLink({
  href = "/sign-up",
  children = "Join the private beta",
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link className="rx-access" href={href}>
      {children}
      <span aria-hidden="true">↗</span>
    </Link>
  );
}

export function Beta({ access }: { access: Access }) {
  return (
    <section className="nx-beta" id="beta">
      <div>
        <Eyebrow>Private beta · Now taking shape</Eyebrow>
        <h2>
          Your next Bitcoin question
          <br />
          starts here.
        </h2>
        <p>
          Explore the research. Test a scenario. Follow the sources.
          <br className="nx-desktop" /> Get to know Agent 21 by Secret Satoshis.
        </p>
      </div>
      <div className="nx-beta-action">
        {access === "open" && (
          <>
            <Link className="nx-button" href="/sign-up">
              Join the beta <span aria-hidden="true">↗</span>
            </Link>
            <p>Free during beta · Invite-only access</p>
            <Link className="nx-text-link" href="/sign-in">
              Already invited? Sign in →
            </Link>
          </>
        )}
        {access === "denied" && (
          <>
            <Link className="nx-button" href="/sign-in">
              Manage sign-in <span aria-hidden="true">↗</span>
            </Link>
            <p role="status">This account does not have access to Agent 21.</p>
          </>
        )}
        {access === "soon" && (
          <p role="status">The website beta is coming soon.</p>
        )}
      </div>
    </section>
  );
}
