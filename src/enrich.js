// Document enrichment: doc-kind classifier, ATA extractor,
// aircraft-type/registration detector, and revision extractor.
//
// Runs cheaply on the worker after PDF extraction and produces:
//   { document_kind, document_kind_confidence,
//     ata_chapters, primary_ata, aircraft_type, aircraft_registrations,
//     serial_numbers, revision, issue_date, effective_date,
//     document_family_key, per_chunk_hints: [{ page_number, ata_chapter, heading_path }] }
//
// Heuristics only — a human can override in the UI later.

// --- Aircraft type synonyms ---------------------------------------------------
const AIRCRAFT_TYPES = [
  { canonical: "CL604", re: /\b(cl[\s-]?604|challenger\s*604)\b/i },
  { canonical: "CL605", re: /\b(cl[\s-]?605|challenger\s*605)\b/i },
  { canonical: "CL650", re: /\b(cl[\s-]?650|challenger\s*650)\b/i },
  { canonical: "CL350", re: /\b(cl[\s-]?350|challenger\s*350)\b/i },
  { canonical: "CL300", re: /\b(cl[\s-]?300|challenger\s*300)\b/i },
  { canonical: "BD-700-2A12", re: /\b(global\s*7500|bd[\s-]?700[\s-]?2a12)\b/i },
  { canonical: "BD-700-1A10", re: /\b(global\s*(express|xrs|6000|5000|5500|6500)|bd[\s-]?700[\s-]?1a10)\b/i },
  { canonical: "BD-100-1A10", re: /\b(challenger\s*(300|350)|bd[\s-]?100)\b/i },
];

// --- Document kind classifier -------------------------------------------------
const DOC_KIND_RULES = [
  { kind: "AMM",         patterns: [/\bamm\b/i, /aircraft\s+maintenance\s+manual/i] },
  { kind: "IPC",         patterns: [/\bipc\b/i, /illustrated\s+parts\s+catalog(ue)?/i] },
  { kind: "WDM",         patterns: [/\bwdm\b/i, /wiring\s+diagram(s)?\s+manual/i, /wiring\s+manual/i] },
  { kind: "FIM",         patterns: [/\bfim\b/i, /fault\s+isolation\s+manual/i] },
  { kind: "SRM",         patterns: [/\bsrm\b/i, /structural\s+repair\s+manual/i] },
  { kind: "CMM",         patterns: [/\bcmm\b/i, /component\s+maintenance\s+manual/i] },
  { kind: "MEL",         patterns: [/\bmel\b/i, /minimum\s+equipment\s+list/i] },
  { kind: "TASK_CARD",   patterns: [/\btask\s+card\b/i, /\btc[-\s]?\d/i] },
  { kind: "TRAINING",    patterns: [/training\s+(guide|manual)/i, /technical\s+training/i, /type\s+course/i] },
  { kind: "WORK_PACK",   patterns: [/work\s+pack/i, /\bwp[-\s]?\d/i] },
  { kind: "CERTIFICATE", patterns: [/certificate\s+of\s+(release|conformance|completion)/i, /release\s+to\s+service/i, /\bcofr\b/i] },
  { kind: "INVOICE",     patterns: [/\binvoice\b/i, /amount\s+due/i, /invoice\s+number/i] },
  { kind: "REPORT",      patterns: [/service\s+report/i, /inspection\s+report/i, /pre[-\s]?service/i, /post[-\s]?service/i] },
];

function classifyDocumentKind(fileName, sampleText) {
  const blob = `${fileName ?? ""}\n${sampleText ?? ""}`;
  let best = { kind: "OTHER", score: 0 };
  for (const rule of DOC_KIND_RULES) {
    let score = 0;
    for (const re of rule.patterns) {
      const matches = blob.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || [];
      score += matches.length;
    }
    if (score > best.score) best = { kind: rule.kind, score };
  }
  const confidence = best.score === 0 ? 0 : Math.min(1, best.score / 5);
  return { kind: best.kind, confidence: +confidence.toFixed(2) };
}

// --- ATA extraction -----------------------------------------------------------
function extractAtaFromPage(text) {
  if (!text) return null;
  const atac = text.match(/ATA\s*(?:chapter\s*)?(\d{2})(?:[-\s](\d{1,2})(?:[-\s](\d{1,2}))?)?/i);
  if (atac) {
    const chapter = parseInt(atac[1], 10);
    const section = atac[2] ? `${atac[1]}-${atac[2]}${atac[3] ? "-" + atac[3] : ""}` : null;
    return { chapter, section, headingPath: atac[0] };
  }
  const chap = text.slice(0, 400).match(/\bChapter\s+(\d{2})\b/i);
  if (chap) {
    return { chapter: parseInt(chap[1], 10), section: null, headingPath: chap[0] };
  }
  const sec = text.match(/(?:^|\n)\s*(\d{2})-(\d{2})(?:-(\d{2}))?\s+([A-Z][A-Za-z0-9 /,\-]{3,80})/);
  if (sec) {
    return {
      chapter: parseInt(sec[1], 10),
      section: `${sec[1]}-${sec[2]}${sec[3] ? "-" + sec[3] : ""}`,
      headingPath: `${sec[1]}-${sec[2]}${sec[3] ? "-" + sec[3] : ""} ${sec[4].trim()}`,
    };
  }
  return null;
}

function detectAircraftType(text) {
  for (const t of AIRCRAFT_TYPES) {
    if (t.re.test(text)) return t.canonical;
  }
  return null;
}

// --- Aircraft registrations & serials ----------------------------------------
function detectRegistrations(text) {
  if (!text) return [];
  const set = new Set();
  const re = /\b([A-Z]{1,2}-[A-Z0-9]{3,5}|N[0-9]{1,5}[A-Z]{0,2})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const reg = m[1].toUpperCase();
    if (/^N[0-9]$/.test(reg)) continue;
    set.add(reg);
    if (set.size > 20) break;
  }
  return Array.from(set);
}

function detectSerials(text) {
  if (!text) return [];
  const set = new Set();
  const re = /\b(?:s\/n|serial(?:\s+no)?\.?)\s*[:#]?\s*(\d{3,5})(?:\s*(?:-|to|through|thru)\s*(\d{3,5}))?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2]) set.add(`${m[1]}-${m[2]}`);
    else set.add(m[1]);
    if (set.size > 20) break;
  }
  return Array.from(set);
}

// --- Revision -----------------------------------------------------------------
function detectRevision(text) {
  if (!text) return { revision: null, issueDate: null, effectiveDate: null };
  const rev = text.match(/\b(?:rev(?:ision)?|issue)\s*(?:no\.?|number)?\s*[:#]?\s*([0-9]{1,3}[A-Z]?|[IVXLC]+)\b/i);
  const iso = /(\d{4})[-/\.](\d{1,2})[-/\.](\d{1,2})/;
  const dmy = /(\d{1,2})[\s\-\/](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(\d{2,4})/i;

  const toIso = (d) => {
    if (!d) return null;
    if (d.length === 3 && d[0].length === 4) return `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;
    if (d.length === 4) {
      const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
      const mon = months[d[2].slice(0, 3)];
      let yr = d[3];
      if (yr.length === 2) yr = (parseInt(yr, 10) > 50 ? "19" : "20") + yr;
      return `${yr}-${mon}-${String(d[1]).padStart(2, "0")}`;
    }
    return null;
  };

  let issueDate = null;
  let effectiveDate = null;
  const issueCtx = text.match(new RegExp(`(?:issued|issue\\s+date|dated)[^\\n]{0,40}(?:${iso.source}|${dmy.source})`, "i"));
  if (issueCtx) issueDate = toIso(issueCtx.slice(1).filter(Boolean).length > 3 ? [null, issueCtx[4], issueCtx[5], issueCtx[6]] : [null, issueCtx[1], issueCtx[2], issueCtx[3]]);
  const effCtx = text.match(new RegExp(`(?:effective(?:\\s+date)?)[^\\n]{0,40}(?:${iso.source}|${dmy.source})`, "i"));
  if (effCtx) effectiveDate = toIso(effCtx.slice(1).filter(Boolean).length > 3 ? [null, effCtx[4], effCtx[5], effCtx[6]] : [null, effCtx[1], effCtx[2], effCtx[3]]);

  return {
    revision: rev ? `Rev ${rev[1]}` : null,
    issueDate,
    effectiveDate,
  };
}

// --- Family key: groups revisions of the same manual --------------------------
function familyKey({ title, kind, aircraftType }) {
  const base = (title ?? "")
    .toLowerCase()
    .replace(/rev(?:ision)?\s*[:#]?\s*[0-9a-z]+/gi, "")
    .replace(/issue\s*[:#]?\s*[0-9a-z]+/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 80);
  return [aircraftType || "GLOBAL", kind || "OTHER", base].join("|");
}

// --- Public entry point -------------------------------------------------------
export function enrichDocument({ fileName, pages }) {
  const firstText = (pages ?? []).slice(0, 3).map(p => p.text ?? "").join("\n").slice(0, 8000);
  const allTextForType = (pages ?? []).slice(0, 8).map(p => p.text ?? "").join("\n").slice(0, 20000);

  const { kind, confidence } = classifyDocumentKind(fileName, firstText);
  const aircraftType = detectAircraftType(allTextForType) || detectAircraftType(fileName || "") || null;
  const registrations = detectRegistrations(firstText);
  const serials = detectSerials(firstText);
  const { revision, issueDate, effectiveDate } = detectRevision(firstText);

  const perChunkHints = [];
  const chapterSet = new Set();
  let lastChapter = null;
  let lastHeading = null;
  let lastSection = null;
  for (const page of pages ?? []) {
    const ata = extractAtaFromPage(page.text || "");
    if (ata) {
      lastChapter = ata.chapter;
      lastSection = ata.section ?? lastSection;
      lastHeading = ata.headingPath ?? lastHeading;
      chapterSet.add(ata.chapter);
    }
    perChunkHints.push({
      page_number: page.page_number,
      ata_chapter: lastChapter,
      ata_section: lastSection,
      heading_path: lastHeading,
    });
  }

  const ataChapters = Array.from(chapterSet).sort((a, b) => a - b);
  const primary = ataChapters.length > 0
    ? (lastSection && lastSection.startsWith(String(ataChapters[0])) ? lastSection : String(ataChapters[0]).padStart(2, "0"))
    : null;

  return {
    document_kind: kind,
    document_kind_confidence: confidence,
    ata_chapters: ataChapters,
    primary_ata: primary,
    aircraft_type: aircraftType,
    aircraft_registrations: registrations,
    serial_numbers: serials,
    revision,
    issue_date: issueDate,
    effective_date: effectiveDate,
    document_family_key: familyKey({ title: fileName, kind, aircraftType }),
    per_chunk_hints: perChunkHints,
  };
}
