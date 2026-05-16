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
  if (!s) return "";
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
    .replace(
      /Ich bitte Sie daher, mir innerhalb von 14 Tagen folgende Nachweise schriftlich vorzulegen:/gi,
      "Ich bitte Sie daher, mir die folgenden Nachweise schriftlich vorzulegen:"
    )
    .replace(
      /Ich bitte um eine schriftliche Stellungnahme innerhalb von 14 Tagen nach Eingang dieses Schreibens\./gi,
      "Ich bitte um eine schriftliche Stellungnahme."
    )
    .replace(/werde keine Zahlung leisten/gi, "werde eine Zahlung erst nach vollständiger Klärung prüfen")
    .replace(/keine Zahlung leisten/gi, "eine Zahlung erst nach vollständiger Klärung prüfen")
    .replace(/eindeutig rechtswidrig/gi, "möglicherweise problematisch")
    .replace(/rechtswidrig/gi, "möglicherweise problematisch")
    .replace(/unzulässig/gi, "möglicherweise nicht ausreichend begründet")
    .replace(/zweifelsfrei/gi, "nach erster Einschätzung")
    .replace(/garantiert/gi, "möglicherweise")
    .replace(/sicher gewinnen/gi, "die eigene Position besser einschätzen")
    .replace(/RDG(EG)?/gi, "Rechtsdienstleistungsregister")
    .replace(/Rechtsdienstleistungs-Gesetzesvormerkung/gi, "Rechtsdienstleistungsregister")
    .trim();
}

function removeDuplicateAddressBlocks(text = "") {
  let t = String(text || "").trim();

  t = t.replace(
    /Hinweis:\s*Bitte ergänzen Sie vor dem Versand[\s\S]*?\[Ihre E-Mail-Adresse, optional\]\s*/i,
    ""
  );

  t = t.replace(/Hinweis:\s*Bitte ergänzen Sie vor dem Versand[^\n]*\n?/gi, "");

  t = t.replace(
    /\[Ihr vollständiger Name\]\s*\n\[Ihre Anschrift\]\s*\n\[Ihre E-Mail-Adresse, optional\]\s*/i,
    ""
  );

  t = t.replace(/\[Ihr vollständiger Name\]\s*\n\[Ihre Anschrift\]\s*/i, "");
  t = t.replace(/\[Ihr Name\]\s*\n\[Ihre Adresse\]\s*\n\[PLZ Ort\]\s*/i, "");
  t = t.replace(/\[Ihr Name\]\s*\n\[Ihre Adresse\]\s*/i, "");

  t = t.replace(/\[Ort\],?\s*\[Datum\]\s*\n?/gi, "");
  t = t.replace(/\[Datum\]\s*\n?/gi, "");
  t = t.replace(/\[PLZ Ort\]\s*\n?/gi, "");
  t = t.replace(/\[Unterschrift\]\s*\n?/gi, "");

  t = t.replace(/^\s*,\s*$/gm, "");

  return t.trim();
}

function stripTrailingDisclaimer(text = "") {
  return String(text)
    .replace(/\n*(Dies ist eine informative Analyse[^\n]*\n?)+$/i, "")
    .replace(/\n*(Diese Einschätzung stellt keine Rechtsberatung[^\n]*\n?)+$/i, "")
    .replace(/\n*(Dieses Schreiben wurde automatisch[^\n]*\n?)+$/i, "")
    .replace(/\n*(MussIchZahlen[^\n]*keine Rechtsberatung[^\n]*\n?)+$/i, "")
    .replace(/\n*Bitte richten Sie (alle |zukünftige |weitere )?Korrespondenz[^\n]*\n?/gi, "")
    .replace(/\n*Bitte senden Sie (alle |weitere )?Schreiben[^\n]*\n?/gi, "")
    .replace(/\n*\[Ihr vollständiger Name\][^\n]*\n?/gi, "")
    .replace(/\n*\[Ihre Anschrift\][^\n]*\n?/gi, "")
    .replace(/\n*\[Ihre E-Mail-Adresse[^\n]*\]\n?/gi, "")
    .replace(/\n*\[Ihr Name\][^\n]*\n?/gi, "")
    .replace(/\n*\[Ihre Adresse\][^\n]*\n?/gi, "")
    .replace(/\n*\[PLZ Ort\]\n?/gi, "")
    .replace(/\n*\[Ort\], \[Datum\]\n?/gi, "")
    .replace(/\n*\[Datum\]\n?/gi, "")
    .replace(/\n*\[Unterschrift\]\n?/gi, "")
    .replace(/\n*Ich freue mich auf Ihre (baldige )?Antwort\.?\n?/gi, "")
    .replace(/\n*Ich erwarte Ihre (baldige )?Antwort\.?\n?/gi, "")
    .trim();
}

function getSection(analysis, tag) {
  return sanitizeLegalTone(stripMarkdown(extractTaggedSection(analysis, tag) || ""));
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
  return stripTrailingDisclaimer(
    sanitizeLegalTone(
      removeDuplicateAddressBlocks(
        stripMarkdown(text)
          .replace(/\[\/?\w+\]/g, "")
          .trim()
      )
    )
  );
}
function rtfHeader() {
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;\\red34\\green139\\blue34;\\red180\\green140\\blue0;\\red245\\green248\\blue255;\\red235\\green238\\blue245;}
\\paperw11906\\paperh16838\\margl1700\\margr1700\\margt1320\\margb1320
\\f1\\fs22
`;
}

function rtfFooter(note = DISCLAIMER_RTF) {
  return `
{\\pard\\sb520\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\f1\\fs18\\cf0\\par}
{\\pard\\sb120\\sa0\\f1\\fs16\\cf0\\i ${rtfEscape(note)}\\i0\\par}
}`;
}

function paragraph(text = "", spacing = 180) {
  if (!text) return "";
  return `{\\pard\\sb0\\sa${spacing}\\f1\\fs22 ${rtfEscape(text)}\\par}\n`;
}

function smallParagraph(text = "", spacing = 120) {
  if (!text) return "";
  return `{\\pard\\sb0\\sa${spacing}\\f1\\fs19\\cf0 ${rtfEscape(text)}\\par}\n`;
}

function heading(text = "") {
  if (!text) return "";
  return `{\\pard\\sb380\\sa140\\f1\\fs26\\b\\cf1 ${rtfEscape(text)}\\b0\\cf0\\par}\n`;
}

function subHeading(text = "") {
  if (!text) return "";
  return `{\\pard\\sb240\\sa100\\f1\\fs23\\b\\cf0 ${rtfEscape(text)}\\b0\\par}\n`;
}

function infoBox(title = "", text = "") {
  if (!title && !text) return "";

  return `
{\\pard\\sb220\\sa80\\li260\\ri260\\brdrl\\brdrs\\brdrw45\\brsp120\\f1\\fs22\\cf1\\b ${rtfEscape(title)}\\b0\\cf0\\par}
{\\pard\\sb0\\sa240\\li260\\ri260\\brdrl\\brdrs\\brdrw45\\brsp120\\f1\\fs21 ${rtfEscape(text)}\\par}
`;
}

function badgeLine(label = "", value = "") {
  if (!label && !value) return "";
  return `{\\pard\\sb0\\sa80\\f1\\fs20\\cf0\\b ${rtfEscape(label)}\\b0 ${rtfEscape(value)}\\par}\n`;
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
        `{\\pard\\sb0\\sa130\\fi-300\\li360\\f1\\fs22 \\bullet  ${rtfEscape(
          sanitizeLegalTone(line)
        )}\\par}`
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
        `{\\pard\\sb0\\sa145\\fi-360\\li420\\f1\\fs22 ${index + 1}.  ${rtfEscape(
          sanitizeLegalTone(line)
        )}\\par}`
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

  if (
    text.includes("gbp") ||
    text.includes("pfund") ||
    text.includes("pound") ||
    text.includes("£")
  ) {
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

function assessmentBadge(risk) {
  if (risk === "high") return "Mehrere Punkte prüfenswert";
  if (risk === "medium") return "Einzelne Punkte prüfenswert";
  if (risk === "low") return "Eher geringe Auffälligkeiten";
  return "Erste Prüfung abgeschlossen";
}

function buildSpecificityParagraph(triage = {}) {
  const sender = triage?.sender || "dem Absender";
  const amount = formatAmount(triage);

  const parts = [];

  if (sender !== "unbekannt" && amount !== "unbekannt") {
    parts.push(
      `Im vorliegenden Schreiben von ${sender} über ${amount} sollten insbesondere die Zusammensetzung der Forderung, mögliche Zusatzkosten und die vorhandenen Nachweise nachvollziehbar geprüft werden.`
    );
  } else if (sender !== "unbekannt") {
    parts.push(
      `Im vorliegenden Schreiben von ${sender} sollten insbesondere die Zusammensetzung der Forderung, mögliche Zusatzkosten und die vorhandenen Nachweise nachvollziehbar geprüft werden.`
    );
  } else if (amount !== "unbekannt") {
    parts.push(
      `Bei der geltend gemachten Forderung über ${amount} sollten insbesondere die Zusammensetzung der Forderung, mögliche Zusatzkosten und die vorhandenen Nachweise nachvollziehbar geprüft werden.`
    );
  } else {
    parts.push(
      "Bei diesem Schreiben sollten insbesondere die Zusammensetzung der Forderung, mögliche Zusatzkosten und die vorhandenen Nachweise nachvollziehbar geprüft werden."
    );
  }

  parts.push(
    "Gerade bei Inkasso- oder Mahnschreiben ist wichtig, ob die Hauptforderung, Nebenkosten, Mahnkosten und Inkassokosten ausreichend erklärt und belegt sind."
  );

  return parts.join(" ");
}

function buildDefaultNarrative(triage = {}) {
  const sender = triage?.sender || "dem Absender";
  const amount = formatAmount(triage);

  if (sender !== "unbekannt" && amount !== "unbekannt") {
    return `Nach erster Prüfung wirkt das Schreiben von ${sender} über ${amount} nicht in allen Punkten selbsterklärend. Vor einer Zahlung kann es sinnvoll sein, zunächst die Forderungsgrundlage, die Berechnung einzelner Kostenpositionen und vorhandene Nachweise zu prüfen.`;
  }

  if (amount !== "unbekannt") {
    return `Nach erster Prüfung wirkt die Forderung über ${amount} nicht in allen Punkten selbsterklärend. Vor einer Zahlung kann es sinnvoll sein, zunächst die Forderungsgrundlage, die Berechnung einzelner Kostenpositionen und vorhandene Nachweise zu prüfen.`;
  }

  return "Nach erster Prüfung wirkt das Schreiben nicht in allen Punkten selbsterklärend. Vor einer Zahlung kann es sinnvoll sein, zunächst die Forderungsgrundlage, die Berechnung einzelner Kostenpositionen und vorhandene Nachweise zu prüfen.";
}

function defaultIssuesForType(type = "mahnung") {
  if (type === "mahnung") {
    return [
      "ob die ursprüngliche Forderung ausreichend belegt ist",
      "ob zusätzliche Mahn- oder Inkassokosten nachvollziehbar berechnet wurden",
      "ob der Absender seine Berechtigung zur Geltendmachung der Forderung ausreichend darlegt",
      "ob Zahlungsfristen, Aktenzeichen und Forderungsbestandteile klar zugeordnet werden können",
    ].join("\n");
  }

  if (type === "parkstrafe") {
    return [
      "ob der behauptete Verstoß ausreichend dokumentiert ist",
      "ob Fotos, Zeitangaben und Kennzeichenangaben nachvollziehbar sind",
      "ob zusätzliche Gebühren verständlich begründet werden",
      "ob die Zahlungsaufforderung formal und inhaltlich nachvollziehbar ist",
    ].join("\n");
  }

  if (type === "rechnung") {
    return [
      "ob die berechneten Leistungen oder Waren klar beschrieben sind",
      "ob Preisbestandteile und Zusatzkosten nachvollziehbar sind",
      "ob eine vertragliche Grundlage erkennbar ist",
      "ob Zahlungsziel und Mahnkosten korrekt erläutert werden",
    ].join("\n");
  }

  if (type === "vertrag") {
    return [
      "welche Vertragslaufzeit genannt wird",
      "ob Kündigungsfristen verständlich dargestellt sind",
      "ob automatische Verlängerungen oder Zusatzkosten erkennbar sind",
      "ob offene Beträge nachvollziehbar begründet werden",
    ].join("\n");
  }

  return [
    "ob die Kostenpositionen nachvollziehbar sind",
    "ob Leistungsumfang und Bedingungen klar beschrieben werden",
    "ob zusätzliche Kosten oder Einschränkungen ausreichend erläutert werden",
    "ob eine schriftliche Rückfrage vor Annahme sinnvoll ist",
  ].join("\n");
}

export function makeConfirmationRtf(name = "") {
  const customer = capitalizeFirst(name || "Kunde");

  return (
    rtfHeader() +
    `{\\pard\\sb400\\sa160\\f1\\fs30\\b\\cf1 ${rtfEscape(
      "Ihr Schreiben ist eingegangen"
    )}\\b0\\cf0\\par}\n` +
    paragraph(`Guten Tag ${customer},`) +
    paragraph(
      "wir haben Ihr Dokument erhalten und werden es sorgfältig prüfen. Sie erhalten spätestens am nächsten Werktag bis 16:00 Uhr eine erste Einschätzung per E-Mail."
    ) +
    infoBox(
      "Was wir prüfen",
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
  const narrative =
    getSection(analysis, "NARRATIVE") ||
    getSection(analysis, "FALLBEWERTUNG") ||
    buildDefaultNarrative(triage);
  const howToUse = getSection(analysis, "HOW_TO_USE");
  const summary = getSection(analysis, "SUMMARY");
  const issues = getSection(analysis, "ISSUES") || defaultIssuesForType(type);
  const assessment = getSection(analysis, "ASSESSMENT");
  const nextSteps = getSection(analysis, "NEXT_STEPS");

  const amount = formatAmount(triage);
  const sender = triage?.sender || "unbekannt";
  const risk = riskLabel(triage?.risk);
  const badge = assessmentBadge(triage?.risk);
  const dateStr = new Date().toLocaleDateString("de-DE");
  const cleanName = capitalizeFirst(customerName || "");

  let out = rtfHeader();

  out += `{\\pard\\sb360\\sa120\\f1\\fs34\\b\\cf1 ${rtfEscape(title)}\\b0\\cf0\\par}\n`;

  if (cleanName || customerEmail) {
    out += `{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 ${rtfEscape(cleanName)} ${
      customerEmail ? `(${rtfEscape(customerEmail)})` : ""
    }\\par}\n`;
  }

  out += `{\\pard\\sb0\\sa260\\f1\\fs20\\cf0 ${rtfEscape(
    `Typ: ${type} | Betrag: ${amount} | Einschätzung: ${risk} | Datum: ${dateStr}`
  )}\\par}\n`;

  out += infoBox(
    "Erste Einschätzung",
    `${badge}. Diese Analyse dient dazu, die Forderung besser einzuordnen und vor einer Zahlung gezielt zu prüfen, welche Punkte nachvollziehbar belegt sind.`
  );

  out += heading("Fallübersicht");
  out += badgeLine("Absender: ", sender);
  out += badgeLine("Betrag: ", amount);
  out += badgeLine("Status der Prüfung: ", badge);

  out += heading("Fallbewertung");
  out += paragraph(buildSpecificityParagraph(triage));

  if (intro) {
    out += paragraph(intro);
  }

  if (narrative) {
    out += paragraph(narrative);
  }

  if (summary) {
    out += heading("Erste Einschätzung");
    out += paragraph(summary);
  }

  if (issues) {
    out += heading("Was derzeit auffällt");
    out += bulletLines(issues) || paragraph(issues);
  }

  if (assessment) {
    out += heading("Warum eine Prüfung sinnvoll sein kann");
    out += paragraph(assessment);
  } else {
    out += heading("Warum eine Prüfung sinnvoll sein kann");
    out += paragraph(
      "Vor allem bei höheren Forderungsbeträgen, zusätzlichen Inkassokosten oder fehlenden Nachweisen kann eine Prüfung helfen, vorschnelle Zahlungen zu vermeiden und die eigene Position besser einzuschätzen."
    );
  }

  if (nextSteps) {
    out += heading("Mögliche nächste Schritte");
    out += numberedLines(nextSteps) || bulletLines(nextSteps) || paragraph(nextSteps);
  } else {
    out += heading("Mögliche nächste Schritte");
    out += numberedLines(
      [
        "Bewahren Sie das Schreiben und alle Anlagen sorgfältig auf.",
        "Prüfen Sie, ob Vertragsgrundlagen, Rechnungen oder frühere Mahnungen vorhanden sind.",
        "Zahlen Sie nicht vorschnell, wenn Forderungsbestandteile oder Zusatzkosten unklar bleiben.",
        "Nutzen Sie das beigefügte Antwortschreiben, um Nachweise und eine nachvollziehbare Aufstellung anzufordern.",
      ].join("\n")
    );
  }

  if (howToUse) {
    out += heading("So verwenden Sie dieses Ergebnis");
    out += numberedLines(howToUse) || paragraph(howToUse);
  } else {
    out += heading("So verwenden Sie dieses Ergebnis");
    out += numberedLines(
      [
        "Lesen Sie die Fallbewertung und markieren Sie Punkte, die Sie selbst nicht nachvollziehen können.",
        "Ergänzen Sie im Antwortschreiben Ihre persönlichen Angaben, Aktenzeichen und Datum.",
        "Senden Sie das Antwortschreiben nach Möglichkeit so, dass Sie den Versand später nachweisen können.",
        "Bewahren Sie eine Kopie des Schreibens und aller Antworten auf.",
      ].join("\n")
    );
  }

  out += infoBox(
    "Hinweis zum beigefügten Schreiben",
    "Das beigefügte Schreiben ist als sachliche Antwort formuliert. Es soll helfen, Nachweise anzufordern und die Forderung zu klären, ohne vorschnell eine Zahlungspflicht anzuerkennen."
  );

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

  out += `{\\pard\\sb360\\sa160\\f1\\fs30\\b\\cf2 ${rtfEscape(title)}\\b0\\cf0\\par}\n`;
  out += `{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 ${rtfEscape(`Erstellt für: ${cleanName}`)}\\par}\n`;
  out += `{\\pard\\sb0\\sa260\\f1\\fs20\\cf4\\i ${rtfEscape(
    "Bitte ergänzen Sie Ihre persönlichen Angaben, Datum, Adresse und Aktenzeichen vor dem Versand."
  )}\\i0\\cf0\\par}\n`;

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

  return out + "}";
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

  return `Betreff: Bitte um Klärung und Nachweise zu Ihrer Forderung

Sehr geehrte Damen und Herren,

ich nehme Bezug auf Ihr Schreiben bezüglich der von Ihnen geltend gemachten Forderung${
    amount !== "unbekannt" ? ` in Höhe von ${amount}` : ""
  }.

Derzeit kann ich die Forderung auf Grundlage Ihres Schreibens nicht vollständig nachvollziehen. Das betrifft insbesondere die Grundlage der Forderung, die Zusammensetzung des geforderten Betrags und etwaige zusätzliche Mahn- oder Inkassokosten.

Ich bitte Sie daher, mir die folgenden Nachweise schriftlich vorzulegen:

1. eine Kopie des ursprünglichen Vertrags, der Rechnung oder der sonstigen Grundlage der Forderung,
2. eine vollständige und nachvollziehbare Aufstellung des geforderten Betrags,
3. eine Erläuterung, wie Mahnkosten, Inkassokosten oder sonstige Zusatzkosten berechnet wurden,
4. einen Nachweis Ihrer Berechtigung, diese Forderung geltend zu machen,
5. das Datum, an dem die Forderung erstmals fällig geworden sein soll.

Bis zur vollständigen Klärung werde ich eine Zahlung erst nach Prüfung der Unterlagen in Betracht ziehen.

Dieses Schreiben stellt kein Anerkenntnis einer Zahlungspflicht dar.

Ich bitte um schriftliche Antwort.

Mit freundlichen Grüßen

[Unterschrift]`;
}

function fallbackParkstrafeLetter() {
  return `Betreff: Bitte um Klärung der Zahlungsaufforderung / vorsorglicher Einspruch

Sehr geehrte Damen und Herren,

ich nehme Bezug auf Ihr Schreiben.

Derzeit kann ich den geltend gemachten Betrag und die Grundlage der Zahlungsaufforderung nicht vollständig nachvollziehen. Ich lege daher vorsorglich Einspruch ein und bitte um eine schriftliche Klärung.

Bitte übersenden Sie mir insbesondere:

1. eine genaue Beschreibung des behaupteten Verstoßes,
2. vorhandene Fotos oder sonstige Nachweise,
3. Angaben zu Datum, Uhrzeit und Ort,
4. eine nachvollziehbare Aufstellung des geforderten Betrags,
5. eine Erläuterung etwaiger Zusatzkosten.

Dieses Schreiben stellt kein Anerkenntnis einer Zahlungspflicht dar.

Ich bitte um schriftliche Antwort.

Mit freundlichen Grüßen

[Unterschrift]`;
}

function fallbackRechnungLetter() {
  return `Betreff: Bitte um Klärung Ihrer Rechnung

Sehr geehrte Damen und Herren,

ich nehme Bezug auf Ihre Rechnung.

Derzeit kann ich die Rechnung nicht vollständig nachvollziehen. Bitte übersenden Sie mir eine genaue Aufstellung der berechneten Positionen sowie die vertragliche Grundlage der Forderung.

Bis zur Klärung werde ich eine Zahlung erst nach Prüfung der Unterlagen in Betracht ziehen.

Dieses Schreiben stellt kein Anerkenntnis einer Zahlungspflicht dar.

Ich bitte um schriftliche Rückmeldung.

Mit freundlichen Grüßen

[Unterschrift]`;
}
function fallbackVertragLetter() {
  return `Betreff: Bitte um Klärung / Kündigung des Vertragsverhältnisses

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

Derzeit kann ich Ihr Anliegen auf Grundlage des Schreibens nicht vollständig nachvollziehen. Bitte erläutern Sie mir schriftlich die Grundlage Ihres Anliegens und übersenden Sie mir die dazugehörigen Nachweise.

Dieses Schreiben stellt kein Anerkenntnis einer Zahlungspflicht dar.

Ich bitte um schriftliche Rückmeldung.

Mit freundlichen Grüßen

[Unterschrift]`;
}
