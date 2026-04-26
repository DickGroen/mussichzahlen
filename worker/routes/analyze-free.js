
import { validateUploadInput }         from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse }                from "../utils/response.js";
import { runTriage }                   from "../services/claude.js";
import { enqueueFree }                 from "../services/queue.js";
import { notifyAdminFree }             from "../services/resend.js";
import { loadPrompts }                 from "../config/prompts.js";
import { getStripeLink }               from "../services/stripe.js";

export async function handleAnalyzeFree(request, env) {
  const formData = await request.formData();
  const file     = formData.get("file");
  const name     = String(formData.get("name")  || "").trim();
  const email    = String(formData.get("email") || "").trim();
  const type     = String(formData.get("type")  || "").trim();

  const validationError = validateUploadInput({ file, name, email, type });
  if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);

  const { base64, mediaType } = await fileToBase64(file);
  const prompts = loadPrompts(type);

  const raw    = await runTriage(env, {
    fileBase64:   base64,
    mediaType,
    triagePrompt: prompts.triage
  });

  const triage = safeJsonParse(raw) || {
    sender:  null,
    risk:    "medium",
    route:   "SONNET",
    teaser:  "Auf Basis Ihres Schreibens k\u00f6nnten m\u00f6glicherweise Ansatzpunkte vorliegen."
  };

  console.log("TRIAGE:", JSON.stringify(triage));

  const stripeLink = getStripeLink(env, type);

  await enqueueFree(env, { type, name, email, triage, stripeLink });

  try {
    await notifyAdminFree(env, { name, email, type, triage });
  } catch (err) {
    console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message);
  }

  return jsonResponse({
    ok:      true,
    triage,
    message: "Deine Einsch\u00e4tzung erh\u00e4ltst du bis zum n\u00e4chsten Werktag vor 16:00\u00a0Uhr per E-Mail."
  });
}
