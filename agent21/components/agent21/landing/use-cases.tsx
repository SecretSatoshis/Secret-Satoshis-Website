"use client";

import { useEffect, useRef, useState } from "react";
import { AgentAvatar, type AgentState } from "../agent-avatar";
import { Eyebrow } from "./parts";
import { FIVE_YEAR, REPORT_DATE, WEEKLY } from "./use-case-data";

// Concept 9's main section: the idea, then five ways to use Agent 21, each shown as a chat.
// Figures come from the Report Library release in use-case-data.ts, from
// BRK (bitview.space) as of block 970,543 on Oct 8, 2026, and from Polymarket's
// "What price will Bitcoin hit in 2026?" event retrieved Oct 8, 2026, 23:52 UTC.

const PIZZA_TX =
  "a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d";
const CHART_URL =
  "https://charts.secretsatoshis.com/Bitcoin_Realized_Price.html";
const POLYMARKET_URL =
  "https://polymarket.com/event/what-price-will-bitcoin-hit-before-2027";

const CHIP: Record<AgentState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  answering: "Answering",
  done: "Answered",
  asleep: "Resting",
};

function Chat({
  question,
  step,
  source,
  date = REPORT_DATE,
  children,
}: {
  question: React.ReactNode;
  step: string;
  source: React.ReactNode;
  /** The date of the data the answer uses. */
  date?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<AgentState>("idle");
  // The agent works through the question the first time the chat scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setState("done");
          return;
        }
        setState("thinking");
        timers.push(setTimeout(() => setState("answering"), 1100));
        timers.push(setTimeout(() => setState("done"), 3000));
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div className="uc-chat" ref={ref}>
      <div className="uc-chat-bar">
        <span>Agent 21 · Example</span>
        <span>{date}</span>
      </div>
      <p className="uc-user">{question}</p>
      <div className="uc-msg">
        <AgentAvatar state={state} size={40} />
        <div className="uc-msg-body">
          <div className="uc-name">
            Agent 21 <span className="uc-chip">{CHIP[state]}</span>
          </div>
          <p className="uc-step">{step}</p>
          <div className="uc-answer">{children}</div>
          <p className="uc-source">
            <span aria-hidden="true">↳</span> {source}
          </p>
        </div>
      </div>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="uc-legend">
      {items.map(([label, color]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

const BANDS: [string, string, string][] = [
  ["3x Realized Price", FIVE_YEAR.realized3x, "#b39aee"],
  ["STH Realized Price", FIVE_YEAR.sthRealized, "#5fd4d0"],
  ["Realized Price", FIVE_YEAR.realized, "#6d9eff"],
  ["Bitcoin Price", FIVE_YEAR.price, "#f7931a"],
];

function RealizedChart() {
  return (
    <figure className="uc-chart">
      <figcaption className="uc-chart-t">
        <span>Bitcoin Realized Price</span>
        <span>{FIVE_YEAR.range} · USD, log scale</span>
      </figcaption>
      <svg
        viewBox="0 0 600 236"
        role="img"
        aria-label="Bitcoin price over five years on a log scale, with realized price, STH realized price and 3x realized price"
      >
        <g stroke="#1c1c2e">
          {FIVE_YEAR.ticks.map(([label, y]) => (
            <line key={label} x1="44" x2="590" y1={y} y2={y} />
          ))}
        </g>
        <g fill="#82829c" fontSize="10">
          {FIVE_YEAR.ticks.map(([label, y]) => (
            <text key={label} x="38" y={y + 3} textAnchor="end">
              {label}
            </text>
          ))}
          {FIVE_YEAR.years.map(([label, x]) => (
            <text key={label} x={x} y="230" textAnchor="middle">
              {label}
            </text>
          ))}
        </g>
        {BANDS.map(([label, points, color]) => (
          <polyline
            key={label}
            fill="none"
            stroke={color}
            strokeWidth={label === "Bitcoin Price" ? 2 : 1.5}
            strokeLinejoin="round"
            points={points}
          />
        ))}
      </svg>
      <Legend items={BANDS.map(([label, , color]) => [label, color])} />
    </figure>
  );
}

function WeeklyChart() {
  return (
    <figure className="uc-chart">
      <figcaption className="uc-chart-t">
        <span>Bitcoin Weekly Candles</span>
        <span>{WEEKLY.range} · USD</span>
      </figcaption>
      <svg
        viewBox="0 0 600 236"
        role="img"
        aria-label="52 weekly Bitcoin candles with the 2026 outlook's $120,000 base case and $70,000 bear case"
      >
        <g stroke="#1c1c2e">
          {WEEKLY.ticks.map(([label, y]) => (
            <line key={label} x1="44" x2="590" y1={y} y2={y} />
          ))}
        </g>
        <g fill="#82829c" fontSize="10">
          {WEEKLY.ticks.map(([label, y]) => (
            <text key={label} x="38" y={y + 3} textAnchor="end">
              {label}
            </text>
          ))}
          {WEEKLY.months.map(([label, x]) => (
            <text key={label} x={x} y="230" textAnchor="middle">
              {label}
            </text>
          ))}
        </g>
        {WEEKLY.candles.map(([x, open, high, low, close, up]) => (
          <g key={x} stroke={up ? "#00e5a0" : "#ef4444"}>
            <line x1={x} x2={x} y1={high} y2={low} />
            <rect
              x={x - WEEKLY.width / 2}
              y={Math.min(open, close)}
              width={WEEKLY.width}
              height={Math.max(Math.abs(open - close), 1)}
              fill={up ? "#00e5a0" : "#ef4444"}
            />
          </g>
        ))}
        <g strokeDasharray="5 4" strokeWidth="1.2" fontSize="10">
          <line
            x1="44"
            x2="590"
            y1={WEEKLY.base}
            y2={WEEKLY.base}
            stroke="#ffd700"
          />
          <text
            x="588"
            y={WEEKLY.base - 5}
            textAnchor="end"
            fill="#ffd700"
            stroke="#060610"
            strokeWidth="4"
            strokeDasharray="none"
            paintOrder="stroke"
          >
            Base case $120k
          </text>
          <line
            x1="44"
            x2="590"
            y1={WEEKLY.bear}
            y2={WEEKLY.bear}
            stroke="#ff3b30"
          />
          <text
            x="50"
            y={WEEKLY.bear + 13}
            textAnchor="start"
            fill="#ff3b30"
            stroke="#060610"
            strokeWidth="4"
            strokeDasharray="none"
            paintOrder="stroke"
          >
            Bear case $70k
          </text>
        </g>
      </svg>
    </figure>
  );
}

const CASES: [string, string, string][] = [
  ["Bull case", "$160,000", "+92%"],
  ["Base case", "$120,000", "+44%"],
  ["Bear case", "$70,000", "−16%"],
];

// Open strikes in the 2026 ladder, as midpoint "Yes" prices. None had been
// touched since its market opened, so each is the odds of a touch before 2027.
const ODDS_UP: [string, number][] = [
  ["$200k", 0.8],
  ["$150k", 2.8],
  ["$130k", 4.4],
  ["$120k", 7.5],
  ["$110k", 11.5],
  ["$100k", 26.5],
  ["$95k", 39.5],
  ["$90k", 59],
];
const ODDS_DOWN: [string, number][] = [
  ["$70k", 39.5],
  ["$65k", 23.5],
  ["$60k", 15.5],
  ["$55k", 11],
  ["$50k", 7.5],
];

function OddsRow({
  label,
  odds,
  up,
}: {
  label: string;
  odds: number;
  up: boolean;
}) {
  return (
    <div className={`uc-odds-row ${up ? "up" : "down"}`}>
      <span>
        {up ? "↑" : "↓"} {label}
      </span>
      <span className="uc-odds-track">
        <i style={{ width: `${odds}%` }} />
      </span>
      <b>{odds}%</b>
    </div>
  );
}

function OddsLadder() {
  return (
    <figure className="uc-chart">
      <figcaption className="uc-chart-t">
        <span>Odds Bitcoin touches each price in 2026</span>
        <span>Polymarket · Oct 8, 2026, 23:52 UTC</span>
      </figcaption>
      <div className="uc-odds">
        {ODDS_UP.map(([label, odds]) => (
          <OddsRow key={label} label={label} odds={odds} up />
        ))}
        <p className="uc-odds-now">Oct 7 close · $83,172</p>
        {ODDS_DOWN.map(([label, odds]) => (
          <OddsRow key={label} label={label} odds={odds} up={false} />
        ))}
      </div>
    </figure>
  );
}

const TX_FIELDS: [string, React.ReactNode][] = [
  ["Status", "Confirmed"],
  ["Block", "57,043 · May 22, 2010, 18:16:31 UTC"],
  ["Inputs", "131 legacy (P2PKH) · 10,000.99 BTC"],
  ["Output", "1 · 10,000 BTC to 17SkEw2md5avVNyYgj6RiXuQKNwkXaxFyQ"],
  ["Fee", "0.99 BTC"],
  ["Size", "23,620 bytes · 94,480 weight units"],
  ["Confirmations", "913,501 at block 970,543"],
];

const USE_CASES: {
  id: string;
  title: string;
  summary: string;
  chat: React.ReactNode;
}[] = [
  {
    id: "ask",
    title: "Ask anything",
    summary:
      "Start with a plain question. Agent 21 answers in plain language and shows where each figure came from.",
    chat: (
      <Chat
        question="What does the halving actually change?"
        step="Read the chain tip from BRK"
        date="Oct 8, 2026"
        source={<span>BRK · block 970,543 · Oct 8, 2026</span>}
      >
        <p>
          Every 210,000 blocks, roughly every four years, the new bitcoin paid
          to miners in each block is cut in half. The April 2024 halving at
          block 840,000 cut it from <strong>6.25 to 3.125 BTC</strong>.
        </p>
        <p>
          The next comes at block <strong>1,050,000</strong>, 79,457 blocks
          after the current tip: about 18 months at ten minutes a block. It
          slows how fast new coins arrive. The 21 million limit stays the same.
        </p>
      </Chat>
    ),
  },
  {
    id: "chart",
    title: "Chart the evidence",
    summary:
      "Ask for a chart and get the published series, trimmed to your window, with the numbers that matter called out.",
    chat: (
      <Chat
        question="Chart Bitcoin against realized price, STH realized price and 3x realized price for the last five years."
        step="Read the published Bitcoin Realized Price chart, trimmed to five years of completed UTC days"
        source={
          <>
            <a href={CHART_URL}>Chart Library ↗</a>
            <span>Data through {REPORT_DATE}</span>
          </>
        }
      >
        <p>
          On October 7 (UTC), Bitcoin closed at <strong>$83,172</strong>, 55%
          above the realized price of <strong>$53,779</strong> and 12% above the
          STH realized price of <strong>$74,206</strong>, which it has held
          since August 19.
        </p>
        <p>
          The 3x realized price sits at <strong>$161,336</strong>. Bitcoin has
          not closed above it since April 17, 2021. Its last stretch below
          realized price came in the 2022 bear market: 180 days between June
          2022 and January 2023.
        </p>
        <RealizedChart />
      </Chat>
    ),
  },
  {
    id: "outlook",
    title: "Review the outlook",
    summary:
      "Hold the Secret Satoshis price outlook up against the market and see how far each case sits from today.",
    chat: (
      <Chat
        question="How is the 2026 outlook holding up?"
        step="Read the 2026 price outlook and the last 52 weekly candles from the daily release"
        source={
          <span>
            Secret Satoshis 2026 outlook · Report Library release, {REPORT_DATE}
          </span>
        }
      >
        <p>
          At the October 7 close of <strong>$83,172</strong>, Bitcoin is down
          4.7% for the year. Reaching the <strong>$120,000</strong> base case
          would take a 44% rise in the 12 weeks left, and the close sits 19%
          above the <strong>$70,000</strong> bear case.
        </p>
        <p>
          Over the past year, daily closes ranged from $123,102 on October 8,
          2025 to $58,367 on June 30, 2026. The outlook marks support at
          $73,757, the 2024 prior high, and resistance at $100,000.
        </p>
        <WeeklyChart />
        <table className="uc-cases">
          <caption>Year-end cases against the Oct 7 close</caption>
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Target</th>
              <th scope="col">Move needed</th>
            </tr>
          </thead>
          <tbody>
            {CASES.map(([name, target, move]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{target}</td>
                <td>{move}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Chat>
    ),
  },
  {
    id: "odds",
    title: "Read the prediction markets",
    summary:
      "See what traders price for Bitcoin and the macro, with the volume and liquidity behind each price.",
    chat: (
      <Chat
        question="What price is Bitcoin likely to hit this year?"
        step="Opened Polymarket's What price will Bitcoin hit in 2026? event and read its open strikes"
        date="Oct 8, 2026"
        source={
          <>
            <a href={POLYMARKET_URL}>Polymarket ↗</a>
            <span>Retrieved Oct 8, 2026, 23:52 UTC</span>
          </>
        }
      >
        <p>
          Polymarket&apos;s &ldquo;What price will Bitcoin hit in 2026?&rdquo;
          market, with <strong>$74.2 million</strong> traded and $4.3 million in
          liquidity, puts a <strong>59%</strong> chance on Bitcoin touching
          $90,000 before the year ends, <strong>26.5%</strong> on $100,000 and
          7.5% on $120,000, the outlook&apos;s base case.
        </p>
        <p>
          On the way down, it prices <strong>39.5%</strong> for a touch of
          $70,000 and 15.5% for $60,000. Each figure is the odds of a touch on
          Binance BTC/USDT at any minute before 2027, not a forecast of the
          year-end close.
        </p>
        <OddsLadder />
      </Chat>
    ),
  },
  {
    id: "onchain",
    title: "Go on-chain",
    summary:
      "For builders and the curious: look up a transaction, block or address straight from a Bitcoin node.",
    chat: (
      <Chat
        question={
          <>
            What is transaction <code>{PIZZA_TX}</code>?
          </>
        }
        step="GET /api/tx/a1075db5…f5d48d from BRK"
        date="Oct 8, 2026"
        source={<span>BRK · tip at block 970,543 · Oct 8, 2026</span>}
      >
        <p>
          It is widely known as the 2010 pizza transaction. It spent{" "}
          <strong>131 inputs</strong> into a single <strong>10,000 BTC</strong>{" "}
          output and left a 0.99 BTC fee. At the October 7 close of $83,172,
          that output would be worth about <strong>$832 million</strong>.
        </p>
        <dl className="uc-tx">
          {TX_FIELDS.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Chat>
    ),
  },
];

export function UseCases() {
  const [active, setActive] = useState(USE_CASES[0].id);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    USE_CASES.forEach((u) => {
      const el = document.getElementById(u.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);
  return (
    <div className="nx r9-story uc" id="use-cases">
      <div className="nx-wrap">
        <div className="uc-head">
          <Eyebrow>01 / In practice</Eyebrow>
          <h2>
            The next layer of
            <br />
            Secret Satoshis.
          </h2>
          <p className="uc-idea">
            A decade inside Bitcoin markets became original research. Research
            became open data, charts, and models. Now you can{" "}
            <em>ask the whole system a question.</em>
          </p>
          <p className="nx-description">
            One agent, five ways in. From a first question to a raw transaction,
            Agent 21 works from the same published research and data.
          </p>
        </div>
        <div className="uc-body">
          <nav className="uc-index" aria-label="Use cases">
            <p>Use cases</p>
            {USE_CASES.map((u, i) => (
              <a
                key={u.id}
                href={`#${u.id}`}
                aria-current={active === u.id ? "true" : undefined}
              >
                <span>0{i + 1}</span> {u.title}
              </a>
            ))}
          </nav>
          <div>
            {USE_CASES.map((u, i) => (
              <section key={u.id} id={u.id} className="uc-case">
                <p className="uc-n">0{i + 1}</p>
                <h3>{u.title}</h3>
                <p className="uc-summary">{u.summary}</p>
                {u.chat}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
