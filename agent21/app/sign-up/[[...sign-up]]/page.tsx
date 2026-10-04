import { SignUp } from "@clerk/nextjs";
import { SITE } from "../../../lib/agent21/types";
export default function Page() {
  return (
    <main className="a21-auth">
      <a href={SITE}>{"// SECRET SATOSHIS"}</a>
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <SignUp fallbackRedirectUrl="/" />
      ) : (
        <p>The beta is coming soon.</p>
      )}
    </main>
  );
}
