// ============================================================
// Document Workflow Engine — patterns.ts
// Version: 1.0.0
//
// Shared pattern library — single source of truth for
// classifier and validator.
//
// First commit: centralisering + bevidst semantisk stramning
// af action/obligation-grænsen.
//
// Policy:
//   - "sørger for", "har ansvar", "er ansvarlig" er obligation,
//     ikke direkte handling. De er ikke tilstrækkelige alene
//     som actor-verb binding.
//   - Modal alene er ikke tilstrækkelig evidens for action.
//   - Passive konstruktioner uden agent tvinger context.
// ============================================================

// ------------------------------------------------------------
// Direct action verbs
// Sufficient alone for actor-verb binding.
// ------------------------------------------------------------
export const DIRECT_ACTION_VERB_PATTERN =
  /(?:\b(?:sender|fremsender|kontakter|indkalder|afholder|arrangerer|udarbejder|godkender|opdaterer|reviderer|følger op|opsætter|implementerer|koordinerer|leverer|sends?|contacts?|organis[ae]s?|prepares?|approves?|updates?|reviews?|follows? up|delivers?|implements?|coordinates?|send|fremsend|kontakt|indkald|afhold|arrangér|udarbejd|godkend|opdater|revidér|opsæt|implementer|koordiner|lever|skriv|del)\b|gennemgå(?=\s|[.,;:!?)]|$))/i;

// ------------------------------------------------------------
// Obligation / responsibility markers
// Indicate assignment of responsibility — not direct execution.
// Not sufficient alone for actor-verb binding.
// ------------------------------------------------------------
export const OBLIGATION_PATTERN =
  /\b(?:sørger for|har ansvar|er ansvarlig)\b/i;

// ------------------------------------------------------------
// Modal verbs
// Valid only when followed by a direct action verb in sourceText.
// Modal alone is not sufficient evidence of action.
// ------------------------------------------------------------
export const MODAL_VERB_PATTERN =
  /\b(?:skal|bør|will|must|shall|should|needs? to|has to|have to)\b/i;

// ------------------------------------------------------------
// Passive constructions
// Indicate process or requirement — not a named actor.
// When present without a direct action verb: responsible = null.
// ------------------------------------------------------------
export const PASSIVE_PATTERN =
  /\b(?:sendes|fremsendes|opdateres|udarbejdes|leveres|indsendes|godkendes|revideres|afholdes|is sent|is prepared|is approved|is updated|is reviewed)\b/i;

// ------------------------------------------------------------
// Passive no-agent constructions
// Force context — no responsible can be named.
// ------------------------------------------------------------
export const PASSIVE_NO_AGENT_PATTERN =
  /\b(?:der følges op|der udarbejdes|der fremsendes|der indkaldes|der afholdes|der sendes|rapporten sendes|materialet sendes|oplægget sendes)\b/i;

// ------------------------------------------------------------
// Decision markers
// Required for a clause to be classified as decision.
// ------------------------------------------------------------
export const DECISION_MARKER_PATTERN =
  /\b(?:besluttet|beslutter|beslutning|aftalt|aftaler|vedtaget|vedtager|resolved|decided|agreed|it was decided|det blev besluttet|det er besluttet|vi beslutter|vi besluttede|we decided|we agreed|valgte|afviste|fastholder|godkendte)\b/i;

// ------------------------------------------------------------
// Deadline markers
// Required for a clause to be classified as deadline.
// ------------------------------------------------------------
export const DEADLINE_MARKER_PATTERN =
  /\b(?:senest|inden|deadline|frist|skal være færdig|skal afleveres|afleveres senest|due|no later than|by)\b/i;

// ------------------------------------------------------------
// Structural anchor patterns
// Shared by extractor.ts, grouper.ts, and any future modules
// that need to detect structural positions in source text.
// ------------------------------------------------------------

/**
 * Matches a numeric date in ISO, full numeric, or short numeric form.
 * Used to detect date anchors in first-line position.
 */
export const DATE_ANCHOR_PATTERN =
  /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}|\d{1,2}[./]\d{1,2})\b/;

/**
 * Matches a numbered section prefix at the start of a line.
 * Covers: "1.", "2.1.", "A.", "I.", "Punkt 3", "Agenda 2"
 */
export const NUMBERED_SECTION_PATTERN =
  /^(?:(?:[0-9]+\.)+\s|[A-Z]\.\s|[IVX]+\.\s|[Pp]unkt\s+\d+|[Aa]genda\s+\d+)/;

/**
 * Matches an ALL-CAPS heading line (2–49 characters after first letter).
 * Used to detect structural headings in first-line position.
 */
export const HEADING_PATTERN =
  /^[A-ZÆØÅ][A-ZÆØÅ\s\d]{2,49}$/;