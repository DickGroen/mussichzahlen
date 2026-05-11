// worker/utils/rtf.js — mussichzahlen
import { extractTaggedSection } from "./files.js";

const LETTER_TAG = {
  mahnung:    "WIDERSPRUCH",
  parkstrafe: "EINSPRUCH",
  rechnung:   "WIDERSPRUCHSSCHREIBEN",
  vertrag:    "KUENDIGUNGSSCHREIBEN",
};

const LETTER_TITLE = {
  mahnung:    "Widerspruch",
  parkstrafe: "Einspruchsschreiben",
  rechnung:   "Widerspruchsschreiben",
  vertrag:    "K\u00FCndigungsschreiben",
};

const DISCLAIMER = "MussIchZahlen bietet informative Analysen \u2014 keine Rechtsberatung und keine anwaltliche Vertretung.";

// ── Escape helpers ────────────────────────────────────────────────────────────

export function rtfEscape(str) {
  return String(str || "")
    .replace(/\\/g,   "\\\\")
    .replace(/\{/g,   "\\{")
    .replace(/\}/g,   "\\}")
    .replace(/\n/g,   "\\par\n")
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
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g,     "$1")
    .replace(/^---+$/gm,       "")
    .replace(/^#{1,6}\s/gm,    "")
    .replace(/^\s*[-\u2022]\s*/gm, "")
    .trim();
}

function bulletLines(text) {
  return String(text || "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const cleaned = stripMarkdown(l.replace(/^[-\u2022]\s*/, ""));
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

// ── Confirmation RTF ──────────────────────────────────────────────────────────

export function makeConfirmationRtf(name) {
  return rtfHeader()
    + `{\\pard\\sb400\\sa200\\f1\\fs28\\b\\cf1 ${rtfEscape("Dein Schreiben ist eingegangen")}\\par}\n`
    + `{\\pard\\sb200\\sa200\\f1\\fs22\\cf3\\b ${rtfEscape("\u2713 Dein Schreiben ist eingegangen.")}\\par}\n`
    + `{\\pard\\sb200\\sa200\\f1\\fs22 ${rtfEscape("Hallo " + (name || "") + ",")}\\par}\n`
    + `{\\pard\\sa200\\f1\\fs22 ${rtfEscape("wir haben dein Dokument erhalten und werden es sorgf\u00e4ltig pr\u00fcfen. Du erh\u00e4ltst sp\u00e4testens am n\u00e4chsten Werktag bis 16:00 Uhr eine erste Einsch\u00e4tzung per E-Mail.")}\\par}\n`
    + `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("Was wir pr\u00fcfen")}\\par}\n`
    + `{\\pard\\sa200\\f1\\fs22 ${rtfEscape("Wir schauen uns dein Schreiben genau an und geben dir eine erste Einsch\u00e4tzung, ob es sinnvoll sein k\u00f6nnte, die Forderung vor einer Zahlung genauer pr\u00fcfen zu lassen.")}\\par}\n`
    + `{\\pard\\sb200\\sa200\\f1\\fs20\\cf0\\i ${rtfEscape("\u2192 Bitte pr\u00fcf auch deinen Spam-Ordner, falls du keine E-Mail erh\u00e4ltst.")}\\par}\n`
    + `{\\pard\\sb300\\sa100\\f1\\fs22 ${rtfEscape("Viele Gr\u00fc\u00dfe")}\\par}\n`
    + `{\\pard\\sa100\\f1\\fs22\\b ${rtfEscape("MussIchZahlen")}\\par}\n`
    + `{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i ${rtfEscape(DISCLAIMER)}\\par}\n}`;
}

// ── Analysis RTF ──────────────────────────────────────────────────────────────

export function makeAnalysisRtf(analysis, customerName, customerEmail, triage, type) {
  const title      = stripMarkdown(extractTaggedSection(analysis, "TITLE")      || "MussIchZahlen Analyse");
  const intro      = stripMarkdown(extractTaggedSection(analysis, "INTRO")      || "");
  const howToUse   = extractTaggedSection(analysis, "HOW_TO_USE") || "";
  const summary    = stripMarkdown(extractTaggedSection(analysis, "SUMMARY")    || "");
  const issues     = extractTaggedSection(analysis, "ISSUES")     || "";
  const assessment = stripMarkdown(extractTaggedSection(analysis, "ASSESSMENT") || "");
  const nextSteps  = extractTaggedSection(analysis, "NEXT_STEPS") || "";

  const amount = triage?.amount_claimed
    ? `\u20ac${triage.amount_claimed}`
    : triage?.fine_amount
      ? `\u20ac${triage.fine_amount}`
      : "unbekannt";

  let out = rtfHeader();

  out += `{\\pard\\sb400\\sa200\\f1\\fs32\\b\\cf1 ${rtfEscape(title)}\\par}\n`;
  out += `{\\pard\\sb0\\sa100\\f1\\fs20\\cf0 ${rtfEscape("Name: ")}${rtfEscape(customerName || "")} (${rtfEscape(customerEmail || "")})\\par}\n`;
  out += `{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 ${rtfEscape("Typ: ")}${rtfEscape(type || "")} | ${rtfEscape("Betrag: ")}${rtfEscape(amount)} | ${rtfEscape("Risiko: ")}${rtfEscape(triage?.risk || "")}\\par}\n`;

  if (intro) {
    out += `{\\pard\\sb200\\sa200\\f1\\fs22\\i ${rtfEscape(intro)}\\par}\n`;
  }

  out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("Zusammenfassung")}\\par}\n`;
  out += `{\\pard\\sa200\\f1\\fs22 ${rtfEscape(summary || "Keine Zusammenfassung verf\u00fcgbar.")}\\par}\n`;

  if (howToUse) {
    out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b\\cf4 ${rtfEscape("So verwendest du dieses Ergebnis")}\\par}\n`;
    out += numberedLines(howToUse);
  }

  if (issues) {
    out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("Befunde")}\\par}\n`;
    out += bulletLines(issues);
  }

  if (assessment) {
    out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("Einsch\u00e4tzung")}\\par}\n`;
    out += `{\\pard\\sa200\\f1\\fs22 ${rtfEscape(assessment)}\\par}\n`;
  }

  if (nextSteps) {
    out += `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${rtfEscape("N\u00e4chste Schritte")}\\par}\n`;
    out += bulletLines(nextSteps);
  }

  out += `{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i ${rtfEscape(DISCLAIMER)}\\par}\n}`;
  return out;
}

// ── Letter RTF ────────────────────────────────────────────────────────────────

export function makeLetterRtf(analysis, customerName, triage, type) {
  const tag    = LETTER_TAG[type]   || "WIDERSPRUCH";
  const title  = LETTER_TITLE[type] || "Schreiben";
  const sender = triage?.sender     || null;

  // Try primary tag, then common fallbacks
  const rawContent =
    extractTaggedSection(analysis, tag)                  ||
    extractTaggedSection(analysis, "LETTER")             ||
    extractTaggedSection(analysis, "ANTWORTSCHREIBEN")   ||
    extractTaggedSection(analysis, "SCHREIBEN")          ||
    "";

  const content = stripMarkdown(rawContent) || fallbackLetter(type, customerName, triage);

  return rtfHeader()
    + `{\\pard\\sb400\\sa200\\f1\\fs28\\b\\cf2 ${rtfEscape(title)}\\par}\n`
    + `{\\pard\\sb0\\sa80\\f1\\fs18\\cf0\\i ${rtfEscape("Bitte erg\u00e4nze deine pers\u00f6nlichen Angaben ([Ort], [Datum], Name, Adresse) und pr\u00fcfe das Schreiben vor dem Versand.")}\\par}\n`
    + `{\\pard\\sb300\\sa200\\f1\\fs22\\cf0 ${rtfEscape(content)}\\par}\n`
    + `{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i ${rtfEscape(DISCLAIMER)}\\par}\n}`;
}

// ── Fallback letters ──────────────────────────────────────────────────────────

function fallbackLetter(type, name, triage) {
  const sender = triage?.sender ? `an ${triage.sender}` : "an den Absender";
  const amount = triage?.amount_claimed ? ` \u00fcber einen Betrag von \u20ac${triage.amount_claimed}` : "";
  const ref    = triage?.reference || "[Aktenzeichen / Referenznummer]";

  if (type === "mahnung") {
    return `[Ort], [Datum]

${name || "[Dein Name]"}
[Deine Adresse]
[PLZ Ort]

${triage?.sender || "[Name des Absenders]"}
[Adresse des Absenders]

Betreff: Widerspruch gegen die Forderung, Aktenzeichen: ${ref}

Sehr geehrte Damen und Herren,

hiermit widerspreche ich der in Ihrem Schreiben${amount} geltend gemachten Forderung.

Ich bitte Sie, mir folgende Unterlagen schriftlich zuzusenden:

1. Eine vollst\u00e4ndige und nachvollziehbare Aufstellung der geltend gemachten Forderung.
2. Den Nachweis \u00fcber das Bestehen und die F\u00e4lligkeit der Forderung (z.\u00a0B. Originalvertrag, Rechnung).
3. Den Nachweis der Abtretung der Forderung sowie die Abtretungsanzeige gem\u00e4\u00df \u00a7\u00a0409 BGB, sofern Sie nicht der urspr\u00fcngliche Gl\u00e4ubiger sind.
4. Den Nachweis Ihrer Inkassobefugnis und Ihrer Registrierung gem\u00e4\u00df \u00a7\u00a02 Abs.\u00a02 RDGEG.

Ich weise darauf hin, dass ich mit diesem Schreiben keinerlei Verbindlichkeiten anerkenne.

Bitte teilen Sie mir Ihren Standpunkt schriftlich innerhalb von 14 Tagen mit.

Mit freundlichen Gr\u00fc\u00dfen,

${name || "[Dein Name]"}`;
  }

  // Generic fallback for other types
  return `[Ort], [Datum]

${name || "[Dein Name]"}
[Deine Adresse]
[PLZ Ort]

${triage?.sender || "[Name des Absenders]"}
[Adresse des Absenders]

Betreff: R\u00fcckfrage zu Ihrem Schreiben, Referenz: ${ref}

Sehr geehrte Damen und Herren,

vielen Dank f\u00fcr Ihr Schreiben${amount}. Ich bitte um eine schriftliche Erl\u00e4uterung und Belege zu den darin enthaltenen Angaben.

Bitte senden Sie mir innerhalb von 14 Tagen eine schriftliche Stellungnahme.

Ich weise darauf hin, dass dieses Schreiben kein Anerkenntnis der Forderung darstellt.

Mit freundlichen Gr\u00fc\u00dfen,

${name || "[Dein Name]"}`;
}
