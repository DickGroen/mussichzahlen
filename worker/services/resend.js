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
    price: "49"
  },

  parkstrafe: {
    title: "Bußgeldbescheid",
    letter: "Einspruchsschreiben",
    filename: "Einspruch.rtf",
    price: "19"
  },

  rechnung: {
    title: "Rechnung",
    letter: "Widerspruchsschreiben",
    filename: "Widerspruchsschreiben.rtf",
    price: "29"
  },

  vertrag: {
    title: "Vertrag / Kündigung",
    letter: "Kündigungsschreiben",
    filename: "Kuendigungsschreiben.rtf",
    price: "29"
  },

  angebot: {
    title: "Angebot / Kostenvoranschlag",
    letter: "Prüfbericht",
    filename: "Angebot-Pruefung.rtf",
    price: "29"
  }
};

async function trackEvent(env, event, data = {}) {
  try {
    const id = crypto.randomUUID();

    const key =
      `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;

    await env.SESSIONS_KV.put(
      key,
      JSON.stringify({
        event,
        ...data,
        received_at: new Date().toISOString(),
      }),
      {
        expirationTtl: 60 * 60 * 24 * 90
      }
    );

  } catch (err) {
    console.error("Track error:", err.message);
  }
}

async function sendEmail(env, {
  to,
  subject,
  html,
  attachments = []
}) {

  const body = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  };

  if (attachments.length) {
    body.attachments = attachments;
  }

  const res = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },

      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    throw new Error(
      `Resend Fehler: ${await res.text()}`
    );
  }

  return res.json();
}

function formatAmount(triage) {
  if (triage?.amount_claimed) {
    return `€${triage.amount_claimed}`;
  }

  if (triage?.fine_amount) {
    return `€${triage.fine_amount}`;
  }

  if (triage?.total_price) {
    return `€${triage.total_price}`;
  }

  return "unbekannt";
}

function riskLabel(risk) {
  return {
    low: "Gering",
    medium: "Mittel",
    high: "Hoch"
  }[risk] || risk || "unbekannt";
}

function riskAssessment(risk) {
  return {
    high:
      "Nach erster Einschätzung bestehen mehrere prüfenswerte Auffälligkeiten. Es könnte sinnvoll sein, die Forderung vor einer Zahlung genauer überprüfen zu lassen.",

    medium:
      "Nach erster Einschätzung bestehen mögliche Unklarheiten. Es könnte sinnvoll sein, die Forderung vor einer Zahlung genauer überprüfen zu lassen.",

    low:
      "Nach erster Einschätzung wirkt die Forderung grundsätzlich nachvollziehbar. Eine kurze Prüfung kann dennoch sinnvoll sein."

  }[risk] ||
    "Nach erster Einschätzung bestehen mögliche Unklarheiten. Es könnte sinnvoll sein, die Forderung vor einer Zahlung genauer überprüfen zu lassen.";
}
export async function sendConfirmationEmail(env, {
  name,
  email
}) {

  await sendEmail(env, {
    to: email,

    subject:
      "Ihr Schreiben ist eingegangen — MussIchZahlen",

    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

  <p style="font-size:1.1rem;font-weight:700;color:#14532d;">
    ✓ Ihr Schreiben ist eingegangen.
  </p>

  <p>
    Guten Tag ${escapeHtml(capitalizeFirst(name || "Kunde"))},
  </p>

  <p>
    wir haben Ihr Dokument erhalten und werden es sorgfältig prüfen.
    Sie erhalten spätestens am nächsten Werktag bis 16:00 Uhr
    eine erste Einschätzung per E-Mail.
  </p>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:16px 0;">

    <strong style="color:#14532d;">
      Was wir prüfen:
    </strong>

    <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">

      Wir prüfen, ob einzelne Forderungsbestandteile,
      Zusatzkosten oder Nachweise genauer betrachtet werden sollten.

    </p>

  </div>

  <p style="font-size:.9rem;color:#6b7280;">
    → Bitte prüfen Sie auch Ihren Spam-Ordner,
    falls Sie keine E-Mail erhalten.
  </p>

  <p>
    Viele Grüße<br>
    <strong>MussIchZahlen</strong>
  </p>

  <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">
    ${escapeHtml(DISCLAIMER)}
  </p>

</div>`
  });
}

// ── Admin notifications ──────────────────────────────────────────────────────

export async function notifyAdminFree(env, {
  name,
  email,
  type,
  triage
}) {

  const labels =
    TYPE_LABELS[type] || TYPE_LABELS.mahnung;

  const amount =
    formatAmount(triage);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,

    subject:
      `[MussIchZahlen] Kostenlose Anfrage: ${name} (${type})`,

    html: `
<div style="font-family:Arial,sans-serif;">

  <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">

    📬 Recovery-Sequenz wird automatisch geplant für
    <strong>${escapeHtml(email)}</strong>

  </p>

  <h3>
    Kostenlose Anfrage — ${escapeHtml(labels.title)}
  </h3>

  <p><strong>Name:</strong> ${escapeHtml(name)}</p>
  <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>

  <p>
    <strong>Absender:</strong>
    ${escapeHtml(triage?.sender || "unbekannt")}
  </p>

  <p>
    <strong>Betrag:</strong>
    ${escapeHtml(amount)}
  </p>

  <p>
    <strong>Risiko:</strong>
    ${escapeHtml(triage?.risk || "")}
  </p>

  <p>
    <strong>Chance:</strong>
    ${escapeHtml(String(triage?.chance ?? "unbekannt"))}
  </p>

  <p>
    <strong>Flags:</strong>
    ${escapeHtml(String(triage?.flagCount ?? "unbekannt"))}
  </p>

</div>`
  });
}

// ── Paid admin notification ──────────────────────────────────────────────────

export async function notifyAdminPaid(env, {
  name,
  email,
  type,
  triage,
  analysis
}) {

  const labels =
    TYPE_LABELS[type] || TYPE_LABELS.mahnung;

  const amount =
    formatAmount(triage);

  const rtf =
    makeAnalysisRtf(
      analysis,
      name,
      email,
      triage,
      type
    );

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,

    subject:
      `[MussIchZahlen] BEZAHLT: ${name} (${type})`,

    html: `
<div style="font-family:Arial,sans-serif;">

  <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">

    📬 Recovery-Sequenz wird gestoppt,
    Kunden-E-Mail mit Anhängen wird geplant

  </p>

  <h3>
    Bezahlte Analyse — ${escapeHtml(labels.title)}
  </h3>

  <p><strong>Name:</strong> ${escapeHtml(name)}</p>
  <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>

  <p>
    <strong>Absender:</strong>
    ${escapeHtml(triage?.sender || "unbekannt")}
  </p>

  <p>
    <strong>Betrag:</strong>
    ${escapeHtml(amount)}
  </p>

  <p>
    <strong>Risiko:</strong>
    ${escapeHtml(triage?.risk || "")}
  </p>

</div>`,

    attachments: [
      {
        filename: "MussIchZahlen-Analyse.rtf",
        content: rtfToBase64(rtf)
      }
    ]
  });
}

// ── Free email sequence ──────────────────────────────────────────────────────

export async function sendFreeEmail(env, {
  name,
  email,
  type,
  triage,
  stripeLink,
  stage = 1
}) {

  const labels =
    TYPE_LABELS[type] || TYPE_LABELS.mahnung;

  const amount =
    formatAmount(triage);

  const stageNumber =
    Number(stage) || 1;

  // ── Stage 1 ────────────────────────────────────────────────────────────────

  if (stageNumber === 1) {

    const safeName =
      capitalizeFirst(name || "Kunde");

    const senderText =
      triage?.sender
        ? ` von ${escapeHtml(triage.sender)}`
        : "";

    const teaser =
      triage?.teaser
        ? escapeHtml(triage.teaser)
        : "Es bestehen mögliche Unklarheiten bei einzelnen Kosten oder Forderungsbestandteilen.";

    const riskText =
      riskAssessment(triage?.risk);

    await sendEmail(env, {
      to: email,

      subject:
        `Erste Einschätzung zu Ihrem Schreiben — ${labels.title}`,

      html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

  <p>
    Guten Tag ${escapeHtml(safeName)},
  </p>

  <p>
    wir haben Ihr Schreiben geprüft
    und eine erste Einschätzung erstellt.
  </p>

  <p>

    Bei einer Forderung

    ${amount !== "unbekannt"
      ? `über <strong>${escapeHtml(amount)}</strong>`
      : ""}

    ${senderText}

    könnten einzelne Punkte relevant sein,
    die vor einer Zahlung geprüft werden sollten.

  </p>

  <p>
    <strong>Was auffällt:</strong>
  </p>

  <ul style="padding-left:20px;line-height:1.8;">
    <li>${teaser}</li>
  </ul>

  <table style="width:100%;border-collapse:collapse;margin:22px 0;border:1px solid #e5e7eb;font-size:14px;">

    <tr style="background:#f3f4f6;">
      <td style="padding:10px;font-weight:bold;">
        Dokument
      </td>

      <td style="padding:10px;">
        ${escapeHtml(labels.title)}
      </td>
    </tr>

    <tr>
      <td style="padding:10px;font-weight:bold;">
        Absender
      </td>

      <td style="padding:10px;">
        ${escapeHtml(triage?.sender || "unbekannt")}
      </td>
    </tr>

    <tr style="background:#f3f4f6;">
      <td style="padding:10px;font-weight:bold;">
        Betrag
      </td>

      <td style="padding:10px;font-weight:bold;color:#1d3a6e;">
        ${escapeHtml(amount)}
      </td>
    </tr>

    <tr>
      <td style="padding:10px;font-weight:bold;">
        Einschätzung
      </td>

      <td style="padding:10px;">
        ${escapeHtml(riskText)}
      </td>
    </tr>

  </table>

  <p style="background:#f9fafb;padding:14px;border-radius:8px;color:#374151;">

    Viele Verbraucher lassen Forderungen zunächst prüfen,
    bevor sie bezahlen oder reagieren.

  </p>

  <div style="background:#fff7ed;border:1px solid #fdba74;padding:14px;border-radius:8px;margin:22px 0;color:#9a3412;">

    <strong>
      Warum viele Verbraucher zuerst prüfen lassen:
    </strong>

    <ul style="padding-left:18px;margin-top:10px;line-height:1.8;">
      <li>Inkassokosten sind nicht immer vollständig nachvollziehbar</li>
      <li>Forderungen enthalten teilweise unklare Zusatzkosten</li>
      <li>Nachweise oder Vertragsgrundlagen fehlen manchmal vollständig</li>
    </ul>

  </div>
