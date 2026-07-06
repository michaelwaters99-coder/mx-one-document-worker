import { CONFIG } from "./config.js";

// Simple sliding-window chunker over each page's text.
// Yields { chunk_index, page_number, content } items in order.
export function chunkPages(pages) {
  const size = CONFIG.CHUNK_SIZE;
  const overlap = CONFIG.CHUNK_OVERLAP;
  const chunks = [];
  let idx = 0;

  for (const page of pages) {
    const text = (page.text || "").replace(/\s+\n/g, "\n").trim();
    if (!text) continue;

    if (text.length <= size) {
      chunks.push({ chunk_index: idx++, page_number: page.page_number, content: text });
      continue;
    }

    let start = 0;
    while (start < text.length) {
      const end = Math.min(text.length, start + size);
      const slice = text.slice(start, end).trim();
      if (slice) {
        chunks.push({ chunk_index: idx++, page_number: page.page_number, content: slice });
      }
      if (end >= text.length) break;
      start = end - overlap;
    }
  }

  return chunks;
}
