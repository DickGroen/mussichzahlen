// worker/utils/rtf.js

import { extractTaggedSection } from "./files.js";

const LETTER_TAG = {
  mahnung: "WIDERSPRUCH",
  parkstrafe: "EINSPRUCH",
  rechnung: "WIDERSPRUCHSSCHREIBEN",
  vertrag: "KUENDIGUNGSSCHREIBEN",
  angebot: "ANTWORTSCHREIBEN",
};

const LETTER_TITLE = {
  mahnung: "Widerspruch",
  parkstrafe: "Einspruchsschreiben",
  rechnung: "Widerspruchsschreiben",
  vertrag: "Kündigungsschreiben",
  angebot: "Antwortschreiben",
};

const DISCLAIMER_RTF =
  "MussIchZahlen bietet informative Analysen — keine Rechtsberatung und keine anwaltliche Vertretung.";

export function rtfEscape(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\u2014/g, "\\emdash ")
    .replace(/\u2013/g, "\\endash ")
    .replace(/\u2018/g, "\\'91")
    .replace(/\u2019/g, "\\'92")
    .replace(/\u201c/g, "\\'93")
    .replace(/\u201d/g, "\\'94")
    .replace(/\u00a0/g, " ")
    .replace(/\u20ac/g, "\\'80")
    .replace(/\u00a3/g, "\\'a3")
    .replace(/[^\x00-\x7F]/g, (char) => `\\u${char.charCodeAt(0)}?`)
    .replace(/\n/g, "\\par\n");
}

export function rtfToBase64(rtfString) {
  const bytes = new TextEncoder().encode(String(rtfString || ""));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function capitalizeFirst(value = "") {
  const s = String(value || "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripMarkdown(value = "") {
  return String(value)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function sanitizeLegalTone(text = "") {
  return String(text || "")
    .replace(/Dies ist ein erhebliches Manko\.?/gi, "Es bestehen mögliche Unklarheiten.")
    .replace(/14-Tage-Frist beginnt[^.]*\.?/gi, "Bitte prüfen Sie mögliche Fristen sorgfältig.")
    .replace(/Ich bitte Sie daher, mir innerhalb von 14 Tagen folgende Nachweise schriftlich vorzulegen:/gi,
      "Ich bitte Sie daher, mir die folgenden Nachweise schriftlich vorzulegen:")
    .replace(/Ich bitte um eine schriftliche Stellungnahme innerhalb von 14 Tagen nach Eingang dieses Schreibens\./gi,
      "Ich bitte um eine schriftliche Stellungnahme.")
    .replace(/werde keine Zahlung leisten/gi,
      "werde eine Zahlung erst nach vollständiger Klärung prüfen")
    .replace(/keine Zahlung leisten/gi,
      "eine Zahlung erst nach vollständiger Klärung prüfen")
    .replace(/eindeutig rechtswidrig/gi, "möglicherweise problematisch")
    .replace(/zweifelsfrei/gi, "nach erster Einschätzung")
    .replace(/garantiert/gi, "möglicherweise")
    .replace(/RDG(EG)?/gi, "Rechtsdienstleistungsregister")
    .replace(/Rechtsdienstleistungs-Gesetzesvormerkung/gi, "Rechtsdienstleistungsregister")
    .trim();
}

function removeDuplicateAddressBlocks(text = "") {
  let t = String(text || "").trim();

  // Verwijder dubbele standaard klant-adresblokken als Claude die in de brief zet.
  t = t.replace(
    /Hinweis:\s*Bitte ergänzen Sie vor dem Versand[\s\S]*?\[Ihre E-Mail-Adresse, optional\]\s*/i,
    ""
  );

  t = t.replace(
    /\[Ihr vollständiger Name\]\s*\n\[Ihre Anschrift\]\s*\n\[Ihre E-Mail-Adresse, optional\]\s*/i,
    ""
  );

  t = t.replace(
    /\[Ihr Name\]\s*\n\[Ihre Adresse\]\s*\n\[PLZ Ort\]\s*/i,
    ""
  );

  // Verwijder losse plaats/datum placeholders zoals ", ".
  t = t.replace(/^\s*,\s*$/gm, "");

  return t.trim();
}

function getSection(analysis, tag) {
  return sanitizeLegalTone(
    stripMarkdown(extractTaggedSection(analysis, tag) || "")
  );
}

function getLetterSection(analysis, type) {
  const primary = LETTER_TAG[type] || "WIDERSPRUCH";

  const possibleTags = [
    primary,
    "LETTER",
    "ANTWORTSCHREIBEN",
    "SCHREIBEN",
    "WIDERSPRUCH",
    "EINSPRUCH",
    "WIDERSPRUCHSSCHREIBEN",
    "KUENDIGUNGSSCHREIBEN",
  ];

  for (const tag of possibleTags) {
    const found = getSection(analysis, tag);
    if (found) return found;
  }

  return "";
}

function cleanLetter(text = "") {
  return sanitizeLegalTone(
    removeDuplicateAddressBlocks(
      stripMarkdown(text)
        .replace(/\[\/?\w+\]/g, "")
        .trim()
    )
  );
}

function rtfHeader() {
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;\\red34\\green139\\blue34;\\red180\\green140\\blue0;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440
\\f1\\fs22
`;
}

function rtfFooter(note = DISCLAIMER_RTF) {
  return `
{\\pard\\sb500\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\f1\\fs18\\cf0\\par}
{\\pard\\sb100\\sa0\\f1\\fs16\\cf0\\i ${rtfEscape(note)}\\i0\\par}
}`;
}

function paragraph(text = "", spacing = 180) {
  if (!text) return "";
  return `{\\pard\\sb0\\sa${spacing}\\f1\\fs22 ${rtfEscape(text)}\\par}\n`;
}

function heading(text = "") {
  if (!text) return "";
  return `{\\pard\\sb360\\sa120\\f1\\fs26\\b\\cf1 ${rtfEscape(text)}\\b0\\cf0\\par}\n`;
}

function bulletLines(text = "") {
  const lines = String(text || "")
    .split("\n")
    .map((line) => stripMarkdown(line.replace(/^\s*[-•]\s*/, "").trim()))
    .filter(Boolean);

  if (!lines.length) return "";

  return lines
    .map(
      (line) =>
        `{\\pard\\sb0\\sa120\\fi-300\\li300\\f1\\fs22 \\bullet  ${rtfEscape(sanitizeLegalTone(line))}\\par}`
    )
    .join("\n");
}

function numberedLines(text = "") {
  const lines = String(text || "")
    .split("\n")
    .map((line) => stripMarkdown(line.replace(/^\s*\d+\.\s*/, "").trim()))
    .filter(Boolean);

  if (!lines.length) return "";

  return lines
    .map(
      (line, index) =>
        `{\\pard\\sb0\\sa140\\fi-300\\li300\\f1\\fs22 ${index + 1}.  ${rtfEscape(sanitizeLegalTone(line))}\\par}`
    )
    .join("\n");
}

function detectCurrency(triage = {}) {
  const explicit =
    triage?.currency_symbol ||
    triage?.currency ||
    triage?.amount_currency ||
    "";

  const text = JSON.stringify(triage || {}).toLowerCase();

  if (String(explicit).toUpperCase() === "GBP") return "£";
  if (String(explicit).toUpperCase() === "EUR") return "€";
  if (String(explicit).includes("£")) return "£";
  if (String(explicit).includes("€")) return "€";

  if (text.includes("gbp") || text.includes("pfund") || text.includes("pound") || text.includes("£")) {
    return "£";
  }

  return "€";
}

function formatAmount(triage = {}) {
  const amount =
    triage?.amount_claimed ??
    triage?.fine_amount ??
    triage?.total_price ??
    null;

  if (amount === null || amount === undefined || amount === "") {
    return "unbekannt";
  }

  return `${detectCurrency(triage)}${amount}`;
}

function riskLabel(risk) {
  if (risk === "high") return "hoch";
  if (risk === "medium") return "mittel";
  if (risk === "low") return "gering";
  return risk || "unbekannt";
}

export function makeConfirmationRtf(name = "") {
  const customer = capitalizeFirst(name || "Kunde");

  return (
    rtfHeader() +
    `{\\pard\\sb400\\sa160\\f1\\fs30\\b\\cf1 ${rtfEscape("Ihr Schreiben ist eingegangen")}\\b0\\cf0\\par}\n` +
    paragraph(`Guten Tag ${customer},`) +
    paragraph(
      "wir haben Ihr Dokument erhalten und werden es sorgfältig prüfen. Sie erhalten spätestens am nächsten Werktag bis 16:00 Uhr eine erste Einschätzung per E-Mail."
    ) +
    heading("Was wir prüfen") +
    paragraph(
      "Wir prüfen, ob einzelne Forderungsbestandteile, Zusatzkosten oder Nachweise genauer betrachtet werden sollten."
    ) +
    paragraph("Bitte prüfen Sie auch Ihren Spam-Ordner, falls Sie keine E-Mail erhalten.") +
    paragraph("Viele Grüße\nMussIchZahlen") +
    rtfFooter()
  );
}

export function makeAnalysisRtf(
  analysis,
  customerName = "",
  customerEmail = "",
  triage = {},
  type = "mahnung"
) {
  const title = getSection(analysis, "TITLE") || "MussIchZahlen Analyse";
  const intro = getSection(analysis, "INTRO");
  const howToUse = getSection(analysis, "HOW_TO_USE");
  const summary = getSection(analysis, "SUMMARY");
  const issues = getSection(analysis, "ISSUES");
  const assessment = getSection(analysis, "ASSESSMENT");
  const nextSteps = getSection(analysis, "NEXT_STEPS");

  const amount = formatAmount(triage);
  const sender = triage?.sender || "unbekannt";
  const risk = riskLabel(triage?.risk);
  const dateStr = new Date().toLocaleDateString("de-DE");
  const cleanName = capitalizeFirst(customerName || "");

  let out = rtfHeader();

  out += `{\\pard\\sb400\\sa120\\f1\\fs34\\b\\cf1 ${rtfEscape(title)}\\b0\\cf0\\par}\n`;
  out += `{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 ${rtfEscape(cleanName)} ${customerEmail ? `(${rtfEscape(customerEmail)})` : ""}\\par}\n`;
  out += `{\\pard\\sb0\\sa280\\f1\\fs20\\cf0 ${rtfEscape(`Typ: ${type} | Betrag: ${amount} | Risiko: ${risk} | Datum: ${dateStr}`)}\\par}\n`;

  out += heading("Fallübersicht");
  out += paragraph(`Absender: ${sender}`, 100);
  out += paragraph(`Betrag: ${amount}`, 100);
  out += paragraph(`Einschätzung: ${risk}`, 180);

  if (intro) {
    out += heading("Einordnung");
    out += paragraph(intro);
  }

  if (summary) {
    out += heading("Zusammenfassung");
    out += paragraph(summary);
  }

  if (issues) {
    out += heading("Geprüfte Punkte");
    out += bulletLines(issues) || paragraph(issues);
  }

  if (assessment) {
    out += heading("Einschätzung");
    out += paragraph(assessment);
  }

  if (nextSteps) {
    out += heading("Nächste Schritte");
    out += numberedLines(nextSteps) || bulletLines(nextSteps) || paragraph(nextSteps);
  }

  if (howToUse) {
    out += heading("So verwenden Sie dieses Ergebnis");
    out += numberedLines(howToUse) || paragraph(howToUse);
  }

  out += paragraph(
    "Bitte senden Sie das beigefügte Schreiben separat. Die Analyse ist für Ihre eigene Orientierung bestimmt."
  );

  return out + rtfFooter();
}

export function makeLetterRtf(
  analysis,
  customerName = "",
  triage = {},
  type = "mahnung"
) {
  const title = LETTER_TITLE[type] || "Schreiben";
  const sender = triage?.sender || "[Empfänger]";
  const content =
    cleanLetter(getLetterSection(analysis, type)) ||
    fallbackLetter(type, triage);

  const dateStr = new Date().toLocaleDateString("de-DE");
  const cleanName = capitalizeFirst(customerName || "[Name]");

  let out = rtfHeader();

  out += `{\\pard\\sb400\\sa160\\f1\\fs30\\b\\cf2 ${rtfEscape(title)}\\b0\\cf0\\par}\n`;
  out += `{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 ${rtfEscape(`Erstellt für: ${cleanName}`)}\\par}\n`;
  out += `{\\pard\\sb0\\sa260\\f1\\fs20\\cf4\\i ${rtfEscape("Bitte ergänzen Sie Ihre persönlichen Angaben, Datum, Adresse und Aktenzeichen vor dem Versand.")}\\i0\\cf0\\par}\n`;

  out += `{\\pard\\sb240\\sa180\\f1\\fs22\\cf0
${rtfEscape("[Ihr Name]")}
\\par
${rtfEscape("[Ihre Adresse]")}
\\par
${rtfEscape("[PLZ Ort]")}
\\par
\\par
${rtfEscape(sender)}
\\par
${rtfEscape("[Adresse des Empfängers]")}
\\par
\\par
${rtfEscape(dateStr)}
\\par
\\par
${rtfEscape(content)}
\\par
}`;

  return out + rtfFooter(
    "MussIchZahlen bietet informative Analysen — keine Rechtsberatung und keine anwaltliche Vertretung."
  );
}

function fallbackLetter(type, triage = {}) {
  if (type === "mahnung") return fallbackMahnungLetter(triage);
  if (type === "parkstrafe") return fallbackParkstrafeLetter();
  if (type === "rechnung") return fallbackRechnungLetter();
  if (type === "vertrag") return fallbackVertragLetter();
  if (type === "angebot") return fallbackAngebotLetter();
  return fallbackNeutralLetter();
}

function fallbackMahnungLetter(triage = {}) {
  const amount = formatAmount(triage);

  return `Betreff: Bitte um Nachweis und Klärung Ihrer Forderung

Sehr geehrte Damen und Herren,

ich nehme Bezug auf Ihr Schreiben bezüglich der von Ihnen geltend gemachten Forderung${amount !== "unbekannt" ? ` in Höhe von ${amount}` : ""}.

Ich bestreite die Forderung vorsorglich und ohne Anerkennung einer Rechtspflicht, solange keine vollständigen Nachweise vorliegen.

Bitte übersenden Sie mir insbesondere:

1. eine Kopie des ursprünglichen Vertrags, der Rechnung oder der sonstigen Grundlage der Forderung,
2. eine vollständige und nachvollziehbare Aufstellung des geforderten Betrags,
3. eine Erklärung, wie Mahnkosten, Inkassokosten oder sonstige Zusatzkosten berechnet wurden,
4. einen Nachweis Ihrer Berechtigung, diese Forderung geltend zu machen,
5. das Datum, an dem die Forderung erstmals fällig geworden sein soll.

Bis zur vollständigen Klärung bitte ich darum, weitere Maßnahmen auszusetzen.

Dieses Schreiben stellt kein Anerkenntnis einer Zahlungspflicht dar.

Ich bitte um schriftliche Antwort.

Mit freundlichen Grüßen

[Unterschrift]`;
}

function fallbackParkstrafeLetter() {
  return `Betreff: Einspruch gegen den Bußgeldbescheid / Zahlungsaufforderung

Sehr geehrte Damen und Herren,

hiermit lege ich vorsorglich Einspruch gegen den genannten Bescheid bzw. die Zahlungsaufforderung ein.

Ich bitte um eine vollständige schriftliche Erläuterung des Vorwurfs sowie um Übersendung aller Belege, Fotos, Messdaten oder sonstigen Nachweise.

Dieses Schreiben stellt kein Anerkenntnis einer Zahlungspflicht dar.

Bitte bestätigen Sie den Eingang dieses Schreibens schriftlich.

Mit freundlichen Grüßen

[Unterschrift]`;
}

function fallbackRechnungLetter() {
  return `Betreff: Klärung Ihrer Rechnung

Sehr geehrte Damen und Herren,

ich nehme Bezug auf Ihre Rechnung.

Derzeit kann ich die Rechnung nicht vollständig nachvollziehen. Bitte übersenden Sie mir eine genaue Aufstellung der berechneten Positionen sowie die vertragliche Grundlage der Forderung.

Bis zur Klärung erkenne ich die Forderung nicht an.

Ich bitte um schriftliche Rückmeldung.

Mit freundlichen Grüßen

[Unterschrift]`;
}

function fallbackVertragLetter() {
  return `Betreff: Klärung / Kündigung des Vertragsverhältnisses

Sehr geehrte Damen und Herren,

ich nehme Bezug auf das bestehende Vertragsverhältnis.

Bitte bestätigen Sie mir schriftlich den aktuellen Vertragsstatus, die Vertragslaufzeit, mögliche Kündigungsfristen sowie etwaige offene Beträge.

Soweit eine Kündigung möglich ist, kündige ich den Vertrag vorsorglich zum nächstmöglichen Zeitpunkt.

Ich bitte um schriftliche Bestätigung.

Mit freundlichen Grüßen

[Unterschrift]`;
}

function fallbackAngebotLetter() {
  return `Betreff: Rückfrage zu Ihrem Angebot / Kostenvoranschlag

Sehr geehrte Damen und Herren,

ich nehme Bezug auf Ihr Angebot bzw. den Kostenvoranschlag.

Bitte erläutern Sie die einzelnen Kostenpositionen näher und teilen Sie mir mit, welche Leistungen, Materialien und Zusatzkosten im Betrag enthalten sind.

Ich bitte um schriftliche Rückmeldung, bevor ich über eine Annahme des Angebots entscheide.

Mit freundlichen Grüßen

[Unterschrift]`;
}

function fallbackNeutralLetter() {
  return `Betreff: Bitte um Klärung

Sehr geehrte Damen und Herren,

ich nehme Bezug auf Ihr Schreiben.

Bitte erläutern Sie mir schriftlich die Grundlage Ihres Anliegens und übersenden Sie mir die dazugehörigen Nachweise.

Dieses Schreiben stellt kein Anerkenntnis einer Zahlungspflicht dar.

Ich bitte um schriftliche Rückmeldung.

Mit freundlichen Grüßen

[Unterschrift]`;
}
