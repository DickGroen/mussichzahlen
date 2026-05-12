// worker/services/resend.js

import { escapeHtml } from "../utils/files.js";
import {
  makeAnalysisRtf,
  makeLetterRtf,
  rtfToBase64
} from "../utils/rtf.js";

const FROM =
  "MussIchZahlen <noreply@mussichzahlen.de>";

const DISCLAIMER =
  "MussIchZahlen bietet informative Analysen — keine Rechtsberatung und keine anwaltliche Vertretung.";

function capitalizeFirst(str = "") {
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
    letter: "Antwortschreiben",
    filename: "Antwortschreiben.rtf",
    price: "29"
  }
};

// ── Tracking ─────────────────────────────────────────────────────────────────

async function trackEvent(env, event, data = {}) {

  try {

    const id =
      crypto.randomUUID();

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

// ── Resend core ──────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAmount(triage = {}) {

  const amount =
    triage?.amount_claimed
    || triage?.fine_amount
    || triage?.total_price
    || null;

  if (!amount) {
    return "unbekannt";
  }

  return `€${amount}`;
}

function riskLabel(risk) {

  return {
    low: "Gering",
    medium: "Mittel",
    high: "Hoch"
  }[risk] || "Unbekannt";
}

function riskAssessment(risk) {

  return {

    high:
      "Es bestehen deutliche Hinweise auf mögliche Unstimmigkeiten oder zusätzliche Kosten.",

    medium:
      "Es bestehen mögliche Unklarheiten, die überprüft werden sollten.",

    low:
      "Nach erster Einschätzung wirkt das Schreiben derzeit eher nachvollziehbar."

  }[risk]
  || "Es bestehen mögliche Unklarheiten.";
}

// ── Confirmation mail ────────────────────────────────────────────────────────

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

  <p style="font-size:1.05rem;font-weight:700;color:#14532d;">
    ✓ Ihr Schreiben ist eingegangen.
  </p>

  <p>
    Guten Tag ${escapeHtml(capitalizeFirst(name))},
  </p>

  <p>
    wir haben Ihr Dokument erhalten und werden es sorgfältig prüfen.
  </p>

  <p>
    Sie erhalten spätestens am nächsten Werktag bis 16:00 Uhr
    eine erste Einschätzung per E-Mail.
  </p>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:18px 0;">

    <strong style="color:#14532d;">
      Was wir prüfen:
    </strong>

    <p style="margin-top:8px;color:#166534;line-height:1.65;">

      Wir prüfen,
      ob einzelne Forderungsbestandteile,
      Zusatzkosten oder Nachweise
      genauer betrachtet werden sollten.

    </p>

  </div>

  <p style="font-size:.9rem;color:#6b7280;">
    → Bitte prüfen Sie auch Ihren Spam-Ordner,
    falls Sie keine Nachricht erhalten.
  </p>

  <p>
    Falls Sie Fragen haben,
    können Sie einfach auf diese E-Mail antworten.
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

// ── Free email ───────────────────────────────────────────────────────────────

export async function sendFreeEmail(env, {
  name,
  email,
  type,
  triage,
  stripeLink,
  stage = 1
}) {

  const labels =
    TYPE_LABELS[type]
    || TYPE_LABELS.mahnung;

  const amount =
    formatAmount(triage);

  const stageNumber =
    Number(stage) || 1;

  const safeName =
    capitalizeFirst(name || "Kunde");

  // ── Tier 3 trust mail ──────────────────────────────────────────────────────

  if (
    stageNumber === 1
    && triage?.tier === "tier3"
  ) {

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
    Das Schreiben wirkt nach erster Einschätzung
    derzeit eher nachvollziehbar.
  </p>

  <p>
    Aktuell bestehen keine deutlichen Hinweise
    auf größere Unstimmigkeiten
    oder ungewöhnliche Zusatzkosten.
  </p>

  <div style="background:#f9fafb;padding:16px;border-radius:8px;margin:24px 0;">

    <table style="width:100%;border-collapse:collapse;font-size:14px;">

      <tr>
        <td style="padding:8px 0;font-weight:bold;width:140px;">
          Dokument
        </td>

        <td style="padding:8px 0;">
          ${escapeHtml(labels.title)}
        </td>
      </tr>

      <tr>
        <td style="padding:8px 0;font-weight:bold;">
          Absender
        </td>

        <td style="padding:8px 0;">
          ${escapeHtml(triage?.sender || "unbekannt")}
        </td>
      </tr>

      <tr>
        <td style="padding:8px 0;font-weight:bold;">
          Betrag
        </td>

        <td style="padding:8px 0;">
          ${escapeHtml(amount)}
        </td>
      </tr>

    </table>

  </div>

  <p>
    Falls Sie dennoch zusätzliche Sicherheit wünschen
    oder weitere Schreiben erhalten,
    können Sie jederzeit eine ausführlichere Prüfung anfordern.
  </p>

  ${stripeLink ? `

  <div style="margin:26px 0;">

    <a href="${escapeHtml(stripeLink)}"
       style="display:inline-block;background:#eef2ff;color:#1d3a6e;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;border:1px solid #c7d2fe;">

       Optionale vollständige Analyse — €${escapeHtml(labels.price)}

    </a>

  </div>

  <p style="font-size:0.82rem;color:#6b7280;">
    Nur falls Sie eine zusätzliche Prüfung wünschen.
  </p>

  ` : ""}

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">

  <p>
    Falls Sie Fragen haben,
    können Sie einfach auf diese E-Mail antworten.
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

    await trackEvent(env, "email_sent", {
      type,
      stage: 1,
      kind: "free"
    });

    return;
  }
