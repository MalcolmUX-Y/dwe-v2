Document Workflow Engine (DWE)

A document-to-workflow engine that interprets structured documents and converts them into actionable operations.

---

# Overview

Document Workflow Engine (DWE) transforms documents people already work with into structured workflows.

Instead of manually reading through a document and figuring out what needs to happen next, DWE extracts operational signals — such as actions, deadlines, and decisions — and presents them as a reviewable workflow.

The system does not attempt to summarise documents.
It interprets them as **potential operations**.

The process always follows the same conceptual flow:

```
Document
→ structural interpretation
→ workflow proposal
→ human confirmation
→ exportable operations
```

The output is not prose.
It is **structured workflow data**.

---

# Core idea

Most organisational documents already contain operational information:

* actions
* deadlines
* decisions
* meetings
* responsibilities

However, these signals are embedded in narrative text, formatting conventions, and implicit structures that require human interpretation.

DWE performs that interpretation automatically and presents the result as a workflow that can be confirmed before use.

The system therefore acts as a **document interpreter**, not a summariser.

---

# Conceptual model

DWE can be understood as a **document-to-operation compiler**.

Instead of generating text summaries, it converts documents into structured operational elements.

```
Document
→ segmentation
→ extraction
→ classification
→ workflow interpretation
→ human verification
→ operational output
```

This model is closer to a compiler than to a traditional AI tool.

| Compiler          | DWE                 |
| ----------------- | ------------------- |
| Source code       | Document            |
| Tokenization      | Segmentation        |
| Parsing           | Extraction          |
| Semantic analysis | Classification      |
| Validation        | Review step         |
| Machine code      | Workflow operations |

The system therefore produces **operational structure**, not narrative output.

---

# Current pipeline

The current parsing pipeline is:

```
document
→ segmenter
→ clause splitter
→ classifier
→ extractor
→ grouper
→ UI review
```

Where:

* **Segmenter** divides the document into structural blocks
* **Clause splitter** identifies multiple operational signals inside the same sentence
* **Classifier** categorises signals (action, deadline, decision, context)
* **Extractor** extracts operational fields (date, responsible, etc.)
* **Grouper** assembles extracted items into workflow-relevant entries
* **UI review** allows human verification before export

---

# Frontend workflow

The user interface follows a simple linear process:

```
Step 1
Upload document

Step 2
Parse document

Step 3
Review extracted workflow items

Step 4
Export workflow
```

Step 3 acts as a **semantic verification layer**, ensuring that the system’s interpretation can be corrected before producing the final workflow.

---

# Current project status (v2.0.2)

The project is currently in **DWE v2.0.2**, which introduces the first complete workflow review layer.

Major capabilities now include:

### Multi-signal extraction

The parser can extract multiple workflow signals from a single text segment, such as:

```
Anna indkalder senest 14.03
Næste møde afholdes 18.03
```

Both can be detected independently.

---

### Structured workflow interpretation

Extracted items are now interpreted as workflow signals:

* ⚡ Action
* 📅 Deadline
* ✓ Decision
* 📝 Context / Note

These signals are displayed in the review interface.

---

### Review-based workflow confirmation

Step 3 now functions as a **workflow review interface** rather than a debug output.

The UI groups items into:

```
Ready
Needs review
Hidden
```

This allows the user to confirm the operational interpretation before exporting the workflow.

---

### Operational summary

The interface also presents a quick interpretation summary such as:

```
⚡ 3 actions
📅 4 deadlines
✓ 1 decision
```

This provides immediate insight into what the document appears to contain.

---

### Frontend modularisation

The UI architecture has been improved:

```
app.js
review.js
```

Where:

* `app.js` manages application flow
* `review.js` manages workflow review logic

This isolates the most complex interface layer and allows further improvements without destabilising the main application logic.

---

# Supported document types

DWE works best with documents that contain implicit operational structure, including:

* meeting minutes
* course programmes
* semester plans
* project descriptions
* internal reports
* contracts
* agendas
* planning documents

Any document where a human would normally extract tasks manually is a potential input.

---

# Design principles

### The local parser is the product

The core extraction logic lives inside the codebase.
This ensures predictable behaviour and independence from external AI services.

---

### AI is optional

AI can be used as a fallback when the rule-based parser cannot confidently interpret a segment.

The system therefore remains usable even without external AI providers.

---

### Consistent output, flexible input

The input format can vary widely.
The output structure remains stable.

This ensures learnability and predictable user expectations.

---

### Human verification is essential

Documents contain ambiguity.
Rather than pretending to fully automate interpretation, DWE introduces a **review step** where the system’s interpretation can be confirmed or adjusted.

---

# Next architectural step

The next major evolution of the system is the introduction of a **lightweight relations layer**.

Currently, extracted items are treated as independent elements.

Example:

```
Anna indkalder senest 14.03
Næste møde afholdes 18.03
```

These items are related but currently displayed separately.

The relations layer introduces simple structural links between workflow items.

---

## Proposed relation model

Each workflow item may include:

```
groupKey
relationType
parentKey
```

Example:

```
Meeting
  ├─ Next meeting: 18.03
  └─ Action: Anna sends invitation before 14.03
```

This enables the UI to present workflows as **structured clusters instead of flat lists**.

---

# Near-term development priorities

The next development phase focuses on improving workflow curation.

Key improvements include:

### Item-level review controls

Allow users to:

* hide irrelevant items
* promote items from review to workflow

---

### Workflow grouping

Introduce the relations layer so related items can be visually grouped.

---

### Structured export

Ensure exported workflows preserve structure and relationships between items.

---

# Technology stack

Frontend

* HTML
* CSS
* Vanilla JavaScript

Document extraction

* PDF.js
* Mammoth.js

Backend parsing

* Supabase Edge Functions
* Deno / TypeScript

Deployment

* GitHub Pages

---

# Long-term vision

DWE is designed to evolve from a document parser into a **document-to-workflow engine**.

Future capabilities may include:

```
Document
→ Workflow
→ Integration layer
→ External systems
```

Example integrations:

* task managers
* calendars
* project management tools
* knowledge systems

The goal is not just to understand documents — but to convert them into operational workflows.

---

# Author

Yves

---

Hvis du vil, kan jeg også lave en **kortere “GitHub-style README” version** (mere startup/produkt-agtig), fordi den du har nu faktisk begynder at ligne en **whitepaper README**. Begge typer kan være gode, men de har lidt forskelligt formål.
