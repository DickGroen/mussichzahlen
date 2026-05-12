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
    stripe_label: "Vollständige Analyse + fertiger Widerspruch — €49",
  },
  parkstrafe: {
    title: "Bußgeldbescheid",
    letter: "Einspruchsschreiben",
    filename: "Einspruch.rtf",
    price: "19",
    stripe_label: "Analyse + fertiges Einspruchsschreiben — €19",
  },
  rechnung: {
    title: "Rechnung",
    letter: "Widerspruchsschreiben",
    filename: "Widerspruchsschreiben.rtf",
    price: "29",
    stripe_label: "Analyse + fertiges Widerspruchsschreiben — €29",
  },
  vertrag: {
    title: "Vertrag / Kündigung",
    letter: "Kündigungsschreiben",
    filename: "Kuendigungsschreiben.rtf",
    price: "29",
    stripe_label: "Analyse + fertiges Kündigungsschreiben — €29",
  },
  angebot: {
    title: "Angebot / Kostenvoranschlag",
    letter: "Prüfbericht",
    filename: "Angebot-Pruefung.rtf",
    price: "29",
    stripe_label: "Analyse des Angebots — €29",
  },
};

function riskLabelDe(risk) {
  return { low: "Niedrig", medium: "Mittel", high: "Hoch" }[risk] || risk || "unbekannt";
}

function formatAmount(triage) {
  const value = triage?.amount_claimed ?? triage?.fine_amount ?? triage?.total_price ?? null;
  if (value === null || value === undefined || value === "") return "unbekannt";

  const n = Number(value);
  if (!Number.isFinite(n)) return `€${String(value)}`;

  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

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

  if (attachments.length) body.attachments = attachments;

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

function getFlagLabels(triage) {
  return [
    triage?.possible_verjährt ? "mögliche Verjährung" : null,
    triage?.possible_überhöhte_kosten ? "mögliche zusätzliche Inkassokosten" : null,
    triage?.possible_kein_nachweis ? "fehlende Nachweise / unklare Forderungsgrundlage" : null,
    triage?.possible_falscher_empfänger ? "möglicherweise falscher Empfänger" : null,
    triage?.possible_kein_abtretungsnachweis ? "fehlender oder unklarer Abtretungsnachweis" : null,
    triage?.possible_keine_registrierung ? "fehlende oder nicht erkennbare Inkasso-Registrierung" : null,
  ].filter(Boolean);
}

function getRiskText(risk) {
  return {
    high: "Es bestehen mehrere mögliche Auffälligkeiten, die genauer geprüft werden könnten.",
    medium: "Es bestehen mögliche Unklarheiten, die überprüft werden sollten.",
    low: "Die Forderung wirkt grundsätzlich nachvollziehbar, eine kurze Prüfung kann dennoch sinnvoll sein.",
  }[risk || "medium"] || "Es bestehen mögliche Unklarheiten, die überprüft werden sollten.";
}

function getTierLabel(tier) {
  if (!tier) return "unbekannt";
  return String(tier).replace("tier", "Tier ");
}

export async function sendConfirmationEmail(env, { name, email }) {
  await sendEmail(env, {
    to: email,
    subject: "Ihr Schreiben ist eingegangen — MussIchZahlen",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p style="font-size:1.1rem;font-weight:700;color:#14532d;">✓ Ihr Schreiben ist eingegangen.</p>

      <p>Hallo ${escapeHtml(capitalizeFirst(name))},</p>

      <p>wir haben Ihr Dokument erhalten und werden es sorgfältig prüfen.</p>

      <p>Sie erhalten spätestens am nächsten Werktag bis 16:00 Uhr eine erste Einschätzung per E-Mail — mit möglichen Auffälligkeiten und Hinweisen zu Ihrem Schreiben.</p>

      <p style="font-size:.9rem;color:#6b7280;">→ Bitte prüfen Sie auch Ihren Spam-Ordner, falls Sie keine Nachricht erhalten.</p>

      <p>Falls Sie Fragen haben, können Sie einfach auf diese E-Mail antworten.</p>

      <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>

      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
  });
}

export async function notifyAdminFree(env, { name, email, type, triage, stripeLink }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = formatAmount(triage);
  const flags = getFlagLabels(triage);

  const flagsHtml = flags.length
    ? flags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")
    : "<li>keine konkreten Auffälligkeiten erkannt</li>";

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] Kostenlose Anfrage: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;max-width:650px;color:#1f2937;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        📬 Recovery-Sequenz wird automatisch geplant für <strong>${escapeHtml(email)}</strong>
      </p>

      <h3>Kostenlose Anfrage — ${escapeHtml(labels.title)}</h3>

      <table style="width:100%;border-collapse:collapse;font-size:0.9rem;border:1px solid #e5e7eb;">
        <tr>
          <td style="padding:8px 10px;font-weight:bold;width:40%;">Name</td>
          <td style="padding:8px 10px;">${escapeHtml(name)}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:8px 10px;font-weight:bold;">E-Mail</td>
          <td style="padding:8px 10px;">${escapeHtml(email)}</td>
        </tr>
        <tr>
          <td style="padding:8px 10px;font-weight:bold;">Absender</td>
          <td style="padding:8px 10px;">${escapeHtml(triage?.sender || "unbekannt")}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:8px 10px;font-weight:bold;">Betrag</td>
          <td style="padding:8px 10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(amount)}</td>
        </tr>
        <tr>
          <td style="padding:8px 10px;font-weight:bold;">Risikoeinschätzung</td>
          <td style="padding:8px 10px;">${escapeHtml(riskLabelDe(triage?.risk))}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:8px 10px;font-weight:bold;">Prüfungschance</td>
          <td style="padding:8px 10px;">${escapeHtml(String(triage?.chance ?? "?"))}%</td>
        </tr>
        <tr>
          <td style="padding:8px 10px;font-weight:bold;">Auffälligkeiten</td>
          <td style="padding:8px 10px;"><ul style="margin:0;padding-left:18px;line-height:1.6;">${flagsHtml}</ul></td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:8px 10px;font-weight:bold;">Tier</td>
          <td style="padding:8px 10px;">${escapeHtml(getTierLabel(triage?.tier))}</td>
        </tr>
        <tr>
          <td style="padding:8px 10px;font-weight:bold;">Route</td>
          <td style="padding:8px 10px;">${escapeHtml(triage?.route || "unbekannt")}</td>
        </tr>
        ${
          stripeLink
            ? `<tr style="background:#f9fafb;">
                <td style="padding:8px 10px;font-weight:bold;">Stripe</td>
                <td style="padding:8px 10px;"><a href="${escapeHtml(stripeLink)}">${escapeHtml(stripeLink)}</a></td>
              </tr>`
            : ""
        }
      </table>
    </div>`,
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = formatAmount(triage);
  const rtf = makeAnalysisRtf(analysis, name, email, triage, type);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[MussIchZahlen] BEZAHLT: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;color:#1f2937;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        📬 Recovery-Sequenz wird gestoppt, Kunden-E-Mail mit Anhängen wurde geplant oder versendet.
      </p>

      <h3>Bezahlte Analyse — ${escapeHtml(labels.title)}</h3>

      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
      <p><strong>Absender:</strong> ${escapeHtml(triage?.sender || "unbekannt")}</p>
      <p><strong>Betrag:</strong> ${escapeHtml(amount)}</p>
      <p><strong>Risikoeinschätzung:</strong> ${escapeHtml(riskLabelDe(triage?.risk))}</p>
    </div>`,
    attachments: [
      { filename: "MussIchZahlen-Analyse.rtf", content: rtfToBase64(rtf) },
    ],
  });
}

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const amount = formatAmount(triage);
  const stageNumber = Number(stage) || 1;
  const sender = triage?.sender || "unbekannt";
  const flags = getFlagLabels(triage);

  const riskText = getRiskText(triage?.risk);

  const teaser =
    triage?.teaser ||
    "In diesem Schreiben könnten Punkte vorliegen, die vor einer Zahlung genauer geprüft werden sollten.";

  const concreteLead =
    sender !== "unbekannt" && amount !== "unbekannt"
      ? `Bei einer Forderung über <strong>${escapeHtml(amount)}</strong> von <strong>${escapeHtml(sender)}</strong> könnten einzelne Punkte relevant sein, die vor einer Zahlung geprüft werden sollten.`
      : escapeHtml(teaser);

  const flagHtml = flags.length
    ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;margin:18px 0;">
        <strong style="color:#9a3412;">Was auffällt:</strong>
        <ul style="margin-top:10px;padding-left:18px;line-height:1.7;color:#7c2d12;">
          ${flags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}
        </ul>
      </div>`
    : `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;margin:18px 0;">
        <strong style="color:#9a3412;">Was auffällt:</strong>
        <p style="margin-top:8px;color:#7c2d12;">${escapeHtml(teaser)}</p>
      </div>`;

  const introByStage = {
    1: `<p>wir haben Ihr Schreiben geprüft und eine erste Einschätzung erstellt.</p>
        <p>${concreteLead}</p>
        ${flagHtml}`,

    2: `<p>Ihre kostenlose Ersteinschätzung liegt noch vor.</p>
        <p>Viele Nutzer entscheiden sich dafür, eine Forderung vor einer Zahlung genauer prüfen zu lassen — insbesondere bei unklaren Kosten, fehlenden Nachweisen oder älteren Forderungen.</p>`,

    3: `<p>dies ist unsere letzte Erinnerung zu Ihrer Ersteinschätzung.</p>
        <p>Falls Sie die Forderung noch nicht geprüft haben, könnte eine kurze Analyse sinnvoll sein — bevor weitere Kosten entstehen oder Fristen verstreichen.</p>`,
  };

  const subjectByStage = {
    1: amount !== "unbekannt"
      ? `Erste Einschätzung — offene Forderung über ${amount}`
      : `Erste Einschätzung zu Ihrem Schreiben — ${labels.title}`,
    2: amount !== "unbekannt"
      ? `Ihre Einschätzung wartet noch — Forderung über ${amount}`
      : `Ihre Einschätzung wartet noch — ${labels.title}`,
    3: amount !== "unbekannt"
      ? `Letzte Erinnerung zur Forderung über ${amount}`
      : `Letzte Erinnerung zu Ihrem Schreiben — ${labels.title}`,
  };

  await sendEmail(env, {
    to: email,
    subject: subjectByStage[stageNumber] || subjectByStage[1],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hallo ${escapeHtml(capitalizeFirst(name))},</p>

      ${introByStage[stageNumber] || introByStage[1]}

      <table style="width:100%;border-collapse:collapse;margin:22px 0;border:1px solid #e5e7eb;">
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
          <td style="padding:10px;">${escapeHtml(riskText)}</td>
        </tr>
      </table>

      ${
        stripeLink
          ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:22px 0;">
              <strong style="color:#166534;">Die vollständige Analyse beinhaltet:</strong>
              <ul style="margin-top:10px;padding-left:18px;line-height:1.8;color:#166534;">
                <li>klare Bewertung Ihrer Situation</li>
                <li>konkrete prüfenswerte Punkte</li>
                <li>fertiges Antwortschreiben als Datei</li>
              </ul>
            </div>

            <div style="margin:30px 0;text-align:center;">
              <a href="${escapeHtml(stripeLink)}" target="_blank" rel="noopener noreferrer"
                style="background:#1d3a6e;color:#ffffff;text-decoration:none;padding:15px 26px;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">
                Vollständige Analyse + Antwortschreiben — €${escapeHtml(labels.price)} →
              </a>
            </div>

            <p style="font-size:0.85rem;color:#6b7280;text-align:center;">
              Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung
            </p>

            <p style="font-size:0.82rem;color:#6b7280;background:#f9fafb;padding:12px;border-radius:6px;margin-top:20px;">
              Funktioniert der Button nicht?<br><br>
              Kopieren Sie diesen Zahlungslink in Ihren Browser:<br><br>
              <a href="${escapeHtml(stripeLink)}">${escapeHtml(stripeLink)}</a>
            </p>`
          : ""
      }

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:30px 0;">

      <p>Falls Sie Fragen haben, können Sie einfach auf diese E-Mail antworten.</p>

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

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf = makeLetterRtf(analysis, name, triage, type);

  await sendEmail(env, {
    to: email,
    subject: `Ihre Analyse ist fertig — ${labels.title} | MussIchZahlen`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hallo ${escapeHtml(capitalizeFirst(name))},</p>

      <p>Ihre Analyse ist fertig. Im Anhang finden Sie zwei Dateien:</p>

      <ul style="line-height:1.9;">
        <li><strong>MussIchZahlen-Analyse.rtf</strong> — vollständige Analyse mit Befunden und nächsten Schritten</li>
        <li><strong>${escapeHtml(labels.filename)}</strong> — fertiges ${escapeHtml(labels.letter)}, direkt verwendbar</li>
      </ul>

      <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
        Tipp: Senden Sie das Schreiben möglichst nachweisbar, zum Beispiel per Einschreiben oder per E-Mail mit Lesebestätigung. Bewahren Sie den Versandnachweis auf.
      </p>

      <p>Viele Grüße<br><strong>MussIchZahlen</strong></p>

      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
    attachments: [
      { filename: "MussIchZahlen-Analyse.rtf", content: rtfToBase64(analysisRtf) },
      { filename: labels.filename, content: rtfToBase64(letterRtf) },
    ],
  });

  await trackEvent(env, {
    type,
    kind: "paid",
  });
}

export async function sendAbandonedEmail(env, { name, email, type, amount, stripeLink, stage = 1 }) {
  if (!stripeLink) return;

  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;
  const stageNumber = Number(stage) || 1;
  const amountStr = amount ? ` über einen Betrag von ${escapeHtml(String(amount))}` : "";

  const subjects = {
    1: `Ihre Prüfung wurde noch nicht abgeschlossen — ${labels.title}`,
    2: `Ihre Einschätzung liegt noch vor — ${labels.title}`,
    3: `Letzte Erinnerung zu Ihrer Prüfung — ${labels.title}`,
  };

  const intros = {
    1: `<p>Sie haben Ihr Schreiben hochgeladen, aber die vollständige Prüfung noch nicht abgeschlossen${amountStr}.</p>
        <p>Es kann sinnvoll sein, die Forderung vor einer Zahlung genauer prüfen zu lassen.</p>`,
    2: `<p>Ihre Einschätzung liegt noch vor.</p>
        <p>Viele Nutzer entscheiden sich dafür, eine Forderung erst prüfen zu lassen — bevor sie zahlen.</p>`,
    3: `<p>dies ist unsere letzte Erinnerung.</p>
        <p>Falls Sie die Forderung noch nicht geprüft haben, kann eine kurze Analyse weiterhin sinnvoll sein.</p>`,
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
          Jetzt vollständig prüfen lassen — €${escapeHtml(labels.price)} →
        </a>
      </div>

      <p style="font-size:0.85rem;color:#6b7280;text-align:center;">
        Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung
      </p>

      <p style="font-size:0.82rem;color:#6b7280;background:#f9fafb;padding:12px;border-radius:6px;margin-top:20px;">
        Funktioniert der Button nicht?<br><br>
        Kopieren Sie diesen Zahlungslink in Ihren Browser:<br><br>
        <a href="${escapeHtml(stripeLink)}">${escapeHtml(stripeLink)}</a>
      </p>

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
