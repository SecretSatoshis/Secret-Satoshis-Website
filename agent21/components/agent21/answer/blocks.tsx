"use client";
import { useContext, useMemo } from "react";
import { useAuiState } from "@assistant-ui/react";
import {
  direction,
  formatDate,
  formatOdds,
  formatValue,
  formatWhen,
  parseBlock,
  type BlockType,
  type Blocks,
  type Format,
} from "../../../lib/agent21/blocks";
import { ChartCard } from "./chart-card";
import { ConversationFiles } from "./context";

// The answer blocks of Agent 21's response design, drawn the same way in the
// chat and in the landing page's examples. Every value is drawn as text.

export function StepLine({ data }: { data: Blocks["step"] }) {
  return <p className="ans-step">{data.text}</p>;
}

const KIND = {
  calculated: "Calculated",
  outlook: "Outlook",
  market: "Market-implied",
};

export function Figures({ data }: { data: Blocks["figures"] }) {
  return (
    <div className="ans-figures">
      {data.items.map((item) => (
        <div className="ans-figure" key={item.label}>
          <span className="ans-figure-label">
            {item.label}
            {item.kind && item.kind !== "observed" && (
              <em className="ans-tag">{KIND[item.kind]}</em>
            )}
          </span>
          <strong>{formatValue(item.value, item.format ?? "number")}</strong>
          {item.change !== undefined && (
            <span className={`ans-change ans-${direction(item.change)}`}>
              {formatValue(item.change, "change")}
              {item.changeLabel && <span> {item.changeLabel}</span>}
            </span>
          )}
          {item.asOf && (
            <span className="ans-asof">{formatWhen(item.asOf)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function FactSheet({ data }: { data: Blocks["facts"] }) {
  return (
    <figure className="ans-card">
      {data.title && (
        <figcaption className="ans-card-t">{data.title}</figcaption>
      )}
      <dl className="ans-facts">
        {data.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.mono ? "ans-mono" : undefined}>
              {row.href ? (
                <a href={row.href} target="_blank" rel="noopener noreferrer">
                  {row.value} ↗
                </a>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

const numeric = (format?: Format) =>
  format !== undefined && format !== "text" && format !== "date";

export function TableCard({ data }: { data: Blocks["table"] }) {
  return (
    <figure className="ans-card">
      <div className="ans-scroll">
        <table className="ans-table">
          <caption>{data.caption}</caption>
          <thead>
            <tr>
              {data.columns.map((column, i) => (
                <th
                  key={i}
                  className={numeric(column.format) ? "ans-num" : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => {
                  const format = data.columns[i].format;
                  const change =
                    (format === "change" || format === "pp") &&
                    typeof cell === "number";
                  return (
                    <td
                      key={i}
                      className={
                        [
                          numeric(format) || typeof cell === "number"
                            ? "ans-num"
                            : "",
                          change ? `ans-${direction(cell)}` : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    >
                      {formatValue(cell, format)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.note && <p className="ans-note">{data.note}</p>}
    </figure>
  );
}

export function Ladder({ data }: { data: Blocks["ladder"] }) {
  const odds = data.measure === "odds";
  const levels = [...data.levels].sort((a, b) => b.value - a.value);
  const above = levels.filter((level) => level.value >= data.now.value);
  const below = levels.filter((level) => level.value < data.now.value);
  const row = (level: (typeof levels)[number], side: "up" | "down") => (
    <div className={`ans-level ans-${side}`} key={level.value}>
      <span className="ans-level-v">
        {side === "up" ? "↑" : "↓"} {formatValue(level.value, "usd_compact")}
      </span>
      {odds ? (
        <span className="ans-track" aria-hidden="true">
          <i style={{ width: `${Math.max(level.odds ?? 0, 0.5)}%` }} />
        </span>
      ) : (
        <span className="ans-level-l">{level.label}</span>
      )}
      <b>
        {odds
          ? formatOdds(level.odds ?? 0)
          : formatValue(level.value / data.now.value - 1, "change")}
      </b>
    </div>
  );
  return (
    <figure className="ans-card">
      <figcaption className="ans-card-t">
        <span>{data.title}</span>
        {data.market && (
          <span>
            <a href={data.market.url} target="_blank" rel="noopener noreferrer">
              Polymarket ↗
            </a>{" "}
            · volume {formatValue(data.market.volume, "usd_compact")} ·
            liquidity {formatValue(data.market.liquidity, "usd_compact")} ·{" "}
            <span className="ans-nowrap">market-implied</span>
          </span>
        )}
      </figcaption>
      <div className={odds ? "ans-ladder ans-odds" : "ans-ladder"}>
        {above.map((level) => row(level, "up"))}
        <p className="ans-now">
          {data.now.label} · {formatValue(data.now.value, "usd")}
        </p>
        {below.map((level) => row(level, "down"))}
      </div>
    </figure>
  );
}

export function SourcesLine({ data }: { data: Blocks["sources"] }) {
  return (
    <p className="ans-sources">
      <span aria-hidden="true">↳</span>
      {data.items.map((item, i) => (
        <span key={i}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.name} ↗
            </a>
          ) : (
            <b>{item.name}</b>
          )}
          {item.detail && ` · ${item.detail}`}
          {item.asOf && ` · ${formatWhen(item.asOf)}`}
          {item.published && ` · published ${formatDate(item.published)}`}
        </span>
      ))}
    </p>
  );
}

const PLACEHOLDER: Record<BlockType, string> = {
  step: "ans-ph-line",
  sources: "ans-ph-line",
  figures: "ans-ph-short",
  facts: "ans-ph-card",
  table: "ans-ph-card",
  ladder: "ans-ph-card",
  chart: "ans-ph-chart",
};

export function BlockPlaceholder({ type }: { type: BlockType | null }) {
  return (
    <div
      className={`ans-ph ${PLACEHOLDER[type ?? "facts"]}`}
      aria-hidden="true"
    />
  );
}

export function BlockFallback() {
  return (
    <p className="ans-fallback">This part of the answer could not be shown.</p>
  );
}

function ChartBlock({ data }: { data: Blocks["chart"] }) {
  const files = useContext(ConversationFiles);
  const running = useAuiState((s) => s.message.status?.type === "running");
  // A name can repeat across turns; the latest chart with it wins.
  const file = files.findLast(
    (f) => f.kind === "artifact" && f.name === data.file,
  );
  if (!file)
    return running ? <BlockPlaceholder type="chart" /> : <BlockFallback />;
  return <ChartCard file={file} page={data.page} caption={data.caption} />;
}

/** One fenced `a21-*` block from an answer's Markdown. */
export function AnswerBlock({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const running = useAuiState((s) => s.message.status?.type === "running");
  const block = useMemo(() => parseBlock(language, code), [language, code]);
  if (!block.ok)
    return running ? <BlockPlaceholder type={block.type} /> : <BlockFallback />;
  switch (block.type) {
    case "step":
      return <StepLine data={block.data} />;
    case "figures":
      return <Figures data={block.data} />;
    case "facts":
      return <FactSheet data={block.data} />;
    case "table":
      return <TableCard data={block.data} />;
    case "ladder":
      return <Ladder data={block.data} />;
    case "chart":
      return <ChartBlock data={block.data} />;
    case "sources":
      return <SourcesLine data={block.data} />;
  }
}
