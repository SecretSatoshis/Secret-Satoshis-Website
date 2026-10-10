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
import type { ChainHeight, PriceOdds } from "./live-examples";

// The landing page's example use cases, each shown as a chat. "Analyze the
// market" and "Review the outlook" follow the Report Library's daily facts
// (example-facts.ts); the halving, Polymarket and transaction examples use the
// live block height and Polymarket ladder (live-examples.ts).

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

/** Live data for the halving, Polymarket and transaction examples. */
export type LiveExamples = { chain: ChainHeight; odds: PriceOdds };

const buildUseCases = (
  facts: ExampleFacts,
  { chain, odds }: LiveExamples,
): UseCase[] => [
  {
    id: "fundamentals",
    title: "Learn the fundamentals",
    summary:
      "Start with a simple question. Agent 21 answers in plain language and helps you understand Bitcoin from first principles.",
    chat: (
      <Chat
        question="What does the halving actually change?"
        step="Read the current block height from BRK"
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
    id: "market",
    title: "Analyze the market",
    summary:
      "Ask for market and on-chain analysis and get the data charted, with the readings that matter called out.",
    chat: (
      <Chat
        question="Where is Bitcoin trading against its on-chain cost basis? Show me the last five years."
        step="Read the published Bitcoin Realized Price chart, trimmed to five years of completed UTC days"
        date={shortDate(facts.report_date)}
        source={
          <>
            <a href={CHART_URL}>Chart Library ↗</a>
            <span>Data through {shortDate(facts.report_date)}</span>
          </>
        }
      >
        {costBasisAnswer(facts)}
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
        question={`How is the Secret Satoshis ${facts.outlook.year} outlook holding up?`}
        step={`Read the ${facts.outlook.year} price outlook and the last 52 weekly candles from the daily release`}
        date={shortDate(facts.report_date)}
        source={
          <span>
            Secret Satoshis {facts.outlook.year} outlook · Report Library
            release, {shortDate(facts.report_date)}
          </span>
        }
      >
        {outlookAnswer(facts)}
      </Chat>
    ),
  },
  {
    id: "price",
    title: "Ask where price is heading",
    summary:
      "Get the market's own odds for where Bitcoin trades next, with the volume and liquidity behind each price.",
    chat: (
      <Chat
        question="What price is Bitcoin likely to hit this year?"
        step={`Read the open strikes on Polymarket's “${odds.title}” market`}
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
      "Look up any transaction, block or address straight from a Bitcoin node, for builders and the curious alike.",
    chat: (
      <Chat
        question={
          <>
            What is transaction <code>{PIZZA_TX}</code>?
          </>
        }
        step="GET /api/tx/a1075db5…f5d48d from BRK"
        date={shortDate(chain.retrievedAt.slice(0, 10))}
        source={
          <span>
            BRK · block {chain.height.toLocaleString("en-US")} ·{" "}
            {retrievedLabel(chain.retrievedAt)}
          </span>
        }
      >
        {pizzaAnswer(facts, chain)}
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
          <h2>
            A decade of Bitcoin research, <br />
            working for you.
          </h2>
          <p className="uc-sub">
            From your first question about Bitcoin to this week&apos;s market
            move, Agent 21 applies the frameworks and outlook we use at Secret
            Satoshis, so you understand what&apos;s happening and why it
            matters.
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
