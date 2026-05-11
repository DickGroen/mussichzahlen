// worker/config/types.js — mussichzahlen (DE)

const ALLOWED = new Set(["mahnung", "parkstrafe", "rechnung", "vertrag"]);

export const ALLOWED_TYPES = [...ALLOWED];

export const TYPE_CONFIG = {
  mahnung: {
    label:    "Mahnung / Inkasso",
    letter:   "Widerspruch",
    filename: "Widerspruch.rtf",
    price:    49,
    currency: "EUR"
  },
  parkstrafe: {
    label:    "Bußgeldbescheid",
    letter:   "Einspruchsschreiben",
    filename: "Einspruch.rtf",
    price:    19,
    currency: "EUR"
  },
  rechnung: {
    label:    "Rechnung",
    letter:   "Widerspruchsschreiben",
    filename: "Widerspruch.rtf",
    price:    29,
    currency: "EUR"
  },
  vertrag: {
    label:    "Vertrag / Kündigung",
    letter:   "Kündigungsschreiben",
    filename: "Kuendigungsschreiben.rtf",
    price:    29,
    currency: "EUR"
  }
};

export function requireType(type) {
  const t = String(type || "").trim().toLowerCase();
  if (!ALLOWED.has(t)) throw new Error(`Unbekannter Typ: ${t}`);
  return t;
}

export function isAllowedType(type) {
  return ALLOWED.has(String(type || "").trim().toLowerCase());
}

export function getTypeConfig(type) {
  return TYPE_CONFIG[type] || TYPE_CONFIG.mahnung;
}
