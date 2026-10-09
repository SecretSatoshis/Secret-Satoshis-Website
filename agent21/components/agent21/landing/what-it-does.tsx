import { SectionLabel } from "./parts";

// What Agent 21 works from: the Secret Satoshis layer other agents lack, and
// the live sources it checks that against.
type Card = { title: string; text: string };

const CARDS: Card[] = [
  {
    title: "Secret Satoshis newsletter",
    text: "Secret Satoshis newsletter content: our weekly, quarterly and annual view of the Bitcoin market. Agent 21 can talk you through any issue.",
  },
  {
    title: "Secret Satoshis data sets",
    text: "Our open-source daily data release: 300+ Bitcoin metrics back to 2010, the same numbers behind our charts, dashboard and newsletter.",
  },
  {
    title: "On-chain data",
    text: "Blocks, transactions, addresses, fees and the mempool, plus thousands of market and on-chain series, straight from the blockchain.",
  },
  {
    title: "Prediction markets",
    text: "Polymarket odds on Bitcoin's price and the events that move it, with the volume and liquidity behind each.",
  },
  {
    title: "Latest news",
    text: "Web search for what changed today, from primary and reputable sources, each one linked and dated.",
  },
];

export function WhatItDoes() {
  return (
    <div className="wd section-divider" id="what-it-does">
      <div className="nx-wrap">
        <div className="wd-head">
          <SectionLabel>What Agent 21 knows</SectionLabel>
          <h2>Bitcoin intelligence</h2>
          <p className="wd-sub">
            Secret Satoshis market frameworks. Open-source code. Live market
            data.
          </p>
        </div>
        <div className="wd-grid">
          {CARDS.map(({ title, text }) => (
            <div className="lp-card" key={title}>
              <h3>
                <span className="acc">{"// "}</span>
                {title}
              </h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
