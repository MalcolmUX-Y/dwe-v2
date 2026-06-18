// ============================================================
// Document Workflow Engine — review.js
// Version: 3.1.0
//
// v3.1 changes:
//   - Removed dead 'renderSection' function (was never called)
//   - Removed unused 'hasStrongSignals' function
//   - Fixed mixed Danish/English UI strings → all English
//   - Item cards now include <h3> heading for screen-reader navigation
//   - Source <details> now has aria-label tied to item content
//   - 'groupReviewItems' is now exported for use in app.js confirm handler
//   - Locale-specific heuristics (Danish meeting terms) isolated into
//     LOCALE_DA constant and documented as locale-specific
// ============================================================

import {
  deriveDisplayState,
  getItemDisplay,
  sortByDisplayPriority,
  getDisplayCounts,
} from "./display-state.js";

// ------------------------------------------------------------
// Locale — Danish meeting-minutes heuristics
// These patterns are specific to Danish documents. If this
// engine is used with other languages, define a separate locale
// object and pass it as a parameter.
// ------------------------------------------------------------

const LOCALE_DA = {
  /** Patterns indicating a block is document metadata, not a workflow item. */
  metadataPrefixes: ["referat", "deltagere:"],
  metadataCompound: ["referat", "dato", "deltagere"],
  /** Pattern for bare status lines ("nothing to add", etc.) */
  statusLineRe: /^(intet til|ingen bem[æa]rkninger|ingen kommentarer)/i,
  /** Pattern for vague pronoun-ending action text. */
  vagueActionRe: /\bdette\s*$/i,
  /** Pattern for tautological deadline/task text. */
  tautologicalRe: /^(?:deadline|tidsfrist)\b/i,
  tautologicalIsRe: /^(?:deadline|tidsfrist|frist)\s+er\b/i,
};

// ------------------------------------------------------------
// Text helpers
// ------------------------------------------------------------

function getText(item) {
  return item?.text?.trim() || "";
}

function isObviousMetadata(text) {
  const lower = text.toLowerCase();
  if (LOCALE_DA.metadataPrefixes.some(p => lower.startsWith(p))) return true;
  if (LOCALE_DA.metadataCompound.every(t => lower.includes(t))) return true;
  // Bare section headings like "4. Next meeting"
  if (/^\d+\.\s+[^\n.:]+$/i.test(text)) return true;
  return false;
}

function isVagueActionText(text) {
  return LOCALE_DA.vagueActionRe.test(text.trim());
}

function isTautologicalWorkflowText(text) {
  const t = text.trim();
  return LOCALE_DA.tautologicalRe.test(t) || LOCALE_DA.tautologicalIsRe.test(t);
}

function isStatusLine(text) {
  return LOCALE_DA.statusLineRe.test(text);
}

// ------------------------------------------------------------
// Workflow relevance
// ------------------------------------------------------------

function isWorkflowRelevant(item) {
  return deriveDisplayState(item) !== "note";
}

// ------------------------------------------------------------
// Item grouping
// Exported so the confirm handler in app.js can re-use it
// without re-implementing the grouping logic.
// ------------------------------------------------------------

/**
 * Separate items into ready / needs-review / hidden groups.
 * 'hidden' is reserved for a future suppression feature.
 *
 * @param {object[]} items — flat array of workflow items
 * @returns {{ ready: object[], review: object[], hidden: object[] }}
 */
export function groupReviewItems(items) {
  const ready   = [];
  const review  = [];

  for (const item of items) {
    const text = getText(item);

    if (!text) continue;

    if (isObviousMetadata(text))                                       { review.push(item); continue; }
    if (isStatusLine(text))                                            { review.push(item); continue; }
    if (isWorkflowRelevant(item) && isTautologicalWorkflowText(text)) { review.push(item); continue; }
    if (isWorkflowRelevant(item) && isVagueActionText(text))          { review.push(item); continue; }
    if (isWorkflowRelevant(item))                                      { ready.push(item); continue; }

    review.push(item);
  }

  return { ready, review, hidden: [] };
}

// ------------------------------------------------------------
// Card rendering — shared by review step and export step
// ------------------------------------------------------------

/**
 * Render a single workflow item as an accessible article card.
 *
 * @param {object} item
 * @param {{ escHtml: Function, formatDate: Function }} deps
 * @returns {string} HTML string
 */
export function renderReviewCard(item, deps) {
  const { escHtml, formatDate } = deps;
  const dateStr = formatDate(item.date);
  const respStr = item.responsible?.label ?? null;
  const { meta } = getItemDisplay(item);

  // Truncate item text for the aria-label on the source toggle
  const shortText = (item.text ?? "").slice(0, 60).trim();
  const sourceLabel = `Source text for: ${shortText}${item.text?.length > 60 ? "…" : ""}`;

  return `
    <article class="item-card">
      <div class="item-card-header">
        <span class="kind-chip ${meta.className}">${meta.icon} ${meta.label}</span>
        ${dateStr ? `<span class="item-date">${escHtml(dateStr)}</span>` : ""}
      </div>

      <h3 class="item-text">${escHtml(item.text || "—")}</h3>

      ${respStr ? `
        <div class="item-meta">
          <div class="item-meta-field">
            <span class="item-meta-field-label">Responsible</span>
            <span>${escHtml(respStr)}</span>
          </div>
        </div>` : ""}

      <details class="source-toggle">
        <summary aria-label="${escHtml(sourceLabel)}">Source text</summary>
        <pre>${escHtml(item.sourceText || "")}</pre>
      </details>
    </article>`;
}

// ------------------------------------------------------------
// Section & grouping rendering
// ------------------------------------------------------------

function buildItemContainerMap(doc) {
  const map = new Map();
  for (const c of doc?.containers ?? []) {
    for (const item of c.items ?? []) {
      map.set(item, c.label ?? null);
    }
  }
  for (const item of doc?.orphanItems ?? []) {
    map.set(item, "__standalone__");
  }
  return map;
}

function renderGroupedItems(items, itemContainerMap, deps) {
  const { escHtml } = deps;
  const hasContainers = items.some(i => itemContainerMap.get(i));

  if (!hasContainers) {
    return `<div class="item-list">${items.map(i => renderReviewCard(i, deps)).join("")}</div>`;
  }

  const groups = new Map();
  for (const item of items) {
    const label = itemContainerMap.get(item) ?? null;
    const key = label ?? "__ungrouped__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return [...groups.entries()].map(([key, groupItems]) => {
    const sortedGroupItems = sortByDisplayPriority(groupItems);
    const isStandalone = key === "__standalone__";
    const label = (key === "__ungrouped__" || isStandalone) ? null : key;
    const showLabel = label && groupItems.length > 1;

    const standaloneHeader = isStandalone
      ? `<div class="container-group-label container-group-label--standalone">Standalone findings</div>
         <p class="standalone-desc">Items without a clear structural grouping.</p>`
      : "";

    return `
      <div class="container-group${isStandalone ? " container-group--standalone" : ""}">
        ${standaloneHeader}
        ${showLabel ? `<div class="container-group-label">${escHtml(label)}</div>` : ""}
        <div class="item-list">
          ${sortedGroupItems.map(i => renderReviewCard(i, deps)).join("")}
        </div>
      </div>`;
  }).join("");
}

// ------------------------------------------------------------
// Main review step renderer
// ------------------------------------------------------------

/**
 * Render the full review step (step 3).
 *
 * @param {object} state — app state
 * @param {{ escHtml: Function, formatDate: Function }} deps
 * @returns {string} HTML string
 */
export function renderReviewStep(state, deps) {
  const doc = state.parseResult?.document;
  if (!doc) return "";

  const allItems = [
    ...( doc.containers ?? []).flatMap(c => c.items ?? []),
    ...( doc.orphanItems ?? []),
  ];

  const groups          = groupReviewItems(allItems);
  const counts          = getDisplayCounts(groups.ready);
  const itemContainerMap = buildItemContainerMap(doc);

  const readySection = `
    <section class="review-section" aria-labelledby="section-ready">
      <div class="section-label" id="section-ready">
        ✅ Ready for workflow <span class="section-count">${groups.ready.length}</span>
      </div>
      ${groups.ready.length
        ? renderGroupedItems(groups.ready, itemContainerMap, deps)
        : `<p class="muted" style="padding:16px 0">No items ready for workflow.</p>`}
    </section>`;

  const reviewSection = groups.review.length ? `
    <section class="review-section" aria-labelledby="section-needs-review">
      <div class="section-label" id="section-needs-review">
        🔍 Needs review <span class="section-count">${groups.review.length}</span>
      </div>
      ${renderGroupedItems(groups.review, itemContainerMap, deps)}
    </section>` : "";

  return `
    <div>
      <p class="screen-eyebrow">Step 3</p>
      <h1 class="screen-title">Review extracted items</h1>
      <p class="screen-body">
        Confirm the items that look workflow-relevant before generating your workflow.
      </p>
    </div>

    <div class="review-kind-bar" role="list" aria-label="Item type summary">
      <div class="review-kind-pill" role="listitem">🔴 ${counts.urgent} urgent</div>
      <div class="review-kind-pill" role="listitem">📅 ${counts.planned} planned</div>
      <div class="review-kind-pill" role="listitem">📆 ${counts.windowed} time-bound</div>
      <div class="review-kind-pill" role="listitem">⚡ ${counts.action} actions</div>
      <div class="review-kind-pill" role="listitem">✓ ${counts.decision} decisions</div>
    </div>

    <div class="summary-box" aria-label="Item counts">
      <div>
        <p class="summary-stat-label">Ready</p>
        <p class="summary-stat-value">${groups.ready.length}</p>
      </div>
      <div>
        <p class="summary-stat-label">Needs review</p>
        <p class="summary-stat-value">${groups.review.length}</p>
      </div>
      <div>
        <p class="summary-stat-label">Hidden</p>
        <p class="summary-stat-value">${groups.hidden.length}</p>
      </div>
    </div>

    ${readySection}
    ${reviewSection}

    <div class="actions" style="margin-top:8px">
      <button class="btn btn-ghost" id="backBtn">← Back</button>
      <button class="btn btn-primary" id="confirmBtn">Confirm ${groups.ready.length} items →</button>
    </div>`;
}
