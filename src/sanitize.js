// Sanitize extracted text before sending to Supabase.
// PostgreSQL text columns and JSON payloads reject:
//   - null bytes (\u0000)
//   - lone surrogates (invalid UTF-8)
//   - some control chars that break JSON.stringify round-trips via Postgres
export function sanitizeText(input) {
  if (input == null) return "";
  let s = String(input);

  // Remove literal escape fragments often produced by PDF extractors before
  // JSON.stringify turns them into payload text for the RPC.
  s = s.replace(/\\u0000/gi, "");
  s = s.replace(/\\x00/gi, "");
  s = s.replace(/\\u[dD][89aAbB][0-9a-fA-F]{2}/g, "");
  s = s.replace(/\\u[dD][c-fC-F][0-9a-fA-F]{2}/g, "");
  s = s.replace(/\\u(?:[0-9a-fA-F]{0,3})(?![0-9a-fA-F])/g, "");

  // Remove null bytes — Postgres text cannot store \u0000
  s = s.replace(/\u0000/g, "");

  // Strip C0 control chars except \t \n \r
  s = s.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  // Strip C1 control chars
  s = s.replace(/[\u007F-\u009F]/g, "");

  // Remove lone surrogates (invalid Unicode) which cause
  // "unsupported Unicode escape sequence" in Postgres JSON parsing
  s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "");
  s = s.replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1");

  // Normalize unicode form and collapse excessive whitespace
  try { s = s.normalize("NFKC"); } catch { /* ignore */ }
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s;
}

export function safePreview(input, max = 200) {
  return sanitizeText(input)
    .replace(/\s+/g, " ")
    .slice(0, max);
}

export function sanitizeChunkForUpload(chunk) {
  return {
    ...chunk,
    content: sanitizeText(chunk?.content),
  };
}
