import { escapeHtml } from "../utils/files.js";
import { makeAnalysisRtf, makeLetterRtf, makeConfirmationRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "MussIchZahlen <noreply@mussichzahlen.de>";

const DISCLAIMER =
  "Dies ist eine informative Analyse und keine Rechtsberatung. Wir übernehmen keine rechtliche Vertretung. Bei komplexen Fällen empfehlen wir die Verbraucherzentrale oder einen Anwalt.";

const TYPE_LABELS = {
  mahnung: {
    title: "Mahnung / Inkassoschreiben",
    letter: "Widerspruch",
    filename: "Widerspruch.rtf",
    price: "49",
    stripe_label: "Vollständige Analyse + fertiger Widerspruch — €49"
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

  if (attachments.length) body.attachments = attachments;

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
  if (triage?.fine_amount)    return `€${triage.fine_amount}`;
  if (triage?.total_price)    return `€${triage.total_price}`;
  return "unbekannt";
}

function riskLabel(risk) {
  return { low: "Gering", medium: "Mittel", high: "Hoch" }[risk] || risk || "unbekannt";
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
  const rtf    = makeAnalysisRtf(analysis, name, email, triage, type);

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
      { filename: "MussIchZahlen-Analyse.rtf", content: rtfToBase64(rtf) }
    ]
  });
}

// ── Free email: recovery sequentie ───────────────────────────────────────────

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount      = formatAmount(triage);
  const stageNumber = Number(stage) || 1;

  if (stageNumber === 1) {
    const confirmationRtf = makeConfirmationRtf(name);

    const triagePoints = [];
    if (triage?.teaser) triagePoints.push(triage.teaser);
    if (triage?.risk)   triagePoints.push(`Eingeschätztes Risiko: ${riskLabel(triage.risk)}`);

    const bulletHtml = triagePoints
      .map(p => `<li style="margin-bottom:6px;">${escapeHtml(p)}</li>`)
      .join("");

    await sendEmail(env, {
      to: email,
      subject: `Erste Einschätzung zu deinem Schreiben — ${labels.title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

        <p>Hallo ${escapeHtml(name)},</p>

        <p>wir haben dein Schreiben geprüft und eine erste Einschätzung für dich erstellt.</p>

        <p><strong>👉 Erste Einordnung:</strong><br>
        Es handelt sich um ein <strong>${escapeHtml(labels.title)}</strong>.
        ${triage?.sender ? `Absender: <strong>${escapeHtml(triage.sender)}</strong>.` : ""}
        ${amount !== "unbekannt" ? `Geforderter Betrag: <strong>${escapeHtml(amount)}</strong>.` : ""}
        </p>

        <p><strong>👉 Was uns aufgefallen ist:</strong></p>
        <ul style="padding-left:20px;margin:0 0 16px 0;">
          ${bulletHtml || `<li>Es könnten Ansatzpunkte vorliegen, die eine genauere Prüfung sinnvoll machen.</li>`}
        </ul>

        <p><strong>👉 Wichtig:</strong><br>
        In solchen Fällen können Fristen oder zusätzliche Kosten entstehen, wenn man nicht rechtzeitig reagiert.</p>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

        <p>Wenn du möchtest, kannst du eine vollständige Prüfung inklusive fertigem Antwortschreiben erhalten.</p>

        <p style="margin:0;">Dabei bekommst du:</p>
        <ul style="padding-left:20px;margin:8px 0 16px 0;">
          <li>eine klare Bewertung deiner Situation</li>
          <li>konkrete Handlungsempfehlungen</li>
          <li>ein fertiges Schreiben, das du direkt versenden kannst</li>
        </ul>

        <p style="margin:20px 0;">
          <a href="${escapeHtml(stripeLink)}"
             style="display:inline-block;background:#1d3a6e;color:#fff;padding:13px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
            👉 Vollständige Analyse starten — €${escapeHtml(labels.price)}
          </a>
        </p>

        <p style="font-size:0.85rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>

        <p style="font-size:0.85rem;color:#6b7280;background:#f9fafb;padding:10px;border-radius:4px;">
          Hinweis: Viele Nutzer entscheiden sich für die vollständige Analyse, um auf Nummer sicher zu gehen.
        </p>

        <p style="margin-top:24px;">Falls du Fragen hast, kannst du einfach auf diese E-Mail antworten.</p>

        <p>Viele Grüße<br><strong>Dein Prüfdienst</strong></p>

        <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
      </div>`,
      attachments: [
        { filename: "Eingangsbestaetigung.rtf", content: rtfToBase64(confirmationRtf) }
      ]
    });

    return;
  }

  // ── Stage 2 & 3 ───────────────────────────────────────────────────────────

  const subjects = {
    2: `Nicht vergessen: deine Einschätzung wartet — ${labels.title}`,
    3: `Letzte Erinnerung: mögliche Fristen beachten — ${labels.title}`,
  };

  const intros = {
    2: `<p>deine kostenlose Ersteinschätzung liegt noch vor. In vielen Fällen entstehen unnötige Kosten, wenn nicht rechtzeitig reagiert wird.</p>`,
    3: `<p>dies ist die letzte Erinnerung zu deiner Ersteinschätzung. Wenn du nicht reagierst, können mögliche Einwände ungenutzt bleiben.</p>`,
  };

  await sendEmail(env, {
    to: email,
    subject: subjects[stageNumber] || subjects[2],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hallo ${escapeHtml(name)},</p>
      ${intros[stageNumber] || intros[2]}

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
          <td style="padding:10px;font-weight:bold;">Einschätzung</td>
          <td style="padding:10px;">${escapeHtml(riskLabel(triage?.risk))}</td>
        </tr>
      </table>

      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1d3a6e;color:#fff;padding:13px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Jetzt vollständig prüfen lassen — €${escapeHtml(labels.price)} →
        </a>
      </p>

      <p style="font-size:0.85rem;color:#6b7280;">Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung</p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });
}

// ── Paid delivery ─────────────────────────────────────────────────────────────

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf   = makeLetterRtf(analysis, name, triage, type);

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
      { filename: "MussIchZahlen-Analyse.rtf", content: rtfToBase64(analysisRtf) },
      { filename: labels.filename,              content: rtfToBase64(letterRtf)   }
    ]
  });
}
