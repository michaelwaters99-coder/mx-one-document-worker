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
  EMBED_PROVIDER: (process.env.EMBED_PROVIDER || "mock").toLowerCase(),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
};

export const EMBED_DIM = 1536;
