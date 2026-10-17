import { SourceError } from "../data/http";
import { splitCsvLine } from "../data/report-library";
import { opt, s, tool } from "./types";

// A file the user attached, read on the server. CSVs come back as their
// columns, a sample and per-column summaries; text files as text. Anything
// else (spreadsheets, PDFs, images) needs the shell.
const TEXT = /\.(txt|md|json)$/i;

export function csvSummary(text: string, sampleRows = 5) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) throw new SourceError("The file is empty.");
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map(splitCsvLine);
  const columns = header.map((name, i) => {
    const cells = rows.map((r) => (r[i] ?? "").trim()).filter(Boolean);
    const numbers = cells
      .map((c) => Number(c.replace(/[$,%\s]/g, "")))
      .filter(Number.isFinite);
    if (cells.length && numbers.length === cells.length) {
      const sum = numbers.reduce((a, b) => a + b, 0);
      return {
        name,
        type: "number",
        filled: cells.length,
        min: Math.min(...numbers),
        max: Math.max(...numbers),
        mean: sum / numbers.length,
        sum,
      };
    }
    const dates = cells.filter((c) => !Number.isNaN(Date.parse(c)));
    if (cells.length && dates.length === cells.length)
      return {
        name,
        type: "date",
        filled: cells.length,
        first: cells[0],
        last: cells[cells.length - 1],
      };
    return {
      name,
      type: "text",
      filled: cells.length,
      distinct: new Set(cells).size,
      examples: [...new Set(cells)].slice(0, 5),
    };
  });
  const record = (r: string[]) =>
    Object.fromEntries(header.map((h, i) => [h, r[i] ?? null]));
  return {
    rows: rows.length,
    columns,
    first_rows: rows.slice(0, sampleRows).map(record),
    last_rows:
      rows.length > sampleRows ? rows.slice(-sampleRows).map(record) : [],
  };
}

export const readUpload = tool<{ name: string | null }>({
  name: "read_upload",
  label: "Reading your file",
  description:
    "Reads a file the user attached. CSV: its columns with types and summaries (min, max, mean, sum), the first and last rows. Text, Markdown or JSON: its text. With name null, lists the attached files. Spreadsheets, PDFs and images need the shell.",
  parameters: s.object({ name: s.nullable(s.str("The attached file's name")) }),
  async run({ name }, { uploads, readUpload: read }) {
    const wanted = opt(name);
    if (!wanted) return { files: uploads };
    const file = await read(wanted);
    if (!file)
      throw new SourceError(
        `No attached file "${wanted}". Attached: ${uploads.join(", ") || "none"}`,
      );
    if (/\.csv$/i.test(file.name))
      return { name: file.name, ...csvSummary(file.bytes.toString("utf8")) };
    if (TEXT.test(file.name)) {
      const text = file.bytes.toString("utf8");
      return {
        name: file.name,
        text: text.slice(0, 12_000),
        ...(text.length > 12_000
          ? { note: `First 12,000 of ${text.length} characters.` }
          : {}),
      };
    }
    throw new SourceError(
      `${file.name} is not a CSV or text file; read it with the shell.`,
    );
  },
});
