# Document Workflow Engine 2.0

A document-to-action engine that transforms any structured document into a clear, actionable workflow.

## Overview

Document Workflow Engine (DWE) is a lightweight, front-end-first tool that takes documents people already have — and turns them into something they can act on.

Instead of reading through a PDF and manually figuring out what to do next, DWE extracts the structure and presents it as a prioritised, dated list of actions.

## Core idea

Most documents contain implicit structure — deadlines, responsibilities, sessions, decisions, tasks. But that structure is buried in prose, tables, and formatting that requires human interpretation before anything can happen.

DWE makes that interpretation automatic.

The output is always the same shape:

- what needs to happen
- when it needs to happen
- who is responsible (if stated)

The input can be almost anything.

## Supported document types

- Meeting minutes
- Course programmes and semester plans
- Project descriptions
- Contracts and agreements
- Agendas
- Reports with action points
- Any document where a human would normally extract a to-do list manually

## Design principles

**The local parser is the product.** Parsing logic lives in the codebase — not in a third-party AI service. This keeps the core behaviour predictable, auditable, and independent of external providers.

**AI is a thin, optional layer.** If the local parser cannot confidently extract structure from a segment, an AI call can be made as a fallback. The AI provider is swappable without touching anything else.

**Consistent output, flexible input.** Following Alan Dix's principle of affordance and learnability — the output format never surprises the user. What changes is how the content is derived, not what it looks like.

**Minimise cognitive cost.** Following Gloria Mark's research on attention and context switching — the tool exists to eliminate the gap between receiving a document and knowing what to do with it.

## Tech stack

- HTML / CSS / JavaScript (no framework)
- PDF.js for PDF text extraction
- Mammoth.js for DOCX extraction
- Supabase Edge Functions (Deno / TypeScript) for document parsing
- GitHub Pages for deployment

## Architecture

```
Frontend
  ├── Upload (PDF or DOCX)
  ├── Extract raw text locally (PDF.js / Mammoth)
  └── Send to Edge Function

Edge Function
  ├── Segment text into meaningful blocks
  ├── Classify each block (action, event, info, deadline)
  ├── Local rule-based parser (primary)
  ├── AI fallback (optional, provider-agnostic)
  └── Return structured JSON

Frontend
  ├── Review extracted items
  ├── Confirm and generate workflow
  └── Export (TXT / PDF)
```

## What makes this different from AI document tools

Most AI document tools send your document to a model and return a summary. DWE is not a summariser.

The goal is a structured, actionable output — not prose. The local parser understands document conventions (dates, labels, bullet patterns, section headers) and maps them to a consistent data model. AI is used only where rule-based logic cannot reach.

This means the tool works without an API key, degrades gracefully, and does not depend on any single provider's continued existence or pricing.

## Author

Yves
