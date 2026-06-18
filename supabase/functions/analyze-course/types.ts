// ============================================================
// Document Workflow Engine — types.ts
// Version: 3.0.0
//
// Shared type contract across pipeline, grouper, extractor,
// classifier, validator, AI adapter, and review layer.
//
// v3.0 changes:
//   - ScoreVector replaced by KindScores + TemporalScores
//   - Classifier output is now explicitly two-dimensional:
//     identity (what kind of statement) vs. temporal (how it
//     is time-bound)
//   - DisplayState added as shared derived type for review/export
//   - deadline is NOT a BaseKind — it is a temporal binding
// ============================================================

export type Confidence = number;

// ============================================================
// IDENTITY LAYER
// What kind of statement is this?
// ============================================================

// BaseKind: the four possible identity categories for a
// workflow item. These describe what the statement IS.
//
// "deadline" is promoted post-scoring via a promotion rule in
// the classifier — KindScores remains 3-way (action/decision/context)
// and deadline is not part of that competition.
export type BaseKind =
  | "action"
  | "decision"
  | "deadline"
  | "context";

// KindScores: classifier output for identity signals.
// Three dimensions only — these compete for kind selection.
export interface KindScores {
  action: number;
  decision: number;
  context: number;
}

// ============================================================
// TEMPORAL LAYER
// How is this statement time-bound?
// ============================================================

// TemporalScores: classifier output for temporal signals.
// These do NOT compete with kind selection — they describe
// a separate axis of meaning.
export interface TemporalScores {
  deadline: number;
  scheduled: number;
  temporal_range: number;
}

// TemporalBinding: validated temporal structure on an Item.
// Produced by the pipeline after classifier → extractor →
// validator. All three slots are explicitly null when not
// detected. This contract is closed.
export interface DeadlineModifier {
  iso: string | null;
  dateHint: string | null;
  confidence: Confidence;
}

export interface ScheduledModifier {
  iso: string | null;
  dateHint: string | null;
  confidence: Confidence;
}

export interface TemporalRangeModifier {
  fromIso: string | null;
  toIso: string | null;
  dateHint: string | null;
  confidence: Confidence;
}

export interface TemporalBinding {
  deadline: DeadlineModifier | null;
  scheduled: ScheduledModifier | null;
  temporal_range: TemporalRangeModifier | null;
}

// ============================================================
// EXTRACTION TYPES
// Structured fields extracted from a classified segment.
// ============================================================

export type DateType =
  | "meeting"
  | "deadline"
  | "scheduled"
  | "unknown";

export interface DateResult {
  iso: string | null;
  dateHint: string | null;
  dateType: DateType;
  confidence: Confidence;
}

export type ResponsibleKind =
  | "person"
  | "role"
  | "collective"
  | "unknown";

export interface ResponsibleResult {
  kind: ResponsibleKind;
  label: string | null;
  confidence: Confidence;
}

// ============================================================
// ITEM — the core data unit
// ============================================================

export interface ItemContext {
  sectionTitle: string | null;
}

// Deprecated — migration alias only. Removed after Led 3.
// DO NOT use in new code.
/** @deprecated Use KindScores + TemporalScores instead */
export interface ScoreVector {
  action: number;
  deadline: number;
  decision: number;
  context: number;
}

// Item: a single workflow-relevant unit extracted from a
// document. Carries both identity and temporal information.
//
// Migration note (v3.0):
//   During migration, `scores` (deprecated ScoreVector) may
//   still be present alongside `kindScores`/`temporalScores`.
//   `kindScores` and `temporalScores` are optional until all
//   pipeline modules are migrated. Once Led 2+3 are complete,
//   `scores` will be removed and the new fields made required.
export interface Item {
  kind: BaseKind;
  temporal: TemporalBinding;
  confidence: Confidence;
  date: DateResult;
  responsible: ResponsibleResult;
  text: string;
  sourceText: string;
  context?: ItemContext;

  // v3.0 fields — optional during migration, required after Led 3
  kindScores?: KindScores;
  temporalScores?: TemporalScores;

  // Deprecated — present during migration only. Removed after Led 3.
  /** @deprecated Use kindScores + temporalScores instead */
  scores?: ScoreVector;
}

// ============================================================
// DISPLAY STATE — derived presentation layer
// ============================================================

// DisplayState: an explicitly derived presentation category
// computed from kind + temporal. This is NOT a data model
// type — it is a shared contract for review and export layers.
//
// Computed by deriveDisplayState() in the review layer.
// Never produced by the pipeline itself.
//
// Priority order (first match wins):
//   1. urgent    — temporal.deadline is present
//   2. planned   — temporal.scheduled is present
//   3. windowed  — temporal.temporal_range is present
//   4. decision  — kind === "decision"
//   5. action    — kind === "action"
//   6. note      — everything else (context without temporal)
export type DisplayState =
  | "urgent"
  | "planned"
  | "windowed"
  | "decision"
  | "action"
  | "note";

// Shared function signature for display-state derivation.
// Implemented in display-state.ts (backend) and display-state.js
// (frontend). Both implementations must follow the same priority
// order defined in the DisplayState documentation above.
export type DeriveDisplayState = (item: Item) => DisplayState;

// ============================================================
// STRUCTURAL GROUPING
// ============================================================

export type AnchorKind =
  | "date"
  | "numbered_section"
  | "heading";

export interface Anchor {
  kind: AnchorKind;
  raw: string;
  isoDate: string | null;
}

export type ContainerKind =
  | "session"
  | "section"
  | "block";

export interface Container {
  id: string;
  kind: ContainerKind;
  label: string | null;
  confidence: Confidence;
  primaryAnchor: Anchor;
  secondaryAnchors: Anchor[];
  items: Item[];
  children: Container[];
}

// ============================================================
// DOCUMENT — top-level output
// ============================================================

export interface Document {
  title: string;
  source: string;
  parsedAt: string;
  confidence: Confidence;
  containers: Container[];
  orphanItems: Item[];
}

export interface ParseMeta {
  segmentCount: number;
  parsedCount: number;
  containerCount: number;
  orphanCount: number;
  aiAssistedCount: number;
  durationMs: number;
}

export interface ParseResult {
  document: Document;
  meta: ParseMeta;
}

// ============================================================
// AI ADAPTER CONTRACT
// ============================================================

// AiAdapterInput: data sent to the AI provider for fallback
// classification.
//
// Design decision: only kindScores are sent, not temporalScores.
// The AI adapter's role is identity interpretation — determining
// whether a segment is an action, decision, or context. Temporal
// classification (deadline, scheduled, temporal_range) remains
// the pipeline's responsibility and is never delegated to AI.
export interface AiAdapterInput {
  segment: string;
  kindScores: KindScores;
  documentTitle: string;
}

export interface AiAdapterItem {
  kind: BaseKind;
  confidence: Confidence;
  date: DateResult;
  responsible: ResponsibleResult;
  text: string;
}

export interface AiAdapterOutput {
  item: AiAdapterItem;
  confidence: Confidence;
}

export type AiAdapter = (
  input: AiAdapterInput
) => Promise<AiAdapterOutput>;

export interface ConsentRecord {
  segmentHash: string;
  approvedAt: string;
  provider: string;
  userInitiated: boolean;
}
