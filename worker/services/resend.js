// worker/services/resend.js

import { escapeHtml } from "../utils/files.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "MussIchZahlen <noreply@mussichzahlen.de>";
const DISCLAIMER =
  "MussIchZahlen bietet informative Analysen — keine Rechtsberatung und keine anwaltliche Vertretung.";

function capitalizeFirst(str) {
  const s = String(str || "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const TYPE_LABELS = {
  mahnung: {
    title: "Mahnung / Inkassoschreiben",
    letter: "Widerspruch",
    filename: "Widerspruch.rtf",
    price: "49",
  },
  parkstrafe: {
    title: "Bußgeldbescheid",
    letter: "Einspruchsschreiben",
    filename: "Einspruch.rtf",
    price: "19",
  },
  rechnung: {
    title: "Rechnung",
    letter: "Widerspruchsschreiben",
    filename: "Widerspruchsschreiben.rtf",
    price: "29",
  },
  vertrag: {
    title: "Vertrag / Kündigung",
    letter: "Kündigungsschreiben",
    filename: "Kuendigungsschreiben.rtf",
    price: "29",
  },
  angebot: {
    title: "Angebot / Kostenvoranschlag",
    letter: "Prüfbericht",
    filename: "Angebot-Pruefung.rtf",
    price: "29",
  },
};

async function trackEvent(env, event, data = {}) {
  try {
    const id = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;

    await env.SESSIONS_KV.put(
      key,
      JSON.stringify({
        event,
        ...data,
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

async function sendEmail(env, { to, subject, html, attachments = [] }) {
  const body = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };

  if (attachments.length) {
    body.attachments = attachments;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Resend Fehler: ${await res.text()}`);
  }

  return res.json();
}

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
    high: "Hoch",
  }[risk] || risk || "unbekannt";
}

function riskText(risk) {
  return {
    high: "Es bestehen deutliche Hinweise auf mögliche Unstimmigkeiten.",
    medium: "Es bestehen mögliche Unklarheiten.",
    low: "Die Forderung wirkt grundsätzlich nachvollziehbar.",
  }[risk] || "Es bestehen mögliche Unklarheiten.";
}

export async function sendConfirmationEmail(env, { name, email }) {
  await sendEmail(env, {
    to: email,
    subject: "Dein Schreiben ist eingegangen — MussIchZahlen",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p style="font-size:1.1rem;font-weight:700;color:#14532d;">✓ Dein Schreiben ist eingegangen.</p>
      <p>Hallo ${escapeHtml(capitalizeFirst(name))},</p>
      <p>wir haben dein Dokument erhalten und werden es sorgfältig prüfen.</p>
      <p>Du erhältst gleich eine erste Einschätzung per E-Mail.</p>
      <p style="font-size:.9rem;color:#6b7280;">→ Bitte prüf auch deinen Spam-Ordner.</p>
      <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
  });
}

export async function notifyAdminFree(env, { name, email, type, triage, stripeLink }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] Kostenlose Anfrage: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <h3>Kostenlose Anfrage — ${escapeHtml(labels.title)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
      <p><strong>Absender:</strong> ${escapeHtml(triage?.sender || "unbekannt")}</p>
      <p><strong>Betrag:</strong> ${escapeHtml(formatAmount(triage))}</p>
      <p><strong>Risiko:</strong> ${escapeHtml(triage?.risk || "")}</p>
      <p><strong>Chance:</strong> ${escapeHtml(String(triage?.chance ?? "unbekannt"))}</p>
      <p><strong>Flags:</strong> ${escapeHtml(String(triage?.flagCount ?? "unbekannt"))}</p>
      ${stripeLink ? `<p><strong>Stripe:</strong> <a href="${escapeHtml(stripeLink)}">${escapeHtml(stripeLink)}</a></p>` : ""}
    </div>`,
  });
}

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const stageNumber = Number(stage) || 1;
  const amount = formatAmount(triage);
  const sender = triage?.sender || "unbekannt";
  const teaser =
    triage?.teaser ||
    "In diesem Schreiben könnten Ansatzpunkte vorliegen, die ohne rechtzeitige Reaktion zu unnötigen Mehrkosten führen können.";

  const subjects = {
    1: `Erste Einschätzung zu deinem Schreiben — ${labels.title}`,
    2: `Noch nicht geprüft? Deine Einschätzung wartet — ${labels.title}`,
    3: `Letzte Erinnerung: noch nicht geprüft — ${labels.title}`,
  };

  const intro = {
    1: `<p>wir haben dein Schreiben geprüft und eine erste Einschätzung erstellt.</p>
        <p><strong>Was auffällt:</strong><br>${escapeHtml(teaser)}</p>`,
    2: `<p>deine kostenlose Ersteinschätzung liegt noch vor.</p>
        <p>Es kann sinnvoll sein, die Forderung vor einer Zahlung genauer prüfen zu lassen.</p>`,
    3: `<p>dies ist unsere letzte Erinnerung zu deiner Ersteinschätzung.</p>
        <p>Falls du die Forderung noch nicht geprüft hast, kann eine kurze Analyse sinnvoll sein.</p>`,
  };

  const stripeHtml = stripeLink
    ? `
      <div style="margin:28px 0;text-align:center;">
        <a href="${escapeHtml(stripeLink)}" target="_blank" rel="noopener noreferrer"
          style="background:#1d3a6e;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">
          Vollständige Analyse + Antwortschreiben — €${escapeHtml(labels.price)}
        </a>
      </div>

      <p style="font-size:0.85rem;color:#6b7280;text-align:center;">
        Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung
      </p>

      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;margin:22px 0;">
        <p style="margin:0 0 8px 0;font-weight:bold;color:#9a3412;">
          Funktioniert der Button nicht?
        </p>
        <p style="margin:0 0 10px 0;color:#7c2d12;">
          Kopiere diesen Zahlungslink en plak hem in je browser:
        </p>
        <p style="word-break:break-all;margin:0;">
          <a href="${escapeHtml(stripeLink)}" target="_blank" rel="noopener noreferrer" style="color:#1d3a6e;font-weight:bold;">
            ${escapeHtml(stripeLink)}
          </a>
        </p>
      </div>
    `
    : "";

  await sendEmail(env, {
    to: email,
    subject: subjects[stageNumber] || subjects[1],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hallo ${escapeHtml(capitalizeFirst(name))},</p>

      ${intro[stageNumber] || intro[1]}

      <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;">
        <tr style="background:#f9fafb;">
          <td style="padding:10px;font-weight:bold;">Dokument</td>
          <td style="padding:10px;">${escapeHtml(labels.title)}</td>
        </tr>
        <tr>
          <td style="padding:10px;font-weight:bold;">Absender</td>
          <td style="padding:10px;">${escapeHtml(sender)}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:10px;font-weight:bold;">Betrag</td>
          <td style="padding:10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(amount)}</td>
        </tr>
        <tr>
          <td style="padding:10px;font-weight:bold;">Einschätzung</td>
          <td style="padding:10px;">${escapeHtml(riskText(triage?.risk))}</td>
        </tr>
      </table>

      <p>
        Wenn du möchtest, kannst du eine vollständige Prüfung inklusive fertigem Antwortschreiben erhalten.
      </p>

      <ul style="line-height:1.8;">
        <li>✓ klare Bewertung deiner Situation</li>
        <li>✓ konkrete Punkte, die geprüft werden sollten</li>
        <li>✓ fertiges Antwortschreiben als Datei</li>
      </ul>

      ${stripeHtml}

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">

      <p>Falls du Fragen hast, kannst du einfach auf diese E-Mail antworten.</p>
      <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
  });

  await trackEvent(env, "email_sent", {
    type,
    stage: stageNumber,
    kind: "free",
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = formatAmount(triage);
  const rtf = makeAnalysisRtf(analysis, name, email, triage, type);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] BEZAHLT: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
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
        content: rtfToBase64(rtf),
      },
    ],
  });
}

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf = makeLetterRtf(analysis, name, triage, type);

  await sendEmail(env, {
    to: email,
    subject: `Deine Analyse ist fertig — ${labels.title} | MussIchZahlen`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hallo ${escapeHtml(capitalizeFirst(name))},</p>
      <p>deine Analyse ist fertig. Im Anhang findest du zwei Dateien:</p>
      <ul style="line-height:1.9;">
        <li><strong>MussIchZahlen-Analyse.rtf</strong> — vollständige Analyse mit Befunden und nächsten Schritten</li>
        <li><strong>${escapeHtml(labels.filename)}</strong> — fertiges ${escapeHtml(labels.letter)}, direkt verwendbar</li>
      </ul>
      <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
        Tipp: Sende das Schreiben per Einschreiben oder per E-Mail mit Lesebestätigung. Bewahre den Versandnachweis auf.
      </p>
      <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
    attachments: [
      {
        filename: "MussIchZahlen-Analyse.rtf",
        content: rtfToBase64(analysisRtf),
      },
      {
        filename: labels.filename,
        content: rtfToBase64(letterRtf),
      },
    ],
  });

  await trackEvent(env, "email_sent", {
    type,
    kind: "paid",
  });
}

export async function sendAbandonedEmail(env, { name, email, type, amount, stripeLink, stage = 1 }) {
  if (!stripeLink) return;

  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const stageNumber = Number(stage) || 1;
  const amountStr = amount ? ` über einen Betrag von €${escapeHtml(String(amount))}` : "";

  const subjects = {
    1: `Dein Schreiben wartet noch — ${labels.title}`,
    2: `Noch nicht geprüft? — ${labels.title}`,
    3: `Letzte Erinnerung — ${labels.title}`,
  };

  const intros = {
    1: `<p>du hast dein Schreiben hochgeladen, aber die Prüfung noch nicht abgeschlossen${amountStr}.</p>`,
    2: `<p>deine Einschätzung liegt noch vor.</p>`,
    3: `<p>dies ist unsere letzte Erinnerung.</p>`,
  };

  await sendEmail(env, {
    to: email,
    subject: subjects[stageNumber] || subjects[1],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hallo ${escapeHtml(capitalizeFirst(name))},</p>
      ${intros[stageNumber] || intros[1]}

      <div style="margin:28px 0;text-align:center;">
        <a href="${escapeHtml(stripeLink)}" target="_blank" rel="noopener noreferrer"
          style="background:#1d3a6e;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">
          Jetzt vollständig prüfen lassen — €${escapeHtml(labels.price)}
        </a>
      </div>

      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;margin:22px 0;">
        <p style="margin:0 0 8px 0;font-weight:bold;color:#9a3412;">
          Funktioniert der Button nicht?
        </p>
        <p style="word-break:break-all;margin:0;">
          <a href="${escapeHtml(stripeLink)}" target="_blank" rel="noopener noreferrer" style="color:#1d3a6e;font-weight:bold;">
            ${escapeHtml(stripeLink)}
          </a>
        </p>
      </div>

      <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
  });

  await trackEvent(env, "email_sent", {
    type,
    stage: stageNumber,
    kind: "abandoned",
  });
}
