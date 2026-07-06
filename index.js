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

function log(...args) {
  console.log(new Date().toISOString(), "[worker]", ...args);
}

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function processJob(job) {
  log(`claimed job ${job.job_id} (${job.file_name}, ${job.file_size ?? "?"} bytes)`);

  // Keep the lock alive.
  const heartbeat = setInterval(() => {
    api("heartbeat", { job_id: job.job_id }).catch((e) => log("heartbeat error:", e.message));
  }, CONFIG.HEARTBEAT_INTERVAL_MS);

  try {
    // 1. Download
    await api("heartbeat", { job_id: job.job_id, stage: "downloading" });
    const buffer = await downloadToBuffer(job.download_url);

    // 2. Extract
    await api("heartbeat", { job_id: job.job_id, stage: "extracting" });
    const { pages } = await extractPages({
      buffer,
      fileType: job.file_type,
      mimeType: job.mime_type,
    });
    const totalPages = pages.length;
    log(`extracted ${totalPages} page(s)`);

    // 3. Chunk
    await api("heartbeat", {
      job_id: job.job_id,
      stage: "chunking",
      total_pages: totalPages,
    });
    const allChunks = chunkPages(pages);
    log(`produced ${allChunks.length} chunk(s)`);

    // Resume support: skip chunks we've already indexed on a previous attempt.
    const alreadyIndexed = Number(job.chunks_indexed ?? 0);
    const remaining = allChunks.slice(alreadyIndexed);

    // 4. Embed + upload in batches
    let indexed = alreadyIndexed;
    for (let i = 0; i < remaining.length; i += CONFIG.CHUNKS_PER_BATCH) {
      const batch = remaining.slice(i, i + CONFIG.CHUNKS_PER_BATCH);
      const vectors = await embed(batch.map((c) => c.content));
      const payload = batch.map((c, k) => ({ ...c, embedding: vectors[k] }));

      await api("chunks", { job_id: job.job_id, chunks: payload });
      indexed += batch.length;

      const lastPage = batch[batch.length - 1]?.page_number ?? null;
      await api("heartbeat", {
        job_id: job.job_id,
        stage: "embedding",
        current_page: lastPage,
        total_pages: totalPages,
        chunks_indexed: indexed,
      });
      log(`  indexed ${indexed}/${allChunks.length}`);
    }

    // 5. Complete
    await api("complete", {
      job_id: job.job_id,
      total_pages: totalPages,
      chunks_indexed: indexed,
      summary: `Extracted ${totalPages} page(s), ${indexed} chunk(s).`,
    });
    log(`✓ completed ${job.job_id}`);
  } catch (err) {
    log(`✗ job ${job.job_id} failed:`, err.message);
    try {
      await api("fail", {
        job_id: job.job_id,
        error: err.message ?? String(err),
        retry: true,
        retry_delay_seconds: 60,
      });
    } catch (e) {
      log("fail RPC error:", e.message);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  log(`starting worker ${CONFIG.WORKER_ID}`);
  log(`endpoint ${CONFIG.WORKER_URL}`);

  await api("ping").then((r) => log("ping ok:", r.now)).catch((e) => {
    log("ping failed:", e.message);
    process.exit(1);
  });

  while (true) {
    let claimed = false;
    try {
      const { job } = await api("claim");
      if (job) {
        claimed = true;
        await processJob(job);
      }
    } catch (err) {
      log("claim error:", err.message);
    }
    if (!claimed) {
      await new Promise((r) => setTimeout(r, CONFIG.POLL_INTERVAL_MS));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
