// ============================================================
// Document Workflow Engine — clause-splitter.ts
// Version: 1.0.0
//
// Splits a single segment into one or more clause candidates.
// This sits between segmenter.ts and classifier/extractor.
//
// Design goals:
// - conservative
// - deterministic
// - line-aware, not sentence-aware
// - preserve structural header context in sourceText
// ============================================================

export interface ClauseCandidate {
  text: string;
  sourceText: string;
}

const NUMBERED_SECTION_PATTERN =
  /^(?:(?:[0-9]+\.)+\s*.+|[0-9]+\.\s+.+|[A-Z]\.\s+.+|[IVX]+\.\s+.+|[Pp]unkt\s+\d+\b.*|[Aa]genda\s+\d+\b.*)$/;

const DATE_LINE_PATTERN =
  /^\s*(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?)(?:\s|$)/;

const WEEKDAY_LINE_PATTERN =
  /^\s*(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const HEADING_PATTERN =
  /^[A-ZÆØÅ][A-ZÆØÅ\s\d/&+\-]{2,49}$/;

const COORDINATOR_PATTERN =
  /\s+(?:og|and|samt)\s+/i;

const BARE_LIST_MARKER_PATTERN =
  /^\s*\d+[.)]?\s*$/;

function isBareListMarker(text: string): boolean {
  return BARE_LIST_MARKER_PATTERN.test(text.trim());
}

function countDateSignals(text: string): number {
  const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const local = text.match(/\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/g) ?? [];
  return iso.length + local.length;
}

function normaliseLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function looksLikeSentenceWorkflowStart(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // Capitalized subject/role + common workflow verb
  if (
    /^[A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+)?\s+(?:sørger for|skal|bør|fremsender|sender|kontakter|indkalder|udarbejder|godkender|opdaterer)\b/i.test(t)
  ) return true;

  // Passive / event workflow formulations
  if (
    /^(?:Der\s+)?(?:udarbejdes|fremsendes|indkaldes|afholdes|godkendes|opdateres)\b/i.test(t)
  ) return true;

  // Meeting / event starts
  if (
    /^(?:Næste\s+møde|Next\s+meeting|Workshop|Møde|Meeting)\b/i.test(t)
  ) return true;

  // Deadline-specific start
  if (
    /^(?:Senest|Inden)\b/i.test(t)
  ) return true;

  return false;
}

function splitCompoundWorkflowLine(line: string): string[] {
  const text = line.trim();
  if (!text.includes(".")) return [text];

  const parts = text
    .split(/(?<=\.)\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Guard: reject splits where the left part is a short abbreviation token
  // (≤ 4 characters, e.g. "Dr.", "e.g.", "ca.", "jf."). Real sentence endings
  // are longer. We re-join short left parts with the next part.
  const guardedParts: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isShortAbbrev = part.length <= 4 && /\.$/.test(part);
    if (isShortAbbrev && guardedParts.length > 0) {
      guardedParts[guardedParts.length - 1] += ` ${part}`;
    } else if (isShortAbbrev && i + 1 < parts.length) {
      parts[i + 1] = `${part} ${parts[i + 1]}`;
    } else {
      guardedParts.push(part);
    }
  }
  const filtered = guardedParts;

  if (filtered.length <= 1) return [text];

  const out: string[] = [];
  let current = filtered[0];

  for (let i = 1; i < filtered.length; i++) {
    const next = filtered[i];

    if (looksLikeSentenceWorkflowStart(next)) {
      out.push(current.trim());
      current = next;
    } else {
      current += ` ${next}`;
    }
  }

  if (current.trim()) out.push(current.trim());

  return out;
}

function looksLikeIndependentWorkflowStart(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  if (looksLikeSentenceWorkflowStart(t)) return true;

  if (
    /^[A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+)?\s+\b/i.test(t)
  ) return true;

  if (
    /^(?:Der\s+)?(?:udarbejdes|fremsendes|indkaldes|afholdes|godkendes|opdateres)\b/i.test(t)
  ) return true;

  return false;
}

function splitCoordinatedWorkflowClause(text: string): string[] {
  const input = text.trim();
  if (!input) return [];
  if (!COORDINATOR_PATTERN.test(input)) return [input];

  const matches = [...input.matchAll(/\s+(og|and|samt)\s+/gi)];
  if (!matches.length) return [input];

  for (const match of matches) {
    const splitIndex = (match.index ?? 0) + match[0].length;
    const left = input.slice(0, match.index).trim();
    const right = input.slice(splitIndex).trim();

    if (!left || !right) continue;
    if (!looksLikeIndependentWorkflowStart(right)) continue;
    if (!hasWorkflowSignal(left) || !hasWorkflowSignal(right)) continue;

    const leftDates = countDateSignals(left);
    const rightDates = countDateSignals(right);
    const totalDates = countDateSignals(input);

    const strongEvidence =
      leftDates >= 1 ||
      rightDates >= 1 ||
      totalDates >= 2 ||
      /^[A-ZÆØÅ]/.test(right);

    if (!strongEvidence) continue;

    return [left, ...splitCoordinatedWorkflowClause(right)];
  }

  return [input];
}

function expandCompoundWorkflowLines(lines: string[]): string[] {
  return lines.flatMap(splitCompoundWorkflowLine);
}

function looksLikeHeader(line: string): boolean {
  const t = line.trim();

  if (!t) return false;
  if (NUMBERED_SECTION_PATTERN.test(t)) return true;
  if (DATE_LINE_PATTERN.test(t)) return true;
  if (WEEKDAY_LINE_PATTERN.test(t)) return true;
  if (HEADING_PATTERN.test(t)) return true;

  return false;
}

function isMetadataLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;

  // Typical document metadata: "Label: value"
  if (
    /^(?:dato|date|deltagere|participants|underviser|instructor|kursus|course|sted|location|emne|subject)\s*:/i.test(t)
  ) return true;

  // Generic short label-value line: "Word: value" / "Two words: value"
  if (
    /^[A-ZÆØÅa-zæøå][A-ZÆØÅa-zæøå\s\-]{0,30}:\s+\S+/.test(t) &&
    !/\b\d{4}-\d{2}-\d{2}\b/.test(t) &&
    !/\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/.test(t)
  ) return true;

  return false;
}

function looksLikeBullet(line: string): boolean {
  const t = line.trim();

  if (isBareListMarker(t)) return false;

  return /^[-*•‣∙▸►]\s+|^\d+[.)]\s+/.test(t);
}

function looksLikeContinuation(line: string, prev: string | null): boolean {
  const t = line.trim();
  if (!t) return false;

  if (prev && /:\s*$/.test(prev.trim())) return true;
  if (/^[a-zæøå(]/.test(t)) return true;
  if (/^(?:og|eller|men|samt|herunder|including|and|or|but)\s/i.test(t)) return true;
  if (/^[,;:).\-]/.test(t)) return true;

  return false;
}

function hasWorkflowSignal(line: string): boolean {
  const t = line.trim();

  if (!t) return false;
  if (isBareListMarker(t)) return false;

  if (looksLikeBullet(t)) return true;

  if (/\b\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  if (/\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/.test(t)) return true;

  if (
    /\b(?:shall|must|will|should|needs? to|has to|have to|sørger for|skal|bør|har ansvar|er ansvarlig|fremsender|sender|udarbejdes|udarbejder|kontakter|indkalder|afholdes|godkender|godkendes|opdaterer|opdateres)\b/i.test(t)
  ) return true;

  if (
    /\b(?:senest|inden|before|until|due)\b/i.test(t)
  ) return true;

  if (
    /\b(?:godkendt|besluttet|aftalt|vedtaget)\b/i.test(t)
  ) return true;

  if (
    /^[A-ZÆØÅ][a-zæøå]+(?:\s+[A-ZÆØÅ][a-zæøå]+)?\s+(?:sørger for|skal|bør|fremsender|sender|kontakter|indkalder|udarbejder|godkender|opdaterer)\b/i.test(t)
  ) return true;

  if (
    /^(?:Næste\s+møde|Next\s+meeting|Workshop|Møde|Meeting)\b/i.test(t)
  ) return true;

  return false;
}

function startsNewClause(line: string, prev: string | null): boolean {
  const t = line.trim();
  if (!t) return false;

  if (looksLikeBullet(t)) return true;
  if (looksLikeContinuation(t, prev)) return false;

  // A date-only line is a continuation if the previous line
  // contains an event verb — it completes the assertion, not starts a new one
  const isDateOnly = /^[\d]{1,4}[./\-][\d]{1,2}(?:[./\-][\d]{2,4})?\.?$/.test(t);
  const prevHasEventVerb = prev !== null &&
    /\b(?:afholdes|finder sted|takes place|is held|planlagt til|scheduled)\b/i.test(prev);

  if (isDateOnly && prevHasEventVerb) return false;

  if (hasWorkflowSignal(t)) return true;

  return false;
}

export function splitSegmentIntoClauses(segmentText: string): ClauseCandidate[] {
  const baseLines = normaliseLines(segmentText);
  const lines = expandCompoundWorkflowLines(baseLines);

  if (lines.length <= 1) {
    const text = lines[0]?.trim() ?? segmentText.trim();
    if (isMetadataLine(text)) return [];

    const splitTexts = [text]
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !isBareListMarker(t));

    if (splitTexts.length <= 1) {
      return [{ text, sourceText: text }];
    }

    return splitTexts.map((text) => ({
      text,
      sourceText: text,
    }));
  }

  const first = lines[0];
  const hasHeader = looksLikeHeader(first);
  const header = hasHeader ? first : null;

  const rawBody = hasHeader ? lines.slice(1) : lines;
  const body = rawBody.filter((line) => !isMetadataLine(line));
  
  if (body.length <= 1) {
    const rawText = body[0]?.trim();

    if (!rawText) {
    return [];
  }

    const text = rawText;

    const splitTexts = [text]
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !isBareListMarker(t));

    if (splitTexts.length <= 1) {
      const sourceText = header ? `${header}\n${text}` : text;
      return [{ text, sourceText }];
    }

    return splitTexts.map((text) => ({
      text,
      sourceText: header ? `${header}\n${text}` : text,
    }));
  }

  const buckets: string[] = [];
  let current = "";

  for (const line of body) {
    const prevBucketText = current || null;

    if (!current) {
      current = line;
      continue;
    }

    if (startsNewClause(line, prevBucketText)) {
      buckets.push(current.trim());
      current = line;
      continue;
    }

    current += ` ${line}`;
  }

  if (current.trim()) {
    buckets.push(current.trim());
  }

  const expandedBuckets = buckets
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((text) => !isBareListMarker(text));

  // Conservative safety gate:
  // only keep split if at least 2 buckets look workflow-relevant.
  const workflowBuckets = expandedBuckets.filter(hasWorkflowSignal);

  if (expandedBuckets.length < 2 || workflowBuckets.length === 0) {
    return [{ text: segmentText.trim(), sourceText: segmentText.trim() }];
  }

  return expandedBuckets.map((text) => ({
    text,
    sourceText: header ? `${header}\n${text}` : text,
  }));
}