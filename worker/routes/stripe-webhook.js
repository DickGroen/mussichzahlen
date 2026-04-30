// routes/stripe-webhook.js

import { jsonResponse } from "../utils/response.js";
import { markPaid } from "../services/queue.js";

const TRACK_TTL_SECONDS = 60 * 60 * 24 * 90;

export async function handleStripeWebhook(request, env) {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature) {
    return jsonResponse({ ok: false, error: "Stripe signature fehlt" }, 400);
  }

  const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

  if (!valid) {
    return jsonResponse({ ok: false, error: "Ungültige Stripe Signatur" }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (_) {
    return jsonResponse({ ok: false, error: "Ungültiges JSON" }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    return jsonResponse({ ok: true, ignored: true });
  }

  const session = event.data?.object || {};

  if (session.payment_status !== "paid") {
    return jsonResponse({ ok: true, ignored: true, reason: "not_paid" });
  }

  const type =
    session.metadata?.type ||
    session.client_reference_id ||
    "mahnung";

  const revenue =
    session.amount_total
      ? Number((session.amount_total / 100).toFixed(2))
      : 49;

  const email =
    session.customer_details?.email ||
    session.customer_email ||
    null;

  if (email) {
    await markPaid(env, email);
  }

  await recordPaidCompleted(env, {
    type,
    revenue,
    email,
    session_id: session.id || null,
    currency: session.currency || "eur",
    payment_status: session.payment_status || null,
  });

  return jsonResponse({ ok: true });
}

async function recordPaidCompleted(env, data) {
  const id = crypto.randomUUID();

  const entry = {
    event: "paid_completed",
    type: data.type || "mahnung",
    revenue: data.revenue || 49,
    email: data.email || null,
    session_id: data.session_id || null,
    currency: data.currency || "eur",
    payment_status: data.payment_status || "paid",
    received_at: new Date().toISOString(),
  };

  const key = `track:${entry.type}:paid_completed:${Date.now()}:${id}`;

  await env.MAHNUNG_QUEUE.put(key, JSON.stringify(entry), {
    expirationTtl: TRACK_TTL_SECONDS,
  });
}

async function verifyStripeSignature(payload, header, secret) {
  if (!secret) return false;

  const parts = Object.fromEntries(
    header.split(",").map(part => {
      const [k, v] = part.split("=");
      return [k, v];
    })
  );

  const timestamp = parts.t;
  const signature = parts.v1;

  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  return timingSafeEqual(expected, signature);
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));

  return [...new Uint8Array(sig)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;

  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return out === 0;
}
