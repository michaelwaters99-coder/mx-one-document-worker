import "dotenv/config";

function required(name) {
  const v = process.env[name];
  if (!v || v.startsWith("YOUR-") || v === "paste-the-secret-here") {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}

export const CONFIG = {
  WORKER_URL: required("WORKER_URL"),
  DOCUMENT_WORKER_KEY: required("DOCUMENT_WORKER_KEY"),
  WORKER_ID: process.env.WORKER_ID || `worker-${process.pid}`,
  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS ?? 5000),
  HEARTBEAT_INTERVAL_MS: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 45000),
  CHUNK_SIZE: Number(process.env.CHUNK_SIZE ?? 1200),
  CHUNK_OVERLAP: Number(process.env.CHUNK_OVERLAP ?? 150),
  CHUNKS_PER_BATCH: Number(process.env.CHUNKS_PER_BATCH ?? 32),
  // Default: `server` → send chunk text only, let the document-worker Edge
  // Function embed with the managed LOVABLE_API_KEY. Guarantees vector-space
  // parity with Copilot. Other values (`lovable`, `openai`) are for local
  // testing only. `mock` is disabled and will throw.
  EMBED_PROVIDER: (process.env.EMBED_PROVIDER || "server").toLowerCase(),
  LOVABLE_API_KEY: process.env.LOVABLE_API_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
};

export const EMBED_DIM = 1536;
