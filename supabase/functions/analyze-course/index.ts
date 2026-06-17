import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runPipeline } from "./pipeline.ts";
import { nullAdapter } from "./ai-adapter.ts";

const corsHeaders = {
  // Wildcard is intentional for a public-facing function called from a browser.
  // If this function is ever restricted to a known domain, replace "*" with
  // "https://your-domain.com" and remove the OPTIONS preflight permissiveness below.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const text = typeof body?.text === "string" ? body.text : "";

    const MAX_TEXT_BYTES = 200_000; // ~200 KB — roughly 100 pages of plain text
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
      return new Response(
        JSON.stringify({ error: "Text too large. Maximum is 200,000 bytes." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!text.trim()) {
      return new Response(JSON.stringify({ error: "No text provided." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await runPipeline(text, {
      source:         body?.options?.source         ?? "document",
      referenceYear:  body?.options?.referenceYear  ?? undefined,
      aiThreshold:    body?.options?.aiThreshold    ?? undefined,
      grouperOptions: body?.options?.grouperOptions ?? undefined,
      aiAdapter:      nullAdapter,
    });

    // Sanity check: document must have the new structure
    const doc = result.document;
    if (!Array.isArray(doc.containers) || !Array.isArray(doc.orphanItems)) {
      return new Response(
        JSON.stringify({ error: "Internal error: malformed document structure." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
