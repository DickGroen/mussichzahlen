import { extractTaggedSection } from "./files.js";

const LETTER_TAG = {
  mahnung:    "WIDERSPRUCH",
  parkstrafe: "EINSPRUCH",
  rechnung:   "WIDERSPRUCHSSCHREIBEN",
  vertrag:    "KUENDIGUNGSSCHREIBEN"
};

const LETTER_TITLE = {
  mahnung:    "Widerspruch",
  parkstrafe: "Einspruchsschreiben",
  rechnung:   "Widerspruchsschreiben",
  vertrag:    "K\u00FCndigungsschreiben"
};

const DISCLAIMER_RTF = "Hinweis: Dies ist eine informative Analyse und keine Rechtsberatung. Wir \u00FCbernehmen keine rechtliche Vertretung. Bei komplexen F\u00E4llen empfehlen wir die Verbraucherzentrale oder einen Anwalt.";

// ── Escape helpers ────────────────────────────────────────────────────────────

export function rtfEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\par\n")
    .replace(/[^\x00-\x7F]/g, c => `\\u${c.charCodeAt(0)}?`);
}

export function rtfToBase64(rtfString) {
  const bytes = new TextEncoder().encode(rtfString);
  let binary  = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── Markdown stripper ─────────────────────────────────────────────────────────

function stripMarkdown(str) {
  return String(str || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")   // **bold** → bold
    .replace(/\*(.+?)\*/g, "$1")        // *italic* → italic
    .replace(/^---+$/gm, "")            // --- scheidingslijnen
    .replace(/^#{1,6}\s/gm, "")         // ## headers
    .replace(/^\s*[-•]\s*/gm, "")       // leading bullets (worden apart behandeld)
    .trim();
}

function bulletLines(text) {
  return String(text || "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const cleaned = stripMarkdown(l.replace(/^[-•]\s*/, ""));
      return `{\\pard\\sb0\\sa200\\fi-300\\li300\\f1\\fs22 \\bullet  ${rtfEscape(cleaned)}\\par}`;
    })
    .join("\n");
}

function numberedLines(text) {
  let i = 0;
  return String(text || "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      i++;
      const cleaned = stripMarkdown(l.replace(/^\d+\.\s*/, ""));
      return `{\\pard\\sb0\\sa160\\fi-300\\li300\\f1\\fs22 ${i}.  ${rtfEscape(cleaned)}\\par}`;
    })
    .join("\n");
}

function rtfHeader() {
  return `{\\rtf1\\ansi\\deff0\n{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}\n{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;\\red34\\green197\\blue94;\\red245\\green158\\blue11;}\n\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22\n`;
}

function rtfFooter(note) {
  return `{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i ${rtfEscape(note || DISCLAIMER_RTF)}\\par}\n}`;
}

// ── Confirmation RTF ──────────────────────────────────────────────────────────

export function makeConfirmationRtf(name) {
  return rtfHeader()
    + `{\\pard\\sb400\\sa200\\f1\\fs28\\b\\cf1 ${rtfEscape("Eingangsbestätigung")}\\par}\n`
    + `{\\pard\\sb200\\sa200\\f1\\fs22\\cf3\\b ${rtfEscape("\u2713 Ihr Schreiben ist eingegangen.")}\\par}\n`
    + `{\\pard\\sb200\\sa200\\f1\\fs22 ${rtfEscape("Sehr geehrte/r " + (name || "Nutzer/in") + ",")}\\par}\n`
    + `{\\pard\\sa200\\f1\\fs22 ${rtfEscape("wir haben Ihr Dokument erhalten und werden es sorgf\u00E4ltig pr\u00FCfen. Sie erhalten sp\u00E4testens am n\u00E4chsten Werktag bis 16:00 Uhr eine erste Einsch\u00E4tzung per E-Mail.")}\\par}\n`
    + `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("Warum das wichtig ist")}\\par}\n`
    + `{\\pard\\sa200\\f1\\fs22 ${rtfEscape("Bei Zahlungserinnerungen und Mahnschreiben k\u00F6nnen Fristen und zus\u00E4tzliche Kosten entstehen, wenn Sie nicht rechtzeitig reagieren. Unsere Einsch\u00E4tzung kl\u00E4rt, ob Handlungsbedarf besteht.")}\\par}\n`
    + `{\\pard\\sb200\\sa200\\f1\\fs20\\cf0\\i ${rtfEscape("\u2192 Bitte pr\u00FCfen Sie auch Ihren Spam-Ordner, falls Sie keine E-Mail erhalten.")}\\par}\n`
    + `{\\pard\\sb300\\sa100\\f1\\fs22 ${rtfEscape("Vielen Dank f\u00FCr Ihr Vertrauen.")}\\par}\n`
    + `{\\pard\\sa100\\f1\\fs22 ${rtfEscape("Ihr Pr\u00FCfdienst")}\\par}\n`
    + rtfFooter();
}

// ── Analysis RTF ──────────────────────────────────────────────────────────────

export function makeAnalysisRtf(analysis, customerName, customerEmail, triage, type) {
  const title      = stripMarkdown(extractTaggedSection(analysis, "TITLE")       || "MussIchZahlen Analyse");
  const intro      = stripMarkdown(extractTaggedSection(analysis, "INTRO")       || "");
  const howToUse   = extractTaggedSection(analysis, "HOW_TO_USE") || "";
  const summary    = stripMarkdown(extractTaggedSection(analysis, "SUMMARY")     || "");
  const issues     = extractTaggedSection(analysis, "ISSUES")     || "";
  const assessment = stripMarkdown(extractTaggedSection(analysis, "ASSESSMENT")  || "");
  const nextSteps  = extractTaggedSection(analysis, "NEXT_STEPS") || "";

  const amount = triage?.amount_claimed
    ? `\\u8364?${triage.amount_claimed}`
    : triage?.fine_amount ? `\\u8364?${triage.fine_amount}` : "unbekannt";

  let out = rtfHeader();

  out += `{\\pard\\sb400\\sa200\\f1\\fs32\\b\\cf1 ${rtfEscape(title)}\\par}\n`;
  out += `{\\pard\\sb0\\sa100\\f1\\fs20\\cf0 ${rtfEscape("Name: ")}${rtfEscape(customerName || "")} (${rtfEscape(customerEmail || "")})\\par}\n`;
  out += `{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 ${rtfEscape("Typ: ")}${rtfEscape(type || "")} | ${rtfEscape("Betrag: ")}${amount} | ${rtfEscape("Risiko: ")}${rtfEscape(triage?.risk || "")}\\par}\n`;

  if (intro) {
    out += `{\\pard\\sb200\\sa200\\f1\\fs22\\i ${rtfEscape(intro)}\\par}\n`;
  }

  out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("Zusammenfassung")}\\par}\n`;
  out += `{\\pard\\sa200\\f1\\fs22 ${rtfEscape(summary)}\\par}\n`;

  if (howToUse) {
    out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b\\cf4 ${rtfEscape("So verwenden Sie dieses Ergebnis")}\\par}\n`;
    out += numberedLines(howToUse);
  }

  out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("Befunde")}\\par}\n`;
  out += bulletLines(issues);

  out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("Einsch\u00E4tzung")}\\par}\n`;
  out += `{\\pard\\sa200\\f1\\fs22 ${rtfEscape(assessment)}\\par}\n`;

  out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("N\u00E4chste Schritte")}\\par}\n`;
  out += bulletLines(nextSteps);

  out += rtfFooter();
  return out;
}

// ── Letter RTF ────────────────────────────────────────────────────────────────

export function makeLetterRtf(analysis, customerName, triage, type) {
  const tag     = LETTER_TAG[type]   || "WIDERSPRUCH";
  const title   = LETTER_TITLE[type] || "Schreiben";
  const sender  = triage?.sender     || "unbekannt";
  const content = stripMarkdown(extractTaggedSection(analysis, tag) || "");

  return rtfHeader()
    + `{\\pard\\sb400\\sa200\\f1\\fs28\\b\\cf2 ${rtfEscape(title)}\\par}\n`
    + `{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 ${rtfEscape("Erstellt f\u00FCr: ")}${rtfEscape(customerName || "")} | ${rtfEscape("Absender: ")}${rtfEscape(sender)}\\par}\n`
    + `{\\pard\\sb0\\sa300\\f1\\fs20\\cf4\\i ${rtfEscape("Bitte erg\u00E4nzen Sie Ihre pers\u00F6nlichen Angaben ([Ort], [Datum], Name, Adresse) und pr\u00FCfen Sie das Schreiben vor dem Versand.")}\\par}\n`
    + `{\\pard\\sb300\\sa200\\f1\\fs22\\cf0 ${rtfEscape(content)}\\par}\n`
    + rtfFooter("Hinweis: Dies ist ein Entwurf und keine Rechtsberatung. MussIchZahlen haftet nicht f\u00FCr das Ergebnis.");
}
