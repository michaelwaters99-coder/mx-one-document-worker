// Embedding providers. Return a 1536-dim number[] per input string.
//
// Add new providers by exporting an async function and wiring it into
// `embed()` below. Keep the output dimension at EMBED_DIM (1536).

import { CONFIG, EMBED_DIM } from "./config.js";

export async function embed(texts) {
  if (CONFIG.EMBED_PROVIDER === "openai") return embedOpenAI(texts);
  return embedMock(texts);
}

// Deterministic pseudo-embeddings: good enough to exercise the pipeline
// end-to-end without an API key. Replace with a real provider for prod.
function embedMock(texts) {
  return texts.map((t) => {
    const v = new Array(EMBED_DIM).fill(0);
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h = (h ^ t.charCodeAt(i)) * 16777619;
    }
    for (let i = 0; i < EMBED_DIM; i++) {
      h = (h * 1664525 + 1013904223) >>> 0;
      v[i] = ((h & 0xffff) / 0xffff) * 2 - 1;
    }
    // L2 normalise
    let mag = 0;
    for (const x of v) mag += x * x;
    mag = Math.sqrt(mag) || 1;
    return v.map((x) => x / mag);
  });
}

async function embedOpenAI(texts) {
  if (!CONFIG.OPENAI_API_KEY) {
    throw new Error("EMBED_PROVIDER=openai but OPENAI_API_KEY is empty");
  }
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${CONFIG.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings failed: HTTP ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}
