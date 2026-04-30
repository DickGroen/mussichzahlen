// routes/submit-auto.js

import { jsonResponse }           from "../utils/response.js";
import { verifyStripeSession }    from "../services/stripe.js";
import { runAnalysis }            from "../services/claude.js";
import { enqueuePaid, markPaid, getFreeCase } from "../services/queue.js";
import { notifyAdminPaid }        from "../services/resend.js";
import { loadPrompts }            from "../config/prompts.js";

export async function handleSubmitAuto(request, env) {
  let body;

  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ ok: false, error: "Ungültiges JSON" }, 400);
  }

  const type = String(body.type || "mahnung").trim();
  const sessionId = String(body.session_id || "").trim();

  if (!sessionId) {
    return jsonResponse({ ok: false, need_upload: true, error: "Keine gültige Zahlungssitzung." }, 403);
  }

  const payment = await verifyStripeSession(env, sessionId);
  if (!payment.ok) {
    return jsonResponse({ ok: false, need_upload: true, error: payment.reason || "Zahlung konnte nicht geprüft werden." }, 403);
  }

  const email = payment.email;
  if (!email) {
    return jsonResponse({ ok: false, need_upload: true, error: "Keine E-Mail in der Zahlung gefunden." }, 400);
  }

  await markPaid(env, email);

  const saved = await getFreeCase(env, { type, email });

  if (!saved?.file_base64 || !saved?.media_type || !saved?.triage) {
    return jsonResponse({
      ok: false,
      need_upload: true,
      error: "Die ursprüngliche Datei konnte nicht automatisch gefunden werden."
    }, 404);
  }

  const prompts = loadPrompts(type);
  const triage = saved.triage;

  const analysis = await runAnalysis(env, {
    fileBase64: saved.file_base64,
    mediaType: saved.media_type,
    route: triage.route || "SONNET",
    haikuPrompt: prompts.haiku,
    sonnetPrompt: prompts.sonnet,
  });

  await enqueuePaid(env, {
    type,
    name: saved.name || "Kunde",
    email,
    triage,
    analysis,
  });

  try {
    await notifyAdminPaid(env, {
      name: saved.name || "Kunde",
      email,
      type,
      triage,
      analysis,
    });
  } catch (err) {
    console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message);
  }

  return jsonResponse({
    ok: true,
    message: "Analyse automatisch gestartet. Du erhältst dein Ergebnis per E-Mail.",
  });
}
