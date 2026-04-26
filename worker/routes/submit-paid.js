
import { validateUploadInput }         from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse }                from "../utils/response.js";
import { runTriage, runAnalysis }      from "../services/claude.js";
import { enqueuePaid }                 from "../services/queue.js";
import { notifyAdminPaid }             from "../services/resend.js";
import { loadPrompts }                 from "../config/prompts.js";

export async function handleSubmitPaid(request, env) {
  const formData = await request.formData();
  const file     = formData.get("file");
  const name     = String(formData.get("name")  || "").trim();
  const email    = String(formData.get("email") || "").trim();
  const type     = String(formData.get("type")  || "").trim();

  const validationError = validateUploadInput({ file, name, email, type });
  if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);

  const { base64, mediaType } = await fileToBase64(file);
  const prompts = loadPrompts(type);

  // 1. Triage
  const triageRaw = await runTriage(env, {
    fileBase64:   base64,
    mediaType,
    triagePrompt: prompts.triage
  });

  const triage = safeJsonParse(triageRaw) || { risk: "medium", route: "SONNET" };
  console.log("TRIAGE:", JSON.stringify(triage));

  // 2. Vollständige Analyse
  const analysis = await runAnalysis(env, {
    fileBase64:   base64,
    mediaType,
    route:        triage.route || "SONNET",
    haikuPrompt:  prompts.haiku,
    sonnetPrompt: prompts.sonnet
  });

  // Tags prüfen
  const expectedTags = ["TITLE", "SUMMARY", "ISSUES", "ASSESSMENT", "NEXT_STEPS"];
  const tagStatus = expectedTags.map(t => `${t}:${analysis.includes(`[${t}]`) ? "OK" : "FEHLT"}`).join(" ");
  console.log("ANALYSE TAGS:", tagStatus);
  console.log("ANALYSE LÄNGE:", analysis.length);

  // 3. In Queue einreihen
  await enqueuePaid(env, { type, name, email, triage, analysis });

  // 4. Admin benachrichtigen
  try {
    await notifyAdminPaid(env, { name, email, type, triage, analysis });
  } catch (err) {
    console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message);
  }

  return jsonResponse({
    ok:      true,
    message: "Upload erfolgreich. Du erh\u00e4ltst deine vollst\u00e4ndige Analyse bis zum n\u00e4chsten Werktag vor 16:00\u00a0Uhr per E-Mail."
  });
}
