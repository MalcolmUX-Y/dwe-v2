import { assertEquals } from "jsr:@std/assert";
import { runPipeline } from "../pipeline.ts";

Deno.test("runPipeline does not emit console.log when debug is false", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(String(args[0])); };

  try {
    await runPipeline("Anna sender rapporten senest fredag 2026-03-25.", {
      source: "test.txt",
      debug: false,
    });
  } finally {
    console.log = originalLog;
  }

  assertEquals(logs.length, 0, `Expected no logs, got: ${logs.join("\n")}`);
});

Deno.test("runPipeline emits console.log when debug is true", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(String(args[0])); };

  try {
    await runPipeline("Anna sender rapporten senest fredag 2026-03-25.", {
      source: "test.txt",
      debug: true,
    });
  } finally {
    console.log = originalLog;
  }

  assertEquals(logs.length > 0, true);
});
