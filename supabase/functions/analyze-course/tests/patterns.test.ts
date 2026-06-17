import { assertEquals } from "jsr:@std/assert";
import {
  DATE_ANCHOR_PATTERN,
  NUMBERED_SECTION_PATTERN,
  HEADING_PATTERN,
} from "../patterns.ts";

Deno.test("DATE_ANCHOR_PATTERN matches ISO date", () => {
  assertEquals(DATE_ANCHOR_PATTERN.test("2026-03-25"), true);
});

Deno.test("DATE_ANCHOR_PATTERN matches numeric date", () => {
  assertEquals(DATE_ANCHOR_PATTERN.test("25.03.2026"), true);
});

Deno.test("DATE_ANCHOR_PATTERN matches short numeric", () => {
  assertEquals(DATE_ANCHOR_PATTERN.test("25.03"), true);
});

Deno.test("NUMBERED_SECTION_PATTERN matches numbered section", () => {
  assertEquals(NUMBERED_SECTION_PATTERN.test("1. Introduktion"), true);
});

Deno.test("NUMBERED_SECTION_PATTERN matches nested section", () => {
  assertEquals(NUMBERED_SECTION_PATTERN.test("2.1. Baggrund"), true);
});

Deno.test("NUMBERED_SECTION_PATTERN matches Punkt", () => {
  assertEquals(NUMBERED_SECTION_PATTERN.test("Punkt 3 status"), true);
});

Deno.test("NUMBERED_SECTION_PATTERN matches Agenda", () => {
  assertEquals(NUMBERED_SECTION_PATTERN.test("Agenda 2 opfølgning"), true);
});

Deno.test("HEADING_PATTERN matches all-caps heading", () => {
  assertEquals(HEADING_PATTERN.test("OPFØLGNING"), true);
});

Deno.test("HEADING_PATTERN rejects sentence with punctuation", () => {
  assertEquals(HEADING_PATTERN.test("Send rapporten senest fredag."), false);
});
