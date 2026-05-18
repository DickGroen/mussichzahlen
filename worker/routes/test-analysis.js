// worker/routes/test-analysis.js
//
// End-to-end testroute — voert volledige analyse + email uit zonder echte upload.
//
// Gebruik:
//   GET /api/test-analysis?secret=XXX&type=mahnung&case=tier1-inflated-fees
//   GET /api/test-analysis?secret=XXX&list=1   → overzicht beschikbare cases
//
// Beveiligd met TEST_SECRET uit wrangler.toml.
// Nooit publiek linken. Niet in productie-UI tonen.

import { jsonResponse }          from "../utils/response.js";
import { runTriage, runAnalysis } from "../services/claude.js";
import { loadPrompts }            from "../config/prompts.js";
import { getStripeLink }          from "../services/stripe.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";
import { sendFreeEmail, sendPaidEmail }                 from "../services/resend.js";
import { getTestCase, listTestCases, BLANK_PDF_B64 }    from "../services/testcases.js";

export async function handleTestAnalysis(request, env) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const url    = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (!env.TEST_SECRET || secret !== env.TEST_SECRET) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403);
  }

  // ── List mode ──────────────────────────────────────────────────────────────
  if (url.searchParams.get("list") === "1") {
    return jsonResponse({ ok: true, cases: listTestCases() });
  }

  // ── Params ─────────────────────────────────────────────────────────────────
  const type     = url.searchParams.get("type")?.trim();
  const caseName = url.searchParams.get("case")?.trim();
  const mode     = url.searchParams.get("mode") || "full"; // full | triage | analysis

  if (!type || !caseName) {
    return jsonResponse(
      { ok: false, error: "Missing ?type= and ?case= parameters. Use ?list=1 to see available cases." },
      400
    );
  }

  const testCase = getTestCase(type, caseName);
  if (!testCase) {
    return jsonResponse(
      { ok: false, error: `Test case not found: ${type}:${caseName}. Use ?list=1 to see available cases.` },
      404
    );
  }

  const testEmail = env.TEST_EMAIL || env.ADMIN_EMAIL;
  if (!testEmail) {
    return jsonResponse(
      { ok: false, error: "TEST_EMAIL or ADMIN_EMAIL not configured in wrangler.toml" },
      500
    );
  }

  const name  = testCase.name || "Test User";
  const email = testEmail;

  console.log(`[TEST] Starting: ${type}:${caseName} → ${email}`);

  try {
    // ── Load prompts ───────────────────────────────────────────────────────
    const prompts = await loadPrompts(type);
    if (!prompts?.triage) {
      return jsonResponse({ ok: false, error: `No triage prompt for type: ${type}` }, 500);
    }

    // ── Build document content ─────────────────────────────────────────────
    // Inject the text content into the triage prompt so Claude has context
    // even though the PDF is blank.
    const enrichedTriagePrompt = `${prompts.triage}

---
DOCUMENT CONTENT (extracted text for testing):
${testCase.textContent}
---`;

    const enrichedSonnetPrompt = prompts.sonnet
      ? `${prompts.sonnet}

---
DOCUMENT CONTENT (extracted text for testing):
${testCase.textContent}
---`
      : null;

    // ── Step 1: Triage ─────────────────────────────────────────────────────
    console.log(`[TEST] Running triage for ${type}:${caseName}`);

    const rawTriage = await runTriage(env, {
      fileBase64:   BLANK_PDF_B64,
      mediaType:    "application/pdf",
      triagePrompt: enrichedTriagePrompt,
    });

    let triage;
    try {
      triage = JSON.parse(rawTriage);
    } catch {
      triage = { risk: "medium", tier: "tier1", teaser: rawTriage?.slice(0, 200) };
    }

    console.log(`[TEST] Triage result:`, JSON.stringify(triage));

    if (mode === "triage") {
      return jsonResponse({ ok: true, mode: "triage", type, case: caseName, triage });
    }

    const stripeLink = getStripeLink(env, type);

    // ── Step 2: Free email ─────────────────────────────────────────────────
    console.log(`[TEST] Sending free email to ${email}`);

    await sendFreeEmail(env, {
      name,
      email,
      type,
      triage,
      stripeLink,
      stage: 1,
    });

    console.log(`[TEST] Free email sent`);

    if (mode === "free") {
      return jsonResponse({ ok: true, mode: "free", type, case: caseName, triage });
    }

    // ── Step 3: Full analysis ──────────────────────────────────────────────
    if (!enrichedSonnetPrompt) {
      return jsonResponse(
        { ok: false, error: `No sonnet prompt for type: ${type}` },
        500
      );
    }

    console.log(`[TEST] Running full analysis for ${type}:${caseName}`);

    const analysis = await runAnalysis(env, {
      fileBase64:   BLANK_PDF_B64,
      mediaType:    "application/pdf",
      route:        "SONNET",
      haikuPrompt:  enrichedSonnetPrompt,
      sonnetPrompt: enrichedSonnetPrompt,
    });

    console.log(`[TEST] Analysis length: ${analysis.length}`);

    if (mode === "analysis") {
      return jsonResponse({ ok: true, mode: "analysis", type, case: caseName, triage, analysisLength: analysis.length, analysisSample: analysis.slice(0, 500) });
    }

    // ── Step 4: Paid email with RTF attachments ────────────────────────────
    console.log(`[TEST] Sending paid email to ${email}`);

    await sendPaidEmail(env, {
      name,
      email,
      type,
      triage,
      analysis,
    });

    console.log(`[TEST] Paid email sent`);

    return jsonResponse({
      ok:             true,
      mode:           "full",
      type,
      case:           caseName,
      description:    testCase.description,
      email,
      triage,
      analysisLength: analysis.length,
      analysisSample: analysis.slice(0, 300),
    });

  } catch (err) {
    console.error(`[TEST] Error in ${type}:${caseName}:`, err?.message, err?.stack);
    return jsonResponse(
      { ok: false, error: err?.message || "Test analysis failed" },
      500
    );
  }
}
