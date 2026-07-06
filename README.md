# MX One — External Document Worker

This is a small Node.js program that processes uploaded aircraft documents
for **MX One**. It runs on your own machine (or any small server) and talks
to the `document-worker` Edge Function in Lovable Cloud.

Big PDFs (aircraft manuals, hundreds of MB) are too heavy for Edge
Functions to parse. Instead, MX One puts each upload on a queue, and this
worker:

1. Asks the Edge Function for the next job.
2. Downloads the file via a temporary signed URL.
3. Extracts text (PDF or plain text in v1).
4. Splits the text into chunks.
5. Creates embeddings for each chunk.
6. Uploads the chunks + embeddings and marks the job complete.

It also sends a heartbeat every 45 seconds so MX One knows the worker is
still alive. If the worker crashes, the job is automatically re-queued
after 3 minutes and resumes from where it left off.

---

## 1. What you need

- **Node.js 20 or newer** — check with `node -v`. Install from
  <https://nodejs.org> if needed.
- Your MX One project's **document-worker URL**. It looks like:
  `https://<project-ref>.supabase.co/functions/v1/document-worker`
- The **`DOCUMENT_WORKER_KEY`** secret from MX One → *Backend → Secrets*.

That's it for the first run. You do **not** need an OpenAI account,
LlamaParse, Unstructured, or Google Document AI to get started — the
worker ships with a "mock" embedding mode so you can verify the pipeline
end-to-end first.

---

## 2. Install

Open a terminal in this folder and run:

```bash
npm install
```

Then copy the example config and open it in your editor:

```bash
cp .env.example .env
```

Fill in:

- `WORKER_URL` — your document-worker URL from above.
- `DOCUMENT_WORKER_KEY` — the secret from MX One.
- Leave everything else on its default for the first run.

---

## 3. Run

```bash
npm start
```

You should see:

```
[worker] starting worker worker-local-01
[worker] endpoint https://…/document-worker
[worker] ping ok: 2026-…
```

Now go to **MX One → Documents → Diagnostics** and switch
*Processing mode* to **External worker**. Upload a PDF. Within a few
seconds you'll see the worker log lines like:

```
[worker] claimed job 4f3b… (manual.pdf, 24580931 bytes)
[worker] extracted 412 page(s)
[worker] produced 1180 chunk(s)
[worker]   indexed 32/1180
[worker]   indexed 64/1180
…
[worker] ✓ completed 4f3b…
```

Leave the worker running. It polls every 5 seconds when the queue is
empty, and stays busy while there are jobs.

Stop it with `Ctrl+C`. Any in-flight job is safely picked up again by
the next worker (yours or another instance) after ~3 minutes.

---

## 4. Switching to real embeddings (optional)

The default `EMBED_PROVIDER=mock` produces deterministic fake vectors so
you can prove the pipeline works without spending money. Copilot answers
will only become accurate once you switch to a real embedding model.

To use OpenAI (recommended for the first upgrade):

1. Get an API key from <https://platform.openai.com/api-keys>.
2. In `.env`, set:
   ```
   EMBED_PROVIDER=openai
   OPENAI_API_KEY=sk-…
   ```
3. Restart the worker (`Ctrl+C`, then `npm start`).

OpenAI's `text-embedding-3-small` model matches MX One's 1536-dim vector
schema out of the box.

---

## 5. Adding LlamaParse / Unstructured / Document AI later

The extraction step lives in **`src/extract.js`** and always returns:

```js
{ pages: [ { page_number: 1, text: "…" }, … ] }
```

To plug in a smarter parser:

1. Add a new branch in `extractPages(...)` that calls the provider you
   want (e.g. LlamaParse's REST API).
2. Convert its response into the `{ pages: [...] }` shape above.
3. Restart the worker.

Nothing else needs to change — chunking, embedding, upload, heartbeats,
and resume logic all keep working.

Same pattern for embeddings: add a new function in `src/embed.js` and a
new `EMBED_PROVIDER` value.

---

## 6. Running on a server

Any always-on machine works — a small VPS, Fly.io, Render, Railway,
Cloud Run, a Raspberry Pi, etc. Just:

- Install Node 20+.
- Copy this folder up.
- `npm install`.
- Set the same environment variables (either via `.env` or your host's
  secrets UI).
- Run `npm start` under a process manager (`pm2`, `systemd`, Docker's
  restart policy, your host's built-in one, …).

You can run **multiple workers** at once — they coordinate through the
job queue automatically. Give each one a distinct `WORKER_ID`.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ping failed: unauthorized` | `DOCUMENT_WORKER_KEY` in `.env` doesn't match the secret in MX One. |
| `ping failed: HTTP 404` | `WORKER_URL` is wrong — double-check the project ref. |
| Worker sits idle, no jobs claimed | In MX One → Documents → Diagnostics, make sure *Processing mode* is set to **External worker**. |
| Jobs stall then reappear | Normal after a crash — the server re-queues locks older than 3 minutes. |
| `EMBED_PROVIDER=openai but OPENAI_API_KEY is empty` | Add your key to `.env` and restart. |

---

## File layout

```
external-worker/
├── package.json
├── .env.example
├── README.md
└── src/
    ├── index.js     ← poll loop
    ├── api.js       ← HTTP client for the Edge Function
    ├── config.js    ← reads .env
    ├── extract.js   ← PDF / text extraction (swap for LlamaParse etc.)
    ├── chunk.js     ← sliding-window chunker
    └── embed.js     ← mock + OpenAI embeddings (add more here)
```
