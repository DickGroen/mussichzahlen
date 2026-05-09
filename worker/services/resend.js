// worker/services/resend.js — mussichzahlen (tiered email)

import { escapeHtml } from "../utils/html.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "MussIchZahlen <noreply@mussichzahlen.de>";

const DISCLAIMER =
  "Dies ist ausschließlich eine allgemeine Einschätzung und keine Rechtsberatung. MussIchZahlen bietet keine anwaltliche Vertretung an.";

async function trackEvent(env, event, data = {}) {
  try {
    const id = crypto.randomUUID();

    const key =
      `track:${data.type || "unknown"}:` +
      `${event}:${Date.now()}:${id}`;

    await env.JOBS_KV.put(
      key,
      JSON.stringify({
        event,
        ...data,
        received_at: new Date().toISOString(),
      }),
      {
        expirationTtl: 60 * 60 * 24 * 90,
      }
    );
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

const TYPE_LABELS = {
  mahnung: {
    title: "Mahnung / Inkassoschreiben",
    letter: "Antwortschreiben",
    price: "49",
    filename: "Antwortschreiben.rtf",
  },
};

async function sendEmail(
  env,
  { to, subject, html, attachments = [] }
) {
  const body = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
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
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }

  return res.json();
}

function formatAmount(triage) {
  if (triage?.amount_claimed) {
    return `€${triage.amount_claimed}`;
  }

  return "unbekannt";
}

// ── CONFIRMATION EMAIL ─────────────────────────────────────────────────

export async function sendConfirmationEmail(
  env,
  { name, email, type = "mahnung" }
) {
  const labels =
    TYPE_LABELS[type] || TYPE_LABELS.mahnung;

  await sendEmail(env, {
    to: email,
    subject:
      "Wir haben dein Schreiben erhalten — MussIchZahlen",

    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

        <p style="font-size:1.1rem;font-weight:700;color:#14532d;">
          ✓ Dein Schreiben wurde erfolgreich übermittelt.
        </p>

        <p>Hallo ${escapeHtml(name)},</p>

        <p>
          Wir prüfen dein ${escapeHtml(labels.title)}
          sorgfältig und senden dir deine erste Einschätzung
          bis zum nächsten Werktag vor 16:00 Uhr per E-Mail.
        </p>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:16px 0;">

          <strong style="color:#14532d;">
            Warum das wichtig ist:
          </strong>

          <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">
            Viele Menschen zahlen vorschnell,
            obwohl bestimmte Forderungen,
            Zusatzkosten oder Nachweise
            zunächst geprüft werden sollten.
          </p>

        </div>

        <p style="font-size:.9rem;color:#6b7280;">
          → Bitte prüfe auch deinen Spam-Ordner,
          falls du keine Nachricht erhältst.
        </p>

        <p>
          Viele Grüße<br>
          <strong>MussIchZahlen</strong>
        </p>

        <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">
          ${escapeHtml(DISCLAIMER)}
        </p>

      </div>
    `,
  });
}

// ── ADMIN EMAILS ───────────────────────────────────────────────────────

export async function notifyAdminFree(
  env,
  { name, email, type, triage, stripeLink }
) {
  const amount = formatAmount(triage);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,

    subject:
      `[MussIchZahlen] Free check: ${name} (${type})`,

    html: `
      <div style="font-family:Arial,sans-serif;">

        <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
          📬 Neue kostenlose Prüfung
        </p>

        <h3>Kostenlose Prüfung — ${escapeHtml(type)}</h3>

        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>

        <p>
          <strong>Absender:</strong>
          ${escapeHtml(triage?.sender || "unbekannt")}
        </p>

        <p>
          <strong>Betrag:</strong>
          ${escapeHtml(amount)}
        </p>

        <p>
          <strong>Chance:</strong>
          ${escapeHtml(String(triage?.chance ?? "unbekannt"))}
        </p>

        <p>
          <strong>Flags:</strong>
          ${escapeHtml(String(triage?.flagCount ?? "0"))}
        </p>

        <p>
          <strong>Tier:</strong>
          ${escapeHtml(triage?.tier || "unbekannt")}
        </p>

        <p>
          <strong>Email-Typ:</strong>
          ${escapeHtml(triage?.emailType || "unbekannt")}
        </p>

        <p>
          <strong>Stripe-Link:</strong>
          ${stripeLink ? "JA" : "NEIN"}
        </p>

      </div>
    `,
  });
}

// ── FREE EMAILS ────────────────────────────────────────────────────────

export async function sendFreeEmail(
  env,
  {
    name,
    email,
    type,
    triage,
    stripeLink,
    stage = 1,
  }
) {

  const labels =
    TYPE_LABELS[type] || TYPE_LABELS.mahnung;

  const amount = formatAmount(triage);

  const stageNumber = Number(stage) || 1;

  const emailType =
    triage?.emailType || "stark";

  // ── STAGE 1 ─────────────────────────────────────────────────────────

  if (stageNumber === 1) {

    const senderPart =
      triage?.sender
        ? ` der ${escapeHtml(triage.sender)}`
        : "";

    const amountStr =
      amount !== "unbekannt"
        ? escapeHtml(amount)
        : "";

    const subject =
      amountStr
        ? `Bevor du ${amountStr} zahlst — bitte zuerst prüfen`
        : `Bitte zuerst prüfen, bevor du zahlst`;

    let bodyHtml = "";

    // ── STRONG ───────────────────────────────────────────────────────

    if (emailType === "stark") {

      bodyHtml = `
        <p>Hallo ${escapeHtml(name)},</p>

        <p>
          wir haben dein Schreiben geprüft
          und eine erste Einschätzung erstellt.
        </p>

        <div style="margin-top:20px;">
          <strong>Erste Einordnung:</strong>

          <p style="margin-top:6px;">
            Es handelt sich um ein
            ${escapeHtml(labels.title)}
            ${senderPart}
            ${amountStr ? ` über ${amountStr}` : ""}.
          </p>
        </div>

        <div style="margin-top:20px;">
          <strong>Was auffällt:</strong>

          <p style="margin-top:6px;">
            Es gibt mögliche Unklarheiten,
            die vor einer Zahlung geprüft werden sollten
            — insbesondere bei Betrag,
            Nachweisen oder zusätzlichen Kosten.
          </p>
        </div>

        <div style="margin-top:20px;">
          <strong>Einschätzung:</strong>

          <p style="margin-top:6px;">
            Es wäre nicht sinnvoll,
            vorschnell zu zahlen,
            ohne die Forderung genauer prüfen zu lassen.
          </p>
        </div>

        <div style="margin-top:20px;">
          <strong>Wichtig:</strong>

          <p style="margin-top:6px;">
            Bei Mahnungen können Fristen
            oder zusätzliche Kosten entstehen,
            wenn man gar nicht reagiert.

            Eine schriftliche Reaktion
            ist daher meist besser als Abwarten.
          </p>
        </div>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">

        <p>
          Du kannst jetzt die vollständige Prüfung
          inklusive fertigem Antwortschreiben erhalten:
        </p>

        <ul style="padding-left:20px;margin:14px 0 18px 0;list-style:none;">
          <li>✓ klare Bewertung deiner Situation</li>
          <li>✓ konkrete Punkte, die geprüft werden sollten</li>
          <li>✓ fertiges Schreiben, das du direkt verwenden kannst</li>
        </ul>

        ${
          stripeLink
            ? `
          <p style="margin:24px 0;">
            <a href="${escapeHtml(stripeLink)}"
               style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">

              Vollständige Analyse + Antwortschreiben — €49 →

            </a>
          </p>
        `
            : ""
        }
      `;
    }

    // ── SOFT ─────────────────────────────────────────────────────────

    else if (emailType === "soft") {

      bodyHtml = `
        <p>Hallo ${escapeHtml(name)},</p>

        <p>
          wir haben dein Schreiben geprüft.
        </p>

        <p>
          Es gibt Hinweise darauf,
          dass bestimmte Punkte vor einer Zahlung
          genauer geprüft werden sollten.
        </p>

        <p>
          Gerade bei Mahnungen oder Inkassoschreiben
          kann eine vorschnelle Zahlung
          unnötige Kosten verursachen.
        </p>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">

        <p>
          Du kannst jetzt die vollständige Prüfung
          inklusive Antwortschreiben erhalten:
        </p>

        ${
          stripeLink
            ? `
          <p style="margin:24px 0;">
            <a href="${escapeHtml(stripeLink)}"
               style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">

              Vollständige Analyse — €49 →

            </a>
          </p>
        `
            : ""
        }
      `;
    }

    // ── TRUST ────────────────────────────────────────────────────────

    else {

      bodyHtml = `
        <p>Hallo ${escapeHtml(name)},</p>

        <p>
          wir haben dein Schreiben geprüft.
        </p>

        <p>
          Nach erster Einschätzung
          wirkt die Forderung überwiegend nachvollziehbar.
        </p>

        <p>
          Trotzdem kann es sinnvoll sein,
          die Details vor einer Zahlung
          noch einmal vollständig zu prüfen.
        </p>

        ${
          stripeLink
            ? `
          <p style="margin:24px 0;">
            <a href="${escapeHtml(stripeLink)}"
               style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">

              Vollständige Analyse — €49 →

            </a>
          </p>
        `
            : ""
        }
      `;
    }

    await sendEmail(env, {
      to: email,
      subject,

      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

          ${bodyHtml}

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

          <p>
            Bei Fragen erreichst du uns unter
            support@mussichzahlen.de
          </p>

          <p>
            Viele Grüße<br>
            <strong>MussIchZahlen</strong>
          </p>

          <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">
            ${escapeHtml(DISCLAIMER)}
          </p>

        </div>
      `,
    });

    await trackEvent(env, "email_sent", {
      type,
      stage: 1,
      kind: "free",
      emailType,
    });

    return;
  }
}

// ── PAID EMAIL ─────────────────────────────────────────────────────────

export async function sendPaidEmail(
  env,
  { name, email, type, triage, analysis }
) {

  const labels =
    TYPE_LABELS[type] || TYPE_LABELS.mahnung;

  const analysisRtf =
    makeAnalysisRtf(
      analysis,
      name,
      email,
      triage,
      type
    );

  const letterRtf =
    makeLetterRtf(
      analysis,
      name,
      triage,
      type
    );

  await sendEmail(env, {
    to: email,

    subject:
      "Deine Analyse ist fertig — nächste Schritte",

    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

        <p>Hallo ${escapeHtml(name)},</p>

        <p>
          deine vollständige Analyse ist fertig.
        </p>

        <p>
          Im Anhang findest du:
        </p>

        <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
          <li>✓ Analyse.rtf — vollständige Einschätzung</li>
          <li>✓ ${escapeHtml(labels.filename)} — fertiges Schreiben</li>
        </ul>

        <p>
          Das Schreiben kann direkt verwendet
          und versendet werden.
        </p>

        <p>
          Viele Grüße<br>
          <strong>MussIchZahlen</strong>
        </p>

        <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">
          ${escapeHtml(DISCLAIMER)}
        </p>

      </div>
    `,

    attachments: [
      {
        filename: "Analyse.rtf",
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
