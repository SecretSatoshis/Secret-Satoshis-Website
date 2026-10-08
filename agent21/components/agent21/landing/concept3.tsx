import { Ctas, DESCRIPTION, Foot, GPT_URL, Switch, Top } from "./parts";

// Concept 3 · Evidence map: sources flow into Agent 21 and out as an answer
// you can check, framed by the platform's authority flow.
const SOURCES = [
  "Secret Satoshis research",
  "Daily data release",
  "Chart Library",
  "BRK on-chain data",
  "Polymarket",
  "Web search",
];
const OUTPUTS = [
  "Answer with dated sources",
  "Interactive chart",
  "CSV, PNG or PDF file",
];
const FLOW: [string, string][] = [
  ["Market experience", "A decade inside Bitcoin markets"],
  ["Original research", "The newsletter, reports and outlook"],
  ["Open evidence", "Data, charts, models and code you can inspect"],
  ["Agent 21", "Ask, test, compare and explore"],
];
const RULES: [string, string][] = [
  ["Dated", "Every figure names its source and date."],
  [
    "Completed days",
    "Daily closes use finished UTC days, never a partial one.",
  ],
  ["Honest gaps", "Missing or stale data is stated, not filled in."],
  ["Not advice", "Evidence and frameworks, not personal recommendations."],
];

export function Concept3() {
  return (
    <div className="lp c3">
      <style>{css}</style>
      <Top
        links={[
          ["#map", "How it works"],
          ["#rules", "Standards"],
        ]}
      />
      <main>
        <section className="c3-hero lp-wrap">
          <span className="lp-pill">Agent 21 · Private beta</span>
          <h1 className="lp-display">
            Every answer traces back to the data<span className="acc">.</span>
          </h1>
          <p className="lp-lede">{DESCRIPTION}</p>
          <Ctas />
          <p className="lp-note">
            Free during the beta · <a href={GPT_URL}>Also on ChatGPT ↗</a>
          </p>
        </section>

        <section
          className="c3-map lp-wrap"
          id="map"
          aria-label="How Agent 21 works"
        >
          <div className="c3-col">
            <p className="lp-label">Reads</p>
            {SOURCES.map((s) => (
              <div className="c3-node" key={s}>
                {s}
              </div>
            ))}
          </div>
          <div className="c3-core">
            <div className="c3-ring">
              <div className="c3-mark">21</div>
            </div>
            <p className="lp-label">
              <span className="acc">{"//"}</span> Agent 21
            </p>
            <p className="c3-core-note">
              Reads, calculates and checks in its own sandbox
            </p>
          </div>
          <div className="c3-col">
            <p className="lp-label">Returns</p>
            {OUTPUTS.map((s) => (
              <div className="c3-node out" key={s}>
                {s}
              </div>
            ))}
          </div>
        </section>

        <section className="c3-flow">
          <div className="lp-wrap">
            <p className="lp-label">
              <span className="acc">{"//"}</span> Where it fits
            </p>
            <div className="c3-steps">
              {FLOW.map(([t, d], i) => (
                <div key={t} className={i === 3 ? "on" : ""}>
                  <b>{t}</b>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="c3-rules lp-wrap" id="rules">
          <p className="lp-label">
            <span className="acc">{"//"}</span> Standards
          </p>
          <h2 className="lp-display">Don&apos;t trust. Verify.</h2>
          <div className="c3-grid">
            {RULES.map(([t, d]) => (
              <div className="lp-card" key={t}>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
          <div className="c3-end">
            <Ctas />
          </div>
        </section>
      </main>
      <Foot />
      <Switch current={3} />
    </div>
  );
}

const css = `
.c3-hero { padding-block: clamp(56px, 9vw, 104px) 40px; }
.c3-hero h1 { font-size: clamp(34px, 5.8vw, 70px); max-width: 16ch; margin: 24px 0 18px; }
.c3-hero .lp-lede { margin-bottom: 28px; }
.c3-hero .lp-note { margin-top: 16px; }
.c3-map { display: grid; grid-template-columns: 1fr auto 1fr; gap: clamp(20px, 4vw, 56px); align-items: center; padding-block: 48px 72px; }
.c3-map > * { min-width: 0; }
.c3-col { display: flex; flex-direction: column; gap: 10px; }
.c3-node { position: relative; padding: 12px 16px; border: 1px solid var(--border-hi); border-radius: 10px; background: var(--surface); font-size: 12px; color: var(--text); }
.c3-col:first-child .c3-node::after, .c3-node.out::before { content: ''; position: absolute; top: 50%; width: clamp(20px, 4vw, 56px); border-top: 1px dashed var(--accent-line); }
.c3-col:first-child .c3-node::after { left: 100%; }
.c3-node.out::before { right: 100%; }
.c3-node.out { border-color: var(--accent-line); background: var(--accent-soft); }
.c3-core { text-align: center; display: grid; justify-items: center; gap: 10px; }
.c3-ring { width: 150px; height: 150px; border-radius: 50%; display: grid; place-items: center; border: 1px dashed var(--accent-line); box-shadow: 0 0 80px rgba(247,147,26,.15), inset 0 0 40px rgba(247,147,26,.08); }
.c3-mark { width: 92px; height: 92px; border-radius: 50%; background: var(--accent); color: var(--bg); display: grid; place-items: center; font-family: var(--display); font-weight: 800; font-size: 34px; }
.c3-core-note { font-size: 12px; color: var(--dim); max-width: 22ch; }
.c3-flow { border-block: 1px solid var(--border); background: var(--bg-alt); padding-block: 40px; }
.c3-steps { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: 18px; }
.c3-steps div { padding: 16px 18px; border-left: 1px dashed var(--border-hi); }
.c3-steps b { display: block; color: #fff; font-size: 13px; }
.c3-steps span { font-size: 12px; color: var(--dim); }
.c3-steps .on { border-left: 2px solid var(--accent); background: var(--accent-soft); }
.c3-steps .on b { color: var(--accent); }
.c3-rules { padding-block: clamp(56px, 8vw, 96px); }
.c3-rules h2 { font-size: clamp(26px, 3.6vw, 40px); margin: 12px 0 28px; }
.c3-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.c3-end { margin-top: 40px; }
@media (max-width: 860px) {
  .c3-map { grid-template-columns: 1fr; }
  .c3-col:first-child .c3-node::after, .c3-node.out::before { display: none; }
  .c3-steps, .c3-grid { grid-template-columns: 1fr 1fr; }
}
`;
