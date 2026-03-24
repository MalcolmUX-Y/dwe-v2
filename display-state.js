// ============================================================
// Document Workflow Engine — display-state.js
// Version: 1.0.0
//
// Browser-compatible implementation of the DisplayState contract
// defined in types.ts. This is the frontend counterpart of
// display-state.ts (backend/TypeScript).
//
// Both implementations follow the same priority order.
// This is a deliberate, controlled duplication — the contract
// is defined in types.ts, and both files implement it.
//
// Priority order (first match wins):
//   1. urgent    — temporal.deadline is present
//   2. planned   — temporal.scheduled is present
//   3. windowed  — temporal.temporal_range is present
//   4. decision  — kind === "decision"
//   5. action    — kind === "action"
//   6. note      — everything else
// ============================================================

/**
 * Derive the display state for a single item.
 *
 * @param {object} item — a workflow Item from the pipeline
 * @returns {string} one of: urgent, planned, windowed, decision, action, note
 */
export function deriveDisplayState(item) {
  const temporal = item?.temporal;

  if (temporal?.deadline != null) {
    return "urgent";
  }

  if (temporal?.scheduled != null) {
    return "planned";
  }

  if (temporal?.temporal_range != null) {
    return "windowed";
  }

  if (item?.kind === "decision") {
    return "decision";
  }

  if (item?.kind === "action") {
    return "action";
  }

  return "note";
}

/**
 * Display metadata for each state.
 * Icon, label, and CSS class name.
 */
const DISPLAY_META = {
  urgent:   { icon: "🔴", label: "Urgent",     className: "display-urgent" },
  planned:  { icon: "📅", label: "Planned",    className: "display-planned" },
  windowed: { icon: "📆", label: "Time-bound", className: "display-windowed" },
  decision: { icon: "✓",  label: "Decision",   className: "display-decision" },
  action:   { icon: "⚡", label: "Action",     className: "display-action" },
  note:     { icon: "📝", label: "Note",       className: "display-note" },
};

/**
 * Get display metadata for a given state.
 *
 * @param {string} state — a DisplayState value
 * @returns {{ icon: string, label: string, className: string }}
 */
export function getDisplayMeta(state) {
  return DISPLAY_META[state] ?? DISPLAY_META.note;
}

/**
 * Derive display state and metadata in one call.
 *
 * @param {object} item — a workflow Item
 * @returns {{ state: string, meta: { icon: string, label: string, className: string } }}
 */
export function getItemDisplay(item) {
  const state = deriveDisplayState(item);
  return { state, meta: DISPLAY_META[state] };
}

/**
 * Display-state priority order for sorting.
 * Lower number = higher priority.
 */
const DISPLAY_PRIORITY = {
  urgent: 0,
  planned: 1,
  windowed: 2,
  decision: 3,
  action: 4,
  note: 5,
};

/**
 * Sort items by display-state priority.
 * Urgent first, notes last.
 *
 * @param {object[]} items — array of workflow Items
 * @returns {object[]} sorted copy
 */
export function sortByDisplayPriority(items) {
  return [...items].sort((a, b) => {
    const sa = deriveDisplayState(a);
    const sb = deriveDisplayState(b);
    return (DISPLAY_PRIORITY[sa] ?? 99) - (DISPLAY_PRIORITY[sb] ?? 99);
  });
}

/**
 * Count items by display state.
 *
 * @param {object[]} items — array of workflow Items
 * @returns {Record<string, number>}
 */
export function getDisplayCounts(items) {
  const counts = {
    urgent: 0, planned: 0, windowed: 0,
    decision: 0, action: 0, note: 0,
  };
  for (const item of items) {
    const state = deriveDisplayState(item);
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
}
