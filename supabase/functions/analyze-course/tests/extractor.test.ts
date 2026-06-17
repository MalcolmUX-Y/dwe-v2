import { assertEquals } from "jsr:@std/assert";
import { extractActionText } from "../extractor.ts";

Deno.test("extractActionText keeps valid text when name removal leaves short residual but date removal leaves enough", () => {
  // "Anna sender rapporten til teamet senest 2026-03-25"
  // After removing "Anna": "sender rapporten til teamet senest 2026-03-25" (6 words)
  // After removing "senest 2026-03-25": "sender rapporten til teamet" (4 words — survives post-strip guard)
  // The premature guard (removed) would have incorrectly rejected this in some edge cases.
  const result = extractActionText(
    "Anna sender rapporten til teamet senest 2026-03-25",
    "Anna",
    "2026-03-25"
  );
  assertEquals(result.text.length > 0, true);
  assertEquals(result.confidence > 0, true);
});

Deno.test("extractActionText still returns empty for genuinely short residual", () => {
  // "Anna 2026-03-25" — after stripping both, nothing meaningful remains
  const result = extractActionText("Anna 2026-03-25", "Anna", "2026-03-25");
  assertEquals(result.text, "");
  assertEquals(result.confidence, 0);
});

Deno.test("extractActionText handles null responsible and null date", () => {
  const result = extractActionText("Send rapporten til teamet", null, null);
  assertEquals(result.text.length > 0, true);
});
