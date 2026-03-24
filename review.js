// ============================================================
// Document Workflow Engine — review.js
// Version: 3.0.0
//
// Review step rendering. Uses the shared DisplayState model
// from display-state.js instead of raw kind checks.
//
// v3.0 changes:
//   - All kind === "deadline" references removed
//   - Uses deriveDisplayState() for all presentation decisions
//   - Counts and sorts by display-state, not raw kind
//   - getItemMeta() replaced by getItemDisplay()
//   - Shared card renderer used by both review and export
// ============================================================

import {
  deriveDisplayState,
  getItemDisplay,
  sortByDisplayPriority,
  getDisplayCounts,
} from "./display-state.js";

// ------------------------------------------------------------
// Text helpers
// ------------------------------------------------------------

function getText(item) {
  return item?.text?.trim() || "";
}

function isObviousMetadata(text) {
  const lower = text.toLowerCase();

  if (
    lower.startsWith("referat") ||
    lower.startsWith("deltagere:") ||
    (
      lower.includes("referat") &&
      lower.includes("dato") &&
      lower.includes("deltagere")
    )
  ) {
    return true;
  }

  // Rene sektionsoverskrifter som "4. Næste møde"
  if (/^\d+\.\s+[^\n.:]+$/i.test(text)) {
    return true;
  }

  return false;
}

function isVagueActionText(text) {
  return /\bdette\s*$/i.test(text.trim());
}

function isTautologicalWorkflowText(text) {
  const t = text.trim();
  return /^(?:deadline|tidsfrist)\b/i.test(t) || /^(?:deadline|tidsfrist|frist)\s+er\b/i.test(t);
}

function isStatusLine(text) {
  return /^(intet til|ingen bemærkninger|ingen kommentarer)/i.test(text);
}

// ------------------------------------------------------------
// Workflow relevance — now based on display-state
// ------------------------------------------------------------

/**
 * An item is workflow-relevant if its display-state is
 * anything other than "note". This replaces the old
 * hasWorkflowKind() that checked for the phantom "deadline" kind.
 */
function isWorkflowRelevant(item) {
  const state = deriveDisplayState(item);
  return state !== "note";
}

/**
 * Check if an item has strong signals (responsible, date,
 * or workflow-relevant display-state).
 */
function hasStrongSignals(item) {
  return Boolean(
    item?.responsible?.label ||
    item?.date?.iso ||
    item?.date?.dateHint ||
    isWorkflowRelevant(item)
  );
}

// ------------------------------------------------------------
// Item grouping for review
// ------------------------------------------------------------

function groupReviewItems(items) {
  const ready = [];
  const review = [];

  for (const item of items) {
    const text = getText(item);

    if (!text) continue;

    if (isObviousMetadata(text)) { review.push(item); continue; }
    if (isStatusLine(text)) { review.push(item); continue; }
    if (isWorkflowRelevant(item) && isTautologicalWorkflowText(text)) { review.push(item); continue; }
    if (isWorkflowRelevant(item) && isVagueActionText(text)) { review.push(item); continue; }
    if (isWorkflowRelevant(item)) { ready.push(item); continue; }

    review.push(item);
  }

  return { ready, review, hidden: [] };
}

// ------------------------------------------------------------
// Card rendering — shared by review and export (via export)
// ------------------------------------------------------------

export function renderReviewCard(item, deps) {
  const { escHtml, formatDate } = deps;
  const dateStr = formatDate(item.date);
  const respStr = item.responsible?.label ?? null;
  const { meta } = getItemDisplay(item);

  return `
    <article class="item-card">
      <div class="item-card-header">
        <span class="kind-chip ${meta.className}">${meta.icon} ${meta.label}</span>
        ${dateStr ? `<span class="item-date">${escHtml(dateStr)}</span>` : ""}
      </div>

      <p class="item-text">${escHtml(item.text || "—")}</p>

      ${respStr ? `
        <div class="item-meta">
          <div class="item-meta-field">
            <span class="item-meta-field-label">Responsible</span>
            <span>${escHtml(respStr)}</span>
          </div>
        </div>
      ` : ""}

      <details class="source-toggle">
        <summary>Source text</summary>
        <pre>${escHtml(item.sourceText || "")}</pre>
      </details>
    </article>
  `;
}

// ------------------------------------------------------------
// Section rendering
// ------------------------------------------------------------

function renderSection(title, items, deps, options = {}) {
  const { emptyText = "No items in this section." } = options;

  return `
    <section class="review-section">
      <div class="section-label">${title}</div>
      <div class="item-list">
        ${items.length
      ? items.map((item) => renderReviewCard(item, deps)).join("")
      : `<p class="muted" style="padding:24px 0">${emptyText}</p>`
    }
      </div>
    </section>
  `;
}

// Build a map from item → container label, for secondary grouping within sections
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

// Render a group of items, optionally sub-grouped by container label
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
    const standaloneLabel = isStandalone
      ? `<div class="container-group-label container-group-label--standalone">Standalone findings</div>
         <p class="standalone-desc">Items without a clear structural grouping.</p>`
      : "";
    return `
      <div class="container-group${isStandalone ? " container-group--standalone" : ""}">
        ${standaloneLabel}
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

export function renderReviewStep(state, deps) {
  const doc = state.parseResult?.document;
  if (!doc) return "";

  const { escHtml } = deps;

  const containers = doc.containers ?? [];
  const orphanItems = doc.orphanItems ?? [];

  const allItems = [
    ...containers.flatMap(c => c.items ?? []),
    ...orphanItems,
  ];

  const groups = groupReviewItems(allItems);
  const counts = getDisplayCounts(groups.ready);
  const itemContainerMap = buildItemContainerMap(doc);

  const readySection = `
    <section class="review-section">
      <div class="section-label">✅ Klar til workflow <span class="section-count">${groups.ready.length}</span></div>
      ${groups.ready.length
      ? renderGroupedItems(groups.ready, itemContainerMap, deps)
      : `<p class="muted" style="padding:16px 0">Ingen items klar til workflow.</p>`}
    </section>`;

  const reviewSection = groups.review.length ? `
    <section class="review-section">
      <div class="section-label">🔍 Kræver gennemsyn <span class="section-count">${groups.review.length}</span></div>
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

    <div class="review-kind-bar">
      <div class="review-kind-pill">🔴 ${counts.urgent} urgent</div>
      <div class="review-kind-pill">📅 ${counts.planned} planned</div>
      <div class="review-kind-pill">📆 ${counts.windowed} time-bound</div>
      <div class="review-kind-pill">⚡ ${counts.action} actions</div>
      <div class="review-kind-pill">✓ ${counts.decision} decisions</div>
    </div>

    <div class="summary-box">
      <div>
        <p class="summary-stat-label">Klar</p>
        <p class="summary-stat-value">${groups.ready.length}</p>
      </div>
      <div>
        <p class="summary-stat-label">Gennemsyn</p>
        <p class="summary-stat-value">${groups.review.length}</p>
      </div>
      <div>
        <p class="summary-stat-label">Skjult</p>
        <p class="summary-stat-value">${groups.hidden.length}</p>
      </div>
    </div>

    ${readySection}
    ${reviewSection}

    <div class="actions" style="margin-top:8px">
      <button class="btn btn-ghost" id="backBtn">← Back</button>
      <button class="btn btn-primary" id="continueBtn">Confirm →</button>
    </div>`;
}
