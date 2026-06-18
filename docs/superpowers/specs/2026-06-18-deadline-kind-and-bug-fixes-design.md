# DWE — Deadline Kind & Bug Fixes Design

**Date:** 2026-06-18  
**Status:** Approved  
**Goal:** Reach ~80% classifier accuracy on Testkorpus v0.1 and fix 3 known E2E pipeline bugs.

---

## Context

The regression suite (`regression_corpus.test.ts`, `regression_e2e.test.ts`) revealed two categories of failure:

1. **Classifier gap**: 16/40 corpus cases fail. All 8 deadline corpus cases fail because `deadline` is not a `BaseKind` — it was moved to the temporal axis in v3.0. The user's stated priority is *deadline prominence first, responsible person second*, which requires deadline as a first-class output kind.

2. **Three E2E bugs**:
   - Bug 1: multiclause "Anna X og David Y" produces one item instead of two
   - Bug 2: date string remains in action text instead of being stripped
   - Bug 3: decision items lose their associated date through validator nulling

---

## Success Criteria

- `regression_corpus.test.ts`: ≥ 32/40 passing (~80%)
- `regression_e2e.test.ts`: Bug 1, Bug 2, Bug 3 tests all pass
- No regressions in existing unit tests

---

## Architecture Decision: Deadline as a 4th BaseKind

`deadline` is promoted to a first-class identity kind alongside `action`, `decision`, `context`.

`KindScores` stays as three dimensions (`action | decision | context`) — deadline is determined by a post-scoring promotion rule, not by competing inside the identity normalisation. This avoids reweighting the existing three-way competition.

The confidence score for deadline-promoted items uses `deadlineRaw` directly (the temporal signal strength), not the identity axis result — which would otherwise reflect context winning and give misleadingly low confidence.

---

## Changes by File

### 1. `types.ts`

Add `"deadline"` to `BaseKind`:

```typescript
export type BaseKind = "action" | "decision" | "deadline" | "context";
```

No change to `KindScores` — it remains `{ action, decision, context }`.

---

### 2. `classifier.ts`

**2a — Promotion rule** (end of `classifySegment`, after `kind` is determined):

```typescript
if (deadlineRaw >= 0.4 && actionRaw < 0.3 && kind !== "decision") {
  kind = "deadline";
  // use deadline signal strength, not identity competition
  overrideConfidence = deadlineRaw;
}
```

Gate logic:
- `deadlineRaw >= 0.4`: strong deadline signal required
- `actionRaw < 0.3`: no strong named actor — "Anna sender rapport senest fredag" stays `action` (actionRaw ≈ 0.72)
- `kind !== "decision"`: decisions are never promoted to deadline

**2b — `detectDeadlineSignal` enhancements:**

| Gap | Failing case | Fix |
|---|---|---|
| Month-name dates not matched | "15. november", "9. maj", "28. februar" | Add `\b\d{1,2}\.\s*(?:januar\|februar\|marts\|april\|maj\|juni\|juli\|august\|september\|oktober\|november\|december)\b` to `hasDate` |
| "Afleveringsfrist" not a label | "Afleveringsfrist: 15. november." | Add `afleveringsfrist` to `isLabelStyleDeadline` pattern |
| Closure verbs missing | "Tilmelding lukker fredag", "Sprint 4 slutter 28. februar" | Add `lukker\|slutter\|udløber` → +0.35 to deadline score |
| "inden udgangen af" not a constraint | "afsluttet inden udgangen af Q1" | Add to `hasConstraint` check |
| Past-participle frist verbs | "afsluttet", "indsendt" | Add to `hasFristVerb` pattern |

Known gap: D04 "Review-perioden løber fra 3. til 14. februar" — no constraint marker, stays `context`. Acceptable at 80% target.

---

### 3. `extractor.ts`

**Bug 2 fix — lower residual-words guard:**

In `extractActionText`, change:

```typescript
// Before
if (residualWords <= 3 && !/\d{4}-\d{2}-\d{2}/.test(cleaned)) {
  return { text: "", confidence: 0 };
}

// After
if (residualWords <= 1 && !/\d{4}-\d{2}-\d{2}/.test(cleaned)) {
  return { text: "", confidence: 0 };
}
```

Root cause: "Anna indkalder deltagere senest 2026-04-01" → after name and date stripping, 2 words remain ("indkalder deltagere"). The `<= 3` guard discards them, returning `text: ""`. `pipeline.ts` then falls back to `extraction.text || text.slice(0, 120)`, restoring the unstripped original. Lowering to `<= 1` lets two-word verb phrases through.

---

### 4. `validator.ts`

**Bug 3 fix — add closure verbs to `TEMPORAL_BINDING_PATTERN`:**

```typescript
// Add to existing pattern:
|lukker|lukkes|slutter|afsluttet|ophører|udløber
```

Root cause: "testmiljøet lukkes 2026-03-22" has one date but no binding marker (`senest`, `inden`, etc.), so `checkDateBinding` returns `"none"` and the date is nulled. "lukkes" is a closure verb that explicitly binds a date — it must count as a binding marker.

Side effect: also fixes D06 "Tilmelding lukker fredag" and D08 "Sprint 4 slutter 28. februar" as deadline corpus cases.

**Deadline kind validation — add `case "deadline"` to `validateKind`:**

```typescript
case "deadline": {
  const hasDate = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./\-]\d{1,2}/.test(text);
  const hasMarker = DEADLINE_MARKER_PATTERN.test(text);
  if (!hasDate && !hasMarker) return "context";
  return "deadline";
}
```

Without this, the validator falls through to `default → "context"`, undoing the classifier's deadline promotion.

---

### 5. `clause-splitter.ts`

**Bug 1 fix — apply coordinated clause split to final buckets:**

```typescript
// In the expandedBuckets construction, add flatMap:
const expandedBuckets = buckets
  .map((text) => text.trim())
  .filter(Boolean)
  .filter((text) => !isBareListMarker(text))
  .flatMap((text) => splitCoordinatedWorkflowClause(text)); // ← add
```

Root cause: `splitCoordinatedWorkflowClause` is defined and correct but never called on the final bucket list. It splits "Anna X og David Y" where both sides have independent workflow signals (verb + date). The function already has conservative guards that prevent over-splitting "Anna og Peter udarbejder oplægget" (left side "Anna" has no workflow signal alone).

---

### 6. `grouper.ts`

Add `deadline` to session detection:

```typescript
// Before
const hasActionOrDeadline = items.some(i => i.kind === "action");

// After
const hasActionOrDeadline = items.some(
  i => i.kind === "action" || i.kind === "deadline"
);
```

---

## Change Surface Summary

| File | Type of change |
|---|---|
| `types.ts` | Add `"deadline"` to `BaseKind` |
| `classifier.ts` | Promotion rule + 5 signal enhancements |
| `extractor.ts` | Lower residual-words guard `<= 3` → `<= 1` |
| `validator.ts` | Closure verbs in `TEMPORAL_BINDING_PATTERN`, `case "deadline"` in `validateKind` |
| `clause-splitter.ts` | `flatMap(splitCoordinatedWorkflowClause)` on final buckets |
| `grouper.ts` | `|| i.kind === "deadline"` in session detection |

Frontend (`review.js`) requires no changes — the deadline chip already checks `item.kind === "deadline"`.

---

## Test Impact

- `regression_corpus.test.ts`: D01–D03, D05–D08 pass (7/8 deadline cases). D04 stays failing (known gap). Expected total: ~32/40.
- `regression_e2e.test.ts`: Bug 1, Bug 2, Bug 3 tests pass.
- Existing unit tests (`patterns`, `extractor`, `clause-splitter`, `pipeline`): no regressions expected. One extractor test may need updating if it asserts the old `<= 3` threshold behaviour.
