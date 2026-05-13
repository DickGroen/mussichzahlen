// worker/routes/analyze-free.js

import { validateUploadInput } from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse } from "../utils/response.js";
import { runTriage } from "../services/claude.js";
import { enqueueFree, saveFreeCase } from "../services/queue.js";
import {
  notifyAdminFree,
  sendConfirmationEmail,
  sendFreeEmail,
} from "../services/resend.js";
import { loadPrompts } from "../config/prompts.js";
import { getStripeLink } from "../services/stripe.js";

export async function handleAnalyzeFree(request, env) {
  try {
    const formData = await request.formData();

    const file  = formData.get("file");
    const name  = String(formData.get("name")  || "").trim();
    const email = String(formData.get("email") || "").trim();
    const type  = String(formData.get("type")  || "").trim();

    const validationError = validateUploadInput({ file, name, email, type });
    if (validationError) {
      return jsonResponse({ ok: false, error: validationError }, 400);
    }

    const { base64, mediaType } = await fileToBase64(file);
    const prompts = await loadPrompts(type);

    if (!prompts?.triage) {
      return jsonResponse(
        { ok: false, error: `Triage prompt not found for type: ${type}` },
        500
      );
    }

    const raw = await runTriage(env, {
      fileBase64: base64,
      mediaType,
      triagePrompt: prompts.triage,
    });

    const triage = normalizeTriage(
      safeJsonParse(raw) || {
        documentType:                  "mahnung",
        sender:                        null,
        forderungstyp:                 null,
        amount_claimed:                null,
        currency:                      "EUR",
        is_inkasso:                    false,
        possible_verjährt:             null,
        possible_überhöhte_kosten:     null,
        possible_kein_nachweis:        null,
        possible_falscher_empfänger:   null,
        possible_kein_abtretungsnachweis: null,
        possible_keine_registrierung:  null,
        risk:                          "medium",
        route:                         "SONNET",
        chance:                        50,
        flagCount:                     0,
        tier:                          "tier2",
        consumer_position:             null,
        teaser:                        "Einzelne Angaben in diesem Schreiben könnten vor einer Zahlung noch geklärt werden, besonders wenn Betrag, Absender oder Nachweise nicht vollständig eindeutig sind.",
      }
    );

    console.log("FREE TRIAGE:", JSON.stringify(triage));

    // tier en emailType komen nu direct uit de triage — geen aparte getTriageDecision meer
    const showUpsell = triage.tier !== "tier3";
    const stripeLink = showUpsell ? getStripeLink(env, type) : null;

    console.log("FREE TIER:", triage.tier);
    console.log("FREE EMAIL TYPE:", triage.emailType);
    console.log("FREE STRIPE LINK:", stripeLink);

    await saveFreeCase(env, {
      type,
      name,
      email,
      triage,
      stripeLink,
      fileBase64: base64,
      mediaType,
      fileName: file.name || null,
      fileSize: file.size || null,
    });

    console.log("saveFreeCase: OK");

    await enqueueFree(env, {
      type,
      name,
      email,
      triage,
      stripeLink,
    });

    console.log("enqueueFree: OK");

    try {
      await sendConfirmationEmail(env, { name, email, type });
      console.log("sendConfirmationEmail: OK");
    } catch (err) {
      console.error("sendConfirmationEmail FAILED:", err.message);
    }

    try {
      await notifyAdminFree(env, { name, email, type, triage, stripeLink });
      console.log("notifyAdminFree: OK");
    } catch (err) {
      console.error("notifyAdminFree FAILED:", err.message);
    }

    try {
      await sendFreeEmail(env, { name, email, type, triage, stripeLink, stage: 1 });
      console.log("sendFreeEmail stage 1: OK");
    } catch (err) {
      console.error("sendFreeEmail stage 1 FAILED:", err.message);
    }

    return jsonResponse({
      ok: true,
      type,
      tier:      triage.tier,
      emailType: triage.emailType,
      stripeLink,
      triage: {
        documentType:                     triage.documentType  ?? null,
        sender:                           triage.sender        ?? null,
        forderungstyp:                    triage.forderungstyp ?? null,
        amount_claimed:                   triage.amount_claimed ?? null,
        currency:                         triage.currency      ?? null,
        is_inkasso:                       Boolean(triage.is_inkasso),
        possible_verjährt:                triage.possible_verjährt             ?? null,
        possible_überhöhte_kosten:        triage.possible_überhöhte_kosten     ?? null,
        possible_kein_nachweis:           triage.possible_kein_nachweis        ?? null,
        possible_falscher_empfänger:      triage.possible_falscher_empfänger   ?? null,
        possible_kein_abtretungsnachweis: triage.possible_kein_abtretungsnachweis ?? null,
        possible_keine_registrierung:     triage.possible_keine_registrierung  ?? null,
        risk:                             triage.risk,
        chance:                           triage.chance,
        flagCount:                        triage.flagCount,
        tier:                             triage.tier,
        teaser:                           triage.teaser,
        route:                            triage.route,
        consumer_position:                triage.consumer_position ?? null,
      },
      teaser: {
        chancePercent: triage.chance,
        text:          triage.teaser,
        stripeLink,
      },
      message: "Ihre erste Einschätzung ist fertig.",
    });
  } catch (err) {
    console.error("handleAnalyzeFree FAILED:", err?.message, err?.stack);
    return jsonResponse(
      { ok: false, error: err?.message || "Serverfehler bei der Analyse." },
      500
    );
  }
}

function normalizeTriage(triage) {
  const risk = ["low", "medium", "high"].includes(triage.risk)
    ? triage.risk
    : "medium";

  const route = ["HAIKU", "SONNET"].includes(triage.route)
    ? triage.route
    : risk === "high" ? "SONNET" : "HAIKU";

  const tier = normalizeTier(triage.tier, risk, triage.flagCount);

  // emailType afleiden van tier — consistent met resend.js
  const emailType = { tier1: "stark", tier2: "soft", tier3: "vertrauen" }[tier] || "soft";

  return {
    ...triage,
    documentType:  normalizeDocumentType(triage.documentType),
    forderungstyp: normalizeForderungstyp(triage.forderungstyp),
    amount_claimed: normalizeAmount(triage.amount_claimed),
    currency:      normalizeCurrency(triage.currency),
    is_inkasso:    Boolean(triage.is_inkasso),
    possible_verjährt:                normalizeNullableBool(triage.possible_verjährt),
    possible_überhöhte_kosten:        normalizeNullableBool(triage.possible_überhöhte_kosten),
    possible_kein_nachweis:           normalizeNullableBool(triage.possible_kein_nachweis),
    possible_falscher_empfänger:      normalizeNullableBool(triage.possible_falscher_empfänger),
    possible_kein_abtretungsnachweis: normalizeNullableBool(triage.possible_kein_abtretungsnachweis),
    possible_keine_registrierung:     normalizeNullableBool(triage.possible_keine_registrierung),
    risk,
    route,
    chance:    clampChance(triage.chance),
    flagCount: normalizeFlagCount(triage),
    tier,
    emailType,
    teaser:           normalizeTeaser(risk, triage.teaser),
    consumer_position: triage.consumer_position || null,
  };
}

function normalizeDocumentType(value) {
  const allowed = ["mahnung", "inkasso", "anwalt", "gericht", "rechnung", "sonstige"];
  return allowed.includes(value) ? value : null;
}

function normalizeForderungstyp(value) {
  const allowed = ["inkasso", "mahnung", "anwalt", "gericht", "rechnung", "sonstige"];
  return allowed.includes(value) ? value : null;
}

function normalizeTier(value, risk, flagCount) {
  if (["tier1", "tier2", "tier3"].includes(value)) return value;

  // Fallback als triage geen tier geeft
  const f = Number(flagCount) || 0;
  if (risk === "high" || f >= 4) return "tier1";
  if (risk === "medium" || f >= 1) return "tier2";
  return "tier3";
}

function normalizeCurrency(value) {
  const allowed = ["EUR", "GBP", "USD"];
  return allowed.includes(value) ? value : "EUR";
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeNullableBool(value) {
  if (value === true)  return true;
  if (value === false) return false;
  return null;
}

function clampChance(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeFlagCount(triage) {
  // Telt alle 6 flags — consistent met de nieuwe triage.js
  const flags = [
    triage.possible_verjährt,
    triage.possible_überhöhte_kosten,
    triage.possible_kein_nachweis,
    triage.possible_falscher_empfänger,
    triage.possible_kein_abtretungsnachweis,
    triage.possible_keine_registrierung,
  ];
  return flags.filter(v => v === true).length;
}

function normalizeTeaser(risk, teaser) {
  const map = {
    high:   "Es gibt mehrere Punkte, die vor einer Zahlung sorgfältig geprüft werden sollten — insbesondere wenn Kosten, Nachweise oder die Grundlage der Forderung nicht vollständig nachvollziehbar sind.",
    medium: "Einzelne Angaben in diesem Schreiben könnten vor einer Zahlung noch geklärt werden, besonders wenn Betrag, Absender oder Nachweise nicht vollständig eindeutig sind.",
    low:    "Auf Basis der sichtbaren Informationen wirkt das Schreiben eher standardmäßig, einzelne Details können vor einer endgültigen Entscheidung dennoch geprüft werden.",
  };

  const allowed = new Set(Object.values(map));
  if (allowed.has(teaser)) return teaser;
  return map[risk] || map.medium;
}
