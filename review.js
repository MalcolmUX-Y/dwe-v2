function flattenItems(doc) {
  return [
    ...(doc?.containers ?? []).flatMap((c) => c.items ?? []),
    ...(doc?.orphanItems ?? []),
  ];
}

function getText(item) {
  return item?.text?.trim() || "";
}

function isObviousMetadata(text) {
  const lower = text.toLowerCase();

  if (
  lower.startsWith("referat") ||
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

function isRelevantNote(text) {
  return /^(?:intet til|ingen bemærkninger|ingen kommentarer)/i.test(text.toLowerCase());
}

function hasWorkflowKind(item) {
  return (
    item?.kind === "action" ||
    item?.kind === "deadline" ||
    item?.kind === "decision"
  );
}

function hasWorkflowScore(item) {
  return (
    (item?.scores?.action ?? 0) >= 0.25 ||
    (item?.scores?.deadline ?? 0) >= 0.25 ||
    (item?.scores?.decision ?? 0) >= 0.25
  );
}

function hasStrongSignals(item) {
  return Boolean(
    item?.responsible?.label ||
    item?.date?.iso ||
    item?.date?.dateHint ||
    hasWorkflowKind(item) ||
    hasWorkflowScore(item)
  );
}

function isStatusLine(text) {
  return /^(intet til|ingen bemærkninger|ingen kommentarer)/i.test(text);
}
function getItemMeta(item) {
  if (isStatusLine(item.text || "")) {
    return { icon: "📝", label: "Note", className: "kind-context" };
  }
  switch (item?.kind) {
    case "action":
      return { icon: "⚡", label: "Action", className: "kind-action" };
    case "deadline":
      return { icon: "📅", label: "Deadline", className: "kind-deadline" };
    case "decision":
      return { icon: "✓", label: "Decision", className: "kind-decision" };
    default:
      return { icon: "📝", label: "Note", className: "kind-context" };
  } 
  
}

function groupReviewItems(items) {
  const ready = [];
  const review = [];
  const hidden = [];

  for (const item of items) {
    const text = getText(item);

    if (!text) {
      hidden.push(item);
      continue;
    }

    if (isObviousMetadata(text)) {
      hidden.push(item);
      continue;
    }

    const relevantNote = isRelevantNote(text);
    const strongSignals = hasStrongSignals(item);

    if (hasWorkflowKind(item)) {
      ready.push(item);
      continue;
    }

    if (strongSignals) {
      review.push(item);
      continue;
    }

    if (relevantNote) {
      review.push(item);
      continue;
    }

    hidden.push(item);
  }

  return { ready, review, hidden };
}

function renderSection(title, items, deps, options = {}) {
  const { emptyText = "No items in this section." } = options;

  return `
    <section class="review-section">
      <div class="section-label">${title}</div>
      <div class="item-list">
        ${
          items.length
            ? items.map((item) => renderReviewCard(item, deps)).join("")
            : `<p class="muted" style="padding:24px 0">${emptyText}</p>`
        }
      </div>
    </section>
  `;
}

function renderReviewCard(item, deps) {
  const { escHtml, formatDate } = deps;
  const dateStr = formatDate(item.date);
  const respStr = item.responsible?.label ?? null;
  const meta = getItemMeta(item);

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

function getKindCounts(items) {
  return {
    action: items.filter((item) => item?.kind === "action").length,
    deadline: items.filter((item) => item?.kind === "deadline").length,
    decision: items.filter((item) => item?.kind === "decision").length,
  };
}

export function renderReviewStep(state, deps) {
  const doc = state.parseResult?.document;
  const items = flattenItems(doc);
  const groups = groupReviewItems(items);
  const counts = getKindCounts(groups.ready);

  return `
    <div>
      <p class="screen-eyebrow">Step 3</p>
      <h1 class="screen-title">Review extracted items</h1>
      <p class="screen-body">
        Confirm the items that look workflow-relevant before generating your workflow.
      </p>
    </div>

        <div class="review-kind-bar">
      <div class="review-kind-pill">⚡ ${counts.action} actions</div>
      <div class="review-kind-pill">📅 ${counts.deadline} deadlines</div>
      <div class="review-kind-pill">✓ ${counts.decision} decisions</div>
    </div>

    <div class="summary-box">
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

    ${renderSection("Ready for workflow", groups.ready, deps, {
      emptyText: "No clear workflow items detected yet."
    })}

    ${renderSection("Needs review", groups.review, deps, {
      emptyText: "No ambiguous items need review."
    })}

    ${renderSection("Hidden / low priority", groups.hidden, deps, {
      emptyText: "No low-priority items hidden."
    })}

    <div class="actions" style="margin-top:8px">
      <button class="btn btn-ghost" id="backBtn">← Back</button>
      <button class="btn btn-primary" id="continueBtn">Confirm →</button>
    </div>
  `;
}
