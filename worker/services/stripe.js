// worker/services/stripe.js
// Stripe session validation and payment link helpers — MussIchZahlen.

const STRIPE_API = "https://api.stripe.com/v1";

const FALLBACK_PAGES = {
  mahnung:    "https://mussichzahlen.de/mahnung/#pruefen",
  parkstrafe: "https://mussichzahlen.de/parkstrafe/#pruefen",
  rechnung:   "https://mussichzahlen.de/rechnung/#pruefen",
  vertrag:    "https://mussichzahlen.de/vertrag/#pruefen",
  angebot:    "https://mussichzahlen.de/angebot/#pruefen",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeSessionId(sessionId) {
  return String(sessionId || "").trim();
}

function isValidCheckoutSessionId(sessionId) {
  return (
    sessionId.startsWith("cs_live_") ||
    sessionId.startsWith("cs_test_")
  );
}

function normalizeType(type) {
  return String(type || "mahnung").trim().toLowerCase();
}

function normalizeCurrency(value) {
  return String(value || "eur").trim().toUpperCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

// ─── Stripe API ───────────────────────────────────────────────────────────────

async function stripeGet(env, path) {
  if (!env?.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY fehlt");
  }

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });

  let data;

  try {
    data = await res.json();
  } catch {
    const text = await res.text();
    throw new Error(`Stripe hat eine ungültige Antwort zurückgegeben: ${text}`);
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      JSON.stringify(data);

    throw new Error(`Stripe API Fehler: ${message}`);
  }

  return data;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export async function verifySession(env, sessionId) {
  const id = normalizeSessionId(sessionId);

  if (!isValidCheckoutSessionId(id)) {
    throw new Error("Ungültige Session-ID");
  }

  const session = await stripeGet(
    env,
    `/checkout/sessions/${encodeURIComponent(id)}`
  );

  if (session.payment_status !== "paid") {
    throw new Error(
      `Zahlung nicht abgeschlossen (Status: ${session.payment_status || "unbekannt"})`
    );
  }

  return session;
}

// Alias voor backwards compatibility
export const verifyStripeSession = verifySession;

export async function verifyPaidSession(env, sessionId) {
  const session = await verifySession(env, sessionId);

  return {
    paid:    true,
    session,
    sessionId: session.id,
    email:
      normalizeEmail(session.customer_details?.email) ||
      normalizeEmail(session.customer_email) ||
      null,
    name:
      session.metadata?.name ||
      session.customer_details?.name ||
      null,
    type:
      normalizeType(session.metadata?.type || session.metadata?.product || "mahnung"),
    amount:
      typeof session.amount_total === "number"
        ? session.amount_total / 100
        : null,
    currency:       normalizeCurrency(session.currency),
    payment_status: session.payment_status,
  };
}

export function getStripeLink(env, type) {
  const normalizedType = normalizeType(type);
  const key = `STRIPE_LINK_${normalizedType.toUpperCase()}`;

  if (env?.[key]) return env[key];

  if (env?.STRIPE_PAYMENT_LINK) return env.STRIPE_PAYMENT_LINK;

  if (env?.STRIPE_LINK_MAHNUNG) return env.STRIPE_LINK_MAHNUNG;

  return FALLBACK_PAGES[normalizedType] || "https://mussichzahlen.de";
}
