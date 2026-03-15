# Document Workflow Engine (DWE)

Transform documents into structured, actionable workflows.

Document Workflow Engine interprets everyday documents — meeting notes, plans, reports — and converts them into structured workflow items such as actions, deadlines, and decisions.

Instead of summarising text, DWE extracts operational signals and presents them as a workflow that can be reviewed before export.

---

# Why this exists

Most documents already contain operational information:

* tasks
* deadlines
* decisions
* responsibilities
* meetings

But this information is buried in prose and formatting.

DWE automatically interprets that structure and produces a **reviewable workflow**.

---

# What makes DWE different

Most AI document tools generate summaries.

DWE does something else:

```
Document
→ interpret structure
→ extract operational signals
→ confirm workflow
→ export structured tasks
```

The output is **structured workflow data**, not text.

---

# Example

Input document:

```
Anna kontakter leverandøren senest 6 marts.
Næste møde afholdes 18 marts.
Anna indkalder senest 14 marts.
```

DWE interprets:

```
⚡ Action
Anna contacts supplier
Deadline: 2026-03-06

📅 Meeting
Next meeting
Date: 2026-03-18

⚡ Action
Send meeting invitation
Responsible: Anna
Deadline: 2026-03-14
```

---

# Current pipeline

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

| Stage           | Purpose                                    |
| --------------- | ------------------------------------------ |
| Segmenter       | split document into meaningful blocks      |
| Clause splitter | detect multiple signals in one sentence    |
| Classifier      | identify type (action, deadline, decision) |
| Extractor       | extract fields (date, responsible, etc.)   |
| Grouper         | assemble workflow items                    |
| UI Review       | confirm interpretation                     |

---

# Frontend workflow

The user interface follows four steps:

```
1 Upload document
2 Parse document
3 Review extracted workflow
4 Export workflow
```

Step 3 is critical:
the system proposes a workflow and the user confirms it.

---

# Current status

Current version: **DWE v2.0.2**

Major capabilities now include:

### Multi-item extraction

Multiple workflow signals can be extracted from a single sentence.

---

### Workflow review interface

Step 3 now groups items into:

```
Ready
Needs review
Hidden
```

This allows users to quickly confirm the operational interpretation.

---

### Workflow signal detection

The system detects workflow signals such as:

```
⚡ Action
📅 Deadline
✓ Decision
📝 Context
```

---

### Workflow summary

The interface also provides a quick interpretation overview:

```
⚡ 3 actions
📅 4 deadlines
✓ 1 decision
```

---

### Modular UI architecture

Frontend code is now separated into:

```
app.js
review.js
```

Where:

* `app.js` manages application flow
* `review.js` handles workflow review logic

---

# Tech stack

Frontend

* HTML
* CSS
* Vanilla JavaScript

Document extraction

* PDF.js
* Mammoth.js

Parsing

* Supabase Edge Functions
* Deno / TypeScript

Deployment

* GitHub Pages

---

# Supported document types

DWE works best with documents containing implicit operational structure:

* meeting minutes
* course schedules
* project descriptions
* agendas
* reports with action points
* contracts
* planning documents

---

# Design principles

### Local parser first

The rule-based parser is the core of the system.
This ensures predictable behaviour and independence from external AI services.

---

### AI is optional

AI can be used as a fallback when the local parser cannot confidently interpret a segment.

---

### Human-in-the-loop

Documents are ambiguous.
Instead of pretending full automation is possible, DWE introduces a **review stage** where the workflow can be verified.

---

# Next development steps

The next iteration focuses on improving workflow curation.

### Item-level controls

Allow users to hide or promote extracted items during review.

---

### Workflow relations

Introduce lightweight relationships between items, enabling structured workflows instead of flat lists.

Example:

```
Meeting
  ├─ Next meeting: 18.03
  └─ Action: Send invitation before 14.03
```

---

### Structured export

Export workflows as structured data that can integrate with external tools.

---

# Long-term vision

DWE is evolving from a document parser into a **document-to-workflow engine**.

Future architecture:

```
Document
→ Workflow
→ Integration layer
→ External systems
```

Potential integrations:

* project management tools
* calendars
* task managers
* knowledge systems

---

# Author

Yves
