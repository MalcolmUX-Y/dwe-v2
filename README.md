**DWE v2.4 — Conservative validation baseline**

A deterministic engine that converts unstructured documents into structured workflow data.

DWE does not summarise text.  
It detects operational signals, validates them conservatively, and reconstructs them as reviewable workflow items.

---

# What DWE does

DWE processes documents such as:

* meeting notes
* project plans
* reports
* schedules

And extracts structured items such as:

* actions
* decisions
* context

With temporal and responsibility data attached where explicitly supported.

The result is a **reviewable workflow**, not generated text.

---

# Core idea

Most documents already contain workflow information — but hidden in prose.

DWE makes it explicit:

```

Text
→ detect signals
→ extract structure
→ validate conservatively
→ assemble workflow
→ review

```

---

# Example

Input:

```

Anna kontakter leverandøren senest 2026-03-17.
David opdaterer risikolog inden næste møde.
Næste møde afholdes 2026-03-25.
Det blev besluttet at udskyde lanceringen til marts.

```

Output:

```

✅ Action
Responsible: Anna
Task: Kontakter leverandøren
Date: 2026-03-17

✅ Action
Responsible: David
Task: Opdaterer risikolog
Date: inden næste møde

📝 Context
Næste møde afholdes 2026-03-25

📌 Decision
Udskyde lanceringen til marts

```

---

# Pipeline (v2.4)

DWE is a **deterministic pipeline**:

```

document
→ segment
→ clause
→ classify
→ extract
→ validate
→ group
→ review

```

### Stages

| Stage           | Role                                                          |
| ----------------| ------------------------------------------------------------- |
| Segmenter       | splits document into structural blocks                        |
| Clause splitter | separates multiple signals in one sentence                    |
| Classifier      | assigns kind (action, decision, context)                      |
| Extractor       | extracts structured fields (date, responsible, text)          |
| Validator       | conservatively removes unsupported structure                  |
| Grouper         | assembles items into containers                               |
| Review          | presents result for confirmation                              |

---

# Key properties

### Deterministic

Same input → same output  
No probabilistic guessing in the core pipeline

---

### Traceable

Every item can be traced directly back to source text

---

### No hidden inference

If the system is uncertain, it returns `unknown` or degrades to a safer representation  
It does not fabricate structure

---

### Conservative by design

The system only keeps structure that is explicitly supported by surface signals

---

### Layer separation

Each stage has a single responsibility  
No stage compensates for another

---

# What makes DWE different

Most tools:

```

Document → AI → summary

```

DWE:

```

Document → structured workflow → review → export

```

Output is **data**, not text.

The system is designed to preserve operational meaning without inventing it.

---

# Frontend flow

```

1 Upload document
2 Parse
3 Review workflow
4 Export

```

Step 3 is mandatory — the system proposes, the user confirms.

---

# Current status

**Version: DWE v2.4 — Conservative validation baseline**

This version includes:

### Explicit validation layer

* `validate` is now a dedicated pipeline stage
* conservative rules are enforced centrally rather than implicitly across modules

### Clause-first parsing

* multiple items per sentence supported
* clause splitting happens before classification

### Stable action / decision / context separation

* direct actions remain actionable
* event assertions remain context
* decision language is separated from action language

### Improved decision detection

* handles explicit decision forms such as:

  * `det er besluttet`
  * `har aftalt`
  * `valgte`
  * `afviste`
  * `fastholder`
  * `godkendte`

### Temporal obligation handling

* obligation + temporal binding can survive validation as action
* examples now handled correctly include constructions such as:

  * `skal indsendes senest`
  * `skal underskrives senest`
  * `skal være afsluttet inden`
  * `skal være klar senest`
  * `lukker fredag`

### Event / meeting protection

* descriptive scheduling statements are preserved as context
* examples such as meeting announcements and review periods no longer collapse into action

### Review-layer stability

* review is status-first
* the user sees proposed workflow items, not hidden backend assumptions

---

# What is NOT solved

This is a stable baseline — not a finished system.

Known limitations:

* limited handling of role-based actors (`teamet`, `vi`, departments)
* no semantic linking between related items
* confidence is not calibrated across document types
* no advanced ambiguity resolution
* no deep cross-sentence dependency handling

### Open model question

The following case is still intentionally unresolved:

* absolute-date obligation without explicit deadline marker

Example:

* `Materialet skal være afleveret den 15. november`

This currently remains conservative, because the system has not yet formally decided whether absolute date alone is sufficient temporal evidence.

---

# Tech stack

**Frontend**

* HTML
* CSS
* Vanilla JS

**Parsing**

* Supabase Edge Functions
* Deno / TypeScript

**Document ingestion**

* PDF.js
* Mammoth.js

---

# Design principles

### Parser-first architecture

The system is rule-based at its core.  
AI is not required for normal operation.

---

### Validation before presentation

Parsed structure is not trusted automatically.  
It must survive explicit validation before it reaches review.

---

### AI as fallback (optional)

AI may be introduced later for:

* normalization
* ambiguity resolution

Never for core parsing.

---

### Human-in-the-loop

DWE does not assume correctness.  
All workflows are reviewed before use.

---

# What v2.4 represents

DWE v2.4 is:

> The first stable version where conservative interpretation is enforced as architecture

It marks the transition from:

* rule accumulation
  → to
* rule enforcement

This is the point where DWE stops being only a parser and becomes a controlled workflow extraction system.

---

# Next phase

Focus shifts from baseline correctness → document robustness

### Upcoming focus

* noisy real-world documents
* incomplete and fragmented sentences
* role-based actors
* structural variation
* unresolved temporal edge cases

Goal:

> Identify where the conservative model should expand — and where it should refuse

---

# Long-term direction

```

Document
→ Workflow
→ Structured data
→ External systems

````

DWE is moving toward a **document-to-workflow infrastructure layer**

---

# Author

Yves
```

Min vurdering: den her er meget tættere på din nuværende README’s form end det, jeg gjorde før, men den er stadig lidt mere præcis og moden i “Current status” og “What v2.4 represents” end v2.2-versionen var. Det passer bedre til, hvor projektet faktisk er nu.

Det eneste sted, hvor der stadig er et reelt valg, er versionsnavnet i undertitlen. Jeg ville selv vælge en af disse tre:

- **DWE v2.4 — Conservative validation baseline**
- **DWE v2.4 — Stable validation baseline**
- **DWE v2.4 — Deterministic workflow baseline**

Den første er den mest sandfærdige i forhold til det arbejde, I faktisk lige har gjort.
````
