// worker/services/resend.js

import { escapeHtml } from "../utils/files.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM       = "MussIchZahlen <noreply@mussichzahlen.de>";
const DISCLAIMER = "MussIchZahlen bietet informative Analysen — keine Rechtsberatung und keine anwaltliche Vertretung.";

function capitalizeFirst(str) {
  const s = String(str || "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const TYPE_LABELS = {
  mahnung: {
    title:        "Mahnung / Inkassoschreiben",
    letter:       "Widerspruch",
    filename:     "Widerspruch.rtf",
    price:        "49",
    stripe_label: "Vollständige Analyse + fertiger Widerspruch — €49",
  },
  parkstrafe: {
    title:        "Bußgeldbescheid",
    letter:       "Einspruchsschreiben",
    filename:     "Einspruch.rtf",
    price:        "19",
    stripe_label: "Analyse + fertiges Einspruchsschreiben — €19",
  },
  rechnung: {
    title:        "Rechnung",
    letter:       "Widerspruchsschreiben",
    filename:     "Widerspruchsschreiben.rtf",
    price:        "29",
    stripe_label: "Analyse + fertiges Widerspruchsschreiben — €29",
  },
  vertrag: {
    title:        "Vertrag / Kündigung",
    letter:       "Kündigungsschreiben",
    filename:     "Kuendigungsschreiben.rtf",
    price:        "29",
    stripe_label: "Analyse + fertiges Kündigungsschreiben — €29",
  },
  angebot: {
    title:        "Angebot / Kostenvoranschlag",
    letter:       "Prüfbericht",
    filename:     "Angebot-Pruefung.rtf",
    price:        "29",
    stripe_label: "Analyse des Angebots — €29",
  },
  nebenkosten: {
    title:        "Nebenkostenabrechnung",
    letter:       "Rückfrageschreiben",
    filename:     "Nebenkosten-Einordnung.rtf",
    price:        "29",
    stripe_label: "Einordnung der Nebenkostenabrechnung — €29",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function trackEvent(env, event, data = {}) {
  try {
    const id  = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;
    await env.SESSIONS_KV.put(
      key,
      JSON.stringify({ event, ...data, received_at: new Date().toISOString() }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

async function sendEmail(env, { to, subject, html, attachments = [] }) {
  const body = {
    from: FROM,
    to:   Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (attachments.length) body.attachments = attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Resend Fehler: ${await res.text()}`);
  return res.json();
}

function formatAmount(triage = {}) {
  const amount =
    triage?.amount_claimed ??
    triage?.fine_amount ??
    triage?.total_price ??
    null;

  if (amount === null || amount === undefined || amount === "") return "unbekannt";

  const currency =
    triage?.currency_symbol ||
    triage?.currency ||
    triage?.amount_currency ||
    "€";

  const formatted = Number(amount).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (String(currency).toUpperCase() === "GBP" || String(currency).includes("£")) return `£${formatted}`;
  return `€${formatted}`;
}

function riskLabel(risk) {
  return { low: "Gering", medium: "Mittel", high: "Hoch" }[risk] || risk || "unbekannt";
}

function riskAssessment(risk) {
  return {
    high:   "Nach erster Einschätzung bestehen mehrere prüfenswerte Auffälligkeiten. Eine genauere Prüfung vor einer Zahlung kann empfehlenswert sein.",
    medium: "Nach erster Einschätzung bestehen mögliche Unklarheiten. Eine genauere Prüfung vor einer Zahlung kann sinnvoll sein.",
    low:    "Nach erster Einschätzung wirkt das Schreiben grundsätzlich professionell. Es kann dennoch sinnvoll sein, einzelne Punkte vor einer Zahlung zu prüfen.",
  }[risk] || "Nach erster Einschätzung bestehen mögliche Unklarheiten. Eine genauere Prüfung vor einer Zahlung kann sinnvoll sein.";
}

function teaserList(triage) {
  const raw = String(triage?.teaser || "").trim();

  if (!raw) {
    return [
      "mögliche zusätzliche Inkasso- oder Mahnkosten",
      "fehlende Nachweise oder unklare Forderungsgrundlage",
    ];
  }

  const parts = raw
    .split(/\n|•|;/)
    .map((line) => line.replace(/^[-–—]\s*/, "").trim())
    .filter(Boolean);

  return parts.length >= 2 ? parts.slice(0, 4) : [raw];
}

// Natural rotation for contact/closing phrases
function contactPhrase(seed = 0) {
  const phrases = [
    "Bei Fragen antworten Sie einfach auf diese E-Mail.",
    "Falls noch Fragen offen sind, können Sie uns jederzeit antworten.",
    "Bei Rückfragen genügt eine kurze Antwort auf diese Nachricht.",
    "Falls etwas unklar bleibt, können Sie sich jederzeit melden.",
    "Wenn Sie möchten, können Sie uns direkt auf diese E-Mail antworten.",
    "Bei Fragen können Sie einfach auf diese Nachricht antworten.",
    "Wenn Sie noch Fragen haben, erreichen Sie uns per Antwort auf diese E-Mail.",
  ];
  return phrases[seed % phrases.length];
}

// Type-sensitive "Nicht immer..." intro for tier2
function tier2IntroPhrase(type = "mahnung") {
  const phrases = {
    mahnung:    "Nicht immer sind Forderungsgrundlage und Nachweise vollständig nachvollziehbar. Vor einer Zahlung kann ein kurzer Abgleich sinnvoll sein.",
    parkstrafe: "Nicht immer sind Tatnachweis und Zustellung lückenlos dokumentiert. Vor einer Zahlung kann ein genauerer Blick auf das Schreiben sinnvoll sein.",
    rechnung:   "Nicht immer sind alle Positionen und Berechnungsgrundlagen vollständig aufgeschlüsselt. Vor einer Zahlung kann ein kurzer Abgleich sinnvoll sein.",
    vertrag:    "Nicht immer sind Kündigungsfristen und Verlängerungsklauseln vollständig nachvollziehbar. Vor einer Entscheidung kann ein genauerer Blick sinnvoll sein.",
    angebot:    "Nicht immer sind alle Positionen und Leistungsdetails klar aufgeschlüsselt. Vor einer Beauftragung kann ein genauerer Blick sinnvoll sein.",
    nebenkosten: "Nicht immer sind alle Kostenpositionen und Abrechnungsgrundlagen vollständig nachvollziehbar. Vor einer Zahlung kann ein Abgleich mit den eigenen Unterlagen sinnvoll sein.",
  };
  return phrases[type] || phrases.mahnung;
}

function tier3Teaser(triage = {}, type = "mahnung") {
  // Concrete, type-specific fallback teaser for tier-3 — avoids generic vague language
  if (triage?.teaser) return escapeHtml(String(triage.teaser).trim());

  const teasers = {
    mahnung:    "Es kann sinnvoll sein zu prüfen, ob der geforderte Betrag vollständig nachvollziehbar aufgeschlüsselt ist und ob alle erforderlichen Nachweise beigefügt wurden.",
    parkstrafe: "Es kann sinnvoll sein zu prüfen, ob der Bescheid alle erforderlichen Pflichtangaben enthält und ob Fristen und Zustellung korrekt dokumentiert sind.",
    rechnung:   "Es kann sinnvoll sein zu prüfen, ob alle berechneten Positionen mit der vereinbarten Leistung übereinstimmen und ob die Rechnung die gesetzlichen Pflichtangaben erfüllt.",
    vertrag:    "Es kann sinnvoll sein zu prüfen, ob Kündigungsfristen, automatische Verlängerungsklauseln oder Preiserhöhungen im Vertrag klar und wirksam geregelt sind.",
    angebot:    "Es kann sinnvoll sein zu prüfen, ob alle Positionen des Angebots klar aufgeschlüsselt sind und ob mögliche Zusatzkosten oder unklare Formulierungen enthalten sind.",
  };

  return teasers[type] || "Es kann sinnvoll sein, einzelne Details des Schreibens vor einer Zahlung oder Reaktion genauer zu prüfen.";
}

// ── Exports ───────────────────────────────────────────────────────────────────

export async function sendConfirmationEmail(env, { name, email, type }) {
  const safeName = escapeHtml(capitalizeFirst(name || "Kunde"));

  await sendEmail(env, {
    to:      email,
    subject: `Wir sehen uns Ihr Schreiben an — MussIchZahlen`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  <p>Vielen Dank für Ihre Zahlung. Wir sehen uns Ihr Schreiben nun genauer an.</p>
  <p>Sie erhalten die Einschätzung sowie eine Vorlage in der Regel bis zum nächsten Werktag per E-Mail.</p>
  <p style="font-size:.9rem;color:#6b7280;">→ Bitte prüfen Sie auch Ihren Spam-Ordner, falls Sie keine E-Mail erhalten sollten.</p>
  <p>Bei Fragen können Sie einfach auf diese E-Mail antworten.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });
}

export async function notifyAdminFree(env, { name, email, type, triage, stripeLink }) {
  const labels    = TYPE_LABELS[triage?.forderungstyp && TYPE_LABELS[triage.forderungstyp] ? triage.forderungstyp : type] || TYPE_LABELS.mahnung;
  const amount    = formatAmount(triage);
  const riskLbl   = { low: "Niedrig", medium: "Mittel", high: "Hoch" }[triage?.risk] || triage?.risk || "unbekannt";
  const tier      = triage?.tier ? triage.tier.charAt(0).toUpperCase() + triage.tier.slice(1) : "unbekannt";
  const route     = triage?.route || "unbekannt";

  const flags = [
    triage?.possible_verjährt           ? "mögliche Verjährung"               : null,
    triage?.possible_überhöhte_kosten   ? "mögliche zusätzliche Inkassokosten" : null,
    triage?.possible_kein_nachweis      ? "fehlende Nachweise"                 : null,
    triage?.possible_falscher_empfänger ? "falscher Empfänger"                 : null,
    triage?.possible_kein_abtretungsnachweis ? "fehlender Abtretungsnachweis"  : null,
    triage?.possible_keine_registrierung     ? "fehlende Registrierung"        : null,
  ].filter(Boolean);

  const flagsHtml = flags.length
    ? flags.map(f => `<li>${escapeHtml(f)}</li>`).join("")
    : "<li>keine</li>";

  await sendEmail(env, {
    to:      env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] Kostenlose Anfrage: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;">
  <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
    📬 Recovery-Sequenz wird automatisch geplant für <strong>${escapeHtml(email)}</strong>
  </p>
  <h3>Kostenlose Anfrage — ${escapeHtml(labels.title)}</h3>
  <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
    <tr><td style="padding:6px 10px;font-weight:bold;width:40%;">Name</td><td style="padding:6px 10px;">${escapeHtml(name)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">E-Mail</td><td style="padding:6px 10px;">${escapeHtml(email)}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Absender</td><td style="padding:6px 10px;">${escapeHtml(triage?.sender || "unbekannt")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Betrag</td><td style="padding:6px 10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Risikoeinschätzung</td><td style="padding:6px 10px;">${escapeHtml(riskLbl)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Prüfungschance</td><td style="padding:6px 10px;">${escapeHtml(String(triage?.chance ?? "?"))}%</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Auffälligkeiten</td><td style="padding:6px 10px;"><ul style="margin:0;padding-left:16px;">${flagsHtml}</ul></td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Tier</td><td style="padding:6px 10px;">${escapeHtml(tier)}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Route</td><td style="padding:6px 10px;">${escapeHtml(route)}</td></tr>
    ${stripeLink ? `<tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Stripe</td><td style="padding:6px 10px;"><a href="${escapeHtml(stripeLink)}">${escapeHtml(stripeLink)}</a></td></tr>` : ""}
  </table>
</div>`,
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = formatAmount(triage);
  const rtf    = makeAnalysisRtf(analysis, name, email, triage, type);

  await sendEmail(env, {
    to:      env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] BEZAHLT: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;">
  <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
    📬 Recovery-Sequenz wird gestoppt, Kunden-E-Mail mit Anhängen wird geplant
  </p>
  <h3>Bezahlte Analyse — ${escapeHtml(labels.title)}</h3>
  <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
    <tr><td style="padding:6px 10px;font-weight:bold;width:40%;">Name</td><td style="padding:6px 10px;">${escapeHtml(name)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">E-Mail</td><td style="padding:6px 10px;">${escapeHtml(email)}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Absender</td><td style="padding:6px 10px;">${escapeHtml(triage?.sender || "unbekannt")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Betrag</td><td style="padding:6px 10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Risikoeinschätzung</td><td style="padding:6px 10px;">${escapeHtml({ low: "Niedrig", medium: "Mittel", high: "Hoch" }[triage?.risk] || triage?.risk || "unbekannt")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Tier</td><td style="padding:6px 10px;">${escapeHtml(String(triage?.tier || "unbekannt"))}</td></tr>
  </table>
</div>`,
    attachments: [
      { filename: "MussIchZahlen-Analyse.rtf", content: rtfToBase64(rtf) },
    ],
  });
}

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const baseLabels  = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const labels      = {
    ...baseLabels,
    title: (type === "parkstrafe" && triage?.is_privat)
      ? "Private Parkforderung"
      : (type === "parkstrafe" && triage?.bescheid_typ === "privat")
        ? "Private Parkforderung"
        : baseLabels.title,
  };
  const amount      = (type === "vertrag" || type === "angebot" || type === "nebenkosten")
    ? (triage?.monthly_cost ? `€${Number(triage.monthly_cost).toLocaleString("de-DE", { minimumFractionDigits: 2 })}/Monat` : triage?.annual_cost ? `€${Number(triage.annual_cost).toLocaleString("de-DE", { minimumFractionDigits: 2 })}/Jahr` : triage?.total_price ? `€${Number(triage.total_price).toLocaleString("de-DE", { minimumFractionDigits: 2 })}` : formatAmount(triage))
    : formatAmount(triage);
  const stageNumber = Number(stage) || 1;
  const tier        = triage?.tier || "";
  const safeName    = escapeHtml(capitalizeFirst(name || "Kunde"));

  // ── Stage 1 tier3 — ruhig, ehrlich, optional ─────────────────────────────
  if (stageNumber === 1 && tier === "tier3") {
    const teaser = tier3Teaser(triage, type);

    await sendEmail(env, {
      to:      email,
      subject: `Erste Einschätzung zu Ihrem ${escapeHtml(labels.title)} — MussIchZahlen`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  <p>wir haben uns Ihr Schreiben angesehen und möchten Ihnen eine erste Einschätzung mitteilen.</p>
  <p>Auf Grundlage des vorliegenden Schreibens wirkt die Forderung derzeit grundsätzlich nachvollziehbar. ${teaser}</p>
  <table style="width:100%;border-collapse:collapse;margin:22px 0;font-size:.9rem;border:1px solid #e5e7eb;">
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;width:38%;">Dokument</td><td style="padding:9px 12px;">${escapeHtml(labels.title)}</td></tr>
    <tr><td style="padding:9px 12px;font-weight:600;">Absender</td><td style="padding:9px 12px;">${escapeHtml(triage?.sender || "nicht eindeutig erkennbar")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;">${type === "vertrag" ? "Monatliche Kosten" : type === "angebot" || type === "nebenkosten" ? "Gesamtbetrag" : "Geforderter Betrag"}</td><td style="padding:9px 12px;font-weight:700;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
    <tr><td style="padding:9px 12px;font-weight:600;">Erste Einschätzung</td><td style="padding:9px 12px;">Begrenzte sichtbare Auffälligkeiten</td></tr>
  </table>
  <p>${
    type === "vertrag"
      ? "Manche Verbraucher möchten die Unterlagen dennoch noch einmal genauer ansehen — etwa um Laufzeit oder Kündigungsfrist besser nachvollziehen zu können. Das bleibt selbstverständlich optional."
      : type === "angebot"
        ? "Manche Verbraucher möchten die Unterlagen dennoch noch einmal genauer einordnen lassen — vor allem wenn einzelne Positionen oder der Leistungsumfang noch nicht vollständig klar sind. Das bleibt selbstverständlich optional."
        : type === "nebenkosten"
          ? "Manche Verbraucher möchten die Abrechnung dennoch noch einmal genauer ansehen — etwa um die Kostenbestandteile mit den eigenen Unterlagen abzugleichen. Das bleibt selbstverständlich optional."
          : "Manche Verbraucher möchten die Unterlagen dennoch noch einmal genauer einordnen lassen — etwa wenn einzelne Positionen noch nicht vollständig nachvollziehbar sind. Das bleibt selbstverständlich optional."
  }</p>
  ${stripeLink ? `
  <div style="margin:24px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#374151;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      ${type === "rechnung" || type === "angebot" || type === "vertrag" || type === "nebenkosten" ? "Abrechnung genauer einordnen" : type === "parkstrafe" ? "Bescheid genauer einordnen" : "Unterlagen genauer einordnen"} — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:.82rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>` : ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
  <p>${contactPhrase(1)}</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", tier: "tier3" });
    return;
  }

  // ── Stage 1 tier1 — urgent, concrete concerns ─────────────────────────────
  if (stageNumber === 1 && tier === "tier1") {
    const senderText = triage?.sender ? `von <strong>${escapeHtml(triage.sender)}</strong> ` : "";
    const amountText = amount !== "unbekannt" ? `über <strong>${escapeHtml(amount)}</strong> ` : "";
    const teaserText = triage?.teaser ? escapeHtml(String(triage.teaser).trim()) : null;

    const openings = [
      `wir haben uns Ihr Schreiben ${senderText}angesehen. Einige Punkte sollten vor einer Zahlung noch geklärt werden.`,
      `Ihr Schreiben ${senderText}liegt uns vor — dabei sind einige Punkte aufgefallen, die vor einer Zahlung noch geklärt werden sollten.`,
      `wir haben uns die Unterlagen ${senderText}kurz angesehen. Einiges daran sollte vor einer Zahlung noch überprüft werden.`,
    ];
    const opening = openings[Math.floor(Math.random() * openings.length)];

    await sendEmail(env, {
      to:      email,
      subject: `Erste Einschätzung zu Ihrer ${escapeHtml(labels.title)} — MussIchZahlen`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  <p>${opening}</p>
  ${teaserText ? `
  <div style="background:#fffbeb;border-left:3px solid #d97706;padding:14px 16px;border-radius:4px;margin:22px 0;color:#78350f;font-size:.94rem;line-height:1.75;">
    ${teaserText}
  </div>` : `
  <p>${type === "vertrag" ? "Solche Mitteilungen lohnen sich in Ruhe anzusehen — vor allem wenn Verlängerungsklauseln oder Preisanpassungen betroffen sind." : type === "angebot" ? "Bei Angeboten dieser Größenordnung können einzelne Positionen einen näheren Blick lohnen." : "Gerade bei Forderungen dieser Art kann ein genauerer Blick sinnvoll sein — insbesondere wenn einzelne Angaben nicht vollständig nachvollziehbar sind."}</p>`}
  <table style="width:100%;border-collapse:collapse;margin:22px 0;font-size:.9rem;border:1px solid #e5e7eb;">
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;width:38%;">Dokument</td><td style="padding:9px 12px;">${escapeHtml(labels.title)}</td></tr>
    <tr><td style="padding:9px 12px;font-weight:600;">Absender</td><td style="padding:9px 12px;">${escapeHtml(triage?.sender || "nicht eindeutig erkennbar")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;">${type === "vertrag" ? "Monatliche Kosten" : type === "angebot" || type === "nebenkosten" ? "Gesamtbetrag" : "Geforderter Betrag"}</td><td style="padding:9px 12px;font-weight:700;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
  </table>
  <p>${type === "vertrag"
    ? "Ein genauerer Blick auf die Vertragsunterlagen kann helfen, Kündigungsfristen, Verlängerungsklauseln und Preisanpassungen besser zu verstehen."
    : type === "angebot" || type === "nebenkosten" || type === "rechnung"
      ? "Ein genauerer Blick auf die Unterlagen kann helfen, die Positionen besser nachzuvollziehen und offene Punkte zu klären."
      : "Ein genauerer Blick auf das Schreiben kann helfen, die Grundlage der Forderung besser einzuordnen — und zu verstehen, ob alle Angaben vollständig nachvollziehbar sind."}</p>
  <p>Mit der ausführlicheren Einschätzung erhalten Sie eine klare Einordnung der offenen Punkte sowie eine Vorlage, die Sie bei Bedarf verwenden können.</p>
  ${stripeLink ? `
  <div style="margin:28px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#ffffff;padding:14px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
      ${type === "rechnung" ? "Rechnung genauer einordnen" : type === "angebot" ? "Angebot genauer einordnen" : type === "vertrag" ? "Vertrag genauer einordnen" : type === "parkstrafe" ? "Bescheid genauer einordnen" : type === "nebenkosten" ? "Abrechnung genauer einordnen" : "Schreiben genauer einordnen"} — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:.84rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p style="font-size:.84rem;color:#6b7280;margin-top:16px;">
    Funktioniert der Button nicht? Kopieren Sie diesen Link in Ihren Browser:<br>
    <a href="${escapeHtml(stripeLink)}" style="color:#1d4ed8;word-break:break-all;">${escapeHtml(stripeLink)}</a>
  </p>` : ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
  <p>${contactPhrase(0)}</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", tier: "tier1" });
    return;
  }

  // ── Stage 1 tier2 — moderate caution, concrete but restrained ────────────
  if (stageNumber === 1 && tier === "tier2") {
    const senderText = triage?.sender ? `von <strong>${escapeHtml(triage.sender)}</strong> ` : "";
    const amountText = amount !== "unbekannt" ? `über <strong>${escapeHtml(amount)}</strong> ` : "";
    const teaserText = triage?.teaser ? escapeHtml(String(triage.teaser).trim()) : null;

    await sendEmail(env, {
      to:      email,
      subject: `Erste Einschätzung zu Ihrer ${escapeHtml(labels.title)} — MussIchZahlen`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  <p>Ihr Schreiben ${senderText}liegt uns vor. Wir haben kurz durchgesehen, was darin steht — einige Punkte sollten vor einer Zahlung noch geklärt werden.</p>
  ${teaserText ? `
  <div style="background:#fffbeb;border-left:3px solid #d97706;padding:14px 16px;border-radius:4px;margin:22px 0;color:#78350f;font-size:.94rem;line-height:1.75;">
    ${teaserText}
  </div>` : `
  <p>Einzelne Angaben in diesem Schreiben sollten vor einer Zahlung noch genauer geprüft werden — insbesondere hinsichtlich der Kosten und der zugrunde liegenden Unterlagen bleiben einzelne Punkte derzeit offen.</p>`}
  <table style="width:100%;border-collapse:collapse;margin:22px 0;font-size:.9rem;border:1px solid #e5e7eb;">
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;width:38%;">Dokument</td><td style="padding:9px 12px;">${escapeHtml(labels.title)}</td></tr>
    <tr><td style="padding:9px 12px;font-weight:600;">Absender</td><td style="padding:9px 12px;">${escapeHtml(triage?.sender || "nicht eindeutig erkennbar")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;">${type === "vertrag" ? "Monatliche Kosten" : type === "angebot" || type === "nebenkosten" ? "Gesamtbetrag" : "Geforderter Betrag"}</td><td style="padding:9px 12px;font-weight:700;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
  </table>
  <p>${tier2IntroPhrase(type)}</p>
  <p>${type === "rechnung" || type === "angebot" || type === "vertrag" ? "Mit der ausführlicheren Einschätzung erhalten Sie eine klare Einordnung der offenen Punkte sowie eine Vorlage für eine schriftliche Rückfrage. Das bleibt selbstverständlich optional." : "Mit der ausführlicheren Einschätzung erhalten Sie eine klare Einordnung der offenen Punkte sowie eine Vorlage, die Sie bei Bedarf verwenden können. Das bleibt selbstverständlich optional."}</p>
  ${stripeLink ? `
  <div style="margin:28px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#ffffff;padding:14px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
      ${type === "rechnung" ? "Rechnung genauer einordnen" : type === "angebot" ? "Angebot genauer einordnen" : type === "vertrag" ? "Vertrag genauer einordnen" : type === "parkstrafe" ? "Bescheid genauer einordnen" : type === "nebenkosten" ? "Abrechnung genauer einordnen" : "Schreiben genauer einordnen"} — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:.84rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p style="font-size:.84rem;color:#6b7280;margin-top:16px;">
    Funktioniert der Button nicht? Kopieren Sie diesen Link in Ihren Browser:<br>
    <a href="${escapeHtml(stripeLink)}" style="color:#1d4ed8;word-break:break-all;">${escapeHtml(stripeLink)}</a>
  </p>` : ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
  <p>${contactPhrase(2)}</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", tier: "tier2" });
    return;
  }

  // ── Stage 2/3 — geen link, geen mail voor tier3 ───────────────────────────
  if (!stripeLink || tier === "tier3") return;

  const subjects = {
    2: type === "vertrag" ? `Ihre Vertragsunterlagen liegen noch vor — ${labels.title}` : `Ihre Einschätzung liegt noch vor — ${labels.title}`,
    3: type === "vertrag" ? `Kurze Rückmeldung zu Ihrer Vertragssituation — ${labels.title}` : `Kurze Erinnerung zu Ihrem Schreiben — ${labels.title}`,
  };

  const intros = {
    2: type === "vertrag"
      ? `<p>Ihre Vertragsunterlagen liegen noch vor. Falls Sie die Konditionen noch nicht genauer angesehen haben — vor einer Verlängerung oder weiteren Zahlung kann ein kurzer Blick sinnvoll sein.</p>`
      : `<p>Ihre erste Einschätzung liegt noch vor. Falls Sie die Unterlagen noch nicht genauer angesehen haben — ein kurzer Blick vor einer Zahlung kann sinnvoll sein.</p>`,
    3: type === "vertrag"
      ? `<p>Wir melden uns ein letztes Mal zu Ihren Vertragsunterlagen. Falls noch Fragen offen sind, steht die Einordnung weiter zur Verfügung.</p>`
      : `<p>Wir melden uns ein letztes Mal. Falls die Unterlagen noch nicht durchgesehen wurden, kann ein kurzer Blick sinnvoll sein.</p>`,
  };

  const teaserHint = triage?.teaser ? `
  <div style="background:#fffbeb;border-left:3px solid #d97706;padding:12px 14px;border-radius:4px;margin:18px 0;color:#78350f;font-size:.9rem;line-height:1.7;">
    ${escapeHtml(teaserList(triage)[0])}
  </div>` : "";

  await sendEmail(env, {
    to:      email,
    subject: subjects[stageNumber] || subjects[2],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  ${intros[stageNumber] || intros[2]}
  ${teaserHint}
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:.9rem;border:1px solid #e5e7eb;">
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;width:38%;">Dokument</td><td style="padding:9px 12px;">${escapeHtml(labels.title)}</td></tr>
    <tr><td style="padding:9px 12px;font-weight:600;">Absender</td><td style="padding:9px 12px;">${escapeHtml(triage?.sender || "nicht eindeutig erkennbar")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;">${type === "vertrag" ? "Monatliche Kosten" : type === "angebot" || type === "nebenkosten" ? "Gesamtbetrag" : "Geforderter Betrag"}</td><td style="padding:9px 12px;font-weight:700;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
  </table>
  <div style="margin:22px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
      ${type === "rechnung" ? "Rechnung genauer einordnen" : type === "angebot" ? "Angebot genauer einordnen" : type === "vertrag" ? "Vertrag genauer einordnen" : type === "parkstrafe" ? "Bescheid genauer einordnen" : type === "nebenkosten" ? "Abrechnung genauer einordnen" : "Schreiben genauer einordnen"} — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:.84rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p>${contactPhrase(stageNumber)}</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "free", tier: tier || "tier1_or_tier2" });
}

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const baseLabels  = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const labels      = {
    ...baseLabels,
    title: (type === "parkstrafe" && (triage?.is_privat || triage?.bescheid_typ === "privat"))
      ? "Private Parkforderung"
      : baseLabels.title,
  };
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf   = makeLetterRtf(analysis, name, triage, type);
  const safeName    = escapeHtml(capitalizeFirst(name || "Kunde"));
  const isTier3     = triage?.tier === "tier3";
  const rawSender   = triage?.sender || "";
  const shortSender = rawSender.length > 40
    ? rawSender.split(",")[0].split("—")[0].split("–")[0].trim()
    : rawSender;
  const senderText  = shortSender ? ` von ${escapeHtml(shortSender)}` : "";

  const htmlTier3 = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  <p>Ihr Schreiben${senderText} liegt uns vor. Wir haben die Unterlagen für Sie eingeordnet und übersichtlich zusammengefasst.</p>
  <p>Im Anhang finden Sie die Einschätzung sowie eine Vorlage, die Sie bei Bedarf verwenden können.</p>
  <p>Lesen Sie die Einschätzung bitte in Ruhe durch.</p>
  <p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`;

  const htmlTier1Tier2 = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  <p>Ihr Schreiben${senderText} liegt uns vor. Wir haben die Unterlagen für Sie eingeordnet und die wichtigsten Punkte übersichtlich zusammengefasst.</p>
  <p>Im Anhang finden Sie die Einschätzung sowie eine Vorlage, die Sie bei Bedarf verwenden können.</p>
  <p>Lesen Sie die Einschätzung bitte zunächst in Ruhe durch — sie erklärt, welche Punkte vor einer Entscheidung noch geklärt werden sollten.</p>
  <p style="font-size:.9rem;color:#374151;">Falls Sie die Vorlage versenden möchten, empfehlen wir einen Versand mit Nachweis.</p>
  <p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`;

  await sendEmail(env, {
    to:      email,
    subject: `Ihre Einschätzung — ${triage?.sender ? escapeHtml(triage.sender) : escapeHtml(labels.title)}`,
    html:    isTier3 ? htmlTier3 : htmlTier1Tier2,
    attachments: [
      { filename: "MussIchZahlen-Analyse.rtf", content: rtfToBase64(analysisRtf) },
      { filename: labels.filename,              content: rtfToBase64(letterRtf)   },
    ],
  });

  await trackEvent(env, "email_sent", { type, kind: "paid" });
}

export async function sendAbandonedEmail(env, { name, email, type, amount, stripeLink, stage = 1 }) {
  if (!stripeLink) return;

  const labels      = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const stageNumber = Number(stage) || 1;
  const amountStr   = amount ? ` über einen Betrag von €${escapeHtml(String(amount))}` : "";
  const safeName    = escapeHtml(capitalizeFirst(name || "Kunde"));

  const subjects = {
    1: `Kurze Rückfrage zu Ihrem Schreiben — ${labels.title}`,
    2: `Ihre Unterlagen liegen noch vor — ${labels.title}`,
    3: `Letzte Nachricht zu Ihrer Forderung — ${labels.title}`,
  };

  const intros = {
    1: `<p>Sie haben Ihr Schreiben${amountStr ? ` über ${amountStr}` : ""} bei uns hochgeladen, aber die Prüfung noch nicht abgeschlossen. Falls Sie die Unterlagen vor einer Zahlung noch genauer prüfen möchten — das ist jederzeit möglich.</p>`,
    2: `<p>Ihre Unterlagen liegen noch vor. Falls Sie noch unsicher sind, ob die Forderung vollständig nachvollziehbar ist — eine genauere Prüfung vor einer Zahlung kann sinnvoll sein.</p>`,
    3: `<p>Wir melden uns ein letztes Mal. Falls Sie die Forderung noch nicht geprüft haben und das noch möchten, ist das weiterhin möglich.</p>`,
  };

  await sendEmail(env, {
    to:      email,
    subject: subjects[stageNumber] || subjects[1],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  ${intros[stageNumber] || intros[1]}
  <div style="margin:24px 0;">
    <a href="${escapeHtml(stripeLink)}" target="_blank" rel="noopener noreferrer"
      style="background:#1d3a6e;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;display:inline-block;font-weight:700;font-size:15px;">
      Unterlagen genauer prüfen — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:.84rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "abandoned" });
}
