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

  return teasers[type] || "Es kann sinnvoll sein, einzelne Details des Schreibens vor einer Zahlung oder Reaktion sorgfältig zu prüfen.";
}

// ── Exports ───────────────────────────────────────────────────────────────────

export async function sendConfirmationEmail(env, { name, email, type }) {
  const safeName = escapeHtml(capitalizeFirst(name || "Kunde"));

  await sendEmail(env, {
    to:      email,
    subject: `Ihr Schreiben wird geprüft — MussIchZahlen`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  <p>vielen Dank — wir haben Ihr Schreiben erhalten und werden es sorgfältig prüfen.</p>
  <p>Gerade bei Mahnungen oder Inkassoschreiben lohnt eine genaue Betrachtung. Nicht immer sind Forderungsbetrag, Kostenstruktur und Nachweise auf den ersten Blick vollständig nachvollziehbar.</p>
  <p>Sie erhalten eine erste Einschätzung dazu, ob einzelne Punkte genauer geprüft werden sollten — in der Regel bis zum nächsten Werktag per E-Mail.</p>
  <p style="font-size:.9rem;color:#6b7280;">→ Bitte prüfen Sie auch Ihren Spam-Ordner, falls Sie keine E-Mail erhalten sollten.</p>
  <p>Bei Fragen können Sie einfach auf diese E-Mail antworten.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
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
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;">Geforderter Betrag</td><td style="padding:9px 12px;font-weight:700;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
    <tr><td style="padding:9px 12px;font-weight:600;">Erste Einschätzung</td><td style="padding:9px 12px;">Begrenzte sichtbare Auffälligkeiten</td></tr>
  </table>
  <p>Manche Verbraucher entscheiden sich dennoch für eine vollständige Prüfung — etwa um sicherzugehen, dass alle Kostenbestandteile nachvollziehbar sind und keine Unterlagen fehlen. Das bleibt selbstverständlich optional.</p>
  ${stripeLink ? `
  <div style="margin:24px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#374151;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
      Forderung genauer prüfen — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:.82rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>` : ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
  <p>Bei Fragen können Sie einfach auf diese E-Mail antworten.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", tier: "tier3" });
    return;
  }

  // ── Stage 1 tier1/tier2 — volledige CTA ──────────────────────────────────
  if (stageNumber === 1) {
    const senderText = triage?.sender ? `von <strong>${escapeHtml(triage.sender)}</strong> ` : "";
    const amountText = amount !== "unbekannt" ? `über <strong>${escapeHtml(amount)}</strong> ` : "";
    const teaserText = triage?.teaser ? escapeHtml(String(triage.teaser).trim()) : null;

    // Varieer de opening — niet altijd dezelfde cadans
    const openings = [
      `wir haben uns die Unterlagen ${senderText}${amountText}angesehen und möchten Ihnen eine erste Einschätzung mitteilen.`,
      `nach erster Durchsicht Ihres Schreibens ${senderText}${amountText}ergeben sich einzelne Punkte, die vor einer Zahlung geprüft werden sollten.`,
      `wir haben Ihr Schreiben ${senderText}${amountText}geprüft und möchten Ihnen kurz mitteilen, was uns dabei aufgefallen ist.`,
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
  <p>Gerade bei Forderungen dieser Art kann eine genauere Prüfung sinnvoll sein — insbesondere wenn einzelne Angaben im Schreiben nicht vollständig nachvollziehbar sind.</p>`}
  <table style="width:100%;border-collapse:collapse;margin:22px 0;font-size:.9rem;border:1px solid #e5e7eb;">
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;width:38%;">Dokument</td><td style="padding:9px 12px;">${escapeHtml(labels.title)}</td></tr>
    <tr><td style="padding:9px 12px;font-weight:600;">Absender</td><td style="padding:9px 12px;">${escapeHtml(triage?.sender || "nicht eindeutig erkennbar")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;">Geforderter Betrag</td><td style="padding:9px 12px;font-weight:700;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
  </table>
  <p>Eine genauere Prüfung vor einer Zahlung kann helfen, die Forderung besser einzuordnen — und zu verstehen, ob alle Angaben vollständig nachvollziehbar sind.</p>
  <p>Im Rahmen der vollständigen Prüfung erhalten Sie eine klare Bewertung Ihrer Situation sowie ein fertiges Antwortschreiben, das Sie bei Bedarf direkt verwenden können.</p>
  ${stripeLink ? `
  <div style="margin:28px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#ffffff;padding:14px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
      Forderung vollständig prüfen — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:.84rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p style="font-size:.84rem;color:#6b7280;margin-top:16px;">
    Funktioniert der Button nicht? Kopieren Sie diesen Link in Ihren Browser:<br>
    <a href="${escapeHtml(stripeLink)}" style="color:#1d4ed8;word-break:break-all;">${escapeHtml(stripeLink)}</a>
  </p>` : ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
  <p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", tier: tier || "tier1_or_tier2" });
    return;
  }

  // ── Stage 2/3 — geen link, geen mail voor tier3 ───────────────────────────
  if (!stripeLink || tier === "tier3") return;

  const subjects = {
    2: `Ihre Einschätzung liegt noch vor — ${labels.title}`,
    3: `Kurze Erinnerung zu Ihrer Forderung — ${labels.title}`,
  };

  const intros = {
    2: `<p>Ihre erste Einschätzung liegt noch vor. Falls Sie die Forderung noch nicht abschließend geprüft haben — vor einer Zahlung kann eine genauere Betrachtung sinnvoll sein.</p>`,
    3: `<p>Wir melden uns ein letztes Mal zu Ihrer Einschätzung. Falls Sie die Unterlagen noch nicht geprüft haben, kann ein kurzer Blick vor einer Zahlung sinnvoll sein.</p>`,
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
    <tr style="background:#f9fafb;"><td style="padding:9px 12px;font-weight:600;">Geforderter Betrag</td><td style="padding:9px 12px;font-weight:700;color:#1d3a6e;">${escapeHtml(amount)}</td></tr>
  </table>
  <div style="margin:22px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
      Forderung vollständig prüfen — €${escapeHtml(labels.price)} →
    </a>
  </div>
  <p style="font-size:.84rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
  <p>Bei Fragen antworten Sie einfach auf diese E-Mail.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "free", tier: tier || "tier1_or_tier2" });
}

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf   = makeLetterRtf(analysis, name, triage, type);
  const safeName    = escapeHtml(capitalizeFirst(name || "Kunde"));

  await sendEmail(env, {
    to:      email,
    subject: `Ihre Einschätzung liegt vor — ${escapeHtml(labels.title)} | MussIchZahlen`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.8;">
  <p>Guten Tag ${safeName},</p>
  <p>wir haben Ihr Schreiben sorgfältig geprüft und die wichtigsten Punkte für Sie zusammengefasst. Im Anhang finden Sie zwei Dokumente:</p>
  <ul style="line-height:2;padding-left:20px;">
    <li><strong>MussIchZahlen-Analyse.rtf</strong> — unsere Einschätzung mit konkreten Hinweisen und empfehlenswerten nächsten Schritten</li>
    <li><strong>${escapeHtml(labels.filename)}</strong> — ein fertiges Antwortschreiben, das Sie bei Bedarf direkt verwenden können</li>
  </ul>
  <p>Bitte lesen Sie die Einschätzung zunächst in Ruhe durch, bevor Sie das Antwortschreiben verwenden — sie enthält wichtige Hinweise zu Ihrem weiteren Vorgehen.</p>
  <p style="font-size:.9rem;color:#374151;">Die Dateien lassen sich mit Microsoft Word, LibreOffice oder einem vergleichbaren Textprogramm öffnen.</p>
  <p style="font-size:.9rem;color:#374151;">Falls Sie das Antwortschreiben versenden möchten, empfehlen wir einen nachweisbaren Versandweg — zum Beispiel per Einschreiben. Den Nachweis sollten Sie aufbewahren.</p>
  <p>Bei Fragen können Sie jederzeit einfach auf diese E-Mail antworten.</p>
  <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
  <p style="color:#6b7280;font-size:.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
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
