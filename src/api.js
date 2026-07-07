// Thin HTTP client for the MX One document-worker Edge Function.
// Every request is a POST with { action, worker_id, ...body } and the
// shared secret in the X-Worker-Key header.

import { CONFIG } from "./config.js";
import { sanitizeChunkForUpload } from "./sanitize.js";

function sanitizeBodyForJson(body) {
  if (!body || !Array.isArray(body.chunks)) return body;
  return {
    ...body,
    chunks: body.chunks.map(sanitizeChunkForUpload).filter((c) => c.content && c.content.length > 0),
  };
}

export async function api(action, body = {}) {
  const safeBody = sanitizeBodyForJson(body);
  const res = await fetch(CONFIG.WORKER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-key": CONFIG.DOCUMENT_WORKER_KEY,
    },
    body: JSON.stringify({ action, worker_id: CONFIG.WORKER_ID, ...safeBody }),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`${action} failed: HTTP ${res.status} (non-JSON response)`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`${action} failed: ${json?.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}
