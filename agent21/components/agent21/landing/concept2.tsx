import {
  ChatDemo,
  Ctas,
  DESCRIPTION,
  Foot,
  GPT_URL,
  Switch,
  Top,
} from "./parts";

// Concept 2 · Dossier: an institutional research briefing with numbered
// chapters and a sticky index.
const CHAPTERS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "what",
    title: "What Agent 21 is",
    body: (
      <>
        <p>{DESCRIPTION}</p>
        <p>
          It is the interface to the Secret Satoshis system: a decade of market
          experience turned into research, open data and models, and now a
          conversation you can test.
        </p>
      </>
    ),
  },
  {
    id: "reads",
    title: "What it reads",
    body: (
      <ul className="c2-list">
        <li>
          <b>Secret Satoshis research</b> the newsletter, quarterly reports and
          the price outlook
        </li>
        <li>
          <b>Daily data release</b> market, on-chain, ETF and valuation series,
          by completed UTC day
        </li>
        <li>
          <b>Chart Library</b> the published interactive charts, trimmed to your
          window
        </li>
        <li>
          <b>BRK</b> on-chain series and the live Bitcoin network
        </li>
        <li>
          <b>Polymarket</b> what prediction markets price for Bitcoin and the
          macro
        </li>
        <li>
          <b>Web search</b> dated news for what changed this week
        </li>
      </ul>
    ),
  },
  {
    id: "answers",
    title: "How it answers",
    body: (
      <>
        <p>
          Every figure carries its source and date. Daily closes use completed
          UTC days. When data is missing or partial, the answer says so.
        </p>
        <div className="c2-demo">
          <ChatDemo />
        </div>
      </>
    ),
  },
  {
    id: "ask",
    title: "What to ask",
    body: (
      <ol className="c2-asks">
        <li>
          What was yesterday&apos;s close, and how does it compare with last
          week?
        </li>
        <li>Chart price against realized price for the last five years.</li>
        <li>How has the Secret Satoshis outlook held up this quarter?</li>
        <li>Backtest buying $100 every week since 2020.</li>
        <li>Summarize the attached CSV of my purchases.</li>
      </ol>
    ),
  },
  {
    id: "access",
    title: "Access",
    body: (
      <>
        <p>
          Agent 21 is in private beta and free for invited accounts. Each
          account runs one answer at a time. Conversations and files stay until
          you delete them.
        </p>
        <Ctas />
      </>
    ),
  },
];

export function Concept2() {
  return (
    <div className="lp c2">
      <style>{css}</style>
      <Top />
      <main className="lp-wrap">
        <div className="c2-meta">
          <span>Agent 21</span>
          <span>Briefing</span>
          <span>October 2026</span>
          <span className="acc">Status: private beta</span>
        </div>
        <header className="c2-head">
          <h1 className="lp-display">
            An AI agent for Bitcoin evidence<span className="acc">.</span>
          </h1>
          <p className="lp-lede">
            Bitcoin intelligence you can verify, now through conversation.
          </p>
          <Ctas />
          <p className="lp-note">
            Already on ChatGPT? <a href={GPT_URL}>Open Agent 21 there ↗</a>
          </p>
        </header>
        <div className="c2-body">
          <nav className="c2-index" aria-label="Contents">
            <p className="lp-label">Contents</p>
            {CHAPTERS.map((c, i) => (
              <a key={c.id} href={`#${c.id}`}>
                <span>0{i + 1}</span> {c.title}
              </a>
            ))}
          </nav>
          <div>
            {CHAPTERS.map((c, i) => (
              <section key={c.id} id={c.id} className="c2-ch">
                <p className="c2-n">0{i + 1}</p>
                <h2 className="lp-display">{c.title}</h2>
                {c.body}
              </section>
            ))}
          </div>
        </div>
      </main>
      <Foot />
      <Switch current={2} />
    </div>
  );
}

const css = `
.c2-meta { display: flex; flex-wrap: wrap; gap: 8px 24px; padding-block: 18px; border-bottom: 1px dashed var(--border-hi); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--mute); }
.c2-head { padding-block: clamp(48px, 8vw, 96px) 56px; border-bottom: 1px solid var(--border); }
.c2-head h1 { font-size: clamp(38px, 6.8vw, 84px); max-width: 13ch; margin-bottom: 20px; }
.c2-head .lp-lede { font-size: 15px; margin-bottom: 28px; }
.c2-head .lp-note { margin-top: 16px; }
.c2-body { display: grid; grid-template-columns: 220px 1fr; gap: clamp(24px, 5vw, 72px); padding-block: 48px 72px; }
.c2-body > * { min-width: 0; }
.c2-index { position: sticky; top: 84px; align-self: start; display: flex; flex-direction: column; gap: 10px; font-size: 12px; color: var(--dim); }
.c2-index a:hover { color: #fff; }
.c2-index span { color: var(--accent); margin-right: 6px; }
.c2-ch { padding-block: 8px 48px; margin-bottom: 40px; border-bottom: 1px dashed var(--border); max-width: 70ch; }
.c2-ch:last-child { border-bottom: 0; }
.c2-ch p { color: var(--dim); margin-bottom: 14px; }
.c2-ch h2 { font-size: clamp(24px, 3vw, 34px); margin-bottom: 16px; }
.c2-n { font-family: var(--display); color: var(--accent) !important; font-weight: 700; font-size: 14px; letter-spacing: .1em; }
.c2-list { list-style: none; display: grid; gap: 10px; }
.c2-list li { color: var(--dim); padding-left: 16px; border-left: 2px solid var(--border-hi); }
.c2-list b { display: block; color: #fff; font-weight: 600; }
.c2-asks { display: grid; gap: 8px; padding-left: 20px; color: var(--text); }
.c2-asks li::marker { color: var(--accent); }
.c2-demo { margin-top: 20px; }
@media (max-width: 860px) { .c2-body { grid-template-columns: 1fr; } .c2-index { position: static; } }
`;
