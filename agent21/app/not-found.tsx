import Link from "next/link";
import { SITE } from "../lib/agent21/types";
export default function NotFound() {
  return (
    <main className="a21-welcome">
      <a className="a21-brand" href={SITE}>
        {"// SECRET SATOSHIS"}
      </a>
      <div className="a21-intro">
        <p className="a21-eyebrow">404</p>
        <h1>Page not found.</h1>
        <Link className="a21-button" href="/">
          Return to Agent 21
        </Link>
      </div>
    </main>
  );
}
