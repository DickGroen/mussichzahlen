import { corsResponse, jsonResponse } from "./utils/response.js";
import { handleAnalyzeFree } from "./routes/analyze-free.js";
import { handleSubmitPaid } from "./routes/submit-paid.js";
import { handleCron } from "./routes/cron.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return corsResponse();
    const url = new URL(request.url);
    if (request.method !== "POST") {
      return new Response("Nicht gefunden", { status: 404 });
    }
    try {
      switch (url.pathname) {
        case "/api/analyze-free": return await handleAnalyzeFree(request, env);
        case "/api/submit":       return await handleSubmitPaid(request, env);
        default:                  return jsonResponse({ ok: false, error: "Unbekannter Endpunkt" }, 404);
      }
    } catch (err) {
      console.error("Unbehandelter Fehler:", err.message, err.stack);
      return jsonResponse({ ok: false, error: "Interner Serverfehler" }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  }
};
