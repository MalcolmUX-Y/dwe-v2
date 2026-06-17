import { assertEquals } from "jsr:@std/assert";
import { splitSegmentIntoClauses } from "../clause-splitter.ts";

Deno.test("splitSegmentIntoClauses does not split on abbreviations like Dr.", () => {
  const result = splitSegmentIntoClauses("Dr. Smith sender rapporten senest fredag.");
  // Should produce one clause, not two ("Dr." and "Smith sender...")
  assertEquals(result.length, 1);
  assertEquals(result[0].text.startsWith("Dr."), true);
});

Deno.test("splitSegmentIntoClauses does not split on e.g.", () => {
  const result = splitSegmentIntoClauses("Brug e.g. det nye skema og send det til Anna.");
  assertEquals(result.length, 1);
});

Deno.test("splitSegmentIntoClauses still splits two genuine workflow sentences", () => {
  const result = splitSegmentIntoClauses(
    "Anna sender rapporten senest fredag. Peter indkalder til møde mandag."
  );
  // Two genuine workflow starts — should split
  assertEquals(result.length, 2);
});

Deno.test("splitSegmentIntoClauses handles single sentence without splitting", () => {
  const result = splitSegmentIntoClauses("Send rapporten til teamet.");
  assertEquals(result.length, 1);
});
