# Document Workflow Engine (DWE)

**DWE v2.2 — Baseline**

A deterministic engine that converts unstructured documents into structured workflow data.

DWE does not summarise text.
It interprets operational signals and reconstructs them as actionable workflow items.

---

# What DWE does

DWE processes documents such as:

* meeting notes
* project plans
* reports
* schedules

And extracts structured items:

* actions
* deadlines
* decisions
* context

The result is a **reviewable workflow**, not generated text.

---

# Core idea

Most documents already contain workflow information — but hidden in prose.

DWE makes it explicit:

```
Text
→ detect signals
→ extract structure
→ assemble workflow
→ review
```

---

# Example

Input:

```
Anna kontakter leverandøren senest 2026-03-17.
David opdaterer risikolog senest 2026-03-19.
Næste møde afholdes 2026-03-25.
```

Output:

```
📅 Deadline
Responsible: Anna
Task: Kontakter leverandøren
Date: 2026-03-17

📅 Deadline
Responsible: David
Task: Opdaterer risikolog
Date: 2026-03-19

📝 Context
Næste møde afholdes 2026-03-25
```

---

# Pipeline (v2.2)

DWE is a **deterministic pipeline**:

```
document
→ segment
→ clause
→ classify
→ extract
→ group
→ review
```

### Stages

| Stage           | Role                                                 |
| --------------- | ---------------------------------------------------- |
| Segmenter       | splits document into structural blocks               |
| Clause splitter | separates multiple signals in one sentence           |
| Classifier      | assigns type (action, deadline, decision, context)   |
| Extractor       | extracts structured fields (date, responsible, text) |
| Grouper         | assembles items into containers                      |
| Review          | presents result for confirmation                     |

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

If the system is uncertain, it returns `unknown`
It does not fabricate structure

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

**Version: DWE v2.2 — Baseline**

This version includes:

### Stable classification model

* correct separation of:

  * action vs context
  * event vs obligation
  * passive vs active constructions

### Multi-clause extraction

* multiple items per sentence supported

### Responsible detection

* works for:

  * named agents (`Anna kontakter`)
  * active verbs without modal markers

### Meeting/event handling

* distinguishes:

  * event assertions → context
  * agent-driven events → action

### Deadline logic

* handles:

  * obligation + constraint (`skal … inden`)
  * named agent + active verb + date (`Anna kontakter … senest`)

---

# What is NOT solved

This is a baseline — not a finished system.

Known limitations:

* limited handling of roles (`teamet`, `vi`)
* no semantic linking between items
* confidence is not calibrated across document types
* no advanced ambiguity resolution

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

# What v2.2 represents

DWE v2.2 is:

> The first **stable, end-to-end deterministic workflow extraction engine**

It marks the transition from:

* experimentation
  → to
* system behaviour

---

# Next phase

Focus shifts from correctness → robustness

### Upcoming focus

* noisy real-world documents
* incomplete sentences
* role-based agents
* structural variation

Goal:

> Identify where the system breaks — and why

---

# Long-term direction

```
Document
→ Workflow
→ Structured data
→ External systems
```

DWE is moving toward a **document-to-workflow infrastructure layer**

---

# Author

Yves
