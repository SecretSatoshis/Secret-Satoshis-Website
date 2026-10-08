import Link from "next/link";

export const GPT_URL = "https://chatgpt.com/g/g-BZXtVdU6M-agent-21";
export const DESCRIPTION =
  "Agent 21 by Secret Satoshis is an AI agent for exploring Secret Satoshis research, data, and market frameworks. Ask it to explain a metric, compare scenarios, or examine the evidence behind an investment thesis.";

export function Top({ links }: { links?: [string, string][] }) {
  return (
    <header className="lp-top">
      <div className="lp-wrap">
        <a className="lp-brand" href="https://secretsatoshis.com">
          <span className="acc">{"//"}</span> SECRET SATOSHIS
        </a>
        <nav>
          {(links ?? []).map(([href, text]) => (
            <a key={href} className="lp-hide" href={href}>
              {text}
            </a>
          ))}
          <Link className="lp-btn ghost sm" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Ctas() {
  return (
    <div className="lp-ctas">
      <Link className="lp-btn primary" href="/sign-up">
        Request an invite
      </Link>
      <Link className="lp-btn ghost" href="/sign-in">
        Sign in
      </Link>
    </div>
  );
}

export function Foot() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap">
        <span>
          <span className="acc">{"//"}</span> Created by Trey Brunson ·
          Don&apos;t trust. Verify.
        </span>
        <nav>
          <a href="https://secretsatoshis.com/privacy.html">Privacy</a>
          <a href="https://newsletter.secretsatoshis.com/p/secret-satoshis-newsletter-disclaimer">
            Disclaimer
          </a>
          <a href={GPT_URL}>Agent 21 on ChatGPT</a>
        </nav>
        <span style={{ flexBasis: "100%" }}>
          For informational and educational purposes. Not financial advice.
        </span>
      </div>
    </footer>
  );
}

export function Switch({ current }: { current: number }) {
  return (
    <nav className="lp-switch" aria-label="Concepts">
      {[1, 2, 3].map((n) => (
        <Link
          key={n}
          href={`/design/${n}`}
          aria-current={n === current ? "page" : undefined}
        >
          {n}
        </Link>
      ))}
    </nav>
  );
}

// 30 completed UTC days, Sep 8 to Oct 7, 2026, from BRK; y = $90k at 10, $50k at 190.
const PRICE =
  "10,61.6 30,64 50,69.5 70,69 90,67.2 110,69.5 130,61.7 150,74 170,73.7 190,71 210,50.1 230,49.3 250,49.4 270,27.1 290,27.4 310,35.8 330,36.2 350,36.7 370,36.3 390,36 410,40.2 430,39 450,39.9 470,34.4 490,35.5 510,33.2 530,26.9 550,27.9 570,31.4 590,40.7";
const REALIZED =
  "10,175.8 50,175.7 90,175.7 130,175.6 170,175.7 210,175.5 250,175.4 290,174.5 330,174.4 370,174.2 410,174 450,173.9 490,173.5 530,173.4 570,173.1 590,173";

export function PriceChart() {
  return (
    <div className="lp-chart">
      <div className="lp-chart-t">
        <span>Bitcoin Price vs Realized Price</span>
        <span>Sep 8 – Oct 7, 2026 · USD</span>
      </div>
      <svg
        viewBox="0 0 600 200"
        role="img"
        aria-label="Bitcoin price between $75.8k and $86.2k over 30 days, above a realized price near $53.8k"
      >
        <g stroke="#1c1c2e">
          {[10, 55, 100, 145, 190].map((y) => (
            <line key={y} x1="10" x2="590" y1={y} y2={y} />
          ))}
        </g>
        <g fill="#82829c" fontSize="10">
          <text x="14" y="51">
            $80k
          </text>
          <text x="14" y="141">
            $60k
          </text>
        </g>
        <polyline
          fill="none"
          stroke="#6d9eff"
          strokeWidth="2"
          points={REALIZED}
        />
        <polyline
          fill="none"
          stroke="#f7931a"
          strokeWidth="2.5"
          points={PRICE}
        />
      </svg>
      <div className="lp-legend">
        <span>
          <i style={{ background: "#f7931a" }} />
          Bitcoin price
        </span>
        <span>
          <i style={{ background: "#6d9eff" }} />
          Realized price
        </span>
      </div>
    </div>
  );
}

export function ChatDemo() {
  return (
    <div className="lp-chat">
      <div className="lp-chat-bar">
        <div className="lp-av">₿</div>
        <div>
          <div className="lp-chat-name">Agent 21</div>
          <div className="lp-chat-status">Ready</div>
        </div>
      </div>
      <div className="lp-chat-body">
        <div className="lp-user">
          Chart Bitcoin price vs realized price, last 30 days
        </div>
        <div className="lp-step">
          Read the published Realized Price chart, trimmed to 30 completed UTC
          days
        </div>
        <div className="lp-agent">
          On October 7 (UTC), Bitcoin closed at <strong>$83,172</strong> against
          a realized price of <strong>$53,779</strong>, a 55% premium to the
          network&apos;s average cost basis.
          <PriceChart />
          <span className="lp-cite">
            Source: Secret Satoshis Chart Library · data through Oct 7, 2026
          </span>
        </div>
      </div>
    </div>
  );
}
