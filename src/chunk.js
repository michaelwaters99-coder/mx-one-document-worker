import { CONFIG } from "./config.js";
import { sanitizeText } from "./sanitize.js";

// Sliding-window chunker over each page's text.
// `perPageHints` is a map/array of { page_number, ata_chapter, ata_section, heading_path }
// produced by enrichDocument(). When provided, those fields are attached to each chunk.
//
// Every emitted chunk has the shape:
// {
//   chunk_index,
//   page_number,   // legacy single-page field (kept for backward compatibility)
//   page_start,    // first page this chunk covers
//   page_end,      // last page this chunk covers
//   page_numbers,  // int[] of all pages this chunk covers
//   excerpt,       // short preview (<= 300 chars) used by Copilot source cards
//   content,       // full sanitized chunk text
//   ata_chapter,
//   ata_section,
//   heading_path
// }

export function chunkPages(pages, perPageHints) {
  const size = CONFIG.CHUNK_SIZE;
  const overlap = CONFIG.CHUNK_OVERLAP;

  const chunks = [];
  let idx = 0;

  const hintByPage = new Map();

  for (const h of perPageHints ?? []) {
    if (h?.page_number != null) {
      hintByPage.set(h.page_number, h);
    }
  }

  for (const page of pages) {
    const text = sanitizeText(page.text || "")
      .replace(/\s+\n/g, "\n")
      .trim();

    if (!text) continue;

    const hint = hintByPage.get(page.page_number) ?? {};

    const push = (content) => {
      const pageNum = page.page_number ?? null;

      chunks.push({
        chunk_index: idx++,

        // Legacy field
        page_number: pageNum,

        // New page metadata
        page_start: pageNum,
        page_end: pageNum,
        page_numbers: pageNum != null ? [pageNum] : null,

        // Preview used by Copilot
        excerpt: content.slice(0, 300),

        // Full chunk
        content,

        // Metadata
        ata_chapter: hint.ata_chapter ?? null,
        ata_section: hint.ata_section ?? null,
        heading_path: hint.heading_path ?? null,
      });
    };

    if (text.length <= size) {
      push(text);
      continue;
    }

    let start = 0;

    while (start < text.length) {
      const end = Math.min(text.length, start + size);
      const slice = text.slice(start, end).trim();

      if (slice) {
        push(slice);
      }

      if (end >= text.length) {
        break;
      }

      start = end - overlap;
    }
  }

  return chunks;
}
