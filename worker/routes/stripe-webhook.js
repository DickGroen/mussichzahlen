// worker/routes/stripe-webhook.js — mussichzahlen

import { jsonResponse } from "../utils/response.js";
import { getFreeCase, markPaid, enqueuePaid } from "../services/queue.js";
import { notifyAdminPaid, sendPaidEmail } from "../services/resend.js";
import { runAnalysis } from "../services/claude.js";
import { loadPrompts } from "../config/prompts.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function trackEvent(env, event, data = {}) {
  try {
    const id = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;

    await env.SESSIONS_KV.put(
      key,
      JSON.stringify({
        event,
        ...data,
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

async function hasAnalysisBeenSent(env, sessionId) {
  const key = `analysis_sent:${sessionId}`;
  const val = await env.SESSIONS_KV.get(key);
  return val === "1";
}

async function markAnalysisSent(env, sessionId) {
  const key = `analysis_sent:${sessionId}`;
  await env.SESSIONS_KV.put(key, "1", {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}

// ── Webhook handler ───────────────────────────────────────────────────────────

export async function handleStripeWebhook(request, env) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return jsonResponse({ ok: false, error: "Missing Stripe signature" }, 400);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return jsonResponse({ ok: false, error: "Unable to read webhook body" }, 400);
  }

  let event;
  try {
    event = await verifyStripeWebhook(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Invalid webhook signature:", err.message);
    return jsonResponse({ ok: false, error: "Invalid webhook signature" }, 400);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.payment_status !== "paid") {
          console.log("Session not paid yet:", session.id);
          break;
        }

        if (await hasAnalysisBeenSent(env, session.id)) {
          console.log("Duplicate webhook — already processed:", session.id);
          break;
        }

        const email =
          session.metadata?.email ||
          session.customer_details?.email ||
          session.customer_email ||
          null;

        const name =
          session.metadata?.name ||
          session.customer_details?.name ||
          "Kunde";

        const rawType =
          session.metadata?.type ||
          session.client_reference_id ||
          "mahnung";

        const allowedTypes = [
          "mahnung",
          "parkstrafe",
          "rechnung",
          "vertrag",
          "angebot",
        ];

        const type = allowedTypes.includes(String(rawType).trim().toLowerCase())
          ? String(rawType).trim().toLowerCase()
          : "mahnung";

        console.log("WEBHOOK PAID:", {
          session_id: session.id,
          email,
          type,
          payment_status: session.payment_status,
        });

        await trackEvent(env, "payment_success", {
          type,
          email,
          value: (session.amount_total || 4900) / 100,
          currency: session.currency || "eur",
          session_id: session.id,
        });

        if (email) {
          await markPaid(env, email);
        }

        const saved = email ? await getFreeCase(env, { type, email }) : null;

        console.log("WEBHOOK SAVED FREE CASE:", {
          found: !!saved,
          has_file_base64: !!saved?.file_base64,
          has_media_type: !!saved?.media_type,
          has_triage: !!saved?.triage,
          email,
          type,
        });

        if (saved?.file_base64 && saved?.media_type && saved?.triage) {
          const customerName = saved.name || name;

          let analysis = null;

          try {
            console.log("Analyse wird gestartet für:", email);

            const prompts = await loadPrompts(type);

            analysis = await runAnalysis(env, {
              fileBase64: saved.file_base64,
              mediaType: saved.media_type,
              route: saved.triage?.route || "SONNET",
              haikuPrompt: prompts.haiku,
              sonnetPrompt: prompts.sonnet,
            });

            console.log("Analyse abgeschlossen für:", email);
          } catch (err) {
            console.error("Analyse fehlgeschlagen für:", email, err.message, err.stack);

            await enqueuePaid(env, {
              type,
              name: customerName,
              email,
              triage: saved.triage,
              analysis: null,
              file_base64: saved.file_base64,
              media_type: saved.media_type,
            });

            console.log("Fallback: In Cron-Queue gestellt für:", email);
            await markAnalysisSent(env, session.id);
            break;
          }

          await enqueuePaid(env, {
            type,
            name: customerName,
            email,
            triage: saved.triage,
            analysis,
          });

          try {
            console.log("Analyse-E-Mail wird gesendet an:", email);

            await sendPaidEmail(env, {
              name: customerName,
              email,
              type,
              triage: saved.triage,
              analysis,
            });

            console.log("Analyse-E-Mail erfolgreich gesendet an:", email);
          } catch (err) {
            console.error("Kunde E-Mail fehlgeschlagen für:", email, err.message, err.stack);

            await enqueuePaid(env, {
              type,
              name: customerName,
              email,
              triage: saved.triage,
              analysis,
              file_base64: saved.file_base64,
              media_type: saved.media_type,
            });

            console.log("Fallback: In Cron-Queue gestellt nach E-Mail-Fehler für:", email);
          }

          try {
            await notifyAdminPaid(env, {
              name: customerName,
              email,
              type,
              triage: saved.triage,
              analysis,
            });
          } catch (err) {
            console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message);
          }
        } else {
          console.error("NO SAVED FREE CASE FOUND FOR PAID WEBHOOK:", {
            email,
            type,
            session_id: session.id,
          });

          if (email) {
            await env.SESSIONS_KV.put(
              `paid_missing_free_case:${type}:${email}:${Date.now()}`,
              JSON.stringify({
                type,
                name,
                email,
                session_id: session.id || null,
                reason: "paid_but_no_saved_free_case",
                received_at: new Date().toISOString(),
              }),
              { expirationTtl: 60 * 60 * 24 * 30 }
            );
          }
        }

        await markAnalysisSent(env, session.id);
        break;
      }

      case "payment_intent.succeeded": {
        console.log("Payment intent succeeded:", event.data.object.id);
        break;
      }

      default: {
        console.log("Unbekanntes Stripe-Event:", event.type);
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("Webhook Verarbeitungsfehler:", err.message, err.stack);
    return jsonResponse({ ok: true });
  }
}

// ── Stripe signature verification ─────────────────────────────────────────────

async function verifyStripeWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signaturePart = parts.find((p) => p.startsWith("v1="));

  if (!timestampPart || !signaturePart) {
    throw new Error("Invalid Stripe signature header");
  }

  const timestamp = timestampPart.replace("t=", "");
  const signature = signaturePart.replace("v1=", "");
  const signed = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const result = await crypto.subtle.sign("HMAC", key, encoder.encode(signed));

  const expected = [...new Uint8Array(result)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!secureCompare(expected, signature)) {
    throw new Error("Webhook signature mismatch");
  }

  return JSON.parse(rawBody);
}

function secureCompare(a, b) {
  if (!a || !b || a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
