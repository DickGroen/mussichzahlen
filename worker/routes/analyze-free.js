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

    const triage = normalizeTriage(safeJsonParse(raw) || fallbackTriage(type));

    console.log("FREE TRIAGE:", JSON.stringify(triage));

    // tier en emailType komen direct uit de triage
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
      triage:    publicTriage(triage),
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

// ─── Fallback ────────────────────────────────────────────────────────────────

function fallbackTriage(type) {
  return {
    documentType:    type || "sonstige",
    sender:          null,
    forderungstyp:   null,
    amount_claimed:  null,
    monthly_cost:    null,
    annual_cost:     null,
    currency:        "EUR",
    is_inkasso:      false,
    risk:            "medium",
    route:           "SONNET",
    chance:          50,
    flagCount:       0,
    tier:            "tier2",
    consumer_position: null,
    teaser: "Einzelne Angaben in diesem Schreiben könnten vor einer Zahlung noch geklärt werden, besonders wenn Betrag, Absender oder Nachweise nicht vollständig eindeutig sind.",
  };
}

// ─── Public response shape ────────────────────────────────────────────────────

function publicTriage(triage) {
  return {
    // kern
    documentType:     triage.documentType     ?? null,
    sender:           triage.sender           ?? null,
    forderungstyp:    triage.forderungstyp    ?? null,
    amount_claimed:   triage.amount_claimed   ?? null,
    monthly_cost:     triage.monthly_cost     ?? null,
    annual_cost:      triage.annual_cost      ?? null,
    currency:         triage.currency         ?? "EUR",
    is_inkasso:       Boolean(triage.is_inkasso),

    // scores
    risk:             triage.risk,
    chance:           triage.chance,
    flagCount:        triage.flagCount,
    tier:             triage.tier,
    emailType:        triage.emailType,
    teaser:           triage.teaser,
    route:            triage.route,
    consumer_position: triage.consumer_position ?? null,

    // mahnung / inkasso flags
    possible_verjährt:                triage.possible_verjährt                ?? null,
    possible_überhöhte_kosten:        triage.possible_überhöhte_kosten        ?? null,
    possible_kein_nachweis:           triage.possible_kein_nachweis           ?? null,
    possible_falscher_empfänger:      triage.possible_falscher_empfänger      ?? null,
    possible_kein_abtretungsnachweis: triage.possible_kein_abtretungsnachweis ?? null,
    possible_keine_registrierung:     triage.possible_keine_registrierung     ?? null,

    // parkstrafe flags
    possible_falsche_zustellung:  triage.possible_falsche_zustellung  ?? null,
    possible_kein_tatnachweis:    triage.possible_kein_tatnachweis    ?? null,
    possible_falscher_halter:     triage.possible_falscher_halter     ?? null,
    possible_formfehler:          triage.possible_formfehler          ?? null,
    possible_privater_betreiber:  triage.possible_privater_betreiber  ?? null,

    // rechnung flags
    possible_falsche_position:         triage.possible_falsche_position         ?? null,
    possible_doppelte_berechnung:      triage.possible_doppelte_berechnung      ?? null,
    possible_nicht_erbrachte_leistung: triage.possible_nicht_erbrachte_leistung ?? null,
    possible_überhöhter_preis:         triage.possible_überhöhter_preis         ?? null,
    possible_keine_leistungsbeschreibung: triage.possible_keine_leistungsbeschreibung ?? null,
    possible_unplausible_nachforderung: triage.possible_unplausible_nachforderung ?? null,

    // vertrag flags
    possible_unwirksame_verlaengerungsklausel: triage.possible_unwirksame_verlaengerungsklausel ?? null,
    possible_preiserhoehung_sonderkuendigung:  triage.possible_preiserhoehung_sonderkuendigung  ?? null,
    possible_kuendigung_blockiert:             triage.possible_kuendigung_blockiert             ?? null,
    possible_widerrufsrecht:                   triage.possible_widerrufsrecht                   ?? null,
    possible_unklare_laufzeit:                 triage.possible_unklare_laufzeit                 ?? null,
    possible_unklare_kuendigungsfrist:         triage.possible_unklare_kuendigungsfrist         ?? null,

    // angebot flags
    possible_überhöhter_gesamtpreis:       triage.possible_überhöhter_gesamtpreis       ?? null,
    possible_unklare_einzelpositionen:     triage.possible_unklare_einzelpositionen     ?? null,
    possible_fehlende_leistungsbeschreibung: triage.possible_fehlende_leistungsbeschreibung ?? null,
    possible_versteckte_zusatzkosten:      triage.possible_versteckte_zusatzkosten      ?? null,
    possible_unfaire_zahlungsbedingungen:  triage.possible_unfaire_zahlungsbedingungen  ?? null,
    possible_gültigkeit_oder_frist_unklar: triage.possible_gültigkeit_oder_frist_unklar ?? null,
  };
}

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeTriage(triage) {
  const risk  = normalizeRisk(triage.risk);
  const route = normalizeRoute(triage.route, risk);
  const chance = clampChance(triage.chance);
  const flagCount = normalizeFlagCount(triage);
  const tier  = normalizeTier(triage.tier, risk, flagCount);
  const emailType = { tier1: "stark", tier2: "soft", tier3: "vertrauen" }[tier] || "soft";

  const monthlyCost = normalizeAmount(triage.monthly_cost);
  const annualCost  =
    normalizeAmount(triage.annual_cost) ??
    (monthlyCost !== null ? Number((monthlyCost * 12).toFixed(2)) : null);

  const amountClaimed =
    normalizeAmount(triage.amount_claimed) ??
    annualCost ??
    monthlyCost;

  return {
    ...triage,
    documentType:  normalizeDocumentType(triage.documentType),
    sender:        normalizeText(triage.sender),
    forderungstyp: normalizeForderungstyp(triage.forderungstyp),
    amount_claimed: amountClaimed,
    monthly_cost:   monthlyCost,
    annual_cost:    annualCost,
    currency:      normalizeCurrency(triage.currency),
    is_inkasso:    Boolean(triage.is_inkasso),
    risk,
    route,
    chance,
    flagCount,
    tier,
    emailType,
    teaser:           normalizeTeaser(risk, triage.teaser),
    consumer_position: normalizeConsumerPosition(tier, triage.consumer_position),
  };
}

function normalizeRisk(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function normalizeRoute(value, risk) {
  if (["HAIKU", "SONNET"].includes(value)) return value;
  return risk === "high" ? "SONNET" : "HAIKU";
}

function normalizeTier(value, risk, flagCount) {
  if (["tier1", "tier2", "tier3"].includes(value)) return value;
  const f = Number(flagCount) || 0;
  if (risk === "high" || f >= 4) return "tier1";
  if (risk === "medium" || f >= 1) return "tier2";
  return "tier3";
}

function normalizeDocumentType(value) {
  const allowed = ["mahnung", "inkasso", "anwalt", "gericht", "rechnung", "sonstige"];
  return allowed.includes(value) ? value : null;
}

function normalizeForderungstyp(value) {
  const allowed = ["inkasso", "mahnung", "anwalt", "gericht", "rechnung", "sonstige"];
  return allowed.includes(value) ? value : null;
}

function normalizeCurrency(value) {
  const c = String(value || "").toUpperCase();
  if (["EUR", "GBP", "USD"].includes(c)) return c;
  if (c === "€") return "EUR";
  if (c === "£") return "GBP";
  if (c === "$") return "USD";
  return "EUR";
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[€£$,]/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function clampChance(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeFlagCount(triage) {
  // Gebruik flagCount uit triage als die er al in zit
  if (Number.isFinite(Number(triage.flagCount))) {
    return Math.min(12, Math.max(0, Math.round(Number(triage.flagCount))));
  }
  // Dynamisch tellen van alle possible_* velden — werkt voor alle 5 types
  return Object.entries(triage)
    .filter(([key]) => key.startsWith("possible_"))
    .filter(([, val]) => val === true)
    .length;
}

function normalizeTeaser(risk, teaser) {
  // Behoud AI-gegenereerde documentspecifieke teaser als die substantieel is
  const cleaned = String(teaser || "").trim();
  if (cleaned.length > 20) return cleaned;

  // Fallback naar risk-gebaseerde generieke teaser
  const map = {
    high:   "Es gibt mehrere Punkte, die vor einer Zahlung sorgfältig geprüft werden sollten — insbesondere wenn Kosten, Nachweise oder die Grundlage der Forderung nicht vollständig nachvollziehbar sind.",
    medium: "Einzelne Angaben in diesem Schreiben könnten vor einer Zahlung noch geklärt werden, besonders wenn Betrag, Absender oder Nachweise nicht vollständig eindeutig sind.",
    low:    "Auf Basis der sichtbaren Informationen wirkt das Schreiben eher standardmäßig, einzelne Details können vor einer endgültigen Entscheidung dennoch geprüft werden.",
  };
  return map[risk] || map.medium;
}

function normalizeConsumerPosition(tier, value) {
  const text = normalizeText(value);
  if (text) return text;
  if (tier === "tier1") return "Das Schreiben enthält möglicherweise mehrere Punkte, die vor einer Zahlung genauer geprüft werden sollten.";
  if (tier === "tier2") return "Einige Angaben könnten noch klärungsbedürftig sein. Es kann sinnvoll sein, die Grundlage vor einer Zahlung prüfen zu lassen.";
  return "Nach den sichtbaren Informationen wirkt das Schreiben derzeit eher standardmäßig. Eine zusätzliche Prüfung bleibt optional.";
}
