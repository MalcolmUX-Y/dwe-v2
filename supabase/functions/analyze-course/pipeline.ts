// ============================================================
// Document Workflow Engine — pipeline.ts
// Version: 3.0.0
//
// The single entry point for the entire parse process.
// Orchestrates: segmentation → classification → extraction
// → validation → grouping, and optionally AI fallback for
// low-confidence segments.
//
// v3.0 changes:
//   - Propagates kindScores + temporalScores from classifier
//   - Sets temporal binding on every Item
//   - Sends kindScores (not ScoreVector) to extractor
//   - Maintains deprecated scores field during migration
//
// Input:  raw text + options
// Output: ParseResult (Document + pipeline metadata)
//
// Nothing in this file does parsing itself — it delegates
// entirely to the modules below and assembles the result.
// ============================================================

import type {
  Document,
  Item,
  ParseResult,
  AiAdapter,
  KindScores,
  TemporalBinding,
} from "./types.ts";

import {
  segmentPlainText,
  segmentPdfFragments,
  type Segment,
  type TextFragment,
} from "./segmenter.ts";

import { classifySegment } from "./classifier.ts";
import { extractAll } from "./extractor.ts";
import { nullAdapter } from "./ai-adapter.ts";
import { group } from "./grouper.ts";
import type { GrouperOptions } from "./grouper.ts";
import { splitSegmentIntoClauses } from "./clause-splitter.ts";
import { validateItems } from "./validator.ts";

// ------------------------------------------------------------
// Pipeline options
// ------------------------------------------------------------

export interface PipelineOptions {
  /**
   * Source filename — used as fallback title and in the Document
   * metadata. Required.
   */
  source: string;

  /**
   * The year to use when resolving partial dates like "17/1".
   * Inferred from document content when not provided.
   */
  referenceYear?: number;

  /**
   * Confidence below which the AI adapter is offered.
   * Default: 0.45
   */
  aiThreshold?: number;

  /**
   * The AI adapter to use for low-confidence segments.
   * Defaults to nullAdapter (no AI calls).
   * Pass createAdapter(apiKey) to enable AI fallback.
   */
  aiAdapter?: AiAdapter;

  /**
   * Input mode. Determines which segmenter is used.
   * - "text": plain text from DOCX or TXT (default)
   * - "pdf":  positioned fragments from PDF.js
   */
  mode?: "text" | "pdf";

  /**
   * PDF page width in points — required when mode is "pdf".
   */
  pdfPageWidth?: number;

  /**
   * Options passed through to the grouper.
   * Leave unset to use grouper defaults.
   */
  grouperOptions?: GrouperOptions;

  /**
   * When true, pipeline emits detailed console.log for each clause,
   * validate step, and container. Default: false.
   * Never enable in production — log volume is proportional to document size.
   */
  debug?: boolean;
}

// ------------------------------------------------------------
// Internal types
// ------------------------------------------------------------

interface ProcessedClause {
  segment: Segment;
  clauseText: string;
  item: Item;
  usedAi: boolean;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function inferTitle(text: string, source: string): string {
  // Try the first non-empty line that is short enough to be a title
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    if (line.length > 4 && line.length < 100) {
      return line;
    }
  }
  // Fall back to filename without extension
  return source.replace(/\.[^.]+$/, "");
}

function meanConfidence(items: Item[]): number {
  if (!items.length) return 0;
  const sum = items.reduce((acc, item) => acc + item.confidence, 0);
  return sum / items.length;
}

function inferReferenceYear(text: string): number | undefined {
  // Use the most frequently occurring 4-digit year in the 2020s.
  // This avoids locking to a stale year from a header or citation.
  const matches = [...text.matchAll(/\b(20\d{2})\b/g)].map(m => m[1]);
  if (!matches.length) return undefined;

  const freq: Record<string, number> = {};
  for (const y of matches) freq[y] = (freq[y] ?? 0) + 1;

  return Number(
    Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
  );
}

/** Empty temporal binding — used when no temporal data is available */
const EMPTY_TEMPORAL: TemporalBinding = {
  deadline: null,
  scheduled: null,
  temporal_range: null,
};

// ------------------------------------------------------------
// Single-segment processor
// Runs classify → extract → optionally AI fallback
// ------------------------------------------------------------

async function processSegment(
  segment: Segment,
  options: Required<PipelineOptions>,
): Promise<ProcessedClause[]> {

  const clauses = splitSegmentIntoClauses(segment.text);
  const results: ProcessedClause[] = [];

  for (const clause of clauses) {
    const text = clause.text;

    const classification = classifySegment(text);

    const extraction = extractAll(
      text,
      classification.kindScores,
      options.referenceYear,
    );

    const combinedConfidence =
      classification.confidence * 0.45 + extraction.confidence * 0.55;

    const needsAi =
      combinedConfidence < options.aiThreshold &&
      options.aiAdapter !== nullAdapter;

    if (needsAi) {
      const aiResult = await options.aiAdapter({
        segment: text,
        kindScores: classification.kindScores,
        documentTitle: options.source,
      });

      if (aiResult.confidence > combinedConfidence) {
        const item: Item = {
          kind: aiResult.item.kind,
          temporal: classification.temporal,
          kindScores: classification.kindScores,
          temporalScores: classification.temporalScores,
          confidence: aiResult.confidence,
          date: aiResult.item.date,
          responsible: aiResult.item.responsible,
          text: aiResult.item.text,
          sourceText: clause.sourceText,
          context: { sectionTitle: segment.headerText ?? null },
          // Deprecated — migration compatibility
          scores: classification.scores,
        };

        if (options.debug) console.log(
          `[pipeline] clause AI-assisted` +
          ` | kind=${item.kind}` +
          ` | confidence=${item.confidence.toFixed(2)}` +
          ` | text="${item.text.slice(0, 60)}"`
        );

        results.push({
          segment,
          clauseText: text,
          item,
          usedAi: true,
        });

        continue;
      }
    }

    const item: Item = {
      kind: classification.kind,
      temporal: classification.temporal,
      kindScores: classification.kindScores,
      temporalScores: classification.temporalScores,
      confidence: combinedConfidence,
      date: extraction.date,
      responsible: extraction.responsible,
      text: extraction.text || text.slice(0, 120).trim(),
      sourceText: clause.sourceText,
      context: { sectionTitle: segment.headerText ?? null },
      // Deprecated — migration compatibility
      scores: classification.scores,
    };

    if (options.debug) console.log(
      `[pipeline] clause classified` +
      ` | kind=${item.kind}` +
      ` | section=${item.context?.sectionTitle ?? "none"}` +
      ` | confidence=${combinedConfidence.toFixed(2)}` +
      ` | kindScores=a:${classification.kindScores.action.toFixed(2)}` +
      ` dc:${classification.kindScores.decision.toFixed(2)}` +
      ` cx:${classification.kindScores.context.toFixed(2)}` +
      ` | temporal=dl:${classification.temporalScores.deadline.toFixed(2)}` +
      ` sc:${classification.temporalScores.scheduled.toFixed(2)}` +
      ` rg:${classification.temporalScores.temporal_range.toFixed(2)}` +
      ` | date=${item.date.iso ?? item.date.dateHint ?? "none"}` +
      ` | responsible=${item.responsible?.label ?? "none"}` +
      ` | text="${item.text.slice(0, 60)}"`
    );

    results.push({
      segment,
      clauseText: text,
      item,
      usedAi: false,
    });
  }

  return results;
}

// ------------------------------------------------------------
// Main pipeline
// ------------------------------------------------------------

/**
 * Run the full parse pipeline on raw plain text.
 *
 * This is the entry point for DOCX and TXT input.
 * For PDF input, use runPipelineOnFragments().
 */
export async function runPipeline(
  text: string,
  options: PipelineOptions,
): Promise<ParseResult> {
  const start = Date.now();

  const resolved = resolveOptions(options, text);
  const segments = segmentPlainText(text);

  return runOnSegments(text, segments, resolved, start);
}

/**
 * Run the full parse pipeline on PDF.js text fragments.
 *
 * This entry point handles column detection automatically.
 */
export async function runPipelineOnFragments(
  fragments: TextFragment[],
  options: PipelineOptions,
): Promise<ParseResult> {
  const start = Date.now();
  const pageWidth = options.pdfPageWidth ?? 595; // A4 default in points
  const fullText = fragments.map(f => f.text).join(" ");
  const resolved = resolveOptions({ ...options, mode: "pdf" }, fullText);
  const segments = segmentPdfFragments(fragments, pageWidth);

  return runOnSegments(fullText, segments, resolved, start);
}

// ------------------------------------------------------------
// Shared segment processing loop
// ------------------------------------------------------------

async function runOnSegments(
  fullText: string,
  segments: Segment[],
  options: Required<PipelineOptions>,
  startTime: number,
): Promise<ParseResult> {

  // Step 1: process all segments into a flat Item[]
  // AI calls are awaited individually to preserve order
  const processed: ProcessedClause[] = [];

  for (const segment of segments) {
    const results = await processSegment(segment, options);
    processed.push(...results);
  }

  // Step 2: filter out empty items
  const valid = processed.filter(p => p.item.text.trim().length > 0);

  // Step 3: preserve document order — do NOT sort here.
  // Sorting a flat list made sense before grouping, but the grouper
  // relies on document order to assign items to the correct container.
  // Sorting within containers (by date) is a UI concern, not a pipeline concern.

  // Step 3 (continued): extract items in document order
  const extracted: Item[] = valid.map(p => p.item);

  // Step 4: validate — final authority before grouping.
  // Nulls or degrades fields without explicit textual evidence.
  // Only validated items proceed to the grouper.
  const items: Item[] = validateItems(extracted);

  if (options.debug) {
    for (const item of items) {
      console.log(
        `[validate] kind=${item.kind}` +
        ` | responsible=${item.responsible.label ?? "null"}` +
        ` | date=${item.date.iso ?? item.date.dateHint ?? "null"}` +
        ` | text="${item.text.slice(0, 50)}"`
      );
    }
  }

  // Step 5: group items into containers
  const { containers, orphanItems } = group(items, options.grouperOptions);

  if (options.debug) {
    console.log(
      `[pipeline] grouping done` +
      ` | containers=${containers.length}` +
      ` | orphans=${orphanItems.length}` +
      ` | total items=${items.length}`
    );

    for (const c of containers) {
      console.log(
        `[pipeline] container ${c.id}` +
        ` | kind=${c.kind}` +
        ` | anchor=${c.primaryAnchor.kind}:"${c.primaryAnchor.raw.slice(0, 40)}"` +
        ` | items=${c.items.length}` +
        ` | confidence=${c.confidence.toFixed(2)}` +
        ` | label="${(c.label ?? "").slice(0, 50)}"`
      );
    }
  }

  // Step 6: assemble Document
  const allItems = [
    ...containers.flatMap(c => c.items),
    ...orphanItems,
  ];

  const document: Document = {
    title: inferTitle(fullText, options.source),
    source: options.source,
    parsedAt: new Date().toISOString(),
    confidence: meanConfidence(allItems),
    containers,
    orphanItems,
  };

  const aiAssistedCount = processed.filter(p => p.usedAi).length;

  return {
    document,
    meta: {
      segmentCount: segments.length,
      parsedCount: valid.length,
      containerCount: containers.length,
      orphanCount: orphanItems.length,
      aiAssistedCount,
      durationMs: Date.now() - startTime,
    },
  };
}

// ------------------------------------------------------------
// Options resolver
// Fills in defaults so the rest of the pipeline always has
// fully resolved values — no optional chaining inside the loop.
// ------------------------------------------------------------

function resolveOptions(
  options: PipelineOptions,
  text: string,
): Required<PipelineOptions> {
  return {
    source: options.source,
    referenceYear:
      options.referenceYear ?? inferReferenceYear(text) ?? new Date().getFullYear(),
    aiThreshold: options.aiThreshold ?? 0.45,
    aiAdapter: options.aiAdapter ?? nullAdapter,
    mode: options.mode ?? "text",
    pdfPageWidth: options.pdfPageWidth ?? 595,
    grouperOptions: options.grouperOptions ?? {},
    debug: options.debug ?? false,
  };
}
