
import { escapeHtml } from "../utils/files.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "MussIchZahlen <noreply@mussichzahlen.de>";

const DISCLAIMER = "Dies ist eine informative Analyse und keine Rechtsberatung. Wir \u00FCbernehmen keine rechtliche Vertretung. Bei komplexen F\u00E4llen empfehlen wir die Verbraucherzentrale oder einen Anwalt.";

// ── Type labels ───────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  mahnung: {
    title:        "Mahnung / Inkassoschreiben",
    letter:       "Widerspruch",
    filename:     "Widerspruch.rtf",
    price:        "49",
    stripe_label: "Analyse + fertiger Widerspruch \u2014 \u20AC49"
  },
  parkstrafe: {
    title:        "Bu\u00DFgeldbescheid",
    letter:       "Einspruchsschreiben",
    filename:     "Einspruch.rtf",
    price:        "19",
    stripe_label: "Analyse + fertiges Einspruchsschreiben \u2014 \u20AC19"
  },
  rechnung: {
    title:        "Rechnung",
    letter:       "Widerspruchsschreiben",
    filename:     "Widerspruchsschreiben.rtf",
    price:        "29",
    stripe_label: "Analyse + fertiges Widerspruchsschreiben \u2014 \u20AC29"
  },
  vertrag: {
    title:        "Vertrag / K\u00FCndigung",
    letter:       "K\u00FCndigungsschreiben",
    filename:     "Kuendigungsschreiben.rtf",
    price:        "29",
    stripe_label: "Analyse + fertiges K\u00FCndigungsschreiben \u2014 \u20AC29"
  }
};

// ── Core send ─────────────────────────────────────────────────────────────────

async function sendEmail(env, { to, subject, html, attachments = [] }) {
  const body = { from: FROM, to: Array.isArray(to) ? to : [to], subject, html };
  if (attachments.length) body.attachments = attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Resend Fehler: ${await res.text()}`);
  return res.json();
}

// ── Admin notifications ───────────────────────────────────────────────────────

export async function notifyAdminFree(env, { name, email, type, triage }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = triage?.amount_claimed
    ? `\u20AC${triage.amount_claimed}`
    : triage?.fine_amount ? `\u20AC${triage.fine_amount}` : "unbekannt";

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] Kostenlose Anfrage: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        \uD83D\uDCEC Kunden-E-Mail wird am n\u00E4chsten Tag versendet an <strong>${escapeHtml(email)}</strong>
      </p>
      <h3>Kostenlose Anfrage \u2014 ${escapeHtml(labels.title)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
      <p><strong>Absender:</strong> ${escapeHtml(triage?.sender || "unbekannt")}</p>
      <p><strong>Betrag:</strong> ${amount}</p>
      <p><strong>Risiko:</strong> ${escapeHtml(triage?.risk || "")}</p>
    </div>`
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = triage?.amount_claimed
    ? `\u20AC${triage.amount_claimed}`
    : triage?.fine_amount ? `\u20AC${triage.fine_amount}` : "unbekannt";
  const rtf = makeAdminRtf(analysis, name, email, triage, type);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] BEZAHLT: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        \uD83D\uDCEC Kunden-E-Mail mit Anh\u00E4ngen wird am n\u00E4chsten Tag versendet
      </p>
      <h3>Bezahlte Analyse \u2014 ${escapeHtml(labels.title)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
      <p><strong>Absender:</strong> ${escapeHtml(triage?.sender || "unbekannt")}</p>
      <p><strong>Betrag:</strong> ${amount}</p>
      <p><strong>Risiko:</strong> ${escapeHtml(triage?.risk || "")}</p>
    </div>`,
    attachments: [{ filename: "MussIchZahlen-Analyse.rtf", content: rtfToBase64(rtf) }]
  });
}

// ── Customer emails ───────────────────────────────────────────────────────────

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink }) {
  const labels    = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount    = triage?.amount_claimed
    ? `\u20AC${triage.amount_claimed}`
    : triage?.fine_amount ? `\u20AC${triage.fine_amount}` : "unbekannt";
  const riskLabel = { low: "Gering", medium: "Mittel", high: "Hoch" }[triage?.risk] || triage?.risk || "unbekannt";

  await sendEmail(env, {
    to: email,
    subject: `Deine kostenlose Ersteinsch\u00E4tzung \u2014 ${labels.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d3a6e;">Deine kostenlose Ersteinsch\u00E4tzung</h2>
      <p>Hallo ${escapeHtml(name)},</p>
      <p>wir haben dein Schreiben auf m\u00F6gliche Ansatzpunkte gepr\u00FCft.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr style="background:#f3f4f6;">
          <td style="padding:10px;font-weight:bold;">Absender</td>
          <td style="padding:10px;">${escapeHtml(triage?.sender || "unbekannt")}</td>
        </tr>
        <tr>
          <td style="padding:10px;font-weight:bold;">Betrag</td>
          <td style="padding:10px;font-weight:bold;color:#1d3a6e;">${amount}</td>
        </tr>
        <tr style="background:#f3f4f6;">
          <td style="padding:10px;font-weight:bold;">Widerspruchspotenzial</td>
          <td style="padding:10px;">${riskLabel}</td>
        </tr>
      </table>
      <p style="background:#fef9c3;border-left:4px solid #eab308;padding:12px;border-radius:4px;">
        ${escapeHtml(triage?.teaser || "Auf Basis deines Schreibens k\u00F6nnten m\u00F6glicherweise Ansatzpunkte vorliegen.")}
      </p>
      <p>F\u00FCr eine vollst\u00E4ndige Analyse und ein fertiges ${escapeHtml(labels.letter)}:</p>
      <a href="${stripeLink}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
        ${escapeHtml(labels.stripe_label)} \u2192
      </a>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${DISCLAIMER}</p>
    </div>`
  });
}

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf   = makeLetterRtf(analysis, name, triage, type);

  await sendEmail(env, {
    to: email,
    subject: `Deine Analyse ist fertig \u2014 ${labels.title} | MussIchZahlen`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d3a6e;">Deine Analyse ist fertig</h2>
      <p>Hallo ${escapeHtml(name)},</p>
      <p>im Anhang findest du zwei Dateien:</p>
      <ul style="line-height:1.9;">
        <li><strong>MussIchZahlen-Analyse.rtf</strong> \u2014 vollst\u00E4ndige Analyse mit Befunden und n\u00E4chsten Schritten</li>
        <li><strong>${escapeHtml(labels.filename)}</strong> \u2014 fertiges ${escapeHtml(labels.letter)}, direkt verwendbar</li>
      </ul>
      <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
        \uD83D\uDCA1 Tipp: Sende das Schreiben per Einschreiben oder per E-Mail mit Lesebet\u00E4tigung. Bewahre den Versandnachweis auf.
      </p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${DISCLAIMER}</p>
    </div>`,
    attachments: [
      { filename: "MussIchZahlen-Analyse.rtf", content: rtfToBase64(analysisRtf) },
      { filename: labels.filename,              content: rtfToBase64(letterRtf)   }
    ]
  });
}

// ── Admin RTF (full analysis + letter in one) ─────────────────────────────────

function makeAdminRtf(analysis, name, email, triage, type) {
  // Reuse the same RTF builder — full analysis for admin reference
  return makeAnalysisRtf(analysis, name, email, triage, type);
}
