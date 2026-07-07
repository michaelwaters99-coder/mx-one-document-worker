// Text extraction from a downloaded document.
// Returns: { pages: [{ page_number, text }] }

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

  return extractPlainText(buffer);
}

async function extractPdf(buffer) {
  const parsed = await pdfParse(buffer);
  const raw = parsed.text || "";
  const total = parsed.numpages || 1;

  let pageTexts = raw
    .split(/\f|Page\s+\d+\s+of\s+\d+|-\s*\d+\s*-/gi)
    .map((t) => t.trim())
    .filter(Boolean);

  if (pageTexts.length < 2 && total > 1) {
    const approxCharsPerPage = Math.max(2500, Math.ceil(raw.length / total));
    pageTexts = [];

    for (let i = 0; i < total; i++) {
      const start = i * approxCharsPerPage;
      const end = (i + 1) * approxCharsPerPage;

      pageTexts.push(raw.slice(start, end).trim());
    }
  }

  if (pageTexts.length === 0) {
    pageTexts = [raw.trim()];
  }

  const pages = pageTexts.map((text, index) => ({
    page_number: index + 1,
    text,
  }));

  return { pages };
}

function extractPlainText(buffer) {
  const text = buffer.toString("utf8");

  return {
    pages: [
      {
        page_number: 1,
        text,
      },
    ],
  };
}
