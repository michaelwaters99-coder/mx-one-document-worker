// Embedding providers. Return a 1536-dim number[] per input string.
//
// Copilot embeds queries with:
//   endpoint:   https://ai.gateway.lovable.dev/v1/embeddings
//   model:      google/gemini-embedding-001
//   dimensions: 1536
// In production the `server` provider (default) does NOT embed on Render —
// index.js sends chunk text to the document-worker Edge Function, which
// embeds with the managed LOVABLE_API_KEY. That is the only path that
// guarantees vector-space parity with Copilot.

import { CONFIG, EMBED_DIM } from "./config.js";

export async function embed(texts) {
  if (CONFIG.EMBED_PROVIDER === "server") {
    throw new Error(
      "embed() must not be called when EMBED_PROVIDER=server — the worker must send chunk text only and let the document-worker edge function embed server-side."
    );
  }

  if (CONFIG.EMBED_PROVIDER === "lovable") {
    return embedLovable(texts);
  }

  if (CONFIG.EMBED_PROVIDER === "openai") {
    return embedOpenAI(texts);
  }

  if (CONFIG.EMBED_PROVIDER === "mock") {
    throw new Error(
      "EMBED_PROVIDER=mock is disabled: the previous mock produced identical vectors for different inputs and corrupted the vector index. Use EMBED_PROVIDER=server."
    );
  }

  throw new Error(
    `Unknown EMBED_PROVIDER: ${CONFIG.EMBED_PROVIDER}. Valid values: server (default, production), lovable, openai. Mock is disabled.`
  );
}

// Lovable AI Gateway — matches Copilot's query embedding exactly.
// Local testing only (EMBED_PROVIDER=lovable). Not used in production.
async function embedLovable(texts) {
  if (!CONFIG.LOVABLE_API_KEY) {
    throw new Error("EMBED_PROVIDER=lovable but LOVABLE_API_KEY is empty");
  }

  const out = [];
  const BATCH = 100;

  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${CONFIG.LOVABLE_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-embedding-001",
        input: slice,
        dimensions: EMBED_DIM,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Lovable AI embeddings failed: HTTP ${res.status} ${await res.text()}`
      );
    }

    const json = await res.json();
    const sorted = [...json.data].sort((a, b) => a.index - b.index);

    for (const d of sorted) {
      out.push(d.embedding);
    }
  }

  return out;
}

// OpenAI text-embedding-3-small. DIFFERENT vector space than Copilot —
// local parity/testing only, never production.
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
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
      dimensions: EMBED_DIM,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `OpenAI embeddings failed: HTTP ${res.status} ${await res.text()}`
    );
  }

  const json = await res.json();
  const sorted = [...json.data].sort((a, b) => a.index - b.index);

  return sorted.map((d) => d.embedding);
}
