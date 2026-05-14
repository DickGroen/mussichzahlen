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
  if (!sessionId) return false;
  const val = await env.SESSIONS_KV.get(`analysis_sent:${sessionId}`);
  return val === "1";
}

async function markAnalysisSent(env, sessionId) {
  if (!sessionId) return;
  await env.SESSIONS_KV.put(`analysis_sent:${sessionId}`, "1", {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}

// Zoek free case langs alle types — statische Payment Links sturen geen metadata.type mee.
// preferredType (uit metadata) wordt als eerste geprobeerd.
async function findFreeCase(env, email, preferredType = null) {
  if (!email) return { saved: null, type: null };

  const orderedTypes = [];
  if (preferredType && ALLOWED_TYPES.includes(preferredType)) {
    orderedTypes.push(preferredType);
  }
  for (const type of ALLOWED_TYPES) {
    if (!orderedTypes.includes(type)) orderedTypes.push(type);
  }

  for (const type of orderedTypes) {
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

  const work = handleEvent(event, env).catch((err) =>
    console.error("Webhook achtergrondverwerking mislukt:", err.message, err.stack)
  );

  // ctx.waitUntil garandeert dat de Worker niet stopt voordat handleEvent klaar is
  if (ctx?.waitUntil) {
    ctx.waitUntil(work);
  } else {
    await work;
  }

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

  // Static Payment Links sturen geen metadata.type — preferredType zal meestal null zijn
  const rawType = session.metadata?.type || null;
  const preferredType = rawType && ALLOWED_TYPES.includes(rawType) ? rawType : null;

  const currency = String(session.currency || "eur").toUpperCase();
  const value    = Number(session.amount_total || 0) / 100;

  console.log("WEBHOOK BETAALD:", {
    session_id:     session.id,
    email,
    payment_status: session.payment_status,
    preferredType,
    value,
    currency,
  });

  if (!email) {
    console.error("Geen email gevonden in webhook sessie:", session.id);

    await env.SESSIONS_KV.put(
      `paid_missing_email:${session.id}:${Date.now()}`,
      JSON.stringify({
        session_id:  session.id,
        reason:      "paid_but_no_email_found",
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );

    return;
  }

  await markPaid(env, email);

  await trackEvent(env, "payment_success", {
    type:       preferredType || "unknown",
    email,
    value,
    currency,
    session_id: session.id,
  });

  const { saved, type } = await findFreeCase(env, email, preferredType);

  if (!saved?.file_base64 || !saved?.media_type || !saved?.triage) {
    console.error("GEEN BRUIKBARE FREE CASE GEVONDEN:", {
      email,
      session_id:    session.id,
      preferredType,
    });

    await env.SESSIONS_KV.put(
      `paid_missing_free_case:${email}:${Date.now()}`,
      JSON.stringify({
        name,
        email,
        preferredType,
        session_id:  session.id,
        value,
        currency,
        reason:      "paid_but_no_saved_free_case",
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );

    return;
  }

  const customerName = saved.name || name;
  const finalType    = type || preferredType || saved.type || "mahnung";

  await enqueuePaid(env, {
    type:        finalType,
    name:        customerName,
    email,
    triage:      saved.triage,
    analysis:    null,
    file_base64: saved.file_base64,
    media_type:  saved.media_type,
    fileName:    saved.file_name || null,
    fileSize:    saved.file_size || null,
    payment: {
      sessionId:      session.id,
      value,
      currency,
      payment_status: session.payment_status,
    },
  });

  console.log("PAID IN CRON QUEUE GEZET:", {
    email,
    type: finalType,
    session_id: session.id,
  });

  // Pas markeren als verwerkt nadat enqueuePaid is geslaagd
  await markAnalysisSent(env, session.id);
}

// ── Stripe signature verification ─────────────────────────────────────────────

async function verifyStripeWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) throw new Error("Missing STRIPE_WEBHOOK_SECRET");

  const parts         = signatureHeader.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));

  // Stripe kan meerdere v1= signatures sturen bij key rotation — check ze allemaal
  const signatureParts = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.replace("v1=", ""));

  if (!timestampPart || signatureParts.length === 0) {
    throw new Error("Invalid Stripe signature header");
  }

  const timestamp = timestampPart.replace("t=", "");
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

  // Match tegen elke signature — één match is voldoende
  const matched = signatureParts.some((sig) => secureCompare(expected, sig));

  if (!matched) throw new Error("Webhook signature mismatch");

  return JSON.parse(rawBody);
}

function secureCompare(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
