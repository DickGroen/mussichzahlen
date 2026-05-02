const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

const ALLOWED_FUNNEL_TYPES = new Set([
  "debt",
  "parking",
  "bill",
  "subscription",
  "mahnung",
  "parkstrafe",
  "rechnung",
  "vertrag",
  "angebot"
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function validateEmail(email) {
  const value = String(email || "").trim();
  if (!value) throw new Error("Missing email address");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Invalid email address");
  return value.toLowerCase();
}

export function validateName(name) {
  const value = String(name || "").trim();
  if (!value) throw new Error("Missing name");
  if (value.length > 120) throw new Error("Name is too long");
  return value;
}

export function validateFunnelType(type) {
  const value = String(type || "").trim().toLowerCase();
  if (!ALLOWED_FUNNEL_TYPES.has(value)) throw new Error("Invalid funnel type");
  return value;
}

export function validateSessionId(sessionId) {
  const value = String(sessionId || "").trim();
  if (!value) throw new Error("Missing session_id");
  if (!value.startsWith("cs_live_") && !value.startsWith("cs_test_")) {
    throw new Error("Invalid session_id");
  }
  return value;
}

export function validateUploadFile(file) {
  if (!file || typeof file === "string") throw new Error("No file uploaded");
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("Unsupported file type. Upload PDF, JPG or PNG.");
  if (file.size > MAX_FILE_SIZE) throw new Error("File too large. Max 10MB.");
  if (file.size < 500) throw new Error("File appears to be empty or invalid.");
  return file;
}

export function validatePaidSubmitForm(formData) {
  const type      = validateFunnelType(formData.get("type"));
  const sessionId = validateSessionId(formData.get("session_id"));
  const name      = validateName(formData.get("name"));
  const email     = validateEmail(formData.get("email"));
  const file      = validateUploadFile(formData.get("file"));
  return { type, sessionId, name, email, file };
}

export function validateFreeSubmitForm(formData) {
  const type  = validateFunnelType(formData.get("type"));
  const name  = validateName(formData.get("name"));
  const email = validateEmail(formData.get("email"));
  const file  = validateUploadFile(formData.get("file"));
  return { type, name, email, file };
}

// Alias voor backwards compatibility met routes die validateUploadInput importeren
export const validateUploadInput = validatePaidSubmitForm;
