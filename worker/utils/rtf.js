
import { extractTaggedSection } from "./files.js";

// German letter tag per type
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

function bulletLines(text) {
  return String(text || "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => `{\\pard\\sb0\\sa200\\fi-300\\li300\\f1\\fs22 \\bullet  ${rtfEscape(l.replace(/^- /, ""))}\\par}`)
    .join("\n");
}

// ── RTF header / footer ───────────────────────────────────────────────────────

function rtfHeader() {
  return `{\\rtf1\\ansi\\deff0\n{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}\n{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;}\n\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22\n`;
}

function rtfFooter(note) {
  return `{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i ${rtfEscape(note || DISCLAIMER_RTF)}\\par}\n}`;
}

// ── Analysis RTF ──────────────────────────────────────────────────────────────

export function makeAnalysisRtf(analysis, customerName, customerEmail, triage, type) {
  const title  = extractTaggedSection(analysis, "TITLE") || "MussIchZahlen Analyse";
  const amount = triage?.amount_claimed
    ? `\\u8364?${triage.amount_claimed}`
    : triage?.fine_amount ? `\\u8364?${triage.fine_amount}` : "unbekannt";

  return rtfHeader()
    + `{\\pard\\sb400\\sa200\\f1\\fs32\\b\\cf1 ${rtfEscape(title)}\\par}\n`
    + `{\\pard\\sb0\\sa100\\f1\\fs20\\cf0 Name: ${rtfEscape(customerName || "")} (${rtfEscape(customerEmail || "")})\\par}\n`
    + `{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 Typ: ${rtfEscape(type || "")} | Betrag: ${amount} | Risiko: ${rtfEscape(triage?.risk || "")}\\par}\n`
    + `{\\pard\\sb300\\sa120\\f1\\fs24\\b Zusammenfassung\\par}\n`
    + `{\\pard\\sa200\\f1\\fs22 ${rtfEscape(extractTaggedSection(analysis, "SUMMARY"))}\\par}\n`
    + `{\\pard\\sb300\\sa120\\f1\\fs24\\b Befunde\\par}\n`
    + bulletLines(extractTaggedSection(analysis, "ISSUES"))
    + `{\\pard\\sb300\\sa120\\f1\\fs24\\b Einsch\u00E4tzung\\par}\n`
    + `{\\pard\\sa200\\f1\\fs22 ${rtfEscape(extractTaggedSection(analysis, "ASSESSMENT"))}\\par}\n`
    + `{\\pard\\sb300\\sa120\\f1\\fs24\\b N\u00E4chste Schritte\\par}\n`
    + bulletLines(extractTaggedSection(analysis, "NEXT_STEPS"))
    + rtfFooter();
}

// ── Letter RTF ────────────────────────────────────────────────────────────────

export function makeLetterRtf(analysis, customerName, triage, type) {
  const tag    = LETTER_TAG[type]   || "WIDERSPRUCH";
  const title  = LETTER_TITLE[type] || "Schreiben";
  const sender = triage?.sender     || "unbekannt";

  return rtfHeader()
    + `{\\pard\\sb400\\sa200\\f1\\fs28\\b\\cf2 ${rtfEscape(title)}\\par}\n`
    + `{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 Erstellt f\u00FCr: ${rtfEscape(customerName || "")} | Absender: ${rtfEscape(sender)}\\par}\n`
    + `{\\pard\\sb300\\sa200\\f1\\fs22\\cf0 ${rtfEscape(extractTaggedSection(analysis, tag))}\\par}\n`
    + rtfFooter("Hinweis: Dies ist ein Entwurf und keine Rechtsberatung. MussIchZahlen haftet nicht f\u00FCr das Ergebnis.");
}
