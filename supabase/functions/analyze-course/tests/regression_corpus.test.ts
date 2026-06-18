// ============================================================
// Classifier corpus regression — Testkorpus v0.1 (40 cases)
//
// Ground truth: Testkorpus v0.1.txt (40 labeled examples).
// Each test runs classifySegment and asserts the expected kind.
// A failure here means a classifier change regressed a known case.
// ============================================================

import { assertEquals } from "jsr:@std/assert";
import { classifySegment } from "../classifier.ts";

type KorpusCase = { id: string; text: string; expectedKind: string };

const CORPUS: KorpusCase[] = [
  // ACTION (8)
  { id: "A01", text: "Send opdateret tidsplan til alle projektdeltagere senest fredag.", expectedKind: "action" },
  { id: "A02", text: "Mikkel opdaterer risikoregisteret inden næste møde.", expectedKind: "action" },
  { id: "A03", text: "Der skal indhentes tilbud fra mindst tre leverandører.", expectedKind: "action" },
  { id: "A04", text: "Skriv referat og del med styregruppen.", expectedKind: "action" },
  { id: "A05", text: "IT opsætter testmiljø til piloten.", expectedKind: "action" },
  { id: "A06", text: "Opdater kravspecifikationen med feedback fra workshoppen.", expectedKind: "action" },
  { id: "A07", text: "Gennemgå alle åbne punkter fra Q3 og luk dem der er løst.", expectedKind: "action" },
  { id: "A08", text: "Louise og Jonas koordinerer med juridisk afdeling om kontraktudkastet.", expectedKind: "action" },

  // DEADLINE (8)
  { id: "D01", text: "Afleveringsfrist: 15. november.", expectedKind: "deadline" },
  { id: "D02", text: "Projektet skal være afsluttet inden udgangen af Q1 2025.", expectedKind: "deadline" },
  { id: "D03", text: "Ansøgningen skal indsendes senest den 1. marts kl. 12.00.", expectedKind: "deadline" },
  { id: "D04", text: "Review-perioden løber fra 3. til 14. februar.", expectedKind: "deadline" },
  { id: "D05", text: "Deadline for indsendelse af materialer er torsdag.", expectedKind: "deadline" },
  { id: "D06", text: "Tilmelding lukker fredag den 9. maj.", expectedKind: "deadline" },
  { id: "D07", text: "Alle bidrag skal være klar til korrektur senest d. 20.", expectedKind: "deadline" },
  { id: "D08", text: "Sprint 4 slutter 28. februar.", expectedKind: "deadline" },

  // DECISION (8)
  { id: "DC01", text: "Det blev besluttet at udskyde lanceringen til marts.", expectedKind: "decision" },
  { id: "DC02", text: "Gruppen valgte React frem for Vue til frontend-løsningen.", expectedKind: "decision" },
  { id: "DC03", text: "Styregruppen godkendte budgetforhøjelsen på 200.000 kr.", expectedKind: "decision" },
  { id: "DC04", text: "Vi fastholder den nuværende leverandør.", expectedKind: "decision" },
  { id: "DC05", text: "Projektet fortsætter ikke i sin nuværende form.", expectedKind: "decision" },
  { id: "DC06", text: "API-first-arkitekturen er vedtaget som teknisk retning.", expectedKind: "decision" },
  { id: "DC07", text: "Scope reduceres til MVP-funktionalitet for release 1.", expectedKind: "decision" },
  { id: "DC08", text: "Bestyrelsen afviste forslaget om outsourcing.", expectedKind: "decision" },

  // CONTEXT (8)
  { id: "CT01", text: "Projektet er finansieret via EU-midler frem til 2026.", expectedKind: "context" },
  { id: "CT02", text: "Systemet understøtter i øjeblikket tre brugerroller.", expectedKind: "context" },
  { id: "CT03", text: "Workshoppen afholdes i mødelokale 4.", expectedKind: "context" },
  { id: "CT04", text: "Denne fase dækker perioden august–oktober.", expectedKind: "context" },
  { id: "CT05", text: "Tidligere forsøg på integration mislykkedes grundet manglende API-adgang.", expectedKind: "context" },
  { id: "CT06", text: "Der deltager ca. 12 personer fra tre afdelinger.", expectedKind: "context" },
  { id: "CT07", text: "Systemet er i drift og håndterer dagligt ca. 4.000 transaktioner.", expectedKind: "context" },
  { id: "CT08", text: "Baggrunden for initiativet er den nye databeskyttelseslovgivning.", expectedKind: "context" },

  // EDGE CASES (8) — intentionally ambiguous; correct kind per Testkorpus v0.1 notes
  { id: "E01", text: "Møde om budgetgodkendelse afholdes tirsdag kl. 10.", expectedKind: "context" },
  { id: "E02", text: "Der skal tages stilling til valg af hostingplatform.", expectedKind: "action" },
  { id: "E03", text: "Ansvarlig: Peter.", expectedKind: "context" },
  { id: "E04", text: "Overvej om tidsplanen skal justeres.", expectedKind: "action" },
  { id: "E05", text: "Projektet afsluttes i juni.", expectedKind: "deadline" },
  { id: "E06", text: "It was agreed that the report should be finalized by end of week.", expectedKind: "decision" },
  { id: "E07", text: "Næste skridt besluttes på baggrund af pilotresultaterne.", expectedKind: "action" },
  { id: "E08", text: "Budgettet er ikke godkendt.", expectedKind: "context" },
];

for (const { id, text, expectedKind } of CORPUS) {
  Deno.test(`corpus ${id} → ${expectedKind}: "${text.slice(0, 55)}"`, () => {
    const result = classifySegment(text);
    assertEquals(
      result.kind,
      expectedKind,
      `[${id}] got kind="${result.kind}", want "${expectedKind}"\n  text: "${text}"`,
    );
  });
}
