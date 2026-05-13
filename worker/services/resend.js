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

  if (String(currency).toUpperCase() === "GBP" || String(currency).includes("£")) return `£${amount}`;
  return `€${amount}`;
}

function riskLabel(risk) {
  return { low: "Gering", medium: "Mittel", high: "Hoch" }[risk] || risk || "unbekannt";
}

function riskAssessment(risk) {
  return {
    high:   "Nach erster Einschätzung bestehen mehrere prüfenswerte Auffälligkeiten. Eine genauere Prüfung vor einer Zahlung kann empfehlenswert sein.",
    medium: "Nach erster Einschätzung bestehen mögliche Unklarheiten. Eine genauere Prüfung vor einer Zahlung kann sinnvoll sein.",
    low:    "Nach erster Einschätzung wirkt die Forderung grundsätzlich nachvollziehbar. Eine kurze Prüfung kann dennoch sinnvoll sein.",
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

// ── Exports ───────────────────────────────────────────────────────────────────

export async function sendConfirmationEmail(env, { name, email }) {
  await sendEmail(env, {
    to:      email,
    subject: "Ihr Schreiben ist eingegangen — MussIchZahlen",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  <p style="font-size:1.1rem;font-weight:700;color:#14532d;">✓ Ihr Schreiben ist eingegangen.</p>
  <p>Guten Tag ${escapeHtml(capitalizeFirst(name || "Kunde"))},</p>
  <p>wir haben Ihr Dokument erhalten und werden es sorgfältig prüfen.</p>
  <p>Sie erhalten spätestens am nächsten Werktag bis 16:00 Uhr eine erste Einschätzung per E-Mail — mit möglichen Auffälligkeiten und Hinweisen zu Ihrem Schreiben.</p>
  <p style="font-size:.9rem;color:#6b7280;">→ Bitte prüfen Sie auch Ihren Spam-Ordner, falls Sie keine E-Mail erhalten.</p>
  <p>Falls Sie Fragen haben, können Sie einfach auf diese E-Mail antworten.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });
}

export async function notifyAdminFree(env, { name, email, type, triage, stripeLink }) {
  const labels    = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
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
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount      = formatAmount(triage);
  const stageNumber = Number(stage) || 1;
  const tier        = triage?.tier || "";
  const safeName    = escapeHtml(capitalizeFirst(name || "Kunde"));

  // ── Stage 1 tier3 — zachte versie zonder harde CTA ───────────────────────
  if (stageNumber === 1 && tier === "tier3") {
    await sendEmail(env, {
      to:      email,
      subject: `Erste Einschätzung zu Ihrem Schreiben — ${labels.title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  <p>Guten Tag ${safeName},</p>
  <p>wir haben Ihr Schreiben geprüft und eine erste Einschätzung erstellt.</p>
  <p>Das Schreiben wirkt nach erster Einschätzung derzeit eher nachvollziehbar. Es bestehen keine deutlichen Hinweise auf größere Unstimmigkeiten oder ungewöhnliche Zusatzkosten.</p>
  <div style="background:#f9fafb;padding:16px;border-radius:8px;margin:22px 0;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;font-weight:bold;width:140px;">Dokument</td><td style="padding:8px 0;">${escapeHtml(labels.title)}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;">Absender</td><td style="padding:8px 0;">${escapeHtml(triage?.sender || "unbekannt")}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;">Betrag</td><td style="padding:8px 0;">${escapeHtml(amount)}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;">Einschätzung</td><td style="padding:8px 0;">Eher unauffällig</td></tr>
    </table>
  </div>
  <p>Eine kostenpflichtige vollständige Analyse scheint auf Basis der ersten Prüfung nicht zwingend notwendig.</p>
  ${stripeLink ? `
  <div style="margin:22px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#eef2ff;color:#1d3a6e;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;border:1px solid #c7d2fe;">
      Optionale vollständige Analyse — €${escapeHtml(labels.price)}
    </a>
  </div>
  <p style="font-size:0.82rem;color:#6b7280;">Nur falls Sie eine zusätzliche Prüfung wünschen.</p>` : ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
  <p>Falls Sie Fragen haben, können Sie einfach auf diese E-Mail antworten.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", tier: "tier3" });
    return;
  }

  // ── Stage 1 tier1/tier2 — volledige CTA ──────────────────────────────────
  if (stageNumber === 1) {
    const senderText  = triage?.sender ? ` von <strong>${escapeHtml(triage.sender)}</strong>` : "";
    const riskText    = riskAssessment(triage?.risk);
    const hints       = teaserList(triage);

    await sendEmail(env, {
      to:      email,
      subject: `Erste Einschätzung zu Ihrem Schreiben — ${labels.title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  <p>Guten Tag ${safeName},</p>
  <p>wir haben Ihr Schreiben geprüft und eine erste Einschätzung erstellt.</p>
  <p>Bei einer Forderung${amount !== "unbekannt" ? ` über <strong>${escapeHtml(amount)}</strong>` : ""}${senderText} könnten einzelne Punkte relevant sein, die vor einer Zahlung geprüft werden sollten.</p>
  <p><strong>Hinweise aus der ersten Prüfung:</strong></p>
  <ul style="padding-left:20px;line-height:1.9;margin-top:10px;">
    ${hints.map(line => `<li>${escapeHtml(line)}</li>`).join("")}
  </ul>
  <table style="width:100%;border-collapse:collapse;margin:22px 0;border:1px solid #e5e7eb;font-size:14px;">
    <tr style="background:#f3f4f6;"><td style="padding:10px;font-weight:bold;">Dokument</td><td style="padding:10px;">${escapeHtml(labels.title)}</td></tr>
    <tr><td style="padding:10px;font-weight:bold;">Absender</td><td style="padding:10px;">${escapeHtml(triage?.sender || "unbekannt")}</td></tr>
    <tr style="background:#f3f4f6;"><td style="padding:10px;font-weight:bold;">Betrag</td><td style="padding:10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
    <tr><td style="padding:10px;font-weight:bold;">Einschätzung</td><td style="padding:10px;">${escapeHtml(riskText)}</td></tr>
  </table>
  <div style="background:#fff7ed;border:1px solid #fdba74;padding:14px;border-radius:8px;margin:22px 0;color:#9a3412;">
    <strong>Warum viele Verbraucher zuerst prüfen lassen:</strong>
    <ul style="padding-left:18px;margin-top:10px;line-height:1.8;">
      <li>Inkassokosten sind nicht immer vollständig nachvollziehbar</li>
      <li>Forderungen enthalten teilweise unklare Zusatzkosten</li>
      <li>Nachweise oder Vertragsgrundlagen fehlen manchmal vollständig</li>
    </ul>
  </div>
  <p><strong>Die vollständige Analyse beinhaltet:</strong></p>
  <ul style="padding-left:20px;line-height:1.9;">
    <li>klare Bewertung Ihrer Situation</li>
    <li>konkrete prüfenswerte Punkte</li>
    <li>fertiges Antwortschreiben, das Sie direkt versenden können</li>
  </ul>
  ${stripeLink ? `
  <div style="margin:28px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
      Vollständige Analyse + Antwortschreiben — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:0.86rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p style="font-size:0.86rem;color:#6b7280;margin-top:18px;">
    Funktioniert der Button nicht?<br><br>
    Kopieren Sie diesen Zahlungslink in Ihren Browser:<br>
    <a href="${escapeHtml(stripeLink)}" style="color:#1d4ed8;word-break:break-all;">${escapeHtml(stripeLink)}</a>
  </p>` : ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
  <p>Falls Sie Fragen haben, können Sie einfach auf diese E-Mail antworten.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", tier: tier || "tier1_or_tier2" });
    return;
  }

  // ── Stage 2/3 — geen link, geen mail voor tier3 ───────────────────────────
  if (!stripeLink || tier === "tier3") return;

  const subjects = {
    2: `Noch nicht geprüft? Ihre Einschätzung wartet — ${labels.title}`,
    3: `Letzte Erinnerung zu Ihrer Einschätzung — ${labels.title}`,
  };

  const intros = {
    2: `<p>Ihre kostenlose Ersteinschätzung liegt noch vor. Es kann sinnvoll sein, die Forderung vor einer Zahlung noch einmal prüfen zu lassen.</p>`,
    3: `<p>Dies ist unsere letzte Erinnerung zu Ihrer Ersteinschätzung. Falls Sie die Forderung noch nicht geprüft haben, könnte eine kurze Prüfung sinnvoll sein — bevor Sie zahlen.</p>`,
  };

  const teaserHint = triage?.teaser ? `
  <div style="background:#fff7ed;border:1px solid #fdba74;padding:12px;border-radius:8px;margin:18px 0;color:#9a3412;">
    <strong>Hinweis aus der ersten Prüfung:</strong><br>
    ${escapeHtml(teaserList(triage)[0])}
  </div>` : "";

  await sendEmail(env, {
    to:      email,
    subject: subjects[stageNumber] || subjects[2],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  <p>Guten Tag ${safeName},</p>
  ${intros[stageNumber] || intros[2]}
  ${teaserHint}
  <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;">
    <tr style="background:#f3f4f6;"><td style="padding:10px;font-weight:bold;">Dokument</td><td style="padding:10px;">${escapeHtml(labels.title)}</td></tr>
    <tr><td style="padding:10px;font-weight:bold;">Absender</td><td style="padding:10px;">${escapeHtml(triage?.sender || "unbekannt")}</td></tr>
    <tr style="background:#f3f4f6;"><td style="padding:10px;font-weight:bold;">Betrag</td><td style="padding:10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
    <tr><td style="padding:10px;font-weight:bold;">Einschätzung</td><td style="padding:10px;">${escapeHtml(riskLabel(triage?.risk))}</td></tr>
  </table>
  <div style="margin:24px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
      Vollständige Analyse + Antwortschreiben — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:0.85rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "free", tier: tier || "tier1_or_tier2" });
}

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf   = makeLetterRtf(analysis, name, triage, type);

  await sendEmail(env, {
    to:      email,
    subject: `Ihre Analyse ist fertig — ${labels.title} | MussIchZahlen`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
  <p>Guten Tag ${escapeHtml(capitalizeFirst(name || "Kunde"))},</p>
  <p>Ihre Analyse ist fertig. Im Anhang finden Sie zwei Dateien:</p>
  <ul style="line-height:1.9;">
    <li><strong>MussIchZahlen-Analyse.rtf</strong> — vollständige Analyse mit Befunden und nächsten Schritten</li>
    <li><strong>${escapeHtml(labels.filename)}</strong> — fertiges ${escapeHtml(labels.letter)}, direkt verwendbar</li>
  </ul>
  <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
    💡 Tipp: Senden Sie das Schreiben möglichst per Einschreiben oder per E-Mail mit Versandnachweis. Bewahren Sie den Nachweis auf.
  </p>
  <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
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
    1: `Ihr Schreiben wartet noch — ${labels.title}`,
    2: `Noch nicht geprüft? — ${labels.title}`,
    3: `Letzte Erinnerung — ${labels.title}`,
  };

  const intros = {
    1: `<p>Sie haben Ihr Schreiben hochgeladen, aber die Prüfung noch nicht abgeschlossen${amountStr}. Es kann sinnvoll sein, die Forderung vor einer Zahlung genauer prüfen zu lassen.</p>`,
    2: `<p>Ihre Einschätzung liegt noch vor. Viele entscheiden sich dafür, die Forderung erst prüfen zu lassen — bevor sie zahlen.</p>`,
    3: `<p>Dies ist unsere letzte Erinnerung. Falls Sie die Forderung noch nicht geprüft haben, kann ein kurzer Blick lohnenswert sein.</p>`,
  };

  await sendEmail(env, {
    to:      email,
    subject: subjects[stageNumber] || subjects[1],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  <p>Guten Tag ${safeName},</p>
  ${intros[stageNumber] || intros[1]}
  <div style="margin:28px 0;text-align:center;">
    <a href="${escapeHtml(stripeLink)}" target="_blank" rel="noopener noreferrer"
      style="background:#1d3a6e;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">
      Jetzt vollständig prüfen lassen — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:0.85rem;color:#6b7280;text-align:center;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "abandoned" });
}
