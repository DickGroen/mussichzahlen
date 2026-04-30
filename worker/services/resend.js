import { escapeHtml } from "../utils/files.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "MussIchZahlen <noreply@mussichzahlen.de>";

const DISCLAIMER =
  "Dies ist eine informative Analyse und keine Rechtsberatung. Wir übernehmen keine rechtliche Vertretung. Bei komplexen Fällen empfehlen wir die Verbraucherzentrale oder einen Anwalt.";

// ── Type labels ───────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  mahnung: {
    title: "Mahnung / Inkassoschreiben",
    letter: "Widerspruch",
    filename: "Widerspruch.rtf",
    price: "49",
    stripe_label: "Analyse + fertiger Widerspruch — €49"
  },
  parkstrafe: {
    title: "Bußgeldbescheid",
    letter: "Einspruchsschreiben",
    filename: "Einspruch.rtf",
    price: "19",
    stripe_label: "Analyse + fertiges Einspruchsschreiben — €19"
  },
  rechnung: {
    title: "Rechnung",
    letter: "Widerspruchsschreiben",
    filename: "Widerspruchsschreiben.rtf",
    price: "29",
    stripe_label: "Analyse + fertiges Widerspruchsschreiben — €29"
  },
  vertrag: {
    title: "Vertrag / Kündigung",
    letter: "Kündigungsschreiben",
    filename: "Kuendigungsschreiben.rtf",
    price: "29",
    stripe_label: "Analyse + fertiges Kündigungsschreiben — €29"
  },
  angebot: {
    title: "Angebot / Kostenvoranschlag",
    letter: "Prüfbericht",
    filename: "Angebot-Pruefung.rtf",
    price: "29",
    stripe_label: "Analyse des Angebots — €29"
  }
};

// ── Core send ────────────────────────────────────────────────────────────────

async function sendEmail(env, { to, subject, html, attachments = [] }) {
  const body = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  };

  if (attachments.length) {
    body.attachments = attachments;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Resend Fehler: ${await res.text()}`);
  }

  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAmount(triage) {
  if (triage?.amount_claimed) return `€${triage.amount_claimed}`;
  if (triage?.fine_amount) return `€${triage.fine_amount}`;
  if (triage?.total_price) return `€${triage.total_price}`;
  return "unbekannt";
}

function riskLabel(risk) {
  return {
    low: "Gering",
    medium: "Mittel",
    high: "Hoch"
  }[risk] || risk || "unbekannt";
}

function recoverySubject(stage, labels) {
  if (stage === 1) {
    return `Nicht vergessen: Deine Einschätzung ist bereit — ${labels.title}`;
  }

  if (stage === 2) {
    return `Mögliche Zusatzkosten vermeiden — ${labels.title}`;
  }

  return `Letzte Erinnerung: mögliche Fristen beachten — ${labels.title}`;
}

function recoveryIntro(stage, labels) {
  if (stage === 1) {
    return `
      <p>du hast dein Schreiben prüfen lassen. Deine erste Einschätzung zeigt, ob eine vollständige Analyse sinnvoll sein könnte.</p>
      <p><strong>Wichtig:</strong> Ohne weitere Prüfung könnten zusätzliche Kosten oder weitere Schritte folgen.</p>
    `;
  }

  if (stage === 2) {
    return `
      <p>deine kostenlose Ersteinschätzung liegt weiterhin vor.</p>
      <p>In vielen Fällen entstehen unnötige Kosten, wenn nicht rechtzeitig reagiert wird. Eine vollständige Analyse kann dir helfen, deine nächsten Schritte klarer einzuschätzen.</p>
    `;
  }

  return `
    <p>dies ist die letzte Erinnerung zu deiner kostenlosen Ersteinschätzung.</p>
    <p>Wenn du nicht reagierst, können mögliche Einwände ungenutzt bleiben oder zusätzliche Kosten entstehen.</p>
  `;
}

function ctaLabel(stage, labels) {
  if (stage === 1) return `${labels.stripe_label} →`;
  if (stage === 2) return `Jetzt vollständig prüfen lassen — €${labels.price} →`;
  return `Analyse jetzt abschließen — €${labels.price} →`;
}

// ── Admin notifications ──────────────────────────────────────────────────────

export async function notifyAdminFree(env, { name, email, type, triage }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = formatAmount(triage);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] Kostenlose Anfrage: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        📬 Recovery-Sequenz wird automatisch geplant für <strong>${escapeHtml(email)}</strong>
      </p>
      <h3>Kostenlose Anfrage — ${escapeHtml(labels.title)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
      <p><strong>Absender:</strong> ${escapeHtml(triage?.sender || "unbekannt")}</p>
      <p><strong>Betrag:</strong> ${escapeHtml(amount)}</p>
      <p><strong>Risiko:</strong> ${escapeHtml(triage?.risk || "")}</p>
      <p><strong>Chance:</strong> ${escapeHtml(String(triage?.chance ?? "unbekannt"))}</p>
      <p><strong>Flags:</strong> ${escapeHtml(String(triage?.flagCount ?? "unbekannt"))}</p>
    </div>`
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = formatAmount(triage);
  const rtf = makeAdminRtf(analysis, name, email, triage, type);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] BEZAHLT: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        📬 Recovery-Sequenz wird gestoppt, Kunden-E-Mail mit Anhängen wird geplant
      </p>
      <h3>Bezahlte Analyse — ${escapeHtml(labels.title)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
      <p><strong>Absender:</strong> ${escapeHtml(triage?.sender || "unbekannt")}</p>
      <p><strong>Betrag:</strong> ${escapeHtml(amount)}</p>
      <p><strong>Risiko:</strong> ${escapeHtml(triage?.risk || "")}</p>
    </div>`,
    attachments: [
      {
        filename: "MussIchZahlen-Analyse.rtf",
        content: rtfToBase64(rtf)
      }
    ]
  });
}

// ── Customer emails: recovery sequence ───────────────────────────────────────

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = formatAmount(triage);
  const stageNumber = Number(stage) || 1;

  await sendEmail(env, {
    to: email,
    subject: recoverySubject(stageNumber, labels),
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.6;">
      <h2 style="color:#1d3a6e;margin-bottom:10px;">Deine Einschätzung ist noch offen</h2>

      <p>Hallo ${escapeHtml(name)},</p>

      ${recoveryIntro(stageNumber, labels)}

      <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;">
        <tr style="background:#f3f4f6;">
          <td style="padding:10px;font-weight:bold;">Dokument</td>
          <td style="padding:10px;">${escapeHtml(labels.title)}</td>
        </tr>
        <tr>
          <td style="padding:10px;font-weight:bold;">Absender</td>
          <td style="padding:10px;">${escapeHtml(triage?.sender || "unbekannt")}</td>
        </tr>
        <tr style="background:#f3f4f6;">
          <td style="padding:10px;font-weight:bold;">Betrag</td>
          <td style="padding:10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(amount)}</td>
        </tr>
        <tr>
          <td style="padding:10px;font-weight:bold;">Widerspruchspotenzial</td>
          <td style="padding:10px;">${escapeHtml(riskLabel(triage?.risk))}</td>
        </tr>
      </table>

      <div style="background:#fef9c3;border-left:4px solid #eab308;padding:14px;border-radius:6px;margin:18px 0;">
        ${escapeHtml(triage?.teaser || "Auf Basis deines Schreibens könnten möglicherweise Ansatzpunkte vorliegen. Ohne weitere Prüfung können unnötige Kosten entstehen.")}
      </div>

      <p style="margin:18px 0;">
        Für die vollständige Analyse und ein fertiges ${escapeHtml(labels.letter)}:
      </p>

      <a href="${escapeHtml(stripeLink)}"
         style="display:inline-block;background:#1d3a6e;color:#fff;padding:13px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
        ${escapeHtml(ctaLabel(stageNumber, labels))}
      </a>

      <p style="font-size:0.85rem;color:#6b7280;margin-top:14px;">
        Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung
      </p>

      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">
        ${escapeHtml(DISCLAIMER)}
      </p>
    </div>`
  });
}

// ── Customer emails: paid delivery ───────────────────────────────────────────

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf = makeLetterRtf(analysis, name, triage, type);

  await sendEmail(env, {
    to: email,
    subject: `Deine Analyse ist fertig — ${labels.title} | MussIchZahlen`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d3a6e;">Deine Analyse ist fertig</h2>
      <p>Hallo ${escapeHtml(name)},</p>
      <p>im Anhang findest du zwei Dateien:</p>
      <ul style="line-height:1.9;">
        <li><strong>MussIchZahlen-Analyse.rtf</strong> — vollständige Analyse mit Befunden und nächsten Schritten</li>
        <li><strong>${escapeHtml(labels.filename)}</strong> — fertiges ${escapeHtml(labels.letter)}, direkt verwendbar</li>
      </ul>
      <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
        💡 Tipp: Sende das Schreiben per Einschreiben oder per E-Mail mit Lesebestätigung. Bewahre den Versandnachweis auf.
      </p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
    attachments: [
      {
        filename: "MussIchZahlen-Analyse.rtf",
        content: rtfToBase64(analysisRtf)
      },
      {
        filename: labels.filename,
        content: rtfToBase64(letterRtf)
      }
    ]
  });
}

// ── Admin RTF ────────────────────────────────────────────────────────────────

function makeAdminRtf(analysis, name, email, triage, type) {
  return makeAnalysisRtf(analysis, name, email, triage, type);
}
