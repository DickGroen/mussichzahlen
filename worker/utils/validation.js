
export const ALLOWED_TYPES   = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
export const MAX_FILE_SIZE   = 8 * 1024 * 1024; // 8 MB
export const VALID_CATEGORIES = ["mahnung", "parkstrafe", "rechnung", "vertrag"];

export function validateUploadInput({ file, name, email, type }) {
  if (!file)
    return "Keine Datei empfangen";
  if (file.size > MAX_FILE_SIZE)
    return `Datei zu gro\u00DF (max. 8 MB, deine Datei: ${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  if (!ALLOWED_TYPES.includes(file.type))
    return `Dateityp nicht erlaubt (${file.type}). Bitte PDF, JPG oder PNG verwenden.`;
  if (!name || !String(name).trim())
    return "Name ist erforderlich";
  if (!email || !String(email).includes("@") || !String(email).includes("."))
    return "Ung\u00FCltige E-Mail-Adresse";
  if (!type || !VALID_CATEGORIES.includes(type))
    return `Ung\u00FCltiger Typ. Erlaubt: ${VALID_CATEGORIES.join(", ")}`;
  return null;
}
