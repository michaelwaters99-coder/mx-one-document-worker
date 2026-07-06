// Thin HTTP client for the MX One document-worker Edge Function.
// Every request is a POST with { action, worker_id, ...body } and the
// shared secret in the X-Worker-Key header.

import { CONFIG } from "./config.js";

export async function api(action, body = {}) {
  const res = await fetch(CONFIG.WORKER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-key": CONFIG.DOCUMENT_WORKER_KEY,
    },
    body: JSON.stringify({ action, worker_id: CONFIG.WORKER_ID, ...body }),
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
