import {
  ChatDemo,
  Ctas,
  DESCRIPTION,
  Foot,
  GPT_URL,
  Switch,
  Top,
} from "./parts";

// Concept 1 · Launch: a centred statement, the product window, then what it
// does, how it answers and access.
const FEATURES: [string, string][] = [
  [
    "Research",
    "Reads the Secret Satoshis newsletter, quarterly reports and price outlook, and links the piece it draws on.",
  ],
  [
    "Live data",
    "Pulls current and historical Bitcoin data, completed daily closes and on-chain series, each with its date.",
  ],
  [
    "Charts",
    "Draws interactive charts from the Chart Library or builds new ones for the window you ask about.",
  ],
  [
    "Calculations",
    "Runs returns, drawdowns, savings-plan backtests and comparisons in Python, and shows the method.",
  ],
  [
    "Your files",
    "Analyzes a CSV or PDF you upload and returns charts, tables or a written report.",
  ],
  [
    "Limits stated",
    "Says when data is missing, partial or out of date instead of filling the gap.",
  ],
];

const STEPS: [string, string][] = [
  ["Ask", "Ask in plain language: a metric, a scenario, a chart or a file."],
  [
    "It works",
    "Agent 21 reads the sources and runs the numbers in its own sandbox.",
  ],
  [
    "Check",
    "Every figure comes with its source and date, and charts you can open.",
  ],
];

const FAQ: [string, string][] = [
  [
    "What does it cost?",
    "Nothing during the beta. Secret Satoshis covers the costs.",
  ],
  [
    "Who can use it?",
    "Invited accounts. Request an invite and you will hear back by email.",
  ],
  [
    "Is it financial advice?",
    "No. Agent 21 explains evidence and frameworks for informational and educational purposes; it does not give personal financial advice.",
  ],
  [
    "Where does the data come from?",
    "Secret Satoshis research and its open data release, the Chart Library, BRK on-chain data, Polymarket, public GitHub repositories and web search.",
  ],
];

export function Concept1() {
  return (
    <div className="lp c1">
      <style>{css}</style>
      <Top
        links={[
          ["#what", "What it does"],
          ["#faq", "FAQ"],
        ]}
      />
      <main>
        <section className="c1-hero">
          <div className="lp-wrap">
            <span className="lp-pill">Agent 21 · Private beta</span>
            <h1 className="lp-display">
              Ask the evidence<span className="acc">.</span> Check every answer
              <span className="acc">.</span>
            </h1>
            <p className="lp-lede">{DESCRIPTION}</p>
            <Ctas />
            <p className="lp-note">
              Free during the beta ·{" "}
              <a href={GPT_URL}>Or try it on ChatGPT ↗</a>
            </p>
            <div className="c1-stage">
              <ChatDemo />
            </div>
          </div>
        </section>

        <div className="c1-strip">
          <div className="lp-wrap">
            <b>Reads</b>
            {[
              "Secret Satoshis research",
              "Daily data release",
              "Chart Library",
              "BRK on-chain data",
              "Polymarket",
              "Web search",
            ].map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        </div>

        <section className="c1-section" id="what">
          <div className="lp-wrap">
            <p className="lp-label">
              <span className="acc">{"//"}</span> What it does
            </p>
            <h2 className="lp-display">One place to ask, test and verify.</h2>
            <div className="c1-grid">
              {FEATURES.map(([t, d]) => (
                <div className="lp-card" key={t}>
                  <h3>
                    <span className="acc">{"// "}</span>
                    {t}
                  </h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="c1-section c1-alt">
          <div className="lp-wrap">
            <p className="lp-label">
              <span className="acc">{"//"}</span> How it answers
            </p>
            <h2 className="lp-display">Evidence first, then the view.</h2>
            <div className="c1-grid c1-steps">
              {STEPS.map(([t, d], i) => (
                <div className="lp-card" key={t}>
                  <span className="c1-num">0{i + 1}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="c1-section" id="faq">
          <div className="lp-wrap c1-faq">
            <p className="lp-label">
              <span className="acc">{"//"}</span> Questions
            </p>
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="c1-final">
          <div className="lp-wrap">
            <h2 className="lp-display">
              Explore Bitcoin with the evidence in view.
            </h2>
            <Ctas />
          </div>
        </section>
      </main>
      <Foot />
      <Switch current={1} />
    </div>
  );
}

const css = `
.c1-hero { text-align: center; padding-block: clamp(56px, 9vw, 110px) 64px; background: radial-gradient(ellipse 50% 40% at 50% 12%, rgba(247,147,26,.09), transparent 70%); }
.c1-hero h1 { font-size: clamp(36px, 6.2vw, 74px); max-width: 15ch; margin: 26px auto 20px; }
.c1-hero .lp-lede { margin: 0 auto 30px; }
.c1-hero .lp-ctas { justify-content: center; }
.c1-hero .lp-note { margin-top: 16px; }
.c1-stage { max-width: 760px; margin: 56px auto 0; }
.c1-strip { border-block: 1px solid var(--border); background: var(--bg-alt); }
.c1-strip .lp-wrap { display: flex; flex-wrap: wrap; gap: 10px 28px; justify-content: center; padding-block: 18px; font-size: 12px; color: var(--dim); letter-spacing: .06em; text-transform: uppercase; }
.c1-strip b { color: var(--mute); }
.c1-section { padding-block: clamp(56px, 8vw, 96px); }
.c1-section h2 { font-size: clamp(26px, 3.6vw, 40px); margin: 12px 0 32px; }
.c1-alt { background: var(--bg-alt); border-block: 1px solid var(--border); }
.c1-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.c1-num { display: block; font-family: var(--display); font-weight: 700; color: var(--accent); font-size: 18px; margin-bottom: 10px; }
.c1-faq { max-width: 780px; }
.c1-faq details { border-bottom: 1px solid var(--border); padding: 18px 0; }
.c1-faq summary { cursor: pointer; color: #fff; }
.c1-faq details p { color: var(--dim); font-size: 13px; margin-top: 10px; }
.c1-final { text-align: center; padding-block: 80px; border-top: 1px solid var(--border); background: radial-gradient(ellipse 40% 60% at 50% 100%, rgba(247,147,26,.08), transparent 70%); }
.c1-final h2 { font-size: clamp(28px, 4vw, 44px); max-width: 16ch; margin: 0 auto 26px; }
.c1-final .lp-ctas { justify-content: center; }
@media (max-width: 860px) { .c1-grid { grid-template-columns: 1fr; } }
`;
