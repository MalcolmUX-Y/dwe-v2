// ============================================================
// Document Workflow Engine — classifier.ts
// Version: 3.0.0
//
// Classifies a segment along two independent axes:
//
//   1. Identity (KindScores): what kind of statement is this?
//      action | decision | context
//
//   2. Temporal (TemporalScores): how is it time-bound?
//      deadline | scheduled | temporal_range
//
// These two axes do not compete. A segment can be both an
// action and have a deadline binding. The identity axis
// determines kind; the temporal axis determines time-binding.
//
// Input:  a plain text segment
// Output: ClassificationResult with both axes + confidence
// ============================================================

import type {
  BaseKind,
  KindScores,
  TemporalScores,
  ScoreVector,
  Confidence,
  TemporalBinding,
  DeadlineModifier,
  ScheduledModifier,
} from "./types.ts";

import { DIRECT_ACTION_VERB_PATTERN, MODAL_VERB_PATTERN } from "./patterns.ts";

// ------------------------------------------------------------
// Output type for this module
// ------------------------------------------------------------

export interface ClassificationResult {
  kind: BaseKind;
  temporal: TemporalBinding;
  kindScores: KindScores;
  temporalScores: TemporalScores;
  confidence: Confidence;

  // TODO(led-3): Remove this field and the ScoreVector type entirely.
  // Migration path:
  //   1. grep for `\.scores\.` across the codebase — these are all callers
  //   2. Replace each with the appropriate kindScores.action / kindScores.decision / etc.
  //   3. Remove `scores` from this interface, from Item in types.ts, and from
  //      all construction sites in classifier.ts and pipeline.ts
  //   4. Delete ScoreVector from types.ts
  //
  // The grouper already uses migration-safe helpers (getActionScore/getDecisionScore)
  // that read kindScores with fallback to scores — those helpers can be simplified
  // to direct kindScores access once this field is gone.
  /** @deprecated Use kindScores + temporalScores instead */
  scores: ScoreVector;
}

// ------------------------------------------------------------
// Signal detectors — IDENTITY AXIS
// Each returns a number 0–1. They are pure functions.
// They detect patterns — not words.
// ------------------------------------------------------------

/**
 * ACTION signal
 *
 * Looks for imperative or forward-pointing structure:
 * - A verb that points toward a future task
 * - An agent followed by an obligation marker
 * - A short directive line
 */
function detectActionSignal(text: string): number {
  let score = 0;
  const t = text.trim();

  // Neutral descriptive phrases should not count as actions
  if (/\b(forventes at|vil vare|er planlagt til)\b/i.test(t)) {
    return 0;
  }

  // Temporal range descriptions — not actions
  // "løber fra ... til", "dækker perioden ... til/fra"
  if (/\bløber fra\b.{0,40}\btil\b/i.test(t)) {
    return 0;
  }
  if (/\bdækker perioden\b/i.test(t) && /\b(til|fra|–|-)\b/.test(t)) {
    return 0;
  }

  const words = t.split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";

  // Obligation markers: modal verbs and obligation nouns
  // Language-agnostic: we look for short function words before a verb
  // Modal + direkte handlingsverbum → action-signal
  // Modal alene (passiv obligation) → lavt signal
  if (MODAL_VERB_PATTERN.test(t)) {
    const isPassiveObligation =
      /\bskal\b.{0,15}\b(?:være|være blevet)\b.{0,15}\b\w+et\b/i.test(t) ||
      /\bskal\b.{0,15}\b(?:sendes|fremsendes|afleveres|indsendes|underskrives|afsluttes|godkendes|udarbejdes|revideres|afholdes)\b/i.test(t);
    const afterModal = t.slice((MODAL_VERB_PATTERN.exec(t)?.index ?? 0));
    const hasDirectVerbAfterModal = DIRECT_ACTION_VERB_PATTERN.test(afterModal);
    score += isPassiveObligation ? 0.10 : hasDirectVerbAfterModal ? 0.45 : 0.0;
  }

  // Direkte handlingsverbum uden modal → stærkt action-signal
  if (DIRECT_ACTION_VERB_PATTERN.test(t)) {
    score += 0.40;
  }

  // Active named agent + active event verb:
  // "Anna afholder møde", "Peter arrangerer workshop"
  if (
    /\b[A-ZÆØÅ][a-zæøå]{1,20}(?:\s+[A-ZÆØÅ][a-zæøå]{1,20})?\s+(?:afholder|arrangerer)\b/.test(t)
  ) {
    score += 0.34;
  }

  // "Peter indkalder til møde"
  if (
    /\b[A-ZÆØÅ][a-zæøå]{1,20}(?:\s+[A-ZÆØÅ][a-zæøå]{1,20})?\s+indkalder(?:\s+til)\b/.test(t)
  ) {
    score += 0.38;
  }

  // Short directive / imperative-like line:
  // "Kontakt leverandør", "Opdater risikolog"
  // Kræver eksplicit direkte handlingsverbum i sætningen.
  // Substantiver i startposition uden handlingsverbum tæller ikke.
  if (
    words.length >= 2 &&
    words.length <= 6 &&
    /^[A-ZÆØÅ][a-zæøå]{3,20}$/.test(first) &&
    !/[:.]$/.test(first) &&
    !/^(?:deadline|frist|dato|date|ansvarlig|responsible|beslutning|decision|baggrund|context)$/i.test(first) &&
    DIRECT_ACTION_VERB_PATTERN.test(t)
  ) {
    score += 0.32;
  }

  // Verb-initial imperativ for længere sætninger:
  // "Gennemgå åbne punkter fra Q3 og luk dem der er løst"
  // Kræver: DIRECT_ACTION_VERB_PATTERN matcher fra position 0 i teksten.
  // Aktiveres kun når sætningen er for lang til short-directive-reglen (> 6 ord).
  if (
    words.length > 6 &&
    new RegExp(`^${DIRECT_ACTION_VERB_PATTERN.source}`, "i").test(t)
  ) {
    score += 0.32;
  }

  // Passive workflow phrasing — svagt signal, ikke tilstrækkeligt alene.
  // Passive former indikerer krav eller deadline, ikke eksplicit handling.
  if (
    /\b(?:sendes|fremsendes|opdateres|udarbejdes|leveres|indsendes|godkendes|revideres)\b/i.test(t)
  ) {
    score += 0.08;
  }

  // Follow-up markers: "følg op", "follow up", "check", "ensure"
  if (/\b(?:follow.?up|ensure|check|verify|confirm|følg op|sørg for|sikr)\b/i.test(t)) {
    score += 0.30;
  }

  // Penalise if clearly passive, past tense, or status/reporting language
  if (
    /\b(?:was|were|has been|have been|blev|er blevet|var|orienterede|orienterede om|oplyste|nævnte|bemærkede|rapporterede|drøftede)\b/i.test(t)
  ) {
    score -= 0.35;
  }

  return clamp(score);
}

/**
 * DECISION signal
 *
 * Looks for past-tense resolution or recorded agreement:
 * - Passive constructions indicating something was settled
 * - Agreement or resolution language
 * - Named parties reaching a conclusion
 */
function detectDecisionSignal(text: string): number {
  let score = 0;
  const t = text.trim();

  // Passive past: "it was decided", "det blev besluttet"
  if (/\b(?:was decided|were agreed|has been agreed|it was|det blev|er besluttet|er aftalt|blev vedtaget|blev valgt|blev afvist|blev godkendt|blev forkastet)\b/i.test(t)) {
    score += 0.55;
  }

  // Agreement markers
  if (/\b(?:agreed|decided|resolved|concluded|approved|aftalt|besluttet|vedtaget|godkendt|valgte|valgt|afviste|afvist|godkendte|fastholder|fastholdt|forkastede|forkastet|vedtog|besluttede|afgjorde|afgjort)\b/i.test(t)) {
    score += 0.35;
  }

  // Resolution language: "the decision", "in conclusion"
  if (/\b(?:decision|resolution|conclusion|outcome|the board|bestyrelsen|udvalget|gruppen besluttede)\b/i.test(t)) {
    score += 0.20;
  }

  // Penalise if forward-pointing (decisions are recorded, not future)
  if (detectActionSignal(t) > 0.5) score -= 0.25;

  return clamp(score);
}

/**
 * CONTEXT signal
 *
 * Looks for descriptive, background, or informational text:
 * - No agent, no obligation, no date
 * - Explanatory or definitional tone
 * - Long flowing sentences
 */
function detectContextSignal(text: string): number {
  let score = 0;
  const t = text.trim();

  // Long sentence with no clear agent or obligation
  const words = t.split(/\s+/).length;
  if (words > 30) score += 0.20;
  if (words > 60) score += 0.15;

  // Explanatory connectives
  if (/\b(?:because|therefore|however|although|furthermore|consequently|hence|thus|da|fordi|derfor|dog|selvom|endvidere)\b/i.test(t)) {
    score += 0.25;
  }

  // Definitional language
  if (/\b(?:refers? to|is defined as|means|consists? of|comprises?|handler om|er defineret som|betyder|består af)\b/i.test(t)) {
    score += 0.30;
  }

  // Background/intro markers
  if (/\b(?:background|overview|introduction|context|purpose|scope|baggrund|formål|introduktion|oversigt)\b/i.test(t)) {
    score += 0.30;
  }

  // Status / reporting language:
  // "Bo orienterede om fremdriften", "leverancen er forsinket"
  if (
    /\b(?:orienterede|orienterede om|oplyste|nævnte|bemærkede|rapporterede|drøftede|status|fremdrift|forsinket|forsinkelse|udfordring|problem|risiko)\b/i.test(t)
  ) {
    score += 0.45;
  }

  // Copula/status constructions
  if (
    /\b(?:er|var|blev)\b.{0,25}\b(?:forsinket|afklaret|uklar|uafklaret|påbegyndt|afsluttet|igangværende)\b/i.test(t)
  ) {
    score += 0.35;
  }

  // Penalise if identity-axis competitors are strong.
  // Only action and decision suppress context — temporal signals
  // (deadline, scheduled, range) do not affect identity scoring.
  const actionS = detectActionSignal(t);
  const decisionS = detectDecisionSignal(t);
  const strongest = Math.max(actionS, decisionS);

  if (strongest > 0.4) score -= strongest * 0.5;

  return clamp(score);
}

// ------------------------------------------------------------
// Signal detectors — TEMPORAL AXIS
// These produce TemporalScores. They do NOT affect kind selection.
// ------------------------------------------------------------

/**
 * DEADLINE signal
 *
 * Looks for temporal urgency combined with a constraint:
 * - Explicit date pattern
 * - Relative time expression pointing forward
 * - Cutoff or limit language
 */
function detectDeadlineSignal(text: string): number {
  let score = 0;
  const t = text.trim();

  const hasDate =
    /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
    /\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/.test(t) ||
    /\b\d{1,2}\.\s*(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b/i.test(t);

  const hasFristVerb =
    /\b(?:afleveres?|afleveret|indsendes|indsendt|underskrives|underskrevet|afsluttes|afsluttet|fremsendes|sendes|godkendes)\b/i.test(t);
  const hasWeekday =
    /\b(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t);
  const hasConstraint =
    /\b(?:by|before|until|no later than|deadline|due|senest|frist|afleveres?|indsend)\b/i.test(t) ||
    (/\b(?:inden)\b/i.test(t) && (hasDate || hasFristVerb || hasWeekday)) ||
    /\binden udgangen af\b/i.test(t);

  const isLabelStyleDeadline =
    /^(?:deadline|frist|due date|aflevering|afleveringsfrist|submission date|dato)\s*:/i.test(t);

  // Explicit date pattern (language-agnostic number formats)
  if (hasDate) score += 0.40;

  // Label-style deadline lines:
  // "Deadline: 17.03.2026", "Frist: fredag"
  if (isLabelStyleDeadline) score += 0.38;

  // Named day or month reference
  if (/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\b/i.test(t)) {
    score += 0.25;
  }

  // Cutoff / limit language
  if (hasConstraint) {
    score += 0.40;
  }

  // Obligation + passive verb + deadline constraint:
  // "skal afholdes inden", "skal afleveres senest"
  if (
    /\b(?:skal|must|should)\b.{0,20}\b(?:afholdes|afleveres|afleveret|indsendes|fremsendes|godkendes|udarbejdes|underskrives|afsluttes|sendes|lukker|være færdig|være klar)\b/i.test(t)
  ) {
    score += 0.25;
  }

  // Relative forward-pointing time
  if (/\b(?:next|this|coming|næste|kommende|i denne uge|i næste uge)\b/i.test(t)) {
    score += 0.20;
  }

  // A date alone is not enough — it needs a constraint marker
  // But label-style deadline lines should not be penalised
  if (hasDate && !hasConstraint && !isLabelStyleDeadline) {
    score -= 0.15;
  }

  // Slight extra boost for explicit label + date
  if (isLabelStyleDeadline && hasDate) {
    score += 0.15;
  }

  // Closure verbs: explicitly bind a date to a closing event
  if (/\b(?:lukker|lukkes|slutter|udløber|ophører)\b/i.test(t)) {
    score += 0.35;
  }

  return clamp(score);
}

/**
 * MEETING / SCHEDULED signal
 *
 * Looks for event-scheduling language:
 * - Meeting/workshop/session keywords
 * - Event verbs (afholdes, finder sted, takes place)
 * - Event keyword + date pattern
 */
function detectMeetingSignal(text: string): number {
  let score = 0;
  const t = text.trim();

  if (/\b(?:møde|meeting|workshop|session|agenda|dagsorden|mødeplan)\b/i.test(t)) {
    score += 0.45;
  }

  if (/\b(?:afholdes|indkalder|starter|finder sted|takes place|is held)\b/i.test(t)) {
    score += 0.30;
  }

  if (
    /\b(?:møde|meeting|workshop|session)\b/i.test(t) &&
    /\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/.test(t)
  ) {
    score += 0.20;
  }

  return clamp(score);
}

/**
 * TEMPORAL RANGE signal
 *
 * Looks for explicit period/range language:
 * - "from X to Y" / "fra X til Y"
 * - "perioden" / "period"
 * - Duration markers
 */
function detectTemporalRangeSignal(text: string): number {
  let score = 0;
  const t = text.trim();

  // Explicit range: "fra ... til", "from ... to"
  if (/\bfra\b.{0,40}\btil\b/i.test(t)) {
    score += 0.50;
  }
  if (/\bfrom\b.{0,40}\bto\b/i.test(t)) {
    score += 0.50;
  }

  // Period language
  if (/\b(?:perioden|period|varighed|duration)\b/i.test(t)) {
    score += 0.35;
  }

  // Range with two dates
  const dateMatches = t.match(/\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/g);
  if (dateMatches && dateMatches.length >= 2) {
    score += 0.30;
  }

  // "løber fra", "dækker perioden"
  if (/\b(?:løber fra|dækker perioden|runs from|covers the period)\b/i.test(t)) {
    score += 0.40;
  }

  return clamp(score);
}

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ------------------------------------------------------------
// Normalisation — IDENTITY AXIS ONLY
//
// Only three dimensions: action, decision, context.
// Deadline is NOT part of kind normalisation — it lives on
// the temporal axis.
// ------------------------------------------------------------

function normaliseKindScores(raw: KindScores): KindScores {
  const sum = raw.action + raw.decision + raw.context;
  if (sum === 0) {
    return { action: 1 / 3, decision: 1 / 3, context: 1 / 3 };
  }
  return {
    action: raw.action / sum,
    decision: raw.decision / sum,
    context: raw.context / sum,
  };
}

function winningKind(scores: KindScores): BaseKind {
  const entries: [BaseKind, number][] = [
    ["action", scores.action],
    ["decision", scores.decision],
    ["context", scores.context],
  ];
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/**
 * Confidence: how decisive is the winner?
 * High margin between winner and runner-up = high confidence.
 * Near-tie between two kinds = low confidence.
 *
 * Now uses KindScores (three dimensions that sum to 1.0).
 */
function computeConfidence(scores: KindScores): Confidence {
  const values = [scores.action, scores.decision, scores.context]
    .sort((a, b) => b - a);

  const winner = values[0];
  const runnerUp = values[1];
  const margin = winner - runnerUp;

  // Scale: margin of 0.5+ = very confident, margin of 0 = uncertain
  const base = clamp(margin * 2);

  // Boost confidence if the winner score itself is high
  const absoluteBoost = clamp((winner - 0.4) * 0.5);

  return clamp(base + absoluteBoost);
}

// ------------------------------------------------------------
// Main export
// ------------------------------------------------------------

/**
 * Classify a single text segment.
 *
 * Returns two independent score axes:
 *   - kindScores:     identity classification (action/decision/context)
 *   - temporalScores: temporal binding signals (deadline/scheduled/range)
 *
 * Plus the winning kind, temporal binding, and confidence.
 *
 * This function is pure — no side effects, no I/O.
 * Safe to call in a tight loop over thousands of segments.
 */
export function classifySegment(text: string): ClassificationResult {
  const emptyTemporal: TemporalBinding = {
    deadline: null,
    scheduled: null,
    temporal_range: null,
  };

  if (!text.trim()) {
    return {
      kind: "context",
      temporal: emptyTemporal,
      kindScores: { action: 0, decision: 0, context: 1 },
      temporalScores: { deadline: 0, scheduled: 0, temporal_range: 0 },
      confidence: 0,
      // Deprecated — migration compatibility
      scores: { action: 0, deadline: 0, decision: 0, context: 1 },
    };
  }

  const t = text.trim();

  // ----------------------------------------------------------
  // Early exits for clearly non-workflow text
  // ----------------------------------------------------------

  // Descriptive meeting notes should always be context
  if (/\b(forventes at|vil vare|er planlagt til)\b/i.test(t)) {
    // Still detect temporal signals even for context early-exits
    const deadlineRaw = detectDeadlineSignal(t);
    const meetingRaw = detectMeetingSignal(t);
    const rangeRaw = detectTemporalRangeSignal(t);
    const tScores: TemporalScores = {
      deadline: deadlineRaw,
      scheduled: meetingRaw,
      temporal_range: rangeRaw,
    };
    return {
      kind: "context",
      temporal: buildTemporalBinding(deadlineRaw, meetingRaw),
      kindScores: { action: 0, decision: 0, context: 1 },
      temporalScores: tScores,
      confidence: 0.9,
      scores: { action: 0, deadline: deadlineRaw, decision: 0, context: 1 },
    };
  }

  const hasEventSubject = /\b(?:møde|meeting|workshop|session)\b/i.test(t);
  const hasEventVerb = /\b(?:afholdes|finder sted|takes place|is held|planlagt til|scheduled)\b/i.test(t);
  const hasDateSignal = /\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/.test(t);
  const hasConstraint = /\b(?:by|before|until|no later than|deadline|due|senest|inden|frist|afleveres?|afleveret|indsend|indsendes|underskrives|underskrevet|afsluttes|afsluttet|sendes|fremsendes|lukker|færdig)\b/i.test(t);
  const hasObligation = /\b(?:shall|must|will|should|needs? to|has to|sørger for|skal|bør|har ansvar)\b/i.test(t);
  const hasNamedActor = /\b[A-ZÆØÅ][a-zæøå]{2,20}(?:\s+[A-ZÆØÅ][a-zæøå]{2,20})?\s+afholder\b/i.test(t);

  if (hasEventSubject && hasEventVerb && hasDateSignal && !hasConstraint && !hasObligation && !hasNamedActor) {
    const deadlineRaw = detectDeadlineSignal(t);
    const meetingRaw = detectMeetingSignal(t);
    const rangeRaw = detectTemporalRangeSignal(t);
    const tScores: TemporalScores = {
      deadline: deadlineRaw,
      scheduled: meetingRaw,
      temporal_range: rangeRaw,
    };
    return {
      kind: "context",
      temporal: buildTemporalBinding(deadlineRaw, meetingRaw),
      kindScores: { action: 0, decision: 0, context: 1 },
      temporalScores: tScores,
      confidence: 0.88,
      scores: { action: 0, deadline: deadlineRaw, decision: 0, context: 1 },
    };
  }

  // Short standalone heading detection
  if (
    /^(?:næste\s+møde|next\s+meeting|møde|meeting|status|referat|opsamling)\b$/i.test(t)
  ) {
    return {
      kind: "context",
      temporal: emptyTemporal,
      kindScores: { action: 0, decision: 0, context: 1 },
      temporalScores: { deadline: 0, scheduled: 0, temporal_range: 0 },
      confidence: 0.88,
      scores: { action: 0, deadline: 0, decision: 0, context: 1 },
    };
  }

  // Numbered section heading
  if (/^\d+\.\s+[A-ZÆØÅa-zæøå].{0,40}$/.test(t)) {
    return {
      kind: "context",
      temporal: emptyTemporal,
      kindScores: { action: 0, decision: 0, context: 1 },
      temporalScores: { deadline: 0, scheduled: 0, temporal_range: 0 },
      confidence: 0.9,
      scores: { action: 0, deadline: 0, decision: 0, context: 1 },
    };
  }

  // ----------------------------------------------------------
  // Full classification: compute both axes
  // ----------------------------------------------------------

  // Step 1: Compute raw signals (each detector runs once)
  const actionRaw = detectActionSignal(text);
  const decisionRaw = detectDecisionSignal(text);
  const contextRaw = detectContextSignal(text);
  const deadlineRaw = detectDeadlineSignal(text);
  const meetingRaw = detectMeetingSignal(text);
  const rangeRaw = detectTemporalRangeSignal(text);

  // Step 2: Build raw kind scores
  // Meeting signal adjusts kind scores (meetings are context, not actions)
  // but does NOT affect temporal scores — the two axes are independent.
  let rawAction = actionRaw;
  let rawContext = contextRaw;

  const hasDeadlineConstraint =
    /\b(?:by|before|until|no later than|deadline|due|senest|inden|frist|afleveres?|indsend)\b/i.test(text);

  const hasNamedActorEvent =
    /\b[A-ZÆØÅ][a-zæøå]{1,20}(?:\s+[A-ZÆØÅ][a-zæøå]{1,20})?\s+(?:afholder|arrangerer)\b/.test(t) ||
    /\b[A-ZÆØÅ][a-zæøå]{1,20}(?:\s+[A-ZÆØÅ][a-zæøå]{1,20})?\s+indkalder\s+til\b/.test(t);

  if (meetingRaw > 0 && !hasDeadlineConstraint) {
    if (!hasNamedActorEvent) {
      rawAction = Math.max(0, rawAction - meetingRaw * 0.35);
    }
    rawContext = Math.min(1, rawContext + meetingRaw * 0.50);
  }

  const rawKind: KindScores = {
    action: rawAction,
    decision: decisionRaw,
    context: rawContext,
  };

  // Step 3: Normalise kind scores (three dimensions only)
  const kindScores = normaliseKindScores(rawKind);

  // Step 4: Determine winning kind
  let kind = winningKind(kindScores);

  // Workflow-strength guard: if no identity signal is strong, force context
  const workflowStrength = kindScores.action + kindScores.decision;

  const kindValues = [kindScores.action, kindScores.decision, kindScores.context]
    .sort((a, b) => b - a);
  const margin = kindValues[0] - kindValues[1];

  if (workflowStrength < 0.35) {
    kind = "context";
  } else if (margin < 0.15 && kind !== "context") {
    // Near-uniform scores: check if it's truly uniform or competitive
    const isEffectivelyUniform =
      Math.abs(kindScores.action - kindScores.decision) < 0.01 &&
      Math.abs(kindScores.action - kindScores.context) < 0.01;
    if (isEffectivelyUniform) {
      kind = "context";
    } else {
      // Close but not uniform: check if runner-up is a workflow-kind
      const runnerUpKind = winningKind({
        action: kind === "action" ? 0 : kindScores.action,
        decision: kind === "decision" ? 0 : kindScores.decision,
        context: kindScores.context,
      });
      if (runnerUpKind === "context") {
        kind = "context";
      }
    }
  }

  // Step 4b: Promote to deadline when temporal signal is strong and action signal is weak.
  // Confidence for promoted items uses deadlineRaw directly — not identity competition.
  let overrideConfidence: number | null = null;
  if (deadlineRaw >= 0.4 && actionRaw < 0.3 && kind !== "decision") {
    kind = "deadline";
    overrideConfidence = deadlineRaw;
  }

  // Step 5: Compute confidence from kind scores
  const confidence = overrideConfidence ?? computeConfidence(kindScores);

  // Step 6: Build temporal scores and binding
  const temporalScores: TemporalScores = {
    deadline: deadlineRaw,
    scheduled: meetingRaw,
    temporal_range: rangeRaw,
  };

  const temporal = buildTemporalBinding(deadlineRaw, meetingRaw);

  // Step 7: Build deprecated ScoreVector for migration compatibility
  const scores: ScoreVector = {
    action: kindScores.action,
    deadline: deadlineRaw,
    decision: kindScores.decision,
    context: kindScores.context,
  };

  return { kind, temporal, kindScores, temporalScores, confidence, scores };
}

// ------------------------------------------------------------
// Temporal binding builder
// Converts raw temporal scores into structured TemporalBinding.
// Thresholds determine when a signal is strong enough to
// become a binding.
// ------------------------------------------------------------

function buildTemporalBinding(
  deadlineSignal: number,
  meetingSignal: number,
): TemporalBinding {
  const deadlineModifier: DeadlineModifier | null =
    deadlineSignal >= 0.40
      ? { iso: null, dateHint: null, confidence: deadlineSignal }
      : null;

  const scheduledModifier: ScheduledModifier | null =
    meetingSignal >= 0.45
      ? { iso: null, dateHint: null, confidence: meetingSignal }
      : null;

  return {
    deadline: deadlineModifier,
    scheduled: scheduledModifier,
    // temporal_range: scoring exists in temporalScores from Led 2,
    // but structured binding (TemporalRangeModifier) is first
    // populated by the extractor/validator in Led 3, because it
    // requires date extraction to resolve fromIso/toIso.
    temporal_range: null,
  };
}

// ------------------------------------------------------------
// Batch classification
// ------------------------------------------------------------

/**
 * Classify an array of segments in one call.
 * Preserves order. Each result maps 1:1 to its input segment.
 */
export function classifyAll(
  segments: string[]
): ClassificationResult[] {
  return segments.map(classifySegment);
}
