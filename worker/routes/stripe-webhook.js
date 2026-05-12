// worker/routes/stripe-webhook.js — mussichzahlen

import { jsonResponse } from "../utils/response.js";
import { getFreeCase, markPaid, enqueuePaid } from "../services/queue.js";

const ALLOWED_TYPES = ["mahnung", "parkstrafe", "rechnung", "vertrag", "angebot"];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function trackEvent(env, event, data = {}) {
  try {
    const id  = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;
    await env.SESSIONS_KV.put(
      key,
      JSON.stringify({ event, ...data, received_at: new Date().toISOString() }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

async function hasAnalysisBeenSent(env, sessionId) {
  const val = await env.SESSIONS_KV.get(`analysis_sent:${sessionId}`);
  return val === "1";
}

async function markAnalysisSent(env, sessionId) {
  await env.SESSIONS_KV.put(`analysis_sent:${sessionId}`, "1", {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}

// Zoek free case langs alle types — statische Payment Links sturen geen metadata.type mee
async function findFreeCase(env, email) {
  for (const type of ALLOWED_TYPES) {
    const saved = await getFreeCase(env, { type, email });
    if (saved) {
      console.log(`FREE CASE GEVONDEN: type=${type}, email=${email}`);
      return { saved, type };
    }
  }
  console.warn(`GEEN FREE CASE GEVONDEN voor email=${email}`);
  return { saved: null, type: null };
}

// ── Webhook handler ───────────────────────────────────────────────────────────

export async function handleStripeWebhook(request, env, ctx) {
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
    event = await verifyStripeWebhook(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Invalid webhook signature:", err.message);
    return jsonResponse({ ok: false, error: "Invalid webhook signature" }, 400);
  }

  // ctx.waitUntil garandeert dat de Worker niet stopt voordat handleEvent klaar is
  ctx.waitUntil(
    handleEvent(event, env).catch((err) =>
      console.error("Webhook achtergrondverwerking mislukt:", err.message, err.stack)
    )
  );

  return jsonResponse({ ok: true });
}

async function handleEvent(event, env) {
  if (event.type !== "checkout.session.completed") {
    console.log("Webhook event overgeslagen:", event.type);
    return;
  }

  const session = event.data.object;

  if (session.payment_status !== "paid") {
    console.log("Sessie nog niet betaald:", session.id);
    return;
  }

  if (await hasAnalysisBeenSent(env, session.id)) {
    console.log("Dubbele webhook — al verwerkt:", session.id);
    return;
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

  console.log("WEBHOOK BETAALD:", {
    session_id: session.id,
    email,
    payment_status: session.payment_status,
  });

  if (!email) {
    console.error("Geen email gevonden in webhook sessie:", session.id);
    return;
  }

  await markPaid(env, email);

  await trackEvent(env, "payment_success", {
    email,
    value: (session.amount_total || 4900) / 100,
    currency: session.currency || "eur",
    session_id: session.id,
  });

  // Zoek free case langs alle types — statische Payment Links sturen geen metadata.type mee
  const { saved, type } = await findFreeCase(env, email);

  if (!saved?.file_base64 || !saved?.media_type || !saved?.triage) {
    console.error("GEEN BRUIKBARE FREE CASE GEVONDEN:", { email, session_id: session.id });

    await env.SESSIONS_KV.put(
      `paid_missing_free_case:${email}:${Date.now()}`,
      JSON.stringify({
        name,
        email,
        session_id: session.id,
        reason: "paid_but_no_saved_free_case",
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );
    return;
  }

  const customerName = saved.name || name;

  // Analyse in de cron — enqueuePaid eerst, markAnalysisSent pas daarna
  await enqueuePaid(env, {
    type,
    name: customerName,
    email,
    triage: saved.triage,
    file_base64: saved.file_base64,
    media_type: saved.media_type,
    analysis: null,
  });

  console.log("PAID IN CRON QUEUE GEZET:", { email, type });

  // Pas markeren als verwerkt nadat enqueuePaid is geslaagd
  await markAnalysisSent(env, session.id);
}

// ── Stripe signature verification ─────────────────────────────────────────────

async function verifyStripeWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) throw new Error("Missing STRIPE_WEBHOOK_SECRET");

  const parts         = signatureHeader.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signaturePart = parts.find((p) => p.startsWith("v1="));

  if (!timestampPart || !signaturePart) throw new Error("Invalid Stripe signature header");

  const timestamp = timestampPart.replace("t=", "");
  const signature = signaturePart.replace("v1=", "");
  const signed    = `${timestamp}.${rawBody}`;
  const encoder   = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const result   = await crypto.subtle.sign("HMAC", key, encoder.encode(signed));
  const expected = [...new Uint8Array(result)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!secureCompare(expected, signature)) throw new Error("Webhook signature mismatch");

  return JSON.parse(rawBody);
}

function secureCompare(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
