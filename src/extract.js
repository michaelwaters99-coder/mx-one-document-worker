// Text extraction from a downloaded document.
//
// v2: PDF text extraction with pdf-parse using a per-page `pagerender`
// callback so we get the real physical page number for every chunk.
//
// The previous version relied on splitting the concatenated output on
// form-feed characters (`\f`), but pdf-parse's default renderer does not
// insert form feeds between pages — the result was that many logical
// pages collapsed into a single bucket and every chunk from that bucket
// inherited the wrong `page_number`. That in turn made Copilot's
// "Open Original" jump to the wrong page.
//
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
  // Collect text per physical page. `pagerender` is invoked once per page
  // in document order with a pdf.js PDFPageProxy. We read `pageData.pageNumber`
  // (1-based) as the authoritative physical page number for the extracted text.
  const pagesByNumber = new Map();

  const pagerender = async (pageData) => {
    // pdf.js PDFPageProxy exposes 1-based pageNumber. Fall back to _pageIndex+1
    // for older versions just in case.
    const pageNumber =
      typeof pageData.pageNumber === "number"
        ? pageData.pageNumber
        : typeof pageData._pageIndex === "number"
          ? pageData._pageIndex + 1
          : pagesByNumber.size + 1;

    let text = "";

    try {
      const content = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });

      let lastY = null;

      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : null;

        if (lastY != null && y != null && y !== lastY) {
          text += "\n";
        }

        text += item.str ?? "";
        lastY = y;
      }
    } catch {
      text = "";
    }

    pagesByNumber.set(
      pageNumber,
      (pagesByNumber.get(pageNumber) ?? "") + text
    );

    // Return page text to preserve pdf-parse's expected API contract.
    return text;
  };

  const parsed = await pdfParse(buffer, { pagerender });
  const total = parsed.numpages || pagesByNumber.size || 1;

  const pages = [];

  for (let n = 1; n <= total; n++) {
    pages.push({
      page_number: n,
      text: (pagesByNumber.get(n) ?? "").trim(),
    });
  }

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
