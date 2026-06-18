// ============================================================
// Document Workflow Engine — validator.ts
// Version: 3.0.0
//
// Validate is the final authority in the pipeline.
// It sits between extract and group.
//
// Pipeline position:
//   segment → clause → classify → extract → [validate] → group
//
// System contract:
//   No field may be populated without explicit textual evidence.
//   The system must prefer null over incorrect values.
//   Trust-breaking errors are unacceptable.
//   Coverage is secondary to correctness.
//
// v3.0: Now enforces responsible, date, kind, AND temporal.
//   Temporal bindings from the classifier are not trusted
//   automatically — they must survive independent evidence
//   checks against sourceText before reaching the grouper.
//
// Design rules:
//   - Validate does not inherit classifier/extractor conclusions as truth
//   - Validate applies its own independent evidence check
//   - "same clause" = sourceText in validator context
//   - No threshold-based decisions — pattern match only
//   - Items are never removed — only fields are nulled or degraded
// ============================================================

import type {
  Item,
  DateResult,
  ResponsibleResult,
  BaseKind,
  TemporalBinding,
  DeadlineModifier,
  ScheduledModifier,
  TemporalRangeModifier,
} from "./types.ts";
import {
  DIRECT_ACTION_VERB_PATTERN,
  MODAL_VERB_PATTERN,
  PASSIVE_PATTERN,
  PASSIVE_NO_AGENT_PATTERN,
  DECISION_MARKER_PATTERN,
  DEADLINE_MARKER_PATTERN,
} from "./patterns.ts";

// ============================================================
// RESPONSIBLE VALIDATION
// ============================================================

// Stoplist — these tokens are never valid actors
const ACTOR_STOPLIST =
  /^(?:mødet|næste|sagen|punktet|opgaven|workshoppen|sessionen|møde|referat|beslutningen|emnet|rapporten|materialet|dokumentet|oplægget|han|hun|de|vi|de|man|den|det|he|she|they|we|one)\b/i;

/**
 * Check whether sourceText contains an explicit actor-verb binding.
 *
 * Rules:
 * 1. sourceText must contain an active action verb
 * 2. The actor label must appear before the verb in the text
 * 3. The actor must not be on the stoplist
 * 4. Passive constructions without an active verb → invalid
 * 5. Actor must be within 80 chars before the verb
 */
function hasExplicitActorVerbBinding(
  sourceText: string,
  actorLabel: string,
): boolean {
  if (!actorLabel || !sourceText) return false;

  const text = sourceText.trim();

  // Multi-actor: hvis actorLabel er et koordineret navnepar,
  // validér at præcis denne label efterfølges af direkte handlingsverbum i source text.
  if (/\s+(?:og|and|samt)\s+/.test(actorLabel)) {
    const boundPattern = new RegExp(
      `\\b${escapeRegex(actorLabel)}\\s+${DIRECT_ACTION_VERB_PATTERN.source}`,
      "i"
    );
    return boundPattern.test(text);
  }

  // If passive and no active verb present → reject
  if (PASSIVE_PATTERN.test(text) && !DIRECT_ACTION_VERB_PATTERN.test(text)) {
    return false;
  }

  // Reject stoplist actors
  if (ACTOR_STOPLIST.test(actorLabel.trim())) return false;

  // Find the actor in the text
  const actorIndex = text.toLowerCase().indexOf(actorLabel.toLowerCase());
  if (actorIndex === -1) return false;

  // Check 1: aktør + direkte handlingsverbum
  const directMatch = DIRECT_ACTION_VERB_PATTERN.exec(text);
  if (directMatch && actorIndex < directMatch.index && directMatch.index - actorIndex <= 80) {
    return true;
  }

  // Check 2: aktør + modal + direkte handlingsverbum
  const modalMatch = MODAL_VERB_PATTERN.exec(text);
  if (modalMatch && actorIndex < modalMatch.index && modalMatch.index - actorIndex <= 80) {
    const afterModal = text.slice(modalMatch.index + modalMatch[0].length);
    if (DIRECT_ACTION_VERB_PATTERN.test(afterModal)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate the responsible field of a single item.
 *
 * - kind === "unknown" → always null
 * - person / role / collective → only valid with explicit actor-verb binding
 * - Passive constructions without agent → null
 */
function validateResponsible(
  responsible: ResponsibleResult,
  sourceText: string,
): ResponsibleResult | null {
  if (responsible.kind === "unknown" || !responsible.label) {
    return null;
  }

  if (hasExplicitActorVerbBinding(sourceText, responsible.label)) {
    return responsible;
  }

  return null;
}

// ============================================================
// DATE VALIDATION
// ============================================================

// Explicit numeric date patterns (used for counting)
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const NUMERIC_DATE_PATTERN = /\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/g;

// Temporal binding markers — explicitly bind a date to an action or event
const TEMPORAL_BINDING_PATTERN =
  /\b(?:senest|inden|before|by|deadline|frist|afleveres?|afholdes|finder sted|takes place|scheduled|planlagt til|d\.|kl\.|på|until|no later than|due|lukker|lukkes|slutter|afsluttet|ophører|udløber)\b/i;

// Relative temporal markers — time reference without ISO date
const RELATIVE_TEMPORAL_PATTERN =
  /\b(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|næste uge|denne uge|next week|this week|i morgen|tomorrow|på fredag|on friday|i dag|today)\b/i;

/**
 * Count distinct date patterns in sourceText.
 * Avoids double-counting numeric dates that are part of an ISO date.
 */
function countDatesInText(text: string): number {
  const isoMatches = [...text.matchAll(ISO_DATE_PATTERN)];
  const numericMatches = [...text.matchAll(NUMERIC_DATE_PATTERN)];

  const uniqueNumeric = numericMatches.filter(m => {
    for (const iso of isoMatches) {
      if (
        m.index !== undefined &&
        iso.index !== undefined &&
        m.index >= iso.index &&
        m.index < iso.index + iso[0].length
      ) return false;
    }
    return true;
  });

  return isoMatches.length + uniqueNumeric.length;
}

/**
 * Determine the binding strength of a date in sourceText.
 *
 * Returns:
 * - "bound": iso date is explicitly bound → preserve as-is
 * - "hint":  relative temporal binding only → preserve dateHint, null iso
 * - "none":  no binding found → null both
 */
function checkDateBinding(
  sourceText: string,
  existingIso: string | null,
  existingHint: string | null,
): "bound" | "hint" | "none" {
  const text = sourceText.trim();

  const hasBindingMarker = TEMPORAL_BINDING_PATTERN.test(text);
  const hasRelativeMarker = RELATIVE_TEMPORAL_PATTERN.test(text);
  const dateCount = countDatesInText(text);

  // Multiple dates with no binding marker → ambiguous → none
  if (dateCount > 1 && !hasBindingMarker) {
    return "none";
  }

  // Single explicit date + binding marker → bound
  if (dateCount === 1 && hasBindingMarker && existingIso) {
    return "bound";
  }

  // Single explicit date + event verb (no constraint marker needed)
  if (dateCount === 1 && existingIso) {
    if (/\b(?:afholdes|finder sted|takes place|scheduled|planlagt)\b/i.test(text)) {
      return "bound";
    }
    return "none";
  }

  // No explicit iso date — check for relative temporal binding
  if (dateCount === 0 && (hasBindingMarker || hasRelativeMarker) && existingHint) {
    return "hint";
  }

  return "none";
}

/**
 * Validate the date field of a single item.
 */
function validateDate(
  date: DateResult,
  sourceText: string,
): DateResult {
  const binding = checkDateBinding(sourceText, date.iso, date.dateHint);

  switch (binding) {
    case "bound":
      return date;

    case "hint":
      return {
        iso: null,
        dateHint: date.dateHint,
        dateType: date.dateType,
        confidence: Math.min(date.confidence, 0.40),
      };

    case "none":
    default:
      return {
        iso: null,
        dateHint: null,
        dateType: "unknown",
        confidence: 0,
      };
  }
}

// ============================================================
// KIND VALIDATION
// ============================================================

/**
 * Validate the kind field of a single item.
 *
 * Rules:
 * - action:   requires explicit actor-verb binding in sourceText
 *             AND responsible must not be null after validation
 * - decision: requires explicit decision marker in sourceText
 * - context:  everything else
 *
 * This is degradation only — never upgrades a kind.
 */
function validateKind(
  kind: BaseKind,
  sourceText: string,
  validatedResponsible: ResponsibleResult | null,
): BaseKind {
  const text = sourceText.trim();

  switch (kind) {
    case "action": {
      const isVerbInitial = new RegExp(
        `^${DIRECT_ACTION_VERB_PATTERN.source}`,
        "i"
      ).test(text);

      const isPassiveObligation =
        PASSIVE_PATTERN.test(text) && DEADLINE_MARKER_PATTERN.test(text);

      const isClosingWithDate =
        /\blukker\b.{0,30}\b(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|\d)/i.test(text);

      const isModalPassiveObligation =
        /\b(?:underskrives|afsluttet|afleveret)\b/i.test(text) &&
        DEADLINE_MARKER_PATTERN.test(text);

      const isTemporalObligation =
        /\b(?:indsendes|underskrives|afleveres|afleveret|sendes ind|være afleveret|være klar)\b/i.test(text) &&
        DEADLINE_MARKER_PATTERN.test(text);

      if (!validatedResponsible?.label && !isVerbInitial && !isPassiveObligation && !isClosingWithDate && !isModalPassiveObligation && !isTemporalObligation) {
        return "context";
      }
      const hasDirectVerb = DIRECT_ACTION_VERB_PATTERN.test(text);
      const hasModal = MODAL_VERB_PATTERN.test(text);
      if (!hasDirectVerb) {
        if (!isTemporalObligation && !isClosingWithDate && !isModalPassiveObligation) {
          if (!hasModal) {
            return "context";
          }
          const modalIdx = (MODAL_VERB_PATTERN.exec(text)?.index) ?? -1;
          const afterModal = modalIdx >= 0 ? text.slice(modalIdx) : "";
          if (!DIRECT_ACTION_VERB_PATTERN.test(afterModal)) {
            return "context";
          }
        }
      }
      if (PASSIVE_NO_AGENT_PATTERN.test(text) && !isTemporalObligation && !isClosingWithDate) {
        return "context";
      }
      return "action";
    }

    case "decision": {
      if (!DECISION_MARKER_PATTERN.test(text)) return "context";
      return "decision";
    }

    case "deadline": {
      const hasDate = /\b\d{4}-\d{2}-\d{2}\b/.test(text) ||
        /\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/.test(text) ||
        /\b\d{1,2}\.\s*(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b/i.test(text);
      const hasMarker = DEADLINE_MARKER_PATTERN.test(text) || TEMPORAL_BINDING_PATTERN.test(text);
      if (!hasDate && !hasMarker) return "context";
      return "deadline";
    }

    case "context":
    default:
      return "context";
  }
}

// ============================================================
// TEMPORAL VALIDATION (v3.0)
//
// The classifier proposes temporal bindings. The validator
// independently checks whether sourceText contains sufficient
// evidence to justify each binding. Bindings without evidence
// are nulled — they do not survive to the grouper.
//
// This ensures that temporal bindings in the final Item are
// validated structure, not raw classifier assertions.
//
// Rules:
//   - deadline: requires explicit constraint marker in sourceText
//     (senest, inden, deadline, frist, before, by, due, etc.)
//   - scheduled: requires explicit event/scheduling marker
//     (afholdes, finder sted, takes place, scheduled, planlagt, etc.)
//   - temporal_range: requires explicit range language
//     (fra...til, from...to, perioden, etc.)
//   - Each slot is validated independently
//   - Null means "no evidence" — not "checked and rejected"
// ============================================================

// Deadline evidence: explicit constraint language in sourceText
const DEADLINE_EVIDENCE_PATTERN =
  /\b(?:senest|inden|before|by|deadline|frist|due|no later than|afleveres|afleveret|indsendes|underskrives|afsluttes|lukker|lukkes|slutter|afsluttet|ophører|udløber)\b/i;

// Scheduled evidence: explicit event/scheduling language
const SCHEDULED_EVIDENCE_PATTERN =
  /\b(?:afholdes|finder sted|takes place|is held|scheduled|planlagt|møde|meeting|workshop|session|indkalder)\b/i;

// Temporal range evidence: explicit range/period language
const RANGE_EVIDENCE_PATTERN =
  /(?:\bfra\b.{0,40}\btil\b|\bfrom\b.{0,40}\bto\b|\bperioden\b|\bperiod\b|\bvarighed\b|\bduration\b|\bløber fra\b|\bdækker perioden\b)/i;

/**
 * Validate the temporal binding of a single item.
 *
 * Each slot (deadline, scheduled, temporal_range) is checked
 * independently against sourceText. Bindings without textual
 * evidence are nulled.
 *
 * Returns a new TemporalBinding — never mutates the input.
 */
function validateTemporal(
  temporal: TemporalBinding,
  sourceText: string,
): TemporalBinding {
  const text = sourceText.trim();

  // Validate deadline
  const deadline: DeadlineModifier | null =
    temporal.deadline !== null && DEADLINE_EVIDENCE_PATTERN.test(text)
      ? temporal.deadline
      : null;

  // Validate scheduled
  const scheduled: ScheduledModifier | null =
    temporal.scheduled !== null && SCHEDULED_EVIDENCE_PATTERN.test(text)
      ? temporal.scheduled
      : null;

  // Validate temporal_range
  // Note: temporal_range binding is currently always null from the
  // classifier (Led 2). This validation is ready for when the
  // extractor populates it in a future update.
  const temporal_range: TemporalRangeModifier | null =
    temporal.temporal_range !== null && RANGE_EVIDENCE_PATTERN.test(text)
      ? temporal.temporal_range
      : null;

  return { deadline, scheduled, temporal_range };
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Validate a single item.
 *
 * Enforces: responsible, date, kind, temporal.
 * Returns a new item — never mutates the input.
 */
export function validateItem(item: Item): Item {
  const validatedResponsible = validateResponsible(
    item.responsible,
    item.sourceText,
  );

  const validatedDate = validateDate(item.date, item.sourceText);

  const validatedKind = validateKind(
    item.kind,
    item.sourceText,
    validatedResponsible,
  );

  const validatedTemporal = validateTemporal(
    item.temporal,
    item.sourceText,
  );

  return {
    ...item,
    responsible: validatedResponsible ?? {
      kind: "unknown",
      label: null,
      confidence: 0,
    },
    date: validatedDate,
    kind: validatedKind,
    temporal: validatedTemporal,
  };
}

/**
 * Validate an array of items.
 *
 * Applies validateItem to each. Order is preserved.
 * Items are never removed — only fields are nulled or degraded.
 *
 * Usage:
 *   const validated = validateItems(extracted);
 *   const { containers, orphanItems } = group(validated, options);
 */
export function validateItems(items: Item[]): Item[] {
  return items.map(validateItem);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
