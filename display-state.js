// ============================================================
// Document Workflow Engine — display-state.js
// Version: 1.1.0
//
// v1.1 changes:
//   - Renamed local variable 'state' → 'displayState' in
//     getItemDisplay() to avoid shadowing the app-level state
//     object when reading across files.
//   - No logic changes.
// ============================================================

/**
 * Priority order (first match wins):
 *   1. urgent    — temporal.deadline is present
 *   2. planned   — temporal.scheduled is present
 *   3. windowed  — temporal.temporal_range is present
 *   4. decision  — kind === "decision"
 *   5. action    — kind === "action"
 *   6. note      — everything else
 *
 * @param {object} item — a workflow Item from the pipeline
 * @returns {string} one of: urgent | planned | windowed | decision | action | note
 */
export function deriveDisplayState(item) {
  const temporal = item?.temporal;

  if (temporal?.deadline != null)       return "urgent";
  if (temporal?.scheduled != null)      return "planned";
  if (temporal?.temporal_range != null) return "windowed";
  if (item?.kind === "decision")        return "decision";
  if (item?.kind === "action")          return "action";

  return "note";
}

/** Display metadata for each state. */
const DISPLAY_META = {
  urgent:   { icon: "🔴", label: "Urgent",     className: "display-urgent"   },
  planned:  { icon: "📅", label: "Planned",    className: "display-planned"  },
  windowed: { icon: "📆", label: "Time-bound", className: "display-windowed" },
  decision: { icon: "✓",  label: "Decision",   className: "display-decision" },
  action:   { icon: "⚡", label: "Action",     className: "display-action"   },
  note:     { icon: "📝", label: "Note",       className: "display-note"     },
};

/**
 * @param {string} displayState — a DisplayState value
 * @returns {{ icon: string, label: string, className: string }}
 */
export function getDisplayMeta(displayState) {
  return DISPLAY_META[displayState] ?? DISPLAY_META.note;
}

/**
 * Derive display state and metadata in one call.
 * @param {object} item
 * @returns {{ state: string, meta: { icon: string, label: string, className: string } }}
 */
export function getItemDisplay(item) {
  const displayState = deriveDisplayState(item);
  return { state: displayState, meta: DISPLAY_META[displayState] };
}

/** Lower number = higher priority. */
const DISPLAY_PRIORITY = {
  urgent: 0, planned: 1, windowed: 2, decision: 3, action: 4, note: 5,
};

/**
 * Sort items by display-state priority. Urgent first, notes last.
 * @param {object[]} items
 * @returns {object[]} sorted copy (original not mutated)
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
 * @param {object[]} items
 * @returns {Record<string, number>}
 */
export function getDisplayCounts(items) {
  const counts = { urgent: 0, planned: 0, windowed: 0, decision: 0, action: 0, note: 0 };
  for (const item of items) {
    const displayState = deriveDisplayState(item);
    counts[displayState] = (counts[displayState] ?? 0) + 1;
  }
  return counts;
}
