
export async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes  = new Uint8Array(buffer);
  let binary   = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mediaType: file.type || "application/pdf" };
}

export function safeJsonParse(str) {
  try { return JSON.parse(String(str).trim()); }
  catch {
    try {
      const match = String(str).match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    } catch { return null; }
  }
}

export function extractTaggedSection(text, tag) {
  const start = `[${tag}]`;
  const end   = `[/${tag}]`;
  const si    = text.indexOf(start);
  const ei    = text.indexOf(end);
  if (si === -1 || ei === -1) return "";
  return text.substring(si + start.length, ei).trim();
}

export function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&",  "&amp;")
    .replaceAll("<",  "&lt;")
    .replaceAll(">",  "&gt;")
    .replaceAll('"',  "&quot;")
    .replaceAll("'",  "&#039;");
}
