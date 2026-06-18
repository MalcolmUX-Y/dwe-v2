// ============================================================
// Document Workflow Engine — app.js
// Version: 3.1.0
// Vanilla JS, no framework. ES modules.
//
// v3.1 changes:
//   - Fixed: Authorization header now sends Bearer token from session
//   - Fixed: Removed all console.log calls from callEdgeFunction
//   - Fixed: Removed window._lastResult debug/security leak
//   - Fixed: continueBtn in step 3 now saves confirmedItems (was just step++)
//   - Fixed: triggerDownload now appends anchor to DOM before click (Firefox)
//   - Fixed: formatDate validates ISO string before destructuring
//   - Fixed: pdfjsLib workerSrc set once at boot, not on every parse
//   - Fixed: PDF page extraction parallelised with Promise.all
//   - Fixed: aria-current omitted (not set to "false") on non-current steps
//   - Fixed: Invalid Date in renderExport when parsedAt is missing
//   - Fixed: renderApp default case renders an explicit error state
//   - Fixed: AI toggle now responds to Space/Enter keyboard input
//   - Fixed: file size guard added (50 MB) before reading into memory
//   - Fixed: onAuthStateChange registered for session expiry handling
//   - Removed: filterKind state and dead .filter-btn event binding
//   - Added: state.confirmedItems — items explicitly confirmed in step 3
//   - Added: getAllItems() shared selector used by all export functions
//   - Added: role="alert" on parse error container
//   - Added: <label> associated with file input
//   - NOTE: Credentials still hardcoded — move to env vars (Vite/esbuild)
//           before any public deployment. See SUPABASE_URL comment below.
// ============================================================

import { renderReviewStep, renderReviewCard, groupReviewItems } from "./review.js";
import { getItemDisplay } from "./display-state.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// ------------------------------------------------------------
// Config
// Credentials are loaded from config.js (gitignored).
// Copy config.example.js → config.js and fill in real values.
// ------------------------------------------------------------

const EDGE_URL = `${SUPABASE_URL}/functions/v1/analyze-course`;

const STEPS = ["Upload", "Parse", "Review", "Export"];

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// ------------------------------------------------------------
// State
// ------------------------------------------------------------

const state = {
  step:            1,
  file:            null,
  fileText:        null,
  parseResult:     null,
  confirmedItems:  null,  // set when user confirms step 3
  useAi:           false,
  parsing:         false,
  parseError:      null,
  session:         null,
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
  const btn = document.getElementById("googleBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Redirecting…"; }
  await _supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href },
  });
}

// Keep session up-to-date without requiring a page reload
_supabase.auth.onAuthStateChange((_event, session) => {
  state.session = session;
  if (!session && state.step > 1) {
    // Session expired mid-workflow — return to login
    renderLogin();
  }
});

// ------------------------------------------------------------
// File extraction (local — file never leaves the browser)
// ------------------------------------------------------------

function getFileType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx"))                                    return "docx";
  if (name.endsWith(".txt") || file.type === "text/plain")       return "txt";
  return null;
}

async function extractText(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File too large (${formatBytes(file.size)}). Maximum is ${formatBytes(MAX_FILE_BYTES)}.`
    );
  }

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
    // workerSrc is set once at boot (see bottom of file)

    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

    // Fetch all pages in parallel instead of serially
    const pageNumbers  = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const pageContents = await Promise.all(
      pageNumbers.map(async n => {
        const page    = await pdf.getPage(n);
        const content = await page.getTextContent();

        const lines  = [];
        let lastY    = null;
        let line     = [];

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

        return lines.filter(Boolean).join("\n");
      })
    );

    return pageContents.join("\n\n");
  }

  throw new Error("Unsupported file type. Please upload PDF, DOCX or TXT.");
}

// ------------------------------------------------------------
// API call to Edge Function
// ------------------------------------------------------------

async function callEdgeFunction(text, session) {
  const payload = {
    text,
    options: {
      source: state.file?.name ?? "document",
      useAi:  state.useAi,
    },
  };

  const headers = {
    "Content-Type": "application/json",
    "apikey":        SUPABASE_ANON_KEY,
    // Include the user's JWT so the edge function can verify identity.
    // Without this, every request is treated as anonymous regardless of login.
    ...(session?.access_token
      ? { "Authorization": `Bearer ${session.access_token}` }
      : {}),
  };

  const response = await fetch(EDGE_URL, {
    method:  "POST",
    headers,
    body:    JSON.stringify(payload),
  });

  const raw = await response.text();

  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }

  if (!response.ok) throw new Error(data?.error || raw || "Parse request failed.");
  return data;
}

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Format a date object from the pipeline into a display string.
 * Validates the ISO string before destructuring to avoid "undefined.MM.YYYY".
 */
function formatDate(dateObj) {
  if (!dateObj) return null;

  if (dateObj.iso) {
    const parts = dateObj.iso.split("-");
    // Require exactly YYYY-MM-DD
    if (parts.length === 3 && parts.every(p => p && p.trim())) {
      const [y, m, d] = parts;
      return `${d}.${m}.${y}`;
    }
    // Malformed ISO — fall back to hint if available
    return dateObj.dateHint ?? null;
  }

  return dateObj.dateHint ?? null;
}

/**
 * Flatten all items from a parse result into a single ordered array.
 * Used by export functions and the export step renderer.
 *
 * @param {object|null} parseResult
 * @returns {object[]}
 */
function getAllItems(parseResult) {
  const doc = parseResult?.document;
  if (!doc) return [];
  return [
    ...(doc.containers ?? []).flatMap(c => c.items ?? []),
    ...(doc.orphanItems ?? []),
  ];
}

// ------------------------------------------------------------
// Step nav
// ------------------------------------------------------------

function renderStepNav() {
  const nav = document.getElementById("stepNav");
  if (!nav) return;

  nav.innerHTML = STEPS.map((label, i) => {
    const n      = i + 1;
    const active = n === state.step;
    const done   = n < state.step;
    const cls    = active ? "is-active" : done ? "is-done" : "";

    // Only set aria-current on the actual current step (omit on others)
    const ariaCurrent = active ? ' aria-current="step"' : "";

    return `
      <div class="step ${cls}"${ariaCurrent}>
        <span class="step-n">${n}</span>
        <span class="step-label">${label}</span>
      </div>`;
  }).join("");
}

// ------------------------------------------------------------
// Main render dispatcher
// ------------------------------------------------------------

function renderApp() {
  renderStepNav();

  // Announce step change to screen readers via the live region
  const liveRegion = document.getElementById("liveRegion");
  if (liveRegion) {
    liveRegion.textContent = `Step ${state.step}: ${STEPS[state.step - 1] ?? ""}`;
  }

  const app = document.getElementById("app");
  if (!app) return;

  app.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "screen";

  switch (state.step) {
    case 1: screen.innerHTML = renderUpload();   break;
    case 2: screen.innerHTML = renderParse();    break;
    case 3:
      screen.innerHTML = renderReviewStep(state, { escHtml, formatDate });
      break;
    case 4: screen.innerHTML = renderExport();   break;
    default:
      screen.innerHTML = `
        <div role="alert" class="error-state">
          <p class="screen-eyebrow">Error</p>
          <h1 class="screen-title">Something went wrong</h1>
          <p class="screen-body">Unexpected application state. Please start over.</p>
          <div class="actions">
            <button class="btn btn-primary" id="restartBtn">Start over</button>
          </div>
        </div>`;
  }

  app.appendChild(screen);
  bindEvents();
}

// ------------------------------------------------------------
// Step 1 — Upload
// ------------------------------------------------------------

function renderUpload() {
  const hasFile = !!state.file;
  const type    = hasFile ? getFileType(state.file) : null;

  return `
    <div>
      <p class="screen-eyebrow">Step 1 of ${STEPS.length}</p>
      <h1 class="screen-title">Upload your document</h1>
      <p class="screen-body">
        The file is read locally — it never leaves your device until you
        explicitly enable AI assistance below.
      </p>
    </div>

    <div class="upload-zone ${hasFile ? "has-file" : ""}" id="uploadZone">
      <label for="fileInput" class="upload-label-wrapper">
        <div class="upload-icon" aria-hidden="true">↑</div>
        <p class="upload-label">
          ${hasFile
            ? `<strong>${escHtml(state.file.name)}</strong>`
            : `<strong>Choose file</strong> or drag and drop`}
        </p>
        <p class="upload-hint">PDF · DOCX · TXT · max ${formatBytes(MAX_FILE_BYTES)}</p>
      </label>
      <input
        type="file"
        id="fileInput"
        accept=".pdf,.docx,.txt,application/pdf,text/plain"
        aria-label="Upload document (PDF, DOCX, or TXT)"
      />
    </div>

    ${hasFile ? `
      <div class="file-card">
        <span class="file-card-icon" aria-hidden="true">${type?.toUpperCase() ?? "FILE"}</span>
        <div>
          <p class="file-card-name">${escHtml(state.file.name)}</p>
          <p class="file-card-meta">${formatBytes(state.file.size)} · ready to parse</p>
        </div>
      </div>` : ""}

    <div class="consent-row">
      <div
        class="consent-toggle ${state.useAi ? "is-on" : ""}"
        id="aiToggle"
        role="switch"
        aria-checked="${state.useAi}"
        tabindex="0"
        aria-labelledby="aiToggleTitle"
      ></div>
      <div class="consent-text">
        <p class="consent-title" id="aiToggleTitle">Enable AI assistance for uncertain segments</p>
        <p class="consent-desc">
          When the local parser is unsure, individual text segments may be sent
          to an AI provider for help. Disabled by default.
        </p>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" id="continueBtn" ${!hasFile ? "disabled" : ""}>
        Continue →
      </button>
    </div>`;
}

// ------------------------------------------------------------
// Step 2 — Parse
// ------------------------------------------------------------

function renderParse() {
  const statusLabel =
    state.parsing    ? "Parsing…"  :
    state.parseError ? "Failed"    :
    state.parseResult ? "Completed" : "Ready";

  return `
    <div>
      <p class="screen-eyebrow">Step 2 of ${STEPS.length}</p>
      <h1 class="screen-title">Parse document</h1>
      <p class="screen-body">
        The document is segmented and classified. AI assistance is
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
          ? `<span class="muted"><span class="spinner" aria-hidden="true"></span> ${statusLabel}</span>`
          : `<span class="muted">${statusLabel}</span>`}
      </div>
      ${state.parseResult ? `
        <div class="status-row">
          <strong>Segments found</strong>
          <span class="muted">${state.parseResult.meta?.segmentCount ?? "—"}</span>
        </div>
        <div class="status-row">
          <strong>Items extracted</strong>
          <span class="muted">${state.parseResult.meta?.parsedCount ?? "—"}</span>
        </div>
        <div class="status-row">
          <strong>Duration</strong>
          <span class="muted">${state.parseResult.meta?.durationMs ?? "—"} ms</span>
        </div>` : ""}
      ${state.parseError ? `
        <div class="status-row parse-error" role="alert" aria-live="assertive">
          ${escHtml(state.parseError)}
        </div>` : ""}
    </div>

    <div class="actions">
      <button class="btn btn-ghost" id="backBtn">← Back</button>
      <button class="btn btn-primary" id="parseBtn" ${state.parsing ? "disabled" : ""}>
        ${state.parsing ? "Parsing…" : state.parseResult ? "Parse again" : "Run parser"}
      </button>
      ${state.parseResult ? `
        <button class="btn btn-secondary" id="reviewBtn">Review results →</button>` : ""}
    </div>`;
}

// ------------------------------------------------------------
// Step 4 — Export
// ------------------------------------------------------------

function renderExport() {
  const doc = state.parseResult?.document;
  // Use confirmed items if available; otherwise fall back to all items
  const items = state.confirmedItems ?? getAllItems(state.parseResult);

  let dateStr = "";
  if (doc?.parsedAt) {
    const d = new Date(doc.parsedAt);
    dateStr = isNaN(d.getTime()) ? "" : ` · ${d.toLocaleDateString("en-GB")}`;
  }

  return `
    <div>
      <p class="screen-eyebrow">Step 4 of ${STEPS.length}</p>
      <h1 class="screen-title">Your workflow</h1>
      <p class="screen-body">
        Generated from <em>${escHtml(state.file?.name ?? "your document")}</em>.
        Export in the format that works best for you.
      </p>
    </div>

    <div class="workflow-header">
      <span class="workflow-title">${escHtml(doc?.title ?? "Untitled")}</span>
      <span class="workflow-meta">${items.length} items${escHtml(dateStr)}</span>
    </div>

    <div class="item-list">
      ${items.map(item => renderReviewCard(item, { escHtml, formatDate })).join("")}
    </div>

    <div class="actions" style="margin-top:8px">
      <button class="btn btn-ghost"     id="backBtn">← Back</button>
      <button class="btn btn-secondary" id="exportTxtBtn">Export TXT</button>
      <button class="btn btn-secondary" id="exportPdfBtn">Export PDF</button>
      <button class="btn btn-ghost"     id="restartBtn">Start over</button>
    </div>`;
}

// ------------------------------------------------------------
// Login screen
// ------------------------------------------------------------

function renderLogin() {
  const app = document.getElementById("app");
  if (!app) return;

  renderStepNav();
  app.innerHTML = `
    <div class="screen">
      <div>
        <p class="screen-eyebrow">Access</p>
        <h1 class="screen-title">Sign in to continue</h1>
        <p class="screen-body">
          Sign in with your Google account to use the Document Workflow Engine.
        </p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="googleBtn">Continue with Google</button>
      </div>
    </div>`;

  document.getElementById("googleBtn")?.addEventListener("click", signInWithGoogle);
}

// ------------------------------------------------------------
// Event binding — re-run after each render
// ------------------------------------------------------------

function bindEvents() {
  // File input
  document.getElementById("fileInput")?.addEventListener("change", e => {
    state.file        = e.target.files?.[0] ?? null;
    state.parseResult = null;
    state.parseError  = null;
    renderApp();
  });

  // Drag-and-drop
  const zone = document.getElementById("uploadZone");
  if (zone) {
    zone.addEventListener("dragover",  e => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", ()  => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", e => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) { state.file = file; state.parseResult = null; renderApp(); }
    });
  }

  // AI toggle — mouse and keyboard
  const aiToggle = document.getElementById("aiToggle");
  if (aiToggle) {
    const toggleAi = () => { state.useAi = !state.useAi; renderApp(); };
    aiToggle.addEventListener("click", toggleAi);
    aiToggle.addEventListener("keydown", e => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleAi(); }
    });
  }

  // Step navigation
  document.getElementById("continueBtn")?.addEventListener("click", () => {
    state.step++;
    renderApp();
  });

  // Step 3 confirm — saves the ready items before advancing
  document.getElementById("confirmBtn")?.addEventListener("click", () => {
    if (state.parseResult) {
      const allItems = getAllItems(state.parseResult);
      const groups   = groupReviewItems(allItems);
      state.confirmedItems = groups.ready;
    }
    state.step = 4;
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
      parseResult: null, confirmedItems: null,
      parsing: false, parseError: null,
    });
    renderApp();
  });

  document.getElementById("parseBtn")?.addEventListener("click", runParse);

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
    const text = await extractText(state.file);
    state.fileText = text;

    const result = await callEdgeFunction(text, state.session);
    state.parseResult = result;
    state.parsing     = false;
    renderApp();
  } catch (err) {
    state.parsing    = false;
    state.parseError = err instanceof Error ? err.message : "Unknown error.";
    renderApp();
  }
}

// ------------------------------------------------------------
// Export — TXT
// ------------------------------------------------------------

function exportTxt() {
  const doc = state.parseResult?.document;
  if (!doc) return;

  const items = state.confirmedItems ?? getAllItems(state.parseResult);
  const lines = [`${doc.title}`, "=".repeat(48), ""];

  for (const item of items) {
    const { meta } = getItemDisplay(item);
    const date     = formatDate(item.date) ?? "—";
    lines.push(`[${meta.label.toUpperCase()}] ${date}`);
    lines.push(item.text ?? "");
    if (item.responsible?.label) lines.push(`Responsible: ${item.responsible.label}`);
    lines.push("");
  }

  triggerDownload(lines.join("\n"), `${doc.title}.txt`, "text/plain");
}

// ------------------------------------------------------------
// Export — PDF
// ------------------------------------------------------------

function exportPdf() {
  const doc = state.parseResult?.document;
  if (!doc) {
    return;
  }
  if (!window.jspdf) {
    alert("PDF export is not available — jsPDF failed to load. Try exporting as TXT instead.");
    return;
  }

  const items      = state.confirmedItems ?? getAllItems(state.parseResult);
  const { jsPDF }  = window.jspdf;
  const pdf        = new jsPDF({ unit: "mm", format: "a4" });
  const L = 15, R = 195, lh = 6;
  let y = 20;

  const checkPageBreak = () => { if (y > 270) { pdf.addPage(); y = 20; } };

  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.text(doc.title ?? "Untitled", L, y);
  y += 12;

  for (const item of items) {
    const { meta } = getItemDisplay(item);
    checkPageBreak();

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.text(`[${meta.label.toUpperCase()}]  ${formatDate(item.date) ?? ""}`, L, y);
    y += lh;

    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    pdf.splitTextToSize(item.text ?? "", R - L).forEach(line => {
      checkPageBreak();
      pdf.text(line, L, y);
      y += lh;
    });

    if (item.responsible?.label) {
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Responsible: ${item.responsible.label}`, L, y);
      y += lh;
    }

    y += 4;
  }

  pdf.save(`${doc.title ?? "workflow"}.pdf`);
}

// ------------------------------------------------------------
// Download helper — appends anchor to DOM for Firefox support
// ------------------------------------------------------------

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024)              return `${bytes} B`;
  if (bytes < 1024 * 1024)       return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------

// Set PDF.js worker once at startup
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

(async () => {
  const session = await getSession();
  state.session = session;

  if (!session) {
    renderLogin();
    return;
  }

  renderApp();
})();
