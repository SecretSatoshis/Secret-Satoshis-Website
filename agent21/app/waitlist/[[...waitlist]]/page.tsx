import { Waitlist } from "@clerk/nextjs";
import { SITE } from "../../../lib/agent21/types";
// The private beta's front door: Clerk records the email, and an approval in
// the Clerk dashboard sends the invitation.
export default function Page() {
  return (
    <main className="a21-auth">
      <a href={SITE}>{"// SECRET SATOSHIS"}</a>
      {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <Waitlist afterJoinWaitlistUrl="/" />
      ) : (
        <p>The beta is coming soon.</p>
      )}
    </main>
  );
}
