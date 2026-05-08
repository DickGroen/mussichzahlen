import { escapeHtml } from "../utils/files.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

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

async function trackEvent(env, event, data = {}) {
  try {
    const id  = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;
    await env.SESSIONS_KV.put(key, JSON.stringify({
      event,
      ...data,
      received_at: new Date().toISOString(),
    }), { expirationTtl: 60 * 60 * 24 * 90 });
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

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

function riskAssessment(risk) {
  return {
    high:   "Nach erster Einschätzung bestehen deutliche Hinweise auf mögliche Unstimmigkeiten. Es könnte sinnvoll sein, die Forderung vor einer Zahlung genauer zu überprüfen.",
    medium: "Nach erster Einschätzung bestehen mögliche Unklarheiten. Es könnte sinnvoll sein, die Forderung vor einer Zahlung genauer zu überprüfen.",
    low:    "Nach erster Einschätzung wirkt die Forderung grundsätzlich nachvollziehbar. Eine kurze Prüfung kann dennoch sinnvoll sein.",
  }[risk] || "Nach erster Einschätzung bestehen mögliche Unklarheiten. Es könnte sinnvoll sein, die Forderung vor einer Zahlung genauer zu überprüfen.";
}

// ── Directe bevestigingsemail na upload ──────────────────────────────────────

export async function sendConfirmationEmail(env, { name, email }) {
  await sendEmail(env, {
    to: email,
    subject: "Ihr Schreiben ist eingegangen — MussIchZahlen",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

      <p style="font-size:1.1rem;font-weight:700;color:#14532d;">✓ Ihr Schreiben ist eingegangen.</p>

      <p>Sehr geehrte/r ${escapeHtml(name)},</p>

      <p>wir haben Ihr Dokument erhalten und werden es sorgfältig prüfen. Sie erhalten spätestens am nächsten Werktag bis 16:00 Uhr eine erste Einschätzung per E-Mail.</p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:16px 0;">
        <strong style="color:#14532d;">Warum das wichtig ist:</strong>
        <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">
          Bei Zahlungserinnerungen und Mahnschreiben können Fristen und zusätzliche Kosten entstehen, wenn Sie nicht rechtzeitig reagieren. Unsere Einschätzung klärt, ob Handlungsbedarf besteht.
        </p>
      </div>

      <p style="font-size:.9rem;color:#6b7280;">→ Bitte prüfen Sie auch Ihren Spam-Ordner, falls Sie keine E-Mail erhalten.</p>

      <p>Vielen Dank für Ihr Vertrauen.<br><strong>Ihr Prüfdienst</strong></p>

      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });
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
  const emailType   = triage?.emailType || "stark";

  if (stageNumber === 1) {
    // Tier 3 (vertrauen) — geen harde verkoop
    if (emailType === "vertrauen") {
      await sendEmail(env, {
        to: email,
        subject: `Dein Dokument wurde geprüft`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
          <p>Hallo ${escapeHtml(name)},</p>
          <p>wir haben dein Schreiben geprüft.</p>
          <p>Auf den ersten Blick scheint die Forderung relativ klar zu sein — aber es kann trotzdem hilfreich sein, die Details sorgfältig zu prüfen, bevor du reagierst.</p>
          <p>${escapeHtml(triage?.teaser || "")}</p>
          ${stripeLink ? `<p>Wenn du eine vollständige Prüfung möchtest: <a href="${escapeHtml(stripeLink)}" style="color:#1a3a6b;font-weight:bold;">Hier klicken — €${escapeHtml(labels.price)}</a></p>` : ""}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p>Mit freundlichen Grüßen,<br><strong>MussIchZahlen</strong></p>
          <p style="font-size:0.8rem;color:#6b7280;">${escapeHtml(DISCLAIMER)}</p>
        </div>`
      });
      await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", emailType });
      return;
    }

    // Tier 2 (soft) — zacht
    if (emailType === "soft") {
      await sendEmail(env, {
        to: email,
        subject: `Vielleicht lohnt sich ein zweiter Blick`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
          <p>Hallo ${escapeHtml(name)},</p>
          <p>wir haben einen ersten Blick auf dein Schreiben geworfen.</p>
          <p>Es könnte Punkte geben, die sich lohnen zu prüfen, bevor du zahlst.</p>
          <p>${escapeHtml(triage?.teaser || "")}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p>Wenn du ein klareres Bild möchtest, kannst du eine vollständige Analyse erhalten:</p>
          <p style="margin:20px 0;">
            <a href="${escapeHtml(stripeLink)}"
               style="display:inline-block;background:#1a3a6b;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
              Vor der Zahlung prüfen — €${escapeHtml(labels.price)} →
            </a>
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p>Mit freundlichen Grüßen,<br><strong>MussIchZahlen</strong></p>
          <p style="font-size:0.8rem;color:#6b7280;">${escapeHtml(DISCLAIMER)}</p>
        </div>`
      });
      await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", emailType });
      return;
    }

    // Tier 1 (stark) — default
    const senderPart    = triage?.sender ? ` der ${escapeHtml(triage.sender)}` : "";
    const amountPart    = amount !== "unbekannt" ? ` über einen Betrag von ${escapeHtml(amount)}` : "";
    const einordnung    = `Es handelt sich um ein ${escapeHtml(labels.title)}${senderPart}${amountPart}.`;
    const aufgefallen   = triage?.teaser ? escapeHtml(triage.teaser) : "In diesem Schreiben gibt es Hinweise darauf, dass einzelne Positionen oder Kosten genauer geprüft werden sollten.";
    const einschaetzung = riskAssessment(triage?.risk);

    await sendEmail(env, {
      to: email,
      subject: `Erste Einschätzung zu deinem Schreiben — ${labels.title}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

        <p>Hallo ${escapeHtml(name)},</p>

        <p>wir haben dein Schreiben geprüft und eine erste Einschätzung für dich erstellt.</p>

        <p><strong>👉 Erste Einordnung:</strong><br>${einordnung}</p>

        <p><strong>👉 Was uns aufgefallen ist:</strong><br>${aufgefallen}</p>

        <p><strong>👉 Einschätzung:</strong><br>${escapeHtml(einschaetzung)}</p>

        <p><strong>👉 Wichtig:</strong><br>
        In solchen Fällen können Fristen oder zusätzliche Kosten entstehen, wenn man nicht rechtzeitig reagiert.</p>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

        <p>Wenn du möchtest, kannst du eine vollständige Prüfung inklusive fertigem Antwortschreiben erhalten.</p>

        <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
          <li>✓ eine klare Bewertung deiner Situation</li>
          <li>✓ konkrete Handlungsempfehlungen</li>
          <li>✓ ein fertiges Schreiben, das du direkt versenden kannst</li>
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

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

        <p>Falls du Fragen hast, kannst du einfach auf diese E-Mail antworten.</p>

        <p>Viele Grüße<br><strong>Dein Prüfdienst</strong></p>

        <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
      </div>`
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free" });
    return;
  }

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

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "free" });
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

  await trackEvent(env, "email_sent", { type, kind: "paid" });
}


// ── Abandoned checkout emails ─────────────────────────────────────────────────

export async function sendAbandonedEmail(env, { name, email, type, amount, stripeLink, stage = 1 }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const stageNumber = Number(stage) || 1;
  const amountPart  = amount ? ` €${amount}` : "";

  let subject, bodyHtml;

  if (stageNumber === 1) {
    subject = `Kurze Erinnerung — bevor du zahlst`;
    bodyHtml = `
      <p>Hallo ${escapeHtml(name)},</p>
      <p>du hast angefangen, dein Dokument zu prüfen — aber den Vorgang nicht abgeschlossen.</p>
      <p>Bevor du zahlst, lohnt es sich oft, genauer hinzuschauen — besonders wenn es um${escapeHtml(amountPart)} geht.</p>
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1a3a6b;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Weiter — €${escapeHtml(labels.price)} →
        </a>
      </p>
      <p style="font-size:0.9rem;color:#374151;">Die meisten prüfen lieber zuerst, bevor sie zu viel zahlen.</p>`;

  } else if (stageNumber === 2) {
    subject = `Bevor du zahlst — noch ein Blick`;
    bodyHtml = `
      <p>Hallo ${escapeHtml(name)},</p>
      <p>nur eine kurze Erinnerung.</p>
      <p>Viele merken erst im Nachhinein, dass sie eine Forderung hätten anfechten können.</p>
      <p>Wenn du unsicher bist, ist es sicherer, zuerst zu prüfen.</p>
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1a3a6b;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Vor der Zahlung prüfen — €${escapeHtml(labels.price)} →
        </a>
      </p>`;

  } else {
    subject = amount && Number(amount) > 500
      ? `Bevor du €${amount} zahlst — prüf das zuerst`
      : `Letzte Erinnerung — bevor du zahlst`;
    bodyHtml = `
      <p>Hallo ${escapeHtml(name)},</p>
      <p>wenn du jetzt nicht prüfst, zahlst du möglicherweise unnötigerweise.</p>
      <p>Das ist deine letzte Möglichkeit, alles klar zu überblicken — bevor du eine Entscheidung triffst.</p>
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1a3a6b;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Deine Optionen prüfen — €${escapeHtml(labels.price)} →
        </a>
      </p>`;
  }

  await sendEmail(env, {
    to: email,
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p>Mit freundlichen Grüßen,<br><strong>MussIchZahlen</strong></p>
      <p style="font-size:0.8rem;color:#6b7280;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "abandoned" });
}
