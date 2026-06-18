// ============================================================
// Document Workflow Engine — extractor.ts
// Version: 3.0.0
//
// Three independent extractors that pull structured data out
// of a classified segment. They run in parallel and never
// depend on each other's output.
//
// Extractor 1 — Date:        finds and normalises temporal info
// Extractor 2 — Responsible: finds the agent or role
// Extractor 3 — Action:      compresses the segment to its core
//
// v3.0 changes:
//   - extractAll() now accepts KindScores instead of ScoreVector
//   - Removed local ResponsibleKind/ResponsibleResult duplicates
//     (imported from types.ts)
//   - Fixed MONTH_MAP suffix keys for German/Swedish
//
// Design rules:
// - No domain vocabulary. Patterns only.
// - A missing field is null. We never guess.
// - Each extractor returns its own confidence score.
// - Errors in one extractor do not affect the others.
// ============================================================

import type {
  DateResult,
  DateType,
  Confidence,
  KindScores,
  ResponsibleKind,
  ResponsibleResult,
} from "./types.ts";
import {
  DIRECT_ACTION_VERB_PATTERN,
  DATE_ANCHOR_PATTERN,
  NUMBERED_SECTION_PATTERN,
  HEADING_PATTERN,
} from "./patterns.ts";

type DateExtractResult = {
  result: DateResult;
  matchedText: string | null;
};

// ------------------------------------------------------------
// Shared utility
// ------------------------------------------------------------

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function inferDateType(text: string): DateType {
  const t = text.toLowerCase();

  if (/\b(?:møde|meeting|workshop|session|næste møde|afholdes)\b/i.test(t)) {
    return "meeting";
  }

  if (/\b(?:inden|senest|latest|no later than|due|before)\b/i.test(t)) {
    return "deadline";
  }

  if (/\b(?:scheduled|planlagt|finder sted|foregår|afvikles)\b/i.test(t)) {
    return "meeting";
  }

  return "unknown";
}
const WEEKDAY_START_PATTERN =
  /^(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

function isAnchorLine(line: string): boolean {
  return (
    DATE_ANCHOR_PATTERN.test(line) ||
    NUMBERED_SECTION_PATTERN.test(line) ||
    HEADING_PATTERN.test(line) ||
    WEEKDAY_START_PATTERN.test(line)
  );
}
function isStructuralHeaderLine(line: string): boolean {
  const trimmed = line.trim();

  return (
    NUMBERED_SECTION_PATTERN.test(trimmed) ||
    HEADING_PATTERN.test(trimmed) ||
    WEEKDAY_START_PATTERN.test(trimmed)
  );
}
// ------------------------------------------------------------
// Extractor 1 — Date
// ------------------------------------------------------------

// Months in multiple languages mapped to zero-padded numbers.
// Extend this map to add language support — nothing else changes.
//
// v3.0: Fixed German/Swedish entries. Duplicate month names
// (e.g. Danish "januar" and German "Januar") map to the same
// number — only one entry needed. Removed _de/_sv suffixes
// that could never match actual text.
const MONTH_MAP: Record<string, string> = {
  // English
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04",
  jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  // Danish
  januar: "01", februar: "02", marts: "03",
  maj: "05", juni: "06", juli: "07",
  oktober: "10",
  // German (unique entries only — shared names covered above)
  märz: "03", mai: "05", dezember: "12",
  // Swedish / Norwegian (unique entries only)
  januari: "01", februari: "02",
};

// Named days — used to detect relative references
const NAMED_DAYS =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i;

// Relative forward-pointing expressions
const RELATIVE_FORWARD =
  /\b(?:next\s+\w+|this\s+\w+|coming\s+\w+|næste\s+\w+|kommende\s+\w+|i\s+næste\s+uge|in\s+\d+\s+(?:days?|weeks?|months?))\b/i;

/**
 * Try to parse a date from a raw string and return ISO 8601.
 * Returns null if the string cannot be confidently parsed.
 */
function tryParseIso(raw: string, referenceYear?: number): string | null {
  const t = raw.trim().toLowerCase();

  // Format: YYYY-MM-DD (already ISO)
  const isoMatch = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Format: DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY
  const numericFull = t.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$/);
  if (numericFull) {
    const day = numericFull[1].padStart(2, "0");
    const month = numericFull[2].padStart(2, "0");
    const year = numericFull[3].length === 2
      ? `20${numericFull[3]}`
      : numericFull[3];
    if (Number(day) >= 1 && Number(day) <= 31 &&
      Number(month) >= 1 && Number(month) <= 12) {
      return `${year}-${month}-${day}`;
    }
  }

  // Format: DD.MM or DD/MM (year inferred from document context)
  const numericShort = t.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (numericShort && referenceYear) {
    const day = numericShort[1].padStart(2, "0");
    const month = numericShort[2].padStart(2, "0");
    if (Number(day) >= 1 && Number(day) <= 31 &&
      Number(month) >= 1 && Number(month) <= 12) {
      return `${referenceYear}-${month}-${day}`;
    }
  }

  // Format: "15 January 2026" / "15. januar 2026" / "15 januari"
  const textualFull = t.match(
    /(\d{1,2})\.?\s+([a-zæøå]+)\s*,?\s*(\d{4})?/
  );
  if (textualFull) {
    const day = textualFull[1].padStart(2, "0");
    const monthWord = textualFull[2];
    const monthNum = MONTH_MAP[monthWord] ?? null;
    const year = textualFull[3] ?? String(referenceYear ?? "");
    if (monthNum && year && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${monthNum}-${day}`;
    }
  }

  return null;
}

/**
 * Extract the best date from a segment.
 *
 * Priority:
 * 1. Explicit full date (ISO or numeric with year)
 * 2. Partial date resolved against referenceYear
 * 3. Named day → dateHint
 * 4. Relative expression → dateHint
 * 5. null — no date found
 */
export function extractDate(
  text: string,
  referenceYear?: number
): DateExtractResult {
  const noDate: DateExtractResult = {
    result: { iso: null, dateHint: null, dateType: "unknown", confidence: 0 },
    matchedText: null,
  };

  if (!text.trim()) return noDate;
  const dateType = inferDateType(text);

  // --- Pass 1: explicit numeric dates ---
  const numericPattern =
    /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}|\d{1,2}[./]\d{1,2})\b/g;
  let match: RegExpExecArray | null;
  const candidates: { iso: string; raw: string; confidence: number }[] = [];

  while ((match = numericPattern.exec(text)) !== null) {
    const raw = match[0];
    const iso = tryParseIso(raw, referenceYear);
    if (iso) {
      // Full dates (with year) are more confident than short ones
      const hasYear = /\d{4}/.test(raw);
      candidates.push({ iso, raw, confidence: hasYear ? 0.90 : 0.65 });
    }
  }

  // --- Pass 2: textual month names ---
  const textualPattern = new RegExp(
    `\\b(\\d{1,2})\\.?\\s+(${Object.keys(MONTH_MAP).join("|")})\\b(?:\\s*,?\\s*(\\d{4}))?`,
    "gi"
  );
  while ((match = textualPattern.exec(text)) !== null) {
    const raw = match[0];
    const iso = tryParseIso(raw, referenceYear);
    if (iso) {
      const hasYear = /\d{4}/.test(raw);
      candidates.push({ iso, raw, confidence: hasYear ? 0.88 : 0.60 });
    }
  }

  if (candidates.length > 0) {
    // Pick the most confident candidate; prefer ones with explicit years
    const best = candidates.reduce((a, b) =>
      b.confidence > a.confidence ? b : a
    );
    return {
      result: {
        iso: best.iso,
        dateHint: null,
        dateType,
        confidence: best.confidence,
      },
      matchedText: best.raw,
    };
  }

  // --- Pass 3: named days ---
  const dayMatch = NAMED_DAYS.exec(text);
  if (dayMatch) {
    return {
      result: {
        iso: null,
        dateHint: normaliseWhitespace(dayMatch[0]),
        dateType,
        confidence: 0.35,
      },
      matchedText: dayMatch[0],
    };
  }

  // --- Pass 4: relative expressions ---
  const relMatch = RELATIVE_FORWARD.exec(text);
  if (relMatch) {
    return {
      result: {
        iso: null,
        dateHint: normaliseWhitespace(relMatch[0]),
        dateType,
        confidence: 0.25,
      },
      matchedText: relMatch[0],
    };
  }
  return noDate;
}

// ------------------------------------------------------------
// Extractor 2 — Responsible
// ------------------------------------------------------------

// Role words that act as agents even when no name is present
const ROLE_PATTERN =
  /\b(?:CEO|CTO|CFO|director|manager|lead|coordinator|secretary|chair|president|head of|team|group|committee|board|direktør|leder|koordinator|projektleder|formand|teamet|gruppen|bestyrelsen|udvalget)\b/i;

// Pronouns that weakly indicate an agent
const PRONOUN_PATTERN = /\b(?:he|she|they|it|han|hun|de|vi)\b/i;

// ResponsibleKind and ResponsibleResult are now imported from types.ts
// — no local duplicates.

/**
 * Extract the responsible person or role from a segment.
 *
 * Strategy:
 * 1. Look for a capitalised word (likely a name) early in the segment,
 *    positioned before an obligation verb.
 * 2. Look for a role word if no name found.
 * 3. Return null if nothing is found — never guess.
 */
export function extractResponsible(text: string): ResponsibleResult {

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const contentLines = lines.filter(line => !isStructuralHeaderLine(line));
  const searchText = contentLines.join(" ");

  // --- Stoplist: these tokens are never agents ---
  const AGENT_STOPLIST =
    /^(?:mødet|næste|sagen|punktet|opgaven|workshoppen|sessionen|møde|referat|beslutningen|emnet|rapporten|materialet|dokumentet|oplægget|han|hun|de|vi|man|den|det|he|she|they|we|it|one|der|projektet|kontrakten|ansøgningen|tilmeldingen|systemet|overvej|alle|materialer|bidrag|leverancen)\b/i;

  // --- Pass 00: koordineret multi-actor som samlet aktør ---
  const MULTI_ACTOR_PATTERN = new RegExp(
    `\\b([A-ZÆØÅ][a-zæøå]{1,20}\\s+(?:og|and|samt)\\s+[A-ZÆØÅ][a-zæøå]{1,20})\\s+${DIRECT_ACTION_VERB_PATTERN.source}`,
    "i"
  );
  const multiActorMatch = MULTI_ACTOR_PATTERN.exec(searchText);
  if (multiActorMatch) {
    const label = multiActorMatch[1];
    const [name1, name2] = label.split(/\s+(?:og|and|samt)\s+/);
    if (!AGENT_STOPLIST.test(name1.trim()) && !AGENT_STOPLIST.test(name2.trim())) {
      return { kind: "person", label, confidence: 0.75 };
    }
  }

  // --- Fallback guard: koordineret navnepar uden accepteret direkte-action-struktur ---
  const MULTI_ACTOR_PRESENCE =
    /\b[A-ZÆØÅ][a-zæøå]{1,20}\s+(?:og|and|samt)\s+[A-ZÆØÅ][a-zæøå]{1,20}\b/;
  if (MULTI_ACTOR_PRESENCE.test(searchText)) {
    return { kind: "unknown", label: null, confidence: 0 };
  }

  // --- Pass 0: capitalised name + active verb (no obligation marker required) ---
  const nameBeforeActiveVerb = searchText.match(
    /\b([A-ZÆØÅ][a-zæøå]{1,20}(?:\s+[A-ZÆØÅ][a-zæøå]{1,20})?)\s+(?:kontakter|opdaterer|sender|fremsender|indkalder|afholder|arrangerer|udarbejder|godkender|reviderer|følger op|opsætter|implementerer|koordinerer|leverer)\b/
  );

  if (nameBeforeActiveVerb) {
    const candidate = nameBeforeActiveVerb[1].trim();
    if (!AGENT_STOPLIST.test(candidate)) {
      return {
        kind: "person",
        label: candidate,
        confidence: 0.78,
      };
    }
  }

  // --- Pass 0b: kort organisatorisk aktør + direkte handlingsverbum ---
  const orgActorMatch = searchText.match(
    /\b(IT|HR|BI|QA|UX|Legal|Økonomi|Finans|Drift|Support|Indkøb|Marketing|Kommunikation)\s+(?:opsætter|implementerer|koordinerer|leverer|kontakter|opdaterer|sender|fremsender|indkalder|afholder|arrangerer|udarbejder|godkender|reviderer)\b/i
  );
  if (orgActorMatch) {
    const candidate = orgActorMatch[1].trim();
    return {
      kind: "role",
      label: candidate,
      confidence: 0.70,
    };
  }

  // --- Pass 1: capitalised name before an obligation marker ---
  const nameBeforeObligation = searchText.match(
    /\b([A-ZÆØÅ][a-zæøå]{1,20}(?:\s+[A-ZÆØÅ][a-zæøå]{1,20})?)\b(?=.{0,60}\b(?:shall|must|will|should|needs? to|has to|sørger for|skal|bør|har ansvar)\b)/
  );

  if (nameBeforeObligation) {
    const candidate = nameBeforeObligation[1].trim();

    if (!AGENT_STOPLIST.test(candidate)) {
      const isFirstWord = searchText.trimStart().startsWith(candidate);
      const looksLikeSentenceStart =
        isFirstWord && contentLines.length === 1 && searchText.split(" ").length < 4;
      if (!looksLikeSentenceStart) {
        return { kind: "person", label: candidate, confidence: 0.82 };
      }
    }
  }

  const collectiveMatch = text.match(
    /\b(?:alle|samtlige|gruppen|teamet|vi|deltagerne|participants|everyone|all|the team|students|all students)\b/i
  );

  if (collectiveMatch) {
    return {
      kind: "collective",
      label: normaliseWhitespace(collectiveMatch[0]),
      confidence: 0.7
    };
  }

  // --- Guard: passiv + recipient — objekt-led er ikke agent ---
  const passiveRecipientPattern =
    /\b(?:sendes|fremsendes|leveres|indsendes|afleveres)\s+til\b/i;
  if (passiveRecipientPattern.test(searchText)) {
    return { kind: "unknown", label: null, confidence: 0 };
  }

  // --- Pass 2: role word ---
  const roleMatch = ROLE_PATTERN.exec(text);
  if (roleMatch) {
    return {
      kind: "role",
      label: normaliseWhitespace(roleMatch[0]),
      confidence: 0.65
    };
  }
  return {
    kind: "unknown",
    label: null,
    confidence: 0
  };
}

// ------------------------------------------------------------
// Extractor 3 — Action text
// ------------------------------------------------------------

// Words and patterns that are noise — removed from the action string
const NOISE_PREFIXES = [
  /^(?:please|kindly|note that|please note|obs:|note:)\s*/i,
  /^(?:it was decided that|it has been agreed that|det blev besluttet at|det er aftalt at)\s*/i,
];

/**
 * Strip the responsible person and date from a segment,
 * then compress what remains into a clean action string.
 */
export function extractActionText(
  text: string,
  responsibleName: string | null,
  matchedDateText: string | null
): { text: string; confidence: Confidence } {
  if (!text.trim()) return { text: "", confidence: 0 };

  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const contentLines = lines.filter(line => !isStructuralHeaderLine(line));
  let cleaned = contentLines.join(" ");

  // Guard: ignore short heading-like clauses
  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount <= 2 && !/\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return { text: "", confidence: 0 };
  }

  // Remove the responsible name if found
  if (responsibleName) {
    cleaned = cleaned.replace(
      new RegExp(
        `\\b${escapeRegex(responsibleName)}\\b.{0,30}?\\b(?:shall|must|will|should|needs? to|has to|sørger for|skal|bør)\\b\\s*`,
        "i"
      ),
      ""
    );
    if (cleaned === text) {
      cleaned = cleaned.replace(
        new RegExp(`\\b${escapeRegex(responsibleName)}\\b`, "g"),
        ""
      );
    }
  }

  // Remove the matched date text
  if (matchedDateText) {
    cleaned = cleaned.replace(
      new RegExp(
        `\\b(?:by|before|until|senest|inden|before|due)\\s*${escapeRegex(matchedDateText)}`,
        "gi"
      ),
      ""
    );
    cleaned = cleaned.replace(
      new RegExp(`\\b${escapeRegex(matchedDateText)}\\b`, "g"),
      ""
    );
  }

  // Guard: resttekst efter dato-stripping er for kort til at være meningsfuld
  const residualWords = cleaned.split(/\s+/).filter(Boolean).length;
  if (residualWords <= 1 && !/\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return { text: "", confidence: 0 };
  }

  // Remove noise prefixes
  for (const prefix of NOISE_PREFIXES) {
    cleaned = cleaned.replace(prefix, "");
  }

  // Collapse whitespace and strip leading punctuation
  cleaned = cleaned
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.]+/, "")
    .replace(/[\s,;:.]+$/, "")
    .trim();

  // Capitalise first letter
  if (cleaned.length > 0) {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  }

  if (!cleaned) return { text: "", confidence: 0 };

  // Confidence: longer and cleaner = more confident
  const words = cleaned.split(/\s+/).length;
  const confidence = clamp(
    words >= 3 ? 0.80 :
      words === 2 ? 0.65 :
        0.40
  );

  return { text: cleaned, confidence };
}

// ------------------------------------------------------------
// Combined extraction
// ------------------------------------------------------------

export interface ExtractionResult {
  date: DateResult;
  responsible: ResponsibleResult;
  text: string;
  confidence: Confidence;
}

/**
 * Run all three extractors on a segment and combine results.
 *
 * v3.0: Now accepts KindScores (three dimensions) instead of
 * ScoreVector (four dimensions). Confidence is computed from
 * identity signals only — temporal signals do not affect it.
 */
export function extractAll(
  segment: string,
  scores: KindScores,
  referenceYear?: number
): ExtractionResult {
  // Run extractors
  const dateResult = extractDate(segment, referenceYear);
  const responsible = extractResponsible(segment);
  const actionResult = extractActionText(
    segment,
    responsible.label,
    dateResult.result.iso ? dateResult.matchedText : null
  );

  // Combine confidence: weighted by signal strength from classifier
  // Uses only identity scores — temporal does not affect extraction confidence
  const dominantScore = Math.max(
    scores.action, scores.decision
  );
  const combinedConfidence = clamp(
    (dateResult.result.confidence * 0.30 +
      responsible.confidence * 0.25 +
      actionResult.confidence * 0.45) * (0.5 + dominantScore * 0.5)
  );

  return {
    date: dateResult.result,
    responsible: responsible,
    text: actionResult.text,
    confidence: combinedConfidence,
  };
}

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
