// routes/submit-paid.js
import { validateUploadInput } from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse } from "../utils/response.js";
import { verifyStripeSession } from "../services/stripe.js";
import { runTriage, runAnalysis } from "../services/claude.js";
import { enqueuePaid, markPaid, getFreeCase } from "../services/queue.js";
import { notifyAdminPaid } from "../services/resend.js";
import { loadPrompts } from "../config/prompts.js";

export async function handleSubmitPaid(request, env) {
  const formData = await request.formData();

  const file      = formData.get("file");
  const name      = String(formData.get("name")       || "").trim();
  const email     = String(formData.get("email")      || "").trim();
  const type      = String(formData.get("type")       || "").trim();
  const sessionId = String(formData.get("session_id") || "").trim();

  if (!sessionId) {
    return jsonResponse(
      { ok: false, error: "Keine gültige Zahlungssitzung." },
      403
    );
  }

  let payment;
  try {
    payment = await verifyStripeSession(env, sessionId);
  } catch (err) {
    console.error("Stripe Verifikation fehlgeschlagen:", err.message);
    return jsonResponse(
      { ok: false, error: "Zahlung konnte nicht geprüft werden." },
      403
    );
  }

  const resolvedEmail = email || payment.customer_details?.email || "";

  const validationError = validateUploadInput({
    file,
    name,
    email: resolvedEmail,
    type,
  });

  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, 400);
  }

  await markPaid(env, resolvedEmail);

  const { base64, mediaType } = await fileToBase64(file);
  const prompts = loadPrompts(type);

  let triageSource = "paid_fallback";
  let triage;

  const savedFree = await getFreeCase(env, {
    type,
    email: resolvedEmail,
  });

  if (savedFree?.triage) {
    triage = savedFree.triage;
    triageSource = "free_reused";
  } else {
    const triageRaw = await runTriage(env, {
      fileBase64: base64,
      mediaType,
      triagePrompt: prompts.triage,
    });
    triage = safeJsonParse(triageRaw) || {
      risk: "medium",
      route: "SONNET",
      chance: 50,
      flagCount: 0,
    };
  }

  console.log("TRIAGE SOURCE:", triageSource);
  console.log("TRIAGE:", JSON.stringify(triage));

  const analysis = await runAnalysis(env, {
    fileBase64: base64,
    mediaType,
    route: triage.route || "SONNET",
    haikuPrompt: prompts.haiku,
    sonnetPrompt: prompts.sonnet,
  });

  const expectedTags = ["TITLE", "SUMMARY", "ISSUES", "ASSESSMENT", "NEXT_STEPS"];
  const tagStatus = expectedTags
    .map(tag => `${tag}:${analysis.includes(`[${tag}]`) ? "OK" : "FEHLT"}`)
    .join(" ");

  console.log("ANALYSE TAGS:", tagStatus);
  console.log("ANALYSE LÄNGE:", analysis.length);

  await enqueuePaid(env, {
    type,
    name,
    email: resolvedEmail,
    triage,
    analysis,
  });

  try {
    await notifyAdminPaid(env, {
      name,
      email: resolvedEmail,
      type,
      triage,
      analysis,
    });
  } catch (err) {
    console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message);
  }

  return jsonResponse({
    ok: true,
    message: "Upload erfolgreich. Du erhältst deine vollständige Analyse bis zum nächsten Werktag vor 16:00 Uhr per E-Mail.",
  });
}
