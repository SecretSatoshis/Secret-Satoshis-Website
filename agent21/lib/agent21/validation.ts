import { PDFDocument } from "pdf-lib";
import { AppError } from "./errors";
export async function validateUpload(bytes: Buffer, type: string) {
  if (type === "application/pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new AppError(400, "This file is not a PDF.");
    try {
      const doc = await PDFDocument.load(bytes, {
        ignoreEncryption: false,
        throwOnInvalidObject: true,
      });
      if (doc.isEncrypted || doc.getPageCount() > 200)
        throw new Error("Unsupported PDF");
    } catch {
      throw new AppError(
        400,
        "Please use an unencrypted, readable PDF of up to 200 pages.",
      );
    }
    return;
  }
  if (type !== "text/csv")
    throw new AppError(400, "Please use a CSV or PDF file.");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AppError(400, "Please save the CSV as UTF-8.");
  }
  if (
    !text.trim() ||
    text.includes("\0") ||
    /<(?:html|script|!doctype)/i.test(text)
  )
    throw new AppError(400, "This file is not a readable CSV.");
  // Validate quoting and consistent row widths without changing user data. As in
  // Python's csv module and pandas, a quote that does not open a field (after a
  // space, say) is an ordinary character, and spaces may follow a closing quote.
  let quoted = false,
    afterQuote = false,
    fieldStart = true,
    blank = true,
    columns = 1,
    width: number | undefined,
    rows = 0;
  const endRow = () => {
    // Blank or whitespace-only lines are not rows, as in common CSV readers.
    if (!blank) {
      if (width === undefined) width = columns;
      else if (columns !== width)
        throw new AppError(400, "CSV rows have different numbers of columns.");
      rows++;
    }
    columns = 1;
    fieldStart = true;
    afterQuote = false;
    blank = true;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else {
          quoted = false;
          afterQuote = true;
        }
      }
      continue;
    }
    if (c === ",") {
      columns++;
      blank = false;
      fieldStart = true;
      afterQuote = false;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (afterQuote) {
      if (c === " " || c === "\t") continue;
      throw new AppError(400, "CSV contains invalid quoted fields.");
    }
    if (c === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      blank = false;
    } else {
      fieldStart = false;
      if (c !== " " && c !== "\t") blank = false;
    }
  }
  if (quoted) throw new AppError(400, "CSV contains an unclosed quoted field.");
  if (!/[\r\n]$/.test(text)) endRow();
  if (rows < 1) throw new AppError(400, "CSV is empty.");
}
