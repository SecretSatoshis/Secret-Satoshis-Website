"use client";

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentAvatar, STATE_LABEL, type AgentState } from "../agent-avatar";
import { SectionLabel } from "./parts";
import {
  costBasisAnswer,
  halvingAnswer,
  outlookAnswer,
  pizzaAnswer,
  priceOddsAnswer,
  retrievedLabel,
  shortDate,
} from "./example-answers";
import type { ExampleFacts } from "./example-facts";
import type {
  ChainHeight,
  Close,
  PriceOdds,
  RealizedLevels,
} from "./live-examples";

// The landing page's example use cases, each shown as a chat. "Analyze the
// market" and "Review the outlook" follow the Report Library's daily facts
// (example-facts.ts); the halving, Polymarket and transaction examples use the
// live block height and Polymarket ladder (live-examples.ts). The examples
// that quote Bitcoin's price use the price now from BRK, or the release's
// latest close when BRK's price is unavailable.

const PIZZA_TX =
  "a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d";
const CHART_URL =
  "https://charts.secretsatoshis.com/Bitcoin_Realized_Price.html";

// Words appear one after another, WORD_MS apart; a chart, table or card
// counts as BLOCK_WORDS words and appears whole once the text before it is in.
const WORD_MS = 28;
const BLOCK_WORDS = 10;
const THINK_MS = 1100;
const INLINE = new Set(["p", "strong", "em", "code", "a", "span"]);

// Splits an answer's text into word spans numbered in reading order (--i),
// so CSS can reveal them in sequence without the layout moving.
function streamable(
  node: React.ReactNode,
  count: { n: number },
): React.ReactNode {
  return Children.map(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return String(child)
        .split(/(\s+)/)
        .map((part, k) =>
          !part || /^\s+$/.test(part) ? (
            part
          ) : (
            <span
              key={k}
              className="uc-w"
              style={{ "--i": count.n++ } as React.CSSProperties}
            >
              {part}
            </span>
          ),
        );
    }
    if (!isValidElement<{ children?: React.ReactNode }>(child)) return child;
    if (child.type === Fragment) return streamable(child.props.children, count);
    if (typeof child.type === "string" && INLINE.has(child.type)) {
      return cloneElement(
        child,
        undefined,
        streamable(child.props.children, count),
      );
    }
    const i = count.n;
    count.n += BLOCK_WORDS;
    return (
      <div className="uc-block" style={{ "--i": i } as React.CSSProperties}>
        {child}
      </div>
    );
  });
}

function Chat({
  question,
  step,
  source,
  date,
  children,
}: {
  question: React.ReactNode;
  step: string;
  source: React.ReactNode;
  /** The date of the data the answer uses. */
  date: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const finish = useRef(() => {});
  const [state, setState] = useState<AgentState>("idle");
  const [answer, words] = useMemo(() => {
    const count = { n: 0 };
    return [streamable(children, count), count.n] as const;
  }, [children]);
  // The first time its use case scrolls into view (the top four-fifths of
  // the screen), the agent thinks, writes its answer word by word, then
  // shows the source.
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
        timers.push(setTimeout(() => setState("answering"), THINK_MS));
        timers.push(
          setTimeout(() => setState("done"), THINK_MS + words * WORD_MS + 400),
        );
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    io.observe(el.closest(".uc-case") ?? el);
    const stop = () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
    finish.current = () => {
      stop();
      setState("done");
    };
    return stop;
  }, [words]);
  // Tabbing into a chart or link before the chat has played shows it whole,
  // so focus never lands on something hidden.
  return (
    <div
      className="uc-chat"
      ref={ref}
      data-phase={state}
      style={{ "--word-ms": `${WORD_MS}ms` } as React.CSSProperties}
      onFocus={() => {
        if (state !== "done") finish.current();
      }}
    >
      <div className="uc-chat-bar">
        <span>Agent 21 · Example</span>
        <span>{date}</span>
      </div>
      <p className="uc-user">{question}</p>
      <div className="uc-msg">
        <AgentAvatar state={state} size={40} />
        <div className="uc-msg-body">
          <div className="uc-name">
            Agent 21 <span className="uc-chip">{STATE_LABEL[state]}</span>
          </div>
          <p className="uc-step">{step}</p>
          <div className="uc-answer" aria-busy={state !== "done"}>
            {answer}
          </div>
          <p className="uc-source">
            <span aria-hidden="true">↳</span> {source}
          </p>
        </div>
      </div>
    </div>
  );
}

type UseCase = {
  id: string;
  title: string;
  summary: string;
  chat: React.ReactNode;
};

/** Live data: the block height, the Polymarket ladder, the price now and the
 * realized prices now (null when the release's stand). */
export type LiveExamples = {
  chain: ChainHeight;
  odds: PriceOdds;
  price: Close;
  levels: RealizedLevels | null;
};

/** The source's mention of the price when it is live. */
const priceSource = (price: Close) =>
  price.at && <span>BRK price · {retrievedLabel(price.at)}</span>;

const buildUseCases = (
  facts: ExampleFacts,
  { chain, odds, price, levels }: LiveExamples,
): UseCase[] => [
  {
    id: "fundamentals",
    title: "Learn the fundamentals",
    summary:
      "Start with a simple question. Agent 21 answers in plain language and helps you understand Bitcoin from first principles.",
    chat: (
      <Chat
        question="What does the halving actually change?"
        step="Checked Bitcoin’s current block height."
        date={shortDate(chain.retrievedAt.slice(0, 10))}
        source={
          <span>
            BRK · block {chain.height.toLocaleString("en-US")} ·{" "}
            {retrievedLabel(chain.retrievedAt)}
          </span>
        }
      >
        {halvingAnswer(chain)}
      </Chat>
    ),
  },
  {
    id: "outlook",
    title: "Review the Secret Satoshis price outlook",
    summary:
      "Ask about our Bitcoin price outlook and newsletter updates, and see how our view of the market is holding up against the latest data.",
    chat: (
      <Chat
        question="How does Bitcoin’s current price compare with our year-end scenarios?"
        step="Compared the published outlook with recent price data."
        date={shortDate(price.date)}
        source={
          <>
            <span>
              Secret Satoshis {facts.outlook.year} outlook · Report Library
              release, {shortDate(facts.report_date)}
            </span>
            {priceSource(price)}
          </>
        }
      >
        {outlookAnswer(facts, price)}
      </Chat>
    ),
  },
  {
    id: "market",
    title: "Analyze the market",
    summary:
      "Explore market and on-chain data through charts, with explanations of the readings that matter to your question.",
    chat: (
      <Chat
        question="Chart Bitcoin’s price against realized price over the past five years and explain where it stands today."
        step="Compared Bitcoin’s price and realized price over five years."
        date={shortDate(price.date)}
        source={
          price.at && levels ? (
            <>
              <a href={CHART_URL}>Chart Library ↗</a>
              <span>
                BRK price and realized prices · {retrievedLabel(levels.at)}
              </span>
            </>
          ) : (
            <>
              <a href={CHART_URL}>Chart Library ↗</a>
              <span>Data through {shortDate(facts.report_date)}</span>
              {priceSource(price)}
            </>
          )
        }
      >
        {costBasisAnswer(facts, price, levels)}
      </Chat>
    ),
  },
  {
    id: "price",
    title: "See the market's odds",
    summary:
      "See Polymarket's odds of Bitcoin touching each price this year, with the volume and liquidity behind them.",
    chat: (
      <Chat
        question="What odds does Polymarket give Bitcoin of reaching different prices this year, and how much trading supports those odds?"
        step="Checked Polymarket’s price odds, volume, and liquidity."
        date={shortDate(odds.retrievedAt.slice(0, 10))}
        source={
          <>
            <a href={`https://polymarket.com/event/${odds.slug}`}>
              Polymarket ↗
            </a>
            <span>Retrieved {retrievedLabel(odds.retrievedAt)}</span>
          </>
        }
      >
        {priceOddsAnswer(odds, facts)}
      </Chat>
    ),
  },
  {
    id: "blockchain",
    title: "Explore the blockchain",
    summary:
      "Look up Bitcoin transactions, blocks, and addresses, and understand their details using data read directly from the blockchain.",
    chat: (
      <Chat
        question={
          <>
            Look up this Bitcoin transaction and explain its inputs, outputs,
            fee, and confirmation status. TXID: <code>{PIZZA_TX}</code>
          </>
        }
        step="Retrieved the transaction details."
        date={shortDate(chain.retrievedAt.slice(0, 10))}
        source={
          <span>
            BRK · block {chain.height.toLocaleString("en-US")} ·{" "}
            {retrievedLabel(chain.retrievedAt)}
          </span>
        }
      >
        {pizzaAnswer(facts, chain, price)}
      </Chat>
    ),
  },
];

export function UseCases({
  facts,
  live,
}: {
  facts: ExampleFacts;
  live: LiveExamples;
}) {
  const useCases = useMemo(() => buildUseCases(facts, live), [facts, live]);
  const [active, setActive] = useState(useCases[0].id);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    useCases.forEach((u) => {
      const el = document.getElementById(u.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [useCases]);
  return (
    <div className="uc section-divider" id="use-cases">
      <div className="nx-wrap">
        <div className="uc-head">
          <SectionLabel>How to use Agent 21</SectionLabel>
          <h2>From Bitcoin fundamentals to market analysis.</h2>
          <p className="uc-sub">
            Ask about a Bitcoin concept, examine our outlook, or investigate a
            market move.
          </p>
        </div>
        <div className="uc-body">
          <nav className="uc-index" aria-label="Use cases">
            <p>Example use cases</p>
            {useCases.map((u, i) => (
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
            {useCases.map((u, i) => (
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
