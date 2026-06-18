# Deadline Kind & Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `deadline` as a first-class output kind to the pipeline and fix three known E2E bugs (multiclause split, date stripping, decision date loss), reaching ~80% classifier accuracy on Testkorpus v0.1.

**Architecture:** `deadline` is promoted post-scoring in the classifier — the 3-way `KindScores` normalisation is unchanged; a promotion rule fires when `deadlineRaw >= 0.4 && actionRaw < 0.3 && kind !== "decision"`. The three E2E bugs each have a single-line root-cause fix in their respective modules.

**Tech Stack:** Deno, TypeScript, `jsr:@std/assert`. All tests run with `deno test <path> --no-check`. Working directory: `~/dwe`.

---

## File Map

| File | Change |
|---|---|
| `supabase/functions/analyze-course/types.ts` | Add `"deadline"` to `BaseKind` |
| `supabase/functions/analyze-course/classifier.ts` | Enhance `detectDeadlineSignal` + add promotion rule |
| `supabase/functions/analyze-course/extractor.ts` | Lower residual-words guard (Bug 2) |
| `supabase/functions/analyze-course/clause-splitter.ts` | Wire `splitCoordinatedWorkflowClause` on final buckets (Bug 1) |
| `supabase/functions/analyze-course/validator.ts` | Add closure verbs to `TEMPORAL_BINDING_PATTERN` (Bug 3) + `case "deadline"` in `validateKind` |
| `supabase/functions/analyze-course/grouper.ts` | Include `deadline` in session detection |

---

## Task 1: Extend BaseKind with "deadline"

**Files:**
- Modify: `supabase/functions/analyze-course/types.ts`

- [ ] **Step 1: Confirm current state**

```bash
cd ~/dwe && export PATH="$HOME/.deno/bin:$PATH"
grep -n "BaseKind" supabase/functions/analyze-course/types.ts
```

Expected output includes:
```
29:export type BaseKind =
30:  | "action"
31:  | "decision"
32:  | "context";
```

- [ ] **Step 2: Add "deadline" to BaseKind**

In `supabase/functions/analyze-course/types.ts`, replace:

```typescript
export type BaseKind =
  | "action"
  | "decision"
  | "context";
```

With:

```typescript
export type BaseKind =
  | "action"
  | "decision"
  | "deadline"
  | "context";
```

- [ ] **Step 3: Commit**

```bash
cd ~/dwe && git add supabase/functions/analyze-course/types.ts
git commit -m "feat: add deadline as a first-class BaseKind"
```

---

## Task 2: Add `case "deadline"` to validateKind

Without this, the validator's `switch (kind)` falls through to `default → "context"`, immediately undoing any deadline promotion from the classifier.

**Files:**
- Modify: `supabase/functions/analyze-course/validator.ts`

- [ ] **Step 1: Locate the switch in validateKind**

```bash
cd ~/dwe && grep -n "case \"decision\"" supabase/functions/analyze-course/validator.ts
```

Expected: a line around 318.

- [ ] **Step 2: Add the deadline case**

In `supabase/functions/analyze-course/validator.ts`, find:

```typescript
    case "decision": {
      if (!DECISION_MARKER_PATTERN.test(text)) return "context";
      return "decision";
    }

    case "context":
    default:
      return "context";
```

Replace with:

```typescript
    case "decision": {
      if (!DECISION_MARKER_PATTERN.test(text)) return "context";
      return "decision";
    }

    case "deadline": {
      const hasDate = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./\-]\d{1,2}/.test(text);
      const hasMarker = DEADLINE_MARKER_PATTERN.test(text);
      if (!hasDate && !hasMarker) return "context";
      return "deadline";
    }

    case "context":
    default:
      return "context";
```

- [ ] **Step 3: Verify DEADLINE_MARKER_PATTERN is already imported**

```bash
grep -n "DEADLINE_MARKER_PATTERN" supabase/functions/analyze-course/validator.ts | head -5
```

Expected: appears in both the import list and the `validateKind` action case. If not in the import, add it to the import from `"./patterns.ts"`.

- [ ] **Step 4: Run existing tests to confirm no regressions**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/ --no-check 2>&1 | tail -5
```

Expected: same pass/fail counts as before (24 corpus + 5 E2E passing, 3 E2E + 16 corpus failing).

- [ ] **Step 5: Commit**

```bash
cd ~/dwe && git add supabase/functions/analyze-course/validator.ts
git commit -m "feat: add deadline case to validateKind — prevents validator from undoing classifier promotion"
```

---

## Task 3: Enhance detectDeadlineSignal

Five gaps in the current signal detector cause D01–D08 corpus cases to score below the promotion threshold.

**Files:**
- Modify: `supabase/functions/analyze-course/classifier.ts`

- [ ] **Step 1: Confirm the 8 deadline corpus cases all currently fail**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_corpus.test.ts --no-check 2>&1 | grep "^corpus D"
```

Expected: all 8 lines show `FAILED`.

- [ ] **Step 2: Patch hasDate to include month-name dates**

In `supabase/functions/analyze-course/classifier.ts`, find:

```typescript
  const hasDate =
    /\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/.test(t);
```

Replace with:

```typescript
  const hasDate =
    /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
    /\b\d{1,2}[./\-]\d{1,2}(?:[./\-]\d{2,4})?\b/.test(t) ||
    /\b\d{1,2}\.\s*(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b/i.test(t);
```

- [ ] **Step 3: Patch hasFristVerb to include past-participle forms**

Find:

```typescript
  const hasFristVerb =
    /\b(?:afleveres?|indsendes|underskrives|afsluttes|fremsendes|sendes|godkendes)\b/i.test(t);
```

Replace with:

```typescript
  const hasFristVerb =
    /\b(?:afleveres?|afleveret|indsendes|indsendt|underskrives|underskrevet|afsluttes|afsluttet|fremsendes|sendes|godkendes)\b/i.test(t);
```

- [ ] **Step 4: Patch hasConstraint to include "inden udgangen af"**

Find:

```typescript
  const hasConstraint =
    /\b(?:by|before|until|no later than|deadline|due|senest|frist|afleveres?|indsend)\b/i.test(t) ||
    (/\b(inden)\b/i.test(t) && (hasDate || hasFristVerb || hasWeekday));
```

Replace with:

```typescript
  const hasConstraint =
    /\b(?:by|before|until|no later than|deadline|due|senest|frist|afleveres?|indsend)\b/i.test(t) ||
    (/\b(?:inden)\b/i.test(t) && (hasDate || hasFristVerb || hasWeekday)) ||
    /\binden udgangen af\b/i.test(t);
```

- [ ] **Step 5: Patch isLabelStyleDeadline to include "afleveringsfrist"**

Find:

```typescript
  const isLabelStyleDeadline =
    /^(?:deadline|frist|due date|aflevering|submission date|dato)\s*:/i.test(t);
```

Replace with:

```typescript
  const isLabelStyleDeadline =
    /^(?:deadline|frist|due date|aflevering|afleveringsfrist|submission date|dato)\s*:/i.test(t);
```

- [ ] **Step 6: Add closure verb score boost**

Find the final scoring block in `detectDeadlineSignal` — just before `return clamp(score);`:

```typescript
  // Slight extra boost for explicit label + date
  if (isLabelStyleDeadline && hasDate) {
    score += 0.15;
  }

  return clamp(score);
```

Replace with:

```typescript
  // Slight extra boost for explicit label + date
  if (isLabelStyleDeadline && hasDate) {
    score += 0.15;
  }

  // Closure verbs: explicitly bind a date to a closing event
  if (/\b(?:lukker|lukkes|slutter|udløber|ophører)\b/i.test(t)) {
    score += 0.35;
  }

  return clamp(score);
```

- [ ] **Step 7: Run corpus tests — deadline signal scores should now be high enough**

```bash
cd ~/dwe && deno eval "
import { classifySegment } from './supabase/functions/analyze-course/classifier.ts';
const cases = [
  'Afleveringsfrist: 15. november.',
  'Projektet skal være afsluttet inden udgangen af Q1 2025.',
  'Ansøgningen skal indsendes senest den 1. marts kl. 12.00.',
  'Tilmelding lukker fredag den 9. maj.',
  'Sprint 4 slutter 28. februar.',
];
for (const c of cases) {
  const r = classifySegment(c);
  console.log(r.kind.padEnd(10), c.slice(0, 55));
}
" --no-check 2>&1
```

At this point kind will still be `context` for most — the promotion rule (Task 4) hasn't been added yet. What you are verifying is that the signal scores are high enough. To inspect them:

```bash
cd ~/dwe && deno eval "
import { classifySegment } from './supabase/functions/analyze-course/classifier.ts';
const t = 'Afleveringsfrist: 15. november.';
const r = classifySegment(t);
console.log('kind:', r.kind, '| confidence:', r.confidence.toFixed(2), '| temporalScores.deadline:', r.temporalScores.deadline.toFixed(2));
" --no-check 2>&1
```

Expected: `temporalScores.deadline` >= 0.7 for this case.

- [ ] **Step 8: Commit**

```bash
cd ~/dwe && git add supabase/functions/analyze-course/classifier.ts
git commit -m "feat: enhance detectDeadlineSignal — month names, closure verbs, afleveringsfrist, inden udgangen af"
```

---

## Task 4: Add deadline promotion rule to classifySegment

**Files:**
- Modify: `supabase/functions/analyze-course/classifier.ts`

- [ ] **Step 1: Locate the guard block end in classifySegment**

```bash
cd ~/dwe && grep -n "Step 5: Compute confidence" supabase/functions/analyze-course/classifier.ts
```

The promotion rule inserts just before that line.

- [ ] **Step 2: Insert the promotion rule**

Find the block ending with the close of the margin guard and the start of Step 5:

```typescript
  // Step 5: Compute confidence from kind scores
  const confidence = computeConfidence(kindScores);
```

Replace with:

```typescript
  // Step 4b: Promote to deadline when temporal signal is strong and no named actor
  // Confidence for promoted items uses deadlineRaw directly — not identity competition.
  let overrideConfidence: number | null = null;
  if (deadlineRaw >= 0.4 && actionRaw < 0.3 && kind !== "decision") {
    kind = "deadline";
    overrideConfidence = deadlineRaw;
  }

  // Step 5: Compute confidence from kind scores
  const confidence = overrideConfidence ?? computeConfidence(kindScores);
```

- [ ] **Step 3: Run the corpus deadline cases**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_corpus.test.ts --no-check 2>&1 | grep "^corpus D"
```

Expected: D01, D02, D03, D05, D06, D07, D08 show `ok`. D04 ("Review-perioden løber fra") may still fail — that is acceptable.

- [ ] **Step 4: Run full corpus test**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_corpus.test.ts --no-check 2>&1 | tail -3
```

Expected: ≥ 31 passed (up from 24).

- [ ] **Step 5: Commit**

```bash
cd ~/dwe && git add supabase/functions/analyze-course/classifier.ts
git commit -m "feat: promote segments to deadline kind when temporal signal is strong and no named actor"
```

---

## Task 5: Fix date stripping in action text (Bug 2)

Root cause: after stripping name + date from "Anna indkalder deltagere senest 2026-04-01", only 2 words remain ("indkalder deltagere"). The `<= 3` residual guard discards them, `extractActionText` returns `""`, and `pipeline.ts` falls back to the raw unstripped segment.

**Files:**
- Modify: `supabase/functions/analyze-course/extractor.ts`

- [ ] **Step 1: Confirm Bug 2 test currently fails**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_e2e.test.ts --no-check 2>&1 | grep "BUG 2"
```

Expected: `FAILED`.

- [ ] **Step 2: Lower the residual-words guard**

In `supabase/functions/analyze-course/extractor.ts`, find:

```typescript
  // Guard: resttekst efter dato-stripping er for kort til at være meningsfuld
  const residualWords = cleaned.split(/\s+/).filter(Boolean).length;
  if (residualWords <= 3 && !/\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return { text: "", confidence: 0 };
  }
```

Replace with:

```typescript
  // Guard: resttekst efter dato-stripping er for kort til at være meningsfuld
  const residualWords = cleaned.split(/\s+/).filter(Boolean).length;
  if (residualWords <= 1 && !/\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return { text: "", confidence: 0 };
  }
```

- [ ] **Step 3: Run Bug 2 E2E test**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_e2e.test.ts --no-check --filter "BUG 2" 2>&1 | tail -5
```

Expected: `ok`.

- [ ] **Step 4: Confirm existing extractor unit tests still pass**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/extractor.test.ts --no-check 2>&1 | tail -3
```

Expected: 3 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
cd ~/dwe && git add supabase/functions/analyze-course/extractor.ts
git commit -m "fix: lower residual-words guard in extractActionText from <=3 to <=1 (Bug 2 — date not stripped)"
```

---

## Task 6: Wire coordinated clause split (Bug 1)

Root cause: `splitCoordinatedWorkflowClause` is defined and correct but never called on the final bucket list in `splitSegmentIntoClauses`. Multiclause lines like "Anna X og David Y" pass through as a single bucket.

**Files:**
- Modify: `supabase/functions/analyze-course/clause-splitter.ts`

- [ ] **Step 1: Confirm Bug 1 test currently fails**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_e2e.test.ts --no-check --filter "BUG 1" 2>&1 | tail -5
```

Expected: `FAILED`.

- [ ] **Step 2: Add flatMap to expandedBuckets**

In `supabase/functions/analyze-course/clause-splitter.ts`, find:

```typescript
  const expandedBuckets = buckets
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((text) => !isBareListMarker(text));
```

Replace with:

```typescript
  const expandedBuckets = buckets
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((text) => !isBareListMarker(text))
    .flatMap((text) => splitCoordinatedWorkflowClause(text));
```

- [ ] **Step 3: Run Bug 1 E2E test**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_e2e.test.ts --no-check --filter "BUG 1" 2>&1 | tail -5
```

Expected: `ok`.

- [ ] **Step 4: Run existing clause-splitter unit tests**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/clause-splitter.test.ts --no-check 2>&1 | tail -3
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
cd ~/dwe && git add supabase/functions/analyze-course/clause-splitter.ts
git commit -m "fix: apply splitCoordinatedWorkflowClause to final buckets (Bug 1 — multiclause og-split)"
```

---

## Task 7: Fix decision date validation (Bug 3)

Root cause: `checkDateBinding` in `validator.ts` requires a binding marker (`senest`, `inden`, etc.) for a date to survive. "Det blev besluttet, at testmiljøet lukkes 2026-03-22" has no such marker — "lukkes" is a closure verb that binds the date but is not in `TEMPORAL_BINDING_PATTERN`.

**Files:**
- Modify: `supabase/functions/analyze-course/validator.ts`

- [ ] **Step 1: Confirm Bug 3 test currently fails**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_e2e.test.ts --no-check --filter "BUG 3" 2>&1 | tail -5
```

Expected: `FAILED`.

- [ ] **Step 2: Add closure verbs to TEMPORAL_BINDING_PATTERN**

In `supabase/functions/analyze-course/validator.ts`, find:

```typescript
const TEMPORAL_BINDING_PATTERN =
  /\b(?:senest|inden|before|by|deadline|frist|afleveres?|afholdes|finder sted|takes place|scheduled|planlagt til|d\.|kl\.|på|until|no later than|due)\b/i;
```

Replace with:

```typescript
const TEMPORAL_BINDING_PATTERN =
  /\b(?:senest|inden|before|by|deadline|frist|afleveres?|afholdes|finder sted|takes place|scheduled|planlagt til|d\.|kl\.|på|until|no later than|due|lukker|lukkes|slutter|afsluttet|ophører|udløber)\b/i;
```

- [ ] **Step 3: Run Bug 3 E2E test**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/regression_e2e.test.ts --no-check --filter "BUG 3" 2>&1 | tail -5
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
cd ~/dwe && git add supabase/functions/analyze-course/validator.ts
git commit -m "fix: add closure verbs to TEMPORAL_BINDING_PATTERN (Bug 3 — decision loses date)"
```

---

## Task 8: Update grouper session detection

**Files:**
- Modify: `supabase/functions/analyze-course/grouper.ts`

- [ ] **Step 1: Locate the hasActionOrDeadline check**

```bash
cd ~/dwe && grep -n "hasActionOrDeadline\|i\.kind === \"action\"" supabase/functions/analyze-course/grouper.ts
```

Expected: a line like `const hasActionOrDeadline = items.some(i => i.kind === "action");`

- [ ] **Step 2: Include deadline in session detection**

Find:

```typescript
    const hasActionOrDeadline = items.some(
      i => i.kind === "action"
    );
```

Replace with:

```typescript
    const hasActionOrDeadline = items.some(
      i => i.kind === "action" || i.kind === "deadline"
    );
```

- [ ] **Step 3: Commit**

```bash
cd ~/dwe && git add supabase/functions/analyze-course/grouper.ts
git commit -m "feat: include deadline kind in grouper session detection"
```

---

## Task 9: Final verification and deploy

- [ ] **Step 1: Run full test suite**

```bash
cd ~/dwe && deno test supabase/functions/analyze-course/tests/ --no-check 2>&1 | tail -10
```

Expected:
- Corpus: ≥ 31 passed (up from 24)
- E2E: ≥ 7 passed (up from 5) — Bug 1, 2, 3 now pass
- No previously-passing test should now fail

- [ ] **Step 2: Spot-check deadline output end-to-end**

```bash
cd ~/dwe && deno eval "
import { runPipeline } from './supabase/functions/analyze-course/pipeline.ts';
const cases = [
  'Afleveringsfrist: 15. november.',
  'Tilmelding lukker fredag den 9. maj.',
  'Det blev besluttet, at testmiljøet lukkes 2026-03-22.',
  'Anna indkalder deltagere senest 2026-04-01.',
  'Anna kontakter leverandøren senest 2026-03-17 og David opdaterer risikolog senest 2026-03-19.',
];
for (const text of cases) {
  const r = await runPipeline(text, { source: 'test.txt' });
  const items = [...r.document.containers.flatMap(c=>c.items), ...r.document.orphanItems];
  for (const i of items) {
    console.log(i.kind.padEnd(10), i.date?.iso ?? i.date?.dateHint ?? 'null', '|', i.responsible?.label ?? 'null', '|', i.text.slice(0, 50));
  }
  console.log('---');
}
" --no-check 2>&1
```

Expected output shape:
```
deadline   null      | null  | Afleveringsfrist: 15. november.
---
deadline   null      | null  | Tilmelding lukker fredag den 9. maj.
---
decision   2026-03-22| null  | Det blev besluttet, at testmiljøet lukkes ...
---
action     2026-04-01| Anna  | Indkalder deltagere
---
action     2026-03-17| Anna  | Kontakter leverandøren
action     2026-03-19| David | Opdaterer risikolog
---
```

- [ ] **Step 3: Deploy to Supabase**

```bash
cd ~/dwe && supabase functions deploy analyze-course
```

- [ ] **Step 4: Push to GitHub**

```bash
cd ~/dwe && git push
```
