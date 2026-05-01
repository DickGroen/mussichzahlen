
// worker/utils/types.js — mussichzahlen (DE/NL)

export const TYPE_MAP = {
  // DE
  mahnung:    "mahnung",
  parkstrafe: "parkstrafe",
  rechnung:   "rechnung",
  vertrag:    "vertrag",
  angebot:    "angebot",

  // NL → zelfde rechtssysteem, DE prompts
  schuld:      "mahnung",
  boete:       "parkstrafe",
  factuur:     "rechnung",
  abonnement:  "vertrag",
  offerte:     "angebot",
};

export const TYPE_LANG = {
  mahnung:    "de",
  parkstrafe: "de",
  rechnung:   "de",
  vertrag:    "de",
  angebot:    "de",
};

export function normalizeType(input) {
  if (!input) return null;
  return TYPE_MAP[String(input).toLowerCase().trim()] || null;
}

export function requireType(input) {
  const type = normalizeType(input);
  if (!type) throw new Error(`Unbekannter Typ: ${input}`);
  return type;
}

export function getLang(type) {
  return TYPE_LANG[type] || "de";
}
