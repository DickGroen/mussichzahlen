// routes/analyze-free.js

import { validateUploadInput }         from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse }                from "../utils/response.js";
import { runTriage }                   from "../services/claude.js";
import { enqueueFree, saveFreeCase }   from "../services/queue.js";
import { notifyAdminFree }             from "../services/resend.js";
import { loadPrompts }                 from "../config/prompts.js";
import { getStripeLink }               from "../services/stripe.js";

export async function handleAnalyzeFree(request, env) {
  const formData = await request.formData();

  const file  = formData.get("file");
  const name  = String(formData.get("name")  || "").trim();
  const email = String(formData.get("email") || "").trim();
  const type  = String(formData.get("type")  || "").trim();

  const validationError = validateUploadInput({ file, name, email, type });
  if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);

  const { base64, mediaType } = await fileToBase64(file);
  const prompts = loadPrompts(type);

  const raw = await runTriage(env, {
    fileBase64: base64,
    mediaType,
    triagePrompt: prompts.triage,
  });

  const triage = safeJsonParse(raw) || {
    documentType: "mahnung",
    sender: null,
    amount_claimed: null,
    risk: "medium",
    route: "SONNET",
    chance: 50,
    flagCount: 0,
    teaser: "In diesem Schreiben könnten Ansatzpunkte vorliegen, die ohne rechtzeitige Reaktion zu unnötigen Mehrkosten führen können.",
  };

  triage.chance = clampChance(triage.chance ?? 50);
  triage.flagCount = Number.isFinite(Number(triage.flagCount)) ? Number(triage.flagCount) : 0;
  triage.risk = ["low", "medium", "high"].includes(triage.risk) ? triage.risk : "medium";

  const stripeLink = getStripeLink(env, type);

  await saveFreeCase(env, {
    type,
    name,
    email,
    triage,
    stripeLink,
    fileBase64: base64,
    mediaType,
    fileName: file.name,
    fileSize: file.size,
  });

  await enqueueFree(env, { type, name, email, triage, stripeLink });

  try {
    await notifyAdminFree(env, { name, email, type, triage });
  } catch (err) {
    console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message);
  }

  return jsonResponse({
    ok: true,
    triage: {
      sender: triage.sender ?? null,
      amount_claimed: triage.amount_claimed ?? null,
      risk: triage.risk,
      chance: triage.chance,
      flagCount: triage.flagCount,
      teaser: triage.teaser ?? null,
      stripeLink,
    },
    teaser: {
      chancePercent: triage.chance,
      text: triage.teaser ?? null,
      stripeLink,
    },
    message: "Deine erste Einschätzung ist fertig.",
  });
}

function clampChance(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}
