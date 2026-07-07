// Text extraction from a downloaded document.
//
// v1: PDF text extraction with pdf-parse, plus a plain-text fallback.
// Structured so you can plug in LlamaParse / Unstructured / Google
// Document AI later — just add a new branch and return the same shape:
//   { pages: [{ page_number, text }] }

import pdfParse from "pdf-parse";

export async function extractPages({ buffer, fileType, mimeType }) {
  const type = (fileType || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (type === "pdf" || mime.includes("pdf")) {
    return extractPdf(buffer);
  }
  if (mime.startsWith("text/") || ["txt", "md", "csv"].includes(type)) {
    return extractPlainText(buffer);
  }
  // Fallback: try text, otherwise return one empty page so the job can complete.
  return extractPlainText(buffer);
}

async function extractPdf(buffer) {
  // pdf-parse gives us the full text and page count, but not per-page text.
  // We split on form-feed characters which pdf-parse inserts between pages;
  // if that fails we fall back to a single-page document.
  const parsed = await pdfParse(buffer);
  const raw = parsed.text ?? "";
  const total = parsed.numpages || 1;

  let pageTexts = raw.split("\f");
  if (pageTexts.length < 2) {
    pageTexts = [raw];
  }

  const pages = [];
  for (let i = 0; i < Math.max(pageTexts.length, total); i++) {
    pages.push({
      page_number: i + 1,
      text: (pageTexts[i] ?? "").trim(),
    });
  }
  return { pages };
}

function extractPlainText(buffer) {
  const text = buffer.toString("utf8");
  return { pages: [{ page_number: 1, text }] };
}
