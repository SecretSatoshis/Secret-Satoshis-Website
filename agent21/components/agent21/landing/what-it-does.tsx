import { Eyebrow } from "./parts";

// Concept 9: the sources Agent 21 reads, in concept 1's card grid.
const SOURCES: [string, string][] = [
  [
    "Secret Satoshis research",
    "The weekly recap, quarterly strategy reports and the annual price outlook. Agent 21 links the piece it draws on.",
  ],
  [
    "Daily data release",
    "Market, on-chain, ETF and valuation series from the Report Library, published for every completed UTC day.",
  ],
  [
    "Chart Library",
    "The published interactive charts, trimmed to your window, plus new charts built for your question.",
  ],
  [
    "On-chain data",
    "Blocks, transactions, addresses, fees and on-chain series straight from BRK's Bitcoin node.",
  ],
  [
    "Prediction markets",
    "Polymarket odds for Bitcoin and the macro, with the volume and liquidity behind each price.",
  ],
  [
    "Latest news",
    "Web search for dated news on what changed this week, cited with its source.",
  ],
];

export function WhatItDoes() {
  return (
    <div className="nx r9-story wd" id="what-it-does">
      <div className="nx-wrap">
        <Eyebrow>02 / What it does</Eyebrow>
        <h2>
          Every source.
          <br />
          One conversation.
        </h2>
        <p className="nx-description">
          Agent 21 brings Secret Satoshis research and data together with the
          live Bitcoin network, prediction markets and the latest news, so one
          question gets a current, sourced answer.
        </p>
        <div className="wd-grid">
          {SOURCES.map(([title, text]) => (
            <div className="lp-card" key={title}>
              <h3>
                <span className="acc">{"// "}</span>
                {title}
              </h3>
              <p>{text}</p>
            </div>
          ))}
          <div className="lp-card wd-agent">
            <h3>
              <span className="acc">{"// "}</span>
              Agent 21
            </h3>
            <p>
              Reads all six, runs the numbers in its own sandbox and answers
              with every source and date in view. Real-time Bitcoin intelligence
              you can verify.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
