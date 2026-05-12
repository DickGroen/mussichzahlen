export async function sendFreeEmail(env, {
  name,
  email,
  type,
  triage,
  stripeLink,
  stage = 1
}) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.mahnung;

  const amount =
    triage?.amount_claimed
      ? `€${triage.amount_claimed}`
      : "unbekannt";

  const sender = triage?.sender || "unbekannt";

  const riskText = {
    high: "Es bestehen deutliche Hinweise auf mögliche Unstimmigkeiten.",
    medium: "Es bestehen mögliche Unklarheiten.",
    low: "Die Forderung wirkt grundsätzlich nachvollziehbar.",
  }[triage?.risk || "medium"];

  const teaser =
    triage?.teaser ||
    "In diesem Schreiben könnten Ansatzpunkte vorliegen, die ohne rechtzeitige Reaktion zu unnötigen Mehrkosten führen können.";

  const introByStage = {
    1: `
      <p>wir haben dein Schreiben geprüft und eine erste Einschätzung erstellt.</p>
      <p><strong>Was auffällt:</strong><br>${escapeHtml(teaser)}</p>
    `,
    2: `
      <p>deine kostenlose Ersteinschätzung liegt noch vor.</p>
      <p>Viele entscheiden sich dafür, die Forderung vor einer Zahlung genauer prüfen zu lassen.</p>
    `,
    3: `
      <p>dies ist unsere letzte Erinnerung zu deiner Ersteinschätzung.</p>
      <p>Falls du die Forderung noch nicht geprüft hast, kann eine kurze Analyse sinnvoll sein.</p>
    `,
  };

  const subjectByStage = {
    1: `Erste Einschätzung zu deinem Schreiben — ${labels.title}`,
    2: `Noch nicht geprüft? Deine Einschätzung wartet — ${labels.title}`,
    3: `Letzte Erinnerung: noch nicht geprüft — ${labels.title}`,
  };

  await sendEmail(env, {
    to: email,
    subject: subjectByStage[stage] || subjectByStage[1],
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
        
        <p>Hallo ${escapeHtml(capitalizeFirst(name))},</p>

        ${introByStage[stage] || introByStage[1]}

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
            <td style="padding:10px;font-weight:bold;color:#1d3a6e;">
              ${escapeHtml(amount)}
            </td>
          </tr>

          <tr>
            <td style="padding:10px;font-weight:bold;">Einschätzung</td>
            <td style="padding:10px;">
              ${escapeHtml(riskText)}
            </td>
          </tr>
        </table>

        ${
          stripeLink
            ? `
          <div style="margin:28px 0;text-align:center;">

            <a
              href="${escapeHtml(stripeLink)}"
              target="_blank"
              rel="noopener noreferrer"
              style="
                background:#1d3a6e;
                color:#ffffff;
                text-decoration:none;
                padding:14px 24px;
                border-radius:8px;
                display:inline-block;
                font-weight:bold;
                font-size:16px;
              "
            >
              Vollständige Analyse + Antwortschreiben — €${escapeHtml(labels.price)} →
            </a>

          </div>

          <p style="font-size:0.85rem;color:#6b7280;text-align:center;">
            Einmalig €${escapeHtml(labels.price)} · kein Abo · sichere Zahlung
          </p>

          <p style="font-size:0.82rem;color:#6b7280;background:#f9fafb;padding:12px;border-radius:6px;margin-top:20px;">
            Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:
            <br><br>
            <a href="${escapeHtml(stripeLink)}">
              ${escapeHtml(stripeLink)}
            </a>
          </p>
        `
            : ""
        }

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">

        <p>
          Falls du Fragen hast, kannst du einfach auf diese E-Mail antworten.
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

  await trackEvent(env, "email_sent", {
    type,
    stage,
    kind: "free",
  });
}
