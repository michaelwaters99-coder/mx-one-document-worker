// MX One external document processing worker — entry point.
//
// Poll loop:
//   1. claim  → grab the next queued external job
//   2. download the PDF via the returned signed URL
//   3. extract → chunk → embed in batches
//   4. push chunks + heartbeats after each batch
//   5. complete (or fail with retry)

import { CONFIG } from "./config.js";
import { api } from "./api.js";
import { extractPages } from "./extract.js";
import { chunkPages } from "./chunk.js";
import { embed } from "./embed.js";
import { enrichDocument } from "./enrich.js";
import { sanitizeChunkForUpload, sanitizeText, safePreview } from "./sanitize.js";

function logOffendingChunks(err, chunks) {
  const message = String(err?.message ?? err ?? "");
  const likelyEncoding = /unicode|escape|invalid|encoding|json|control/i.test(message);
  if (!likelyEncoding) return;

  for (const chunk of chunks) {
    const content = String(chunk?.content ?? "");
    const suspicious =
      /\u0000/i.test(content) ||
      /\x00/i.test(content) ||
      /\u[dD][89aAbB][0-9a-fA-F]{2}/.test(content) ||
      /\u[dD][c-fC-F][0-9a-fA-F]{2}/.test(content) ||
      /\u(?:[0-9a-fA-F]{0,3})(?![0-9a-fA-F])/.test(content) ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(content) ||
      /[\uD800-\uDFFF]/.test(content);
    if (suspicious) {
      logErr(
        `offending chunk ${chunk?.chunk_index ?? "?"}:`,
        safePreview(content, 200),
      );
    }
  }
}

async function uploadChunksIndividually(jobId, chunks) {
  let inserted = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    const safe = sanitizeChunkForUpload(chunk);
    if (!safe.content) {
      skipped += 1;
      logErr(`skipping empty chunk ${chunk?.chunk_index ?? "?"} after sanitization`);
      continue;
    }

    try {
      await api("chunks", { job_id: jobId, chunks: [safe] });
      inserted += 1;
    } catch (err) {
      skipped += 1;
      logErr(
        `quarantining chunk ${safe.chunk_index ?? "?"} after upload failure:`,
        err.message,
        `preview="${safePreview(safe.content, 200)}"`,
      );
    }
  }

  if (inserted === 0 && skipped > 0) {
    throw new Error(`all ${skipped} chunk(s) in batch failed or were empty`);
  }

  return { inserted, skipped };
}

async function postChunksWithRetry(jobId, chunks, maxAttempts = 4) {
  // Defensive re-sanitize immediately before upload.
  const safe = chunks.map(sanitizeChunkForUpload)
    .filter((c) => c.content && c.content.length > 0);
  if (safe.length === 0) return { inserted: 0, skipped: chunks.length };

  let delay = 1000;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await api("chunks", { job_id: jobId, chunks: safe });
      return { inserted: safe.length, skipped: chunks.length - safe.length };
    } catch (err) {
      lastErr = err;
      console.error(new Date().toISOString(), "[worker]",
        `chunks upload attempt ${attempt}/${maxAttempts} failed:`, err.message);
      logOffendingChunks(err, safe);
      if (attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15000);
    }
  }

  logErr("batch upload failed after retries — falling back to one chunk at a time");
  try {
    return await uploadChunksIndividually(jobId, safe);
  } catch (err) {
    err.cause = lastErr;
    throw err;
  }
}

function log(...args) {
  console.log(new Date().toISOString(), "[worker]", ...args);
}

function logErr(...args) {
  console.error(new Date().toISOString(), "[worker]", ...args);
}

// Graceful shutdown state -----------------------------------------------------
let shuttingDown = false;
let activeJobId = null;

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function processJob(job) {
  activeJobId = job.job_id;
  log(`claimed job ${job.job_id} (${job.file_name}, ${job.file_size ?? "?"} bytes)`);

  // Keep the lock alive.
  const heartbeat = setInterval(() => {
    api("heartbeat", { job_id: job.job_id }).catch((e) => logErr("heartbeat error:", e.message));
  }, CONFIG.HEARTBEAT_INTERVAL_MS);

  try {
    // 1. Download
    await api("heartbeat", { job_id: job.job_id, stage: "downloading" });
    const buffer = await downloadToBuffer(job.download_url);
    log(`downloaded ${buffer.length} bytes`);

    // 2. Extract
    await api("heartbeat", { job_id: job.job_id, stage: "extracting" });
    const { pages } = await extractPages({
      buffer,
      fileType: job.file_type,
      mimeType: job.mime_type,
    });
    const totalPages = pages.length;
    log(`extracted ${totalPages} page(s)`);

    // 3. Enrich (ATA / doc kind / aircraft / revision)
    await api("heartbeat", { job_id: job.job_id, stage: "enriching", total_pages: totalPages });
    let enrichment = { per_chunk_hints: [] };
    try {
      enrichment = enrichDocument({ fileName: job.file_name, pages });
      log(`enriched: kind=${enrichment.document_kind} type=${enrichment.aircraft_type ?? "-"} ata=[${(enrichment.ata_chapters ?? []).join(",")}] rev=${enrichment.revision ?? "-"}`);
      const { per_chunk_hints, ...enrichForRpc } = enrichment;
      await api("enrich", { job_id: job.job_id, payload: enrichForRpc });
    } catch (e) {
      logErr("enrichment failed (non-fatal):", e.message);
    }

    // 4. Chunk (with ATA hints per page)
    await api("heartbeat", { job_id: job.job_id, stage: "chunking", total_pages: totalPages });
    const allChunks = chunkPages(pages, enrichment.per_chunk_hints ?? []);
    log(`produced ${allChunks.length} chunk(s)`);

    // Resume support: skip chunks we've already indexed on a previous attempt.
    const alreadyIndexed = Number(job.chunks_indexed ?? 0);
    const remaining = allChunks.slice(alreadyIndexed);
    if (alreadyIndexed > 0) {
      log(`resuming — skipping first ${alreadyIndexed} chunk(s)`);
    }

    // 5. Embed + upload in batches
    let indexed = alreadyIndexed;
    for (let i = 0; i < remaining.length; i += CONFIG.CHUNKS_PER_BATCH) {
      if (shuttingDown) {
        throw new Error("shutdown requested — releasing job for retry");
      }

      const batch = remaining.slice(i, i + CONFIG.CHUNKS_PER_BATCH);
      let payload;
      if (CONFIG.EMBED_PROVIDER === "server") {
        // Send content only. The document-worker Edge Function embeds
        // server-side with the managed LOVABLE_API_KEY so vectors match
        // Copilot's query embedding space exactly.
        payload = batch;
      } else {
        const vectors = await embed(batch.map((c) => c.content));
        payload = batch.map((c, k) => ({ ...c, embedding: vectors[k] }));
      }

      const uploaded = await postChunksWithRetry(job.job_id, payload);
      indexed += uploaded.inserted + uploaded.skipped;

      const lastPage = batch[batch.length - 1]?.page_number ?? null;
      await api("heartbeat", {
        job_id: job.job_id,
        stage: "embedding",
        current_page: lastPage,
        total_pages: totalPages,
        chunks_indexed: indexed,
      });
      log(`  indexed ${indexed}/${allChunks.length}${uploaded.skipped ? ` (${uploaded.skipped} skipped)` : ""}`);
    }

    // 6. Complete
    await api("complete", {
      job_id: job.job_id,
      total_pages: totalPages,
      chunks_indexed: indexed,
      summary: `Extracted ${totalPages} page(s), ${indexed} chunk(s).`,
    });
    log(`✓ completed ${job.job_id}`);
  } catch (err) {
    logErr(`✗ job ${job.job_id} failed:`, err.message);
    try {
      // Longer backoff so a broken job doesn't get re-claimed in a tight loop.
      const msg = String(err.message ?? err);
      const isDataError = /unicode|escape|invalid|encoding|json/i.test(msg);
      await api("fail", {
        job_id: job.job_id,
        error: msg,
        retry: true,
        retry_delay_seconds: isDataError ? 600 : 120,
      });
    } catch (e) {
      logErr("fail RPC error:", e.message);
    }
  } finally {
    clearInterval(heartbeat);
    activeJobId = null;
  }
}

async function main() {
  log(`starting worker ${CONFIG.WORKER_ID}`);
  log(`endpoint ${CONFIG.WORKER_URL}`);
  log(`embed provider: ${CONFIG.EMBED_PROVIDER}`);

  try {
    const r = await api("ping");
    log("ping ok:", r.now ?? "ok");
  } catch (e) {
    logErr("ping failed:", e.message);
    process.exit(1);
  }

  while (!shuttingDown) {
    let claimed = false;
    try {
      const { job } = await api("claim");
      if (job) {
        claimed = true;
        await processJob(job);
      }
    } catch (err) {
      logErr("claim error:", err.message);
    }
    if (!claimed && !shuttingDown) {
      await new Promise((r) => setTimeout(r, CONFIG.POLL_INTERVAL_MS));
    }
  }

  log("shutdown complete");
  process.exit(0);
}

// Graceful shutdown: let the in-flight job's catch handler call `fail` so the
// queue re-claims it. Force-exit if a second signal comes in.
let forcing = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (forcing) {
      logErr(`received ${sig} again — forcing exit`);
      process.exit(1);
    }
    forcing = true;
    shuttingDown = true;
    log(`received ${sig} — finishing${activeJobId ? ` job ${activeJobId}` : ""} and exiting…`);
  });
}

process.on("unhandledRejection", (reason) => {
  logErr("unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  logErr("uncaughtException:", err);
});

main().catch((err) => {
  logErr(err);
  process.exit(1);
});
