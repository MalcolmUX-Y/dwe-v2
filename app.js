// ============================================================
// Document Workflow Engine — app.js v2.0
// Vanilla JS, no framework. ES modules.
// ============================================================

import { renderReviewStep } from "./review.js";

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------

const SUPABASE_URL      = "https://flecimbpfuzlflyvgjrk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsZWNpbWJwZnV6bGZseXZnanJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4Mjg4MTksImV4cCI6MjA4ODQwNDgxOX0.Wcifm_Wjjm1olJefkzOhP2_ZBuDVkqMIB2gGIGpYpZQ";
const EDGE_URL          = `${SUPABASE_URL}/functions/v1/analyze-course`;

const STEPS = ["Upload", "Parse", "Review", "Export"];

// ------------------------------------------------------------
// State
// ------------------------------------------------------------

const state = {
  step:          1,
  file:          null,
  fileText:      null,
  parseResult:   null,
  filterKind:    "all",
  useAi:         false,
  parsing:       false,
  parseError:    null,
  session:       null,
};

// ------------------------------------------------------------
// Supabase auth
// ------------------------------------------------------------

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  const { data: { session } } = await _supabase.auth.getSession();
  return session;
}

async function signInWithGoogle() {
  await _supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href },
  });
}

// ------------------------------------------------------------
// File extraction (local — file never leaves browser)
// ------------------------------------------------------------

function getFileType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".txt")  || file.type === "text/plain") return "txt";
  return null;
}

async function extractText(file) {
  const type = getFileType(file);

  if (type === "txt") {
    return await file.text();
  }

  if (type === "docx") {
    if (!window.mammoth) throw new Error("Mammoth.js not loaded.");
    const buf    = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
    if (!result.value?.trim()) throw new Error("No text found in DOCX.");
    return result.value;
  }

  if (type === "pdf") {
    if (!window.pdfjsLib) throw new Error("PDF.js not loaded.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page    = await pdf.getPage(i);
      const content = await page.getTextContent();
      const lines   = [];
      let   lastY   = null;
      let   line    = [];

      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          if (line.length) lines.push(line.join(" ").trim());
          line = [];
        }
        line.push(item.str);
        lastY = y;
      }
      if (line.length) lines.push(line.join(" ").trim());
      pages.push(lines.filter(Boolean).join("\n"));
    }
    return pages.join("\n\n");
  }

  throw new Error("Unsupported file type. Please upload PDF, DOCX or TXT.");
}

// ------------------------------------------------------------
// API call to Edge Function
// ------------------------------------------------------------

async function callEdgeFunction(text, session) {
  const response = await fetch(EDGE_URL, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      text,
      options: {
        source: state.file?.name ?? "document",
        useAi:  state.useAi,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Parse request failed.");
  return data;
}

// ------------------------------------------------------------
// Rendering helpers
// ------------------------------------------------------------

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dateObj) {
  if (!dateObj) return null;
  if (dateObj.iso) {
    const [y, m, d] = dateObj.iso.split("-");
    return `${d}.${m}.${y}`;
  }
  return dateObj.dateHint || null;
}

function confClass(c) {
  if (c >= 0.8) return "conf-high";
  if (c >= 0.45) return "conf-mid";
  return "conf-low";
}

function confLabel(c) {
  if (c >= 0.8) return "high";
  if (c >= 0.45) return "medium";
  return "low";
}

function renderStepNav() {
  const nav = document.getElementById("stepNav");
  nav.innerHTML = STEPS.map((label, i) => {
    const n      = i + 1;
    const status = n === state.step ? "is-active" : n < state.step ? "is-done" : "";
    return `
      <div class="step ${status}" aria-current="${n === state.step ? "step" : "false"}">
        <span class="step-n">${n}</span>
        <span class="step-label">${label}</span>
      </div>`;
  }).join("");
}

function renderKindChip(kind) {
  return `<span class="kind-chip kind-${kind}">${kind}</span>`;
}

function renderConfidenceBar(confidence) {
  const pct = Math.round(confidence * 100);
  return `
    <div class="confidence-bar-wrap">
      <div class="confidence-bar">
        <div class="confidence-bar-fill ${confClass(confidence)}"
             style="width:${pct}%"></div>
      </div>
      <span class="confidence-label">${confLabel(confidence)}</span>
    </div>`;
}

function renderItemCard(item) {
  const dateStr = formatDate(item.date);
  const respStr = item.responsible?.label ?? null;

  return `
    <article class="item-card">
      <div class="item-card-header">
        ${dateStr ? `<span class="item-date">${escHtml(dateStr)}</span>` : ""}
      </div>

      <p class="item-text">${escHtml(item.text || "—")}</p>

      ${(respStr || item.confidence != null) ? `
        <div class="item-meta">
          ${respStr ? `
            <div class="item-meta-field">
              <span class="item-meta-field-label">Responsible</span>
              <span>${escHtml(respStr)}</span>
            </div>` : ""}
        </div>
      ` : ""}

      <details class="source-toggle">
        <summary>Source text</summary>
        <pre>${escHtml(item.sourceText || "")}</pre>
      </details>
    </article>`;
}

// ------------------------------------------------------------
// Step screens
// ------------------------------------------------------------

function renderApp() {
  renderStepNav();
  const app = document.getElementById("app");

  app.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "screen";

  switch (state.step) {
    case 1: screen.innerHTML = renderUpload();    break;
    case 2: screen.innerHTML = renderParse();     break;
    case 3:
  screen.innerHTML = renderReviewStep(state, {
    escHtml,
    formatDate
  });
  break;
    case 4: screen.innerHTML = renderExport();    break;
    default: screen.innerHTML = renderUpload();
  }

  app.appendChild(screen);
  bindEvents();
}

// --- Step 1: Upload ---

function renderUpload() {
  const hasFile = !!state.file;
  const type    = hasFile ? getFileType(state.file) : null;

  return `
    <div>
      <p class="screen-eyebrow">Step 1</p>
      <h1 class="screen-title">Upload your document</h1>
      <p class="screen-body">
        The file is read locally — it never leaves your device until you
        explicitly enable AI assistance below.
      </p>
    </div>

    <div class="upload-zone ${hasFile ? "has-file" : ""}" id="uploadZone">
      <input type="file" id="fileInput" accept=".pdf,.docx,.txt,application/pdf,text/plain" />
      <div class="upload-icon">↑</div>
      <p class="upload-label">
        ${hasFile
          ? `<strong>${escHtml(state.file.name)}</strong>`
          : `<strong>Choose file</strong> or drag and drop`}
      </p>
      <p class="upload-hint">PDF · DOCX · TXT</p>
    </div>

    ${hasFile ? `
      <div class="file-card">
        <span class="file-card-icon">${type?.toUpperCase() ?? "FILE"}</span>
        <div>
          <p class="file-card-name">${escHtml(state.file.name)}</p>
          <p class="file-card-meta">${formatBytes(state.file.size)} · ready to parse</p>
        </div>
      </div>` : ""}

    <div class="consent-row">
      <div class="consent-toggle ${state.useAi ? "is-on" : ""}" id="aiToggle"
           role="switch" aria-checked="${state.useAi}" tabindex="0"></div>
      <div class="consent-text">
        <p class="consent-title">Enable AI assistance for uncertain segments</p>
        <p class="consent-desc">
          When the local parser is unsure, individual text segments may be sent
          to an AI provider for help. You will see exactly what is sent before it
          is transmitted. Disabled by default.
        </p>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" id="continueBtn" ${!hasFile ? "disabled" : ""}>
        Continue →
      </button>
    </div>`;
}

// --- Step 2: Parse ---

function renderParse() {
  const statusLabel =
    state.parsing    ? "Parsing…"   :
    state.parseError ? "Failed"     :
    state.parseResult ? "Completed" : "Ready";

  return `
    <div>
      <p class="screen-eyebrow">Step 2</p>
      <h1 class="screen-title">Parse document</h1>
      <p class="screen-body">
        The document is segmented and classified locally. AI assistance is
        ${state.useAi ? "enabled" : "disabled"} for this session.
      </p>
    </div>

    <div class="status-box">
      <div class="status-row">
        <strong>File</strong>
        <span class="muted">${escHtml(state.file?.name ?? "—")}</span>
      </div>
      <div class="status-row">
        <strong>Status</strong>
        ${state.parsing
          ? `<span class="muted"><span class="spinner"></span> ${statusLabel}</span>`
          : `<span class="muted">${statusLabel}</span>`}
      </div>
      ${state.parseResult ? `
        <div class="status-row">
          <strong>Segments found</strong>
          <span class="muted">${state.parseResult.meta.segmentCount}</span>
        </div>
        <div class="status-row">
          <strong>Items extracted</strong>
          <span class="muted">${state.parseResult.meta.parsedCount}</span>
        </div>
        <div class="status-row">
          <strong>Duration</strong>
          <span class="muted">${state.parseResult.meta.durationMs} ms</span>
        </div>` : ""}
      ${state.parseError ? `
        <div class="status-row" style="color:var(--danger)">
          ${escHtml(state.parseError)}
        </div>` : ""}
    </div>

    <div class="actions">
      <button class="btn btn-ghost" id="backBtn">← Back</button>
      <button class="btn btn-primary" id="parseBtn"
        ${state.parsing ? "disabled" : ""}>
        ${state.parsing ? "Parsing…" : state.parseResult ? "Parse again" : "Run parser"}
      </button>
      ${state.parseResult ? `
        <button class="btn btn-secondary" id="reviewBtn">Review results →</button>` : ""}
    </div>`;
}

// --- Step 3: Review ---

function renderReview() {
  const doc   = state.parseResult?.document;
  const items = [
  ...(doc?.containers ?? []).flatMap(c => c.items),
  ...(doc?.orphanItems ?? []),
];

    const filtered = items.filter((i) => {
  const text = i.text?.trim() || "";
  const lower = text.toLowerCase();

  if (!text) return false;

  // Fjern dokumentheader / metadata
  if (
    lower.includes("referat") &&
    lower.includes("dato") &&
    lower.includes("deltagere")
  ) return false;

  // Fjern rene sektionsoverskrifter som "4. Næste møde"
  if (/^\d+\.\s+[^\n.:]+$/i.test(text)) return false;

  const hasWorkflowKind =
    i.kind === "action" ||
    i.kind === "deadline" ||
    i.kind === "decision";

  const hasWorkflowScore =
    (i.scores?.action ?? 0) >= 0.25 ||
    (i.scores?.deadline ?? 0) >= 0.25 ||
    (i.scores?.decision ?? 0) >= 0.25;

  // behold også noter som "Intet til eventuelt"
  const isRelevantNote =
    /^(?:intet til|ingen bemærkninger|ingen kommentarer)/i.test(lower);

  return Boolean(
    i.responsible?.label ||
    i.date?.iso ||
    i.date?.dateHint ||
    hasWorkflowKind ||
    hasWorkflowScore ||
    isRelevantNote
  );
});

  return `
    <div>
      <p class="screen-eyebrow">Step 3</p>
      <h1 class="screen-title">Review extracted items</h1>
      <p class="screen-body">
        ${filtered.length} item${filtered.length !== 1 ? "s" : ""} extracted.
        Review what the parser found before generating your workflow.
      </p>
    </div>

    <div class="summary-box">
      <div>
        <p class="summary-stat-label">Items</p>
        <p class="summary-stat-value">${filtered.length}</p>
      </div>
      <div>
        <p class="summary-stat-label">Avg confidence</p>
        <p class="summary-stat-value">${Math.round((doc?.confidence ?? 0) * 100)}%</p>
      </div>
      <div>
        <p class="summary-stat-label">AI assisted</p>
        <p class="summary-stat-value">${state.parseResult?.meta?.aiAssistedCount ?? 0}</p>
      </div>
    </div>

    <div class="item-list">
      ${filtered.length
        ? filtered.map(renderItemCard).join("")
        : `<p class="muted" style="padding:24px 0">No items match this filter.</p>`}
    </div>

    <div class="actions" style="margin-top:8px">
      <button class="btn btn-ghost" id="backBtn">← Back</button>
      <button class="btn btn-primary" id="continueBtn">Confirm →</button>
    </div>`;
}

// --- Step 4: Export ---

function renderExport() {
  const doc   = state.parseResult?.document;
  const items = [
  ...(doc?.containers ?? []).flatMap(c => c.items),
  ...(doc?.orphanItems ?? []),
];

  return `
    <div>
      <p class="screen-eyebrow">Step 4</p>
      <h1 class="screen-title">Your workflow</h1>
      <p class="screen-body">
        Generated from <em>${escHtml(state.file?.name ?? "your document")}</em>.
        Export in the format that works best for you.
      </p>
    </div>

    <div class="workflow-header">
      <span class="workflow-title">${escHtml(doc?.title ?? "Untitled")}</span>
      <span class="workflow-meta">${items.length} items · ${new Date(doc?.parsedAt ?? "").toLocaleDateString("en-GB")}</span>
    </div>

    <div class="item-list">
      ${items.map(renderItemCard).join("")}
    </div>

    <div class="actions" style="margin-top:8px">
      <button class="btn btn-ghost"      id="backBtn">← Back</button>
      <button class="btn btn-secondary"  id="exportTxtBtn">Export TXT</button>
      <button class="btn btn-secondary"  id="exportPdfBtn">Export PDF</button>
      <button class="btn btn-ghost"      id="restartBtn">Start over</button>
    </div>`;
}

// --- Login screen ---

function renderLogin() {
  document.getElementById("app").innerHTML = `
    <div class="screen">
      <div>
        <p class="screen-eyebrow">Access</p>
        <h1 class="screen-title">Sign in to continue</h1>
        <p class="screen-body">Sign in with your Google account to use the Document Workflow Engine.</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="googleBtn">Continue with Google</button>
      </div>
    </div>`;

  document.getElementById("googleBtn")?.addEventListener("click", signInWithGoogle);
}

// ------------------------------------------------------------
// Event binding (re-run after each render)
// ------------------------------------------------------------

function bindEvents() {
  // File input
  document.getElementById("fileInput")?.addEventListener("change", e => {
    state.file        = e.target.files?.[0] ?? null;
    state.parseResult = null;
    state.parseError  = null;
    renderApp();
  });

  // Drag and drop
  const zone = document.getElementById("uploadZone");
  if (zone) {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", e => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) { state.file = file; state.parseResult = null; renderApp(); }
    });
  }

  // AI toggle
  document.getElementById("aiToggle")?.addEventListener("click", () => {
    state.useAi = !state.useAi;
    renderApp();
  });

  // Navigation
  document.getElementById("continueBtn")?.addEventListener("click", () => {
    state.step++;
    renderApp();
  });

  document.getElementById("backBtn")?.addEventListener("click", () => {
    state.step--;
    renderApp();
  });

  document.getElementById("reviewBtn")?.addEventListener("click", () => {
    state.step = 3;
    renderApp();
  });

  document.getElementById("restartBtn")?.addEventListener("click", () => {
    Object.assign(state, {
      step: 1, file: null, fileText: null,
      parseResult: null, filterKind: "all",
      parsing: false, parseError: null,
    });
    renderApp();
  });

  // Parse button
  document.getElementById("parseBtn")?.addEventListener("click", runParse);

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.filterKind = btn.dataset.kind;
      renderApp();
    });
  });

  // Export
  document.getElementById("exportTxtBtn")?.addEventListener("click", exportTxt);
  document.getElementById("exportPdfBtn")?.addEventListener("click", exportPdf);
}

// ------------------------------------------------------------
// Parse flow
// ------------------------------------------------------------

async function runParse() {
  if (!state.file) return;

  state.parsing    = true;
  state.parseError = null;
  renderApp();

  try {
    // 1. Extract text locally
    const text = await extractText(state.file);
    state.fileText = text;

    // 2. Send to Edge Function
    const result = await callEdgeFunction(text, state.session);
    state.parseResult = result;
    window._lastResult = result;
    state.parsing     = false;
    renderApp();
  } catch (err) {
    state.parsing    = false;
    state.parseError = err instanceof Error ? err.message : "Unknown error.";
    renderApp();
  }
}

// ------------------------------------------------------------
// Export
// ------------------------------------------------------------

function exportTxt() {
  const doc   = state.parseResult?.document;
  if (!doc) return;
  // Flatten containers + orphanItems
const items = [
  ...(doc.containers ?? []).flatMap(c => c.items),
  ...(doc.orphanItems ?? []),
];

  const lines = [`${doc.title}`, "=".repeat(48), ""];

  for (const item of items) {
    const date = formatDate(item.date) ?? "—";
    lines.push(`[${item.kind.toUpperCase()}] ${date}`);
    lines.push(item.text);
    if (item.responsible?.label) lines.push(`Responsible: ${item.responsible.label}`);
    lines.push("");
  }

  triggerDownload(lines.join("\n"), `${doc.title}.txt`, "text/plain");
}

function exportPdf() {
  const doc = state.parseResult?.document;
  if (!doc || !window.jspdf) return;
  // Flatten containers + orphanItems
const items = [
  ...(doc.containers ?? []).flatMap(c => c.items),
  ...(doc.orphanItems ?? []),
];

  const { jsPDF } = window.jspdf;
  const pdf       = new jsPDF({ unit: "mm", format: "a4" });
  const L = 15, R = 195, lh = 6;
  let y = 20;

  const check = () => { if (y > 270) { pdf.addPage(); y = 20; } };

  pdf.setFontSize(16); pdf.setFont("helvetica", "bold");
  pdf.text(doc.title, L, y); y += 12;

  for (const item of items) {
    check();
    pdf.setFontSize(9); pdf.setFont("helvetica", "normal");
    pdf.text(`[${item.kind.toUpperCase()}]  ${formatDate(item.date) ?? ""}`, L, y); y += lh;

    pdf.setFontSize(11); pdf.setFont("helvetica", "bold");
    pdf.splitTextToSize(item.text, R - L).forEach(l => { check(); pdf.text(l, L, y); y += lh; });

    if (item.responsible?.label) {
  pdf.setFontSize(9); pdf.setFont("helvetica", "normal");
  pdf.text(`Responsible: ${item.responsible.label}`, L, y); y += lh;
}
    y += 4;
  }

  pdf.save(`${doc.title}.pdf`);
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------

(async () => {
  const session = await getSession();
  state.session = session;

  if (!session) {
    renderLogin();
    return;
  }

  renderApp();
})();
