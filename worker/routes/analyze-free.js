// routes/analyze-free.js

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

function getTriageDecision({ chance, flags }) {
  const c = Number(chance) || 0;
  const f = Number(flags) || 0;

  if (c >= 60 && f >= 2) {
    return { tier: "tier1", showUpsell: true, emailType: "strong" };
  }

  if (c >= 40 || f === 1) {
    return { tier: "tier2", showUpsell: true, emailType: "soft" };
  }

  return { tier: "tier3", showUpsell: false, emailType: "trust" };
}

export async function handleAnalyzeFree(request, env) {
  try {
    const formData = await request.formData();
    console.log("STEP 1 formData OK");

    const file = formData.get("file");
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const type = String(formData.get("type") || "").trim();

    const validationError = validateUploadInput({ file, name, email, type });
    if (validationError) {
      return jsonResponse({ ok: false, error: validationError }, 400);
    }

    const { base64, mediaType } = await fileToBase64(file);
    console.log("STEP 2 fileToBase64 OK");

    const prompts = await loadPrompts(type);
    console.log("STEP 3 prompts loaded");

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
    console.log("STEP 4 runTriage OK");

    const triage = normalizeTriage(
      safeJsonParse(raw) || {
        documentType: "mahnung",
        sender: null,
        forderungstyp: null,
        amount_claimed: null,
        is_inkasso: false,
        possible_verjährt: null,
        possible_überhöhte_kosten: null,
        possible_kein_nachweis: null,
        possible_falscher_empfänger: null,
        risk: "medium",
        route: "SONNET",
        chance: 50,
        flagCount: 0,
        teaser:
          "In diesem Schreiben könnten Ansatzpunkte vorliegen, die ohne rechtzeitige Reaktion zu unnötigen Mehrkosten führen können.",
      }
    );

    console.log("STEP 5 normalizeTriage OK");
    console.log("FREE TRIAGE:", JSON.stringify(triage));

    const decision = getTriageDecision({
      chance: triage.chance,
      flags: triage.flagCount,
    });

    triage.tier = decision.tier;
    triage.emailType = decision.emailType;

    const stripeLink = decision.showUpsell ? getStripeLink(env, type) : null;

    console.log("FREE DECISION:", JSON.stringify(decision));
    console.log("FREE STRIPE LINK:", stripeLink);

    try {
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

      console.log("STEP 6 saveFreeCase OK");
    } catch (err) {
      console.error("saveFreeCase FAILED:", err.message);
      return jsonResponse(
        { ok: false, error: "saveFreeCase failed: " + err.message },
        500
      );
    }

    try {
      await enqueueFree(env, {
        type,
        name,
        email,
        triage,
        stripeLink,
      });

      console.log("enqueueFree: OK");
    } catch (err) {
      console.error("enqueueFree FAILED:", err.message);
      return jsonResponse(
        { ok: false, error: "enqueueFree failed: " + err.message },
        500
      );
    }

    try {
      await sendConfirmationEmail(env, { name, email, type });
      console.log("sendConfirmationEmail: OK");
    } catch (err) {
      console.error("Bevestigingsemail fehlgeschlagen:", err.message);
    }

    try {
      await notifyAdminFree(env, {
        name,
        email,
        type,
        triage,
        stripeLink,
      });

      console.log("notifyAdminFree: OK");
    } catch (err) {
      console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message);
    }

    // NOODOPLOSSING:
    // Stage 1 direct verzenden, zodat klant meteen beoordeling + betaallink krijgt.
    // enqueueFree blijft bestaan voor stage 2/3 en latere cron-debug.
    try {
      await sendFreeEmail(env, {
        name,
        email,
        type,
        triage,
        stripeLink,
        stage: 1,
      });

      console.log("sendFreeEmail stage 1 DIRECT: OK");
    } catch (err) {
      console.error("sendFreeEmail stage 1 DIRECT fehlgeschlagen:", err.message);
    }

    return jsonResponse({
      ok: true,
      type,
      tier: decision.tier,
      emailType: decision.emailType,
      stripeLink,
      triage: {
        documentType: triage.documentType ?? null,
        sender: triage.sender ?? null,
        forderungstyp: triage.forderungstyp ?? null,
        amount_claimed: triage.amount_claimed ?? null,
        is_inkasso: Boolean(triage.is_inkasso),
        possible_verjährt: triage.possible_verjährt ?? null,
        possible_überhöhte_kosten: triage.possible_überhöhte_kosten ?? null,
        possible_kein_nachweis: triage.possible_kein_nachweis ?? null,
        possible_falscher_empfänger: triage.possible_falscher_empfänger ?? null,
        risk: triage.risk,
        chance: triage.chance,
        flagCount: triage.flagCount,
        teaser: triage.teaser,
        route: triage.route,
      },
      teaser: {
        chancePercent: triage.chance,
        text: triage.teaser,
        stripeLink,
      },
      message: "Deine erste Einschätzung ist fertig.",
    });
  } catch (err) {
    console.error("handleAnalyzeFree FAILED:", err?.message, err?.stack);

    return jsonResponse(
      {
        ok: false,
        error: err?.message || "Serverfehler bei der Analyse.",
      },
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
    : risk === "high"
      ? "SONNET"
      : "HAIKU";

  return {
    ...triage,
    documentType: normalizeDocumentType(triage.documentType),
    forderungstyp: normalizeForderungstyp(triage.forderungstyp),
    amount_claimed: normalizeAmount(triage.amount_claimed),
    is_inkasso: Boolean(triage.is_inkasso),
    possible_verjährt: normalizeNullableBool(triage.possible_verjährt),
    possible_überhöhte_kosten: normalizeNullableBool(
      triage.possible_überhöhte_kosten
    ),
    possible_kein_nachweis: normalizeNullableBool(
      triage.possible_kein_nachweis
    ),
    possible_falscher_empfänger: normalizeNullableBool(
      triage.possible_falscher_empfänger
    ),
    risk,
    route,
    chance: clampChance(triage.chance),
    flagCount: normalizeFlagCount(triage),
    teaser: normalizeTeaser(risk, triage.teaser),
  };
}

function normalizeDocumentType(value) {
  const allowed = ["mahnung", "inkasso", "anwalt", "gericht", "sonstige"];
  return allowed.includes(value) ? value : null;
}

function normalizeForderungstyp(value) {
  const allowed = ["inkasso", "mahnung", "anwalt", "gericht", "sonstige"];
  return allowed.includes(value) ? value : null;
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeNullableBool(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function clampChance(value) {
  const n = Number(value);

  if (Number.isNaN(n)) return 50;

  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeFlagCount(triage) {
  const flags = [
    triage.possible_verjährt,
    triage.possible_überhöhte_kosten,
    triage.possible_kein_nachweis,
    triage.possible_falscher_empfänger,
  ];

  return flags.filter(v => v === true).length;
}

function normalizeTeaser(risk, teaser) {
  const map = {
    high:
      "Es deutet einiges darauf hin, dass hier mögliche Unstimmigkeiten bestehen. Wenn du nicht reagierst, kann sich die Situation finanziell deutlich verschlechtern.",
    medium:
      "In diesem Schreiben könnten Ansatzpunkte vorliegen, die ohne rechtzeitige Reaktion zu unnötigen Mehrkosten führen können.",
    low:
      "Es gibt Hinweise darauf, dass diese Forderung nicht vollständig eindeutig ist. Ohne Prüfung könnten unnötige Kosten entstehen.",
  };

  const allowed = new Set(Object.values(map));

  if (allowed.has(teaser)) return teaser;

  return map[risk] || map.medium;
}
