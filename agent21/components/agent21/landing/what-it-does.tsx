import { SectionLabel } from "./parts";

// What Agent 21 works from: the Secret Satoshis layer other agents lack, and
// the live sources it checks that against.
type Card = { title: string; text: string };

const CARDS: Card[] = [
  {
    title: "Secret Satoshis newsletter",
    text: "Our yearly outlook, weekly recaps, quarterly reviews, and year-end assessments.",
  },
  {
    title: "Secret Satoshis data sets",
    text: "More than 300 Bitcoin metrics, updated daily, with historical coverage extending back to 2010.",
  },
  {
    title: "Market and on-chain data",
    text: "Price and on-chain indicators, plus blocks, transactions, addresses, fees, and mempool activity.",
  },
  {
    title: "Prediction markets",
    text: "Polymarket odds, trading volume, and liquidity for Bitcoin prices and related events.",
  },
  {
    title: "Latest news",
    text: "Current reporting from primary and reputable sources, with links and dates.",
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
            Agent 21 draws on Secret Satoshis research, open-source data sets,
            blockchain records, prediction markets, and current news.
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
