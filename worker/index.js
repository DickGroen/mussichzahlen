// worker/index.js

import { corsResponse, jsonResponse } from "./utils/response.js";

import { handleAnalyzeFree } from "./routes/analyze-free.js";
import { handleSubmitPaid } from "./routes/submit-paid.js";
import { handleCreateCheckout } from "./routes/create-checkout.js";
import { handleTrack } from "./routes/track.js";
import { handleCron } from "./routes/cron.js";
import { handleStripeWebhook } from "./routes/webhook.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── CORS ────────────────────────────────────────────────────────────────

    if (request.method === "OPTIONS") {
      return corsResponse();
    }

    // ── DEBUG ───────────────────────────────────────────────────────────────

    if (url.pathname === "/api/health") {
      return jsonResponse({
        ok: true,
        worker: "mussichzahlen",
        timestamp: new Date().toISOString(),
      });
    }

    // ── MANUAL CRON TEST ────────────────────────────────────────────────────

    if (
      url.pathname === "/api/test-cron" &&
      request.method === "GET"
    ) {
      try {
        await handleCron(env);

        return jsonResponse({
          ok: true,
          message: "Cron ran successfully",
        });
      } catch (err) {
        console.error("test-cron FAILED:", err);

        return jsonResponse(
          {
            ok: false,
            error: err?.message || "Cron failed",
          },
          500
        );
      }
    }

    // ── API ROUTES ──────────────────────────────────────────────────────────

    try {

      // STRIPE WEBHOOK
      if (
        url.pathname === "/api/stripe-webhook" &&
        request.method === "POST"
      ) {
        return await handleStripeWebhook(request, env);
      }

      // ANALYZE FREE
      if (
        url.pathname === "/api/analyze-free" &&
        request.method === "POST"
      ) {
        return await handleAnalyzeFree(request, env);
      }

      // CREATE CHECKOUT
      if (
        url.pathname === "/api/create-checkout" &&
        request.method === "POST"
      ) {
        return await handleCreateCheckout(request, env);
      }

      // TRACK EVENTS
      if (
        url.pathname === "/api/track" &&
        request.method === "POST"
      ) {
        return await handleTrack(request, env);
      }

      // SUBMIT PAID
      if (
        url.pathname === "/api/submit" &&
        request.method === "POST"
      ) {
        return await handleSubmitPaid(request, env);
      }

      // ── API NOT FOUND ────────────────────────────────────────────────────

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse(
          {
            ok: false,
            error: `API endpoint not found: ${url.pathname}`,
          },
          404
        );
      }

      // ── FALLBACK ─────────────────────────────────────────────────────────

      return new Response("Not found", {
        status: 404,
      });

    } catch (err) {
      console.error(
        "UNHANDLED WORKER ERROR:",
        err?.message,
        err?.stack
      );

      return jsonResponse(
        {
          ok: false,
          error: err?.message || "Internal server error",
        },
        500
      );
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  },
};
