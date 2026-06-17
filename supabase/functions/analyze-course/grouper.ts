// ============================================================
// Document Workflow Engine — grouper.ts
// Version: 3.0.0
//
// Groups a flat Item[] into Container[] + orphanItems[].
// This is the structural grouping layer that sits between the
// parse pipeline and the final Document output.
//
// v3.0 changes:
//   - Reads kindScores instead of scores (with fallback to
//     deprecated scores during migration)
//   - Deadline score removed from heading anchor detection
//     (deadline is now temporal, not identity)
//
// What this file does:
//   Item[] → { containers: Container[], orphanItems: Item[] }
//
// What this file does NOT do:
//   - Classify or extract content (that is pipeline.ts)
//   - Produce nested containers (children[] reserved for v2)
//   - Know about document types — it uses anchor signals only
//
// Design rules:
//   - Generalitet i modellen, specialisering i heuristikken
//   - When in doubt, use ContainerKind "block" — not "session" or "meeting"
//   - An item becomes an orphan if uplaceable, ambiguous, or low-confidence
//   - This module is pure: no I/O, no side effects
//
// Anchor priority for first heuristic (semesterplaner):
//   date > numbered_section > heading
// ============================================================

import type {
  Item,
  Container,
  ContainerKind,
  Anchor,
  AnchorKind,
  Confidence,
} from "./types.ts";
import {
  DATE_ANCHOR_PATTERN,
  NUMBERED_SECTION_PATTERN,
  HEADING_PATTERN,
} from "./patterns.ts";

// ------------------------------------------------------------
// Grouper options
// ------------------------------------------------------------

export interface GrouperOptions {
  /**
   * Confidence below which an item is sent to orphanItems instead
   * of being placed in a container.
   * Default: 0.20
   */
  orphanThreshold?: number;

  /**
   * Minimum number of items a container must hold to be kept.
   * Single-item containers are usually noise.
   * Default: 1 (kept — callers may increase this)
   */
  minContainerSize?: number;
}

// ------------------------------------------------------------
// Grouper output
// ------------------------------------------------------------

export interface GrouperResult {
  containers: Container[];
  orphanItems: Item[];
}

// ------------------------------------------------------------
// Score access helpers — migration-safe
// Reads kindScores if available, falls back to deprecated scores
// ------------------------------------------------------------

function getActionScore(item: Item): number {
  return item.kindScores?.action ?? item.scores?.action ?? 0;
}

function getDecisionScore(item: Item): number {
  return item.kindScores?.decision ?? item.scores?.decision ?? 0;
}

// ------------------------------------------------------------
// Anchor detection
// Looks at an item's sourceText to find container-starting signals.
// Returns null if the item does not look like an anchor.
// ------------------------------------------------------------

// Textual month names (Danish, English, German, Swedish)
const MONTH_NAMES =
  /\b(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

/**
 * Attempt to detect an anchor signal in an item's source text.
 *
 * Priority: date > numbered_section > heading
 * Returns null if no anchor signal is found.
 */
function detectAnchor(item: Item): Anchor | null {
  const text = item.sourceText.trim();
  // Use only the first line for anchor detection —
  // anchor signals are almost always at the top of a segment
  const firstLine = text.split("\n")[0].trim();

  // --- Priority 1: date ---
  //
  // A resolved date is a necessary condition for a date-anchor, but not
  // sufficient. Three layers of qualification apply:
  //
  // Negative guards (both must pass):
  //   G1 — deadline-items carry the date as content, not as structure.
  //   G2 — label:value form ("Frist for aflevering: 2026-03-28") signals a
  //        field, not a block-start. Excluded regardless of item.kind.
  //
  // Positive structural signal (at least one required):
  //   S1 — A numbered section pattern on the first line.
  //   S2 — A heading pattern on the first line.
  //
  // Controlled meeting exception (separate allowance, not a structural signal):
  //   E1 — item.kind === "context" AND date.dateType is "meeting" or "scheduled".
  //        This covers "Næste møde afholdes 2026-03-25" in flat note documents
  //        without requiring a numbered section or heading marker.
  //        Treated as a named exception, not as equivalent evidence to S1/S2.
  //
  if (item.date.iso !== null) {
    // G1 — deadline-items are workflow leaves, not structural anchors
    // G2 — label:value form on first line signals a field, not a block-start
    const isLabelValue = /^[^:\n]{1,40}:\s+\S/.test(firstLine);

    if (!isLabelValue) {
      // Positive structural signal
      const hasStructuralSignal =
        NUMBERED_SECTION_PATTERN.test(firstLine) ||
        HEADING_PATTERN.test(firstLine);

      // Controlled meeting exception
      const isMeetingException =
        item.kind === "context" &&
        (item.date.dateType === "meeting" || item.date.dateType === "scheduled");

      if (hasStructuralSignal || isMeetingException) {
        const raw = DATE_ANCHOR_PATTERN.exec(firstLine)?.[0]
          ?? MONTH_NAMES.exec(firstLine)?.[0]
          ?? firstLine.slice(0, 40);
        return {
          kind: "date",
          raw,
          isoDate: item.date.iso,
        };
      }
    }
  }

  // Date pattern present even if extractor did not resolve it.
  const dateRaw = DATE_ANCHOR_PATTERN.exec(firstLine)?.[0]
    ?? (MONTH_NAMES.test(firstLine) ? MONTH_NAMES.exec(firstLine)![0] : null);
  if (dateRaw) {
    const isLabelValue = /^[^:\n]{1,40}:\s+\S/.test(firstLine);
    const hasStructuralSignal =
      NUMBERED_SECTION_PATTERN.test(firstLine) ||
      HEADING_PATTERN.test(firstLine);

    if (!isLabelValue && hasStructuralSignal) {
      return {
        kind: "date",
        raw: dateRaw,
        isoDate: null,
      };
    }
  }

  // --- Priority 2: numbered section ---
  const numberedMatch = NUMBERED_SECTION_PATTERN.exec(firstLine);
  if (numberedMatch) {
    return {
      kind: "numbered_section",
      raw: firstLine.slice(0, 60),
      isoDate: null,
    };
  }

  // --- Priority 3: heading ---
  // Only trigger on items classified as context with low action scores.
  // v3.0: deadline score is no longer checked here — deadline is a
  // temporal signal, not an identity signal. Only identity scores
  // (action, decision) are relevant for heading detection.
  const looksLikeHeading =
    HEADING_PATTERN.test(firstLine) ||
    (firstLine.length < 60 &&
      !firstLine.endsWith(".") &&
      !firstLine.endsWith(",") &&
      firstLine.split(" ").length <= 7 &&
      item.kind === "context" &&
      getActionScore(item) < 0.25);

  if (looksLikeHeading) {
    return {
      kind: "heading",
      raw: firstLine.slice(0, 60),
      isoDate: null,
    };
  }

  return null;
}

// ------------------------------------------------------------
// Secondary anchor detection
// After a primary anchor is found, check the same line for
// additional signals. These are stored but not used for grouping.
// ------------------------------------------------------------

function detectSecondaryAnchors(item: Item, primary: Anchor): Anchor[] {
  const firstLine = item.sourceText.split("\n")[0].trim();
  const secondary: Anchor[] = [];

  // If primary is date, also check for numbered section on same line
  if (primary.kind !== "numbered_section") {
    const numberedMatch = NUMBERED_SECTION_PATTERN.exec(firstLine);
    if (numberedMatch) {
      secondary.push({
        kind: "numbered_section",
        raw: firstLine.slice(0, 60),
        isoDate: null,
      });
    }
  }

  // If primary is numbered_section, also check for date on same line
  if (primary.kind !== "date") {
    const dateRaw = DATE_ANCHOR_PATTERN.exec(firstLine)?.[0] ?? null;
    if (dateRaw) {
      secondary.push({
        kind: "date",
        raw: dateRaw,
        isoDate: item.date.iso,
      });
    }
  }

  return secondary;
}

// ------------------------------------------------------------
// Container kind inference
// Uses anchor type + item scores to pick the most honest kind.
// Rule: prefer "block" over semantic types when signal is weak.
// ------------------------------------------------------------

function inferContainerKind(anchor: Anchor, items: Item[]): ContainerKind {
  // Strong date signal with context/action items → likely a session
  if (anchor.kind === "date" && anchor.isoDate !== null) {
    const hasActionOrDeadline = items.some(
      i => i.kind === "action"
    );
    if (hasActionOrDeadline) return "session";
  }

  // Numbered section → section
  if (anchor.kind === "numbered_section") return "section";

  // Heading with no date → block (conservative — not enough signal for "meeting")
  return "block";
}

// ------------------------------------------------------------
// Label inference
// Produces a short human-readable label for the container.
// ------------------------------------------------------------

function inferLabel(anchor: Anchor, item: Item): string | null {
  // For date anchors, prefer the item's extracted text as context
  if (anchor.kind === "date") {
    const firstLine = item.sourceText.split("\n")[0].trim();
    return firstLine.length > 0 ? firstLine.slice(0, 80) : null;
  }

  // For numbered sections and headings, the raw anchor text is the label
  return anchor.raw.slice(0, 80);
}

// ------------------------------------------------------------
// Container confidence
// Based on anchor strength and number of items placed.
// ------------------------------------------------------------

function containerConfidence(
  anchor: Anchor,
  items: Item[],
): Confidence {
  let score = 0;

  // Anchor type contributes base confidence
  switch (anchor.kind) {
    case "date":
      score += anchor.isoDate ? 0.80 : 0.55;
      break;
    case "numbered_section":
      score += 0.75;
      break;
    case "heading":
      score += 0.55;
      break;
    default:
      score += 0.30;
  }

  // More items = more confident this is a real structural unit
  if (items.length >= 3) score += 0.10;
  if (items.length >= 6) score += 0.05;

  // Mean item confidence as a small modifier
  const meanItemConf = items.reduce((s, i) => s + i.confidence, 0) / items.length;
  score += meanItemConf * 0.10;

  return Math.max(0, Math.min(1, score));
}

// ------------------------------------------------------------
// ID generator
// Simple sequential IDs — stable within a single parse run.
// ------------------------------------------------------------

function makeIdGenerator(): () => string {
  let n = 0;
  return () => `c-${String(++n).padStart(3, "0")}`;
}

// ------------------------------------------------------------
// Core grouping logic
// ------------------------------------------------------------

/**
 * Walk items in document order.
 * When an item carries an anchor signal, start a new container.
 * All subsequent items belong to that container until the next anchor.
 * Items that precede the first anchor go into orphanItems.
 */
function groupItems(
  items: Item[],
  options: Required<GrouperOptions>,
): GrouperResult {
  const nextId = makeIdGenerator();
  const containers: Container[] = [];
  const orphanItems: Item[] = [];

  // Items before the first anchor have no home
  let currentAnchorItem: Item | null = null;
  let currentAnchor: Anchor | null = null;
  let currentBucket: Item[] = [];
  let activeSectionTitle: string | null = null;

  const flushContainer = () => {
    if (!currentAnchor || !currentAnchorItem) return;

    const nonAnchorItems = currentBucket.filter(item => item !== currentAnchorItem);

    // Items below orphan threshold go to orphanItems, not the container
    const placed: Item[] = [];
    const evicted: Item[] = [];
    for (const item of nonAnchorItems) {
      if (item.confidence < options.orphanThreshold) {
        evicted.push(item);
      } else {
        placed.push(item);
      }
    }

    orphanItems.push(...evicted);

    // Containers with too few items are dissolved — their items become orphans
    if (placed.length + 1 < options.minContainerSize) {
      orphanItems.push(currentAnchorItem, ...placed);
      return;
    }

    const kind = inferContainerKind(currentAnchor, placed);
    const label = inferLabel(currentAnchor, currentAnchorItem);
    const secondary = detectSecondaryAnchors(currentAnchorItem, currentAnchor);

    containers.push({
      id: nextId(),
      kind,
      label,
      confidence: containerConfidence(currentAnchor, [currentAnchorItem, ...placed]),
      primaryAnchor: currentAnchor,
      secondaryAnchors: secondary,
      items: [currentAnchorItem, ...placed],
      children: [],   // reserved — not populated in v1
    });
  };

  for (const item of items) {
    const anchor = detectAnchor(item);
    const sectionTitle = item.context?.sectionTitle?.trim() ?? null;
    const isNewSection =
      sectionTitle !== null &&
      sectionTitle !== activeSectionTitle &&
      NUMBERED_SECTION_PATTERN.test(sectionTitle);

    if (isNewSection) {
      flushContainer();
      currentAnchorItem = item;
      currentAnchor = {
        kind: "numbered_section",
        raw: sectionTitle,
        isoDate: item.date.iso,
      };
      activeSectionTitle = sectionTitle;
      currentBucket = [item];
      continue;
    }

    const insideActiveSection = activeSectionTitle !== null;
    const anchorIsDateOnly = anchor?.kind === "date";

    if (anchor && !(insideActiveSection && anchorIsDateOnly)) {
      flushContainer();
      currentAnchorItem = item;
      currentAnchor = anchor;
      currentBucket = [item];
      if (sectionTitle !== null) activeSectionTitle = sectionTitle;
    } else if (currentAnchor) {
      currentBucket.push(item);
    } else {
      orphanItems.push(item);
    }
  }

  // Flush the final container
  flushContainer();
  return { containers, orphanItems };
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

/**
 * Group a flat list of items into containers and orphans.
 *
 * Items are processed in the order they are received (document order).
 * The grouper never reorders items — that is a pipeline concern.
 *
 * Usage:
 *   const { containers, orphanItems } = groupItems(items, options);
 */
export function group(
  items: Item[],
  options: GrouperOptions = {},
): GrouperResult {
  if (!items.length) {
    return { containers: [], orphanItems: [] };
  }

  const resolved: Required<GrouperOptions> = {
    orphanThreshold: options.orphanThreshold ?? 0.20,
    minContainerSize: options.minContainerSize ?? 1,
  };

  return groupItems(items, resolved);
}
