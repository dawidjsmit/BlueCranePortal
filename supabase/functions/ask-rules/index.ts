// ============================================================
//  Blue Crane Vistas Portal — "Ask the rules" Edge Function
//
//  Receives a resident's question, fetches the current conduct-rules
//  PDF from Storage, sends both to OpenAI, and returns a plain-language
//  answer grounded in the rules.
//
//  DEPLOY (no command line needed):
//    Supabase Dashboard -> Edge Functions -> Create a new function
//    -> name it exactly:  ask-rules
//    -> paste this whole file -> Deploy.
//
//  REQUIRES a secret named OPENAI_API_KEY (already added).
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "photos";
const MODEL = "gpt-4o-mini"; // cost-effective, reads PDFs well

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { question } = await req.json();
    if (!question || !question.trim()) {
      return json({ error: "Please ask a question." }, 400);
    }

    // Admin client (service role) to read the document record + file.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Find the current conduct-rules document.
    const { data: docs, error: docErr } = await admin
      .from("documents")
      .select("storage_path")
      .eq("kind", "conduct_rules")
      .order("created_at", { ascending: false })
      .limit(1);
    if (docErr) throw docErr;
    if (!docs || !docs.length) {
      return json({ answer: "The conduct-rules document hasn't been uploaded yet, so I can't answer rule questions. Please ask a trustee to upload it." });
    }

    // 2) Download the PDF from storage and base64-encode it.
    const { data: file, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(docs[0].storage_path);
    if (dlErr) throw dlErr;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = base64Encode(bytes);

    // 3) Ask OpenAI, giving it the PDF + the question.
    const system =
      "You are a helpful assistant for residents of the Blue Crane Vistas " +
      "residential complex. Answer ONLY using the attached conduct-rules " +
      "document. Explain in plain, friendly language and, where possible, " +
      "point to the relevant rule or section. If the rules do not cover the " +
      "question, say so honestly and suggest the resident log a ticket or " +
      "contact a trustee. Do NOT give legal advice or guarantee outcomes.";

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: question },
              {
                type: "file",
                file: {
                  filename: "conduct-rules.pdf",
                  file_data: `data:application/pdf;base64,${base64}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI error:", errText);
      return json({ error: "The assistant is temporarily unavailable. Please try again shortly." }, 502);
    }

    const result = await openaiRes.json();
    const answer = result.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I couldn't produce an answer. Please try rephrasing your question.";

    return json({ answer });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong answering your question." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Base64-encode bytes in chunks (avoids call-stack limits on large files).
function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
