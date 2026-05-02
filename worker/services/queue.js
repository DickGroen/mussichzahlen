// services/queue.js

const PAID_MARKER_TTL_SECONDS  = 60 * 60 * 24 * 30; // 30 dagen
const FREE_CASE_TTL_SECONDS    = 60 * 60 * 24 * 3;  // 3 dagen voor automatische B-flow
const FREE_TRIAGE_TTL_SECONDS  = 60 * 60 * 24 * 14; // 14 dagen voor fallback-consistentie

const RECOVERY_DELAYS = [
  { stage: 1, delay_ms:  3 * 60 * 60 * 1000 },
  { stage: 2, delay_ms: 24 * 60 * 60 * 1000 },
  { stage: 3, delay_ms: 48 * 60 * 60 * 1000 },
];

const PAID_SEND_DELAY_MS = 0; // direct versturen; later: 23 * 60 * 60 * 1000

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function safeEmailKey(email) {
  return normalizeEmail(email).replace(/[^a-z0-9]/gi, "_");
}

function paidMarkerKey(email) {
  return `paid_marker:${normalizeEmail(email)}`;
}

function freeTriageKey(type, email) {
  return `free_triage:${type}:${safeEmailKey(email)}`;
}

function freeCaseKey(type, email) {
  return `free_case:${type}:${safeEmailKey(email)}`;
}

// ── Paid marker: stopt recovery na betaling ─────────────────────────────────

export async function markPaid(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  await env.SESSIONS_KV.put(
    paidMarkerKey(normalized),
    "1",
    { expirationTtl: PAID_MARKER_TTL_SECONDS }
  );
}

export async function hasPaid(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const value = await env.SESSIONS_KV.get(paidMarkerKey(normalized));
  return value === "1";
}

// ── Free triage: A-flow fallback consistentie ────────────────────────────────

export async function saveFreeTriage(env, { type, name, email, triage, stripeLink }) {
  const entry = {
    type,
    name,
    email: normalizeEmail(email),
    triage,
    stripe_link: stripeLink,
    created_at: new Date().toISOString(),
  };

  await env.SESSIONS_KV.put(
    freeTriageKey(type, email),
    JSON.stringify(entry),
    { expirationTtl: FREE_TRIAGE_TTL_SECONDS }
  );

  return entry;
}

export async function getFreeTriage(env, { type, email }) {
  const raw = await env.SESSIONS_KV.get(freeTriageKey(type, email));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// ── Free case: B-flow automatische analyse zonder tweede upload ──────────────

export async function saveFreeCase(env, {
  type,
  name,
  email,
  triage,
  stripeLink,
  fileBase64,
  mediaType,
  fileName,
  fileSize,
}) {
  const entry = {
    type,
    name,
    email: normalizeEmail(email),
    triage,
    stripe_link: stripeLink,
    file_base64: fileBase64,
    media_type:  mediaType,
    file_name:   fileName || null,
    file_size:   fileSize || null,
    created_at:  new Date().toISOString(),
  };

  await env.SESSIONS_KV.put(
    freeCaseKey(type, email),
    JSON.stringify(entry),
    { expirationTtl: FREE_CASE_TTL_SECONDS }
  );

  return entry;
}

export async function getFreeCase(env, { type, email }) {
  const raw = await env.SESSIONS_KV.get(freeCaseKey(type, email));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// ── Free recovery queue ──────────────────────────────────────────────────────

export async function enqueueFree(env, { type, name, email, triage, stripeLink }) {
  await saveFreeTriage(env, { type, name, email, triage, stripeLink });

  const createdAt = Date.now();
  const emailKey  = safeEmailKey(email);
  const baseKey   = `free:${type}:${createdAt}:${emailKey}`;

  for (const item of RECOVERY_DELAYS) {
    const key = `${baseKey}:stage_${item.stage}`;

    const entry = {
      kind:        "free",
      stage:       item.stage,
      type,
      name,
      email:       normalizeEmail(email),
      triage,
      stripe_link: stripeLink,
      created_at:  new Date(createdAt).toISOString(),
      send_at:     new Date(createdAt + item.delay_ms).toISOString(),
    };

    await env.SESSIONS_KV.put(key, JSON.stringify(entry), {
      expirationTtl: 60 * 60 * 24 * 7, // 7 dagen
    });
  }

  return baseKey;
}

// ── Paid delivery queue ──────────────────────────────────────────────────────

export async function enqueuePaid(env, { type, name, email, triage, analysis }) {
  const key = `paid:${type}:${Date.now()}:${safeEmailKey(email)}`;

  const entry = {
    kind:       "paid",
    type,
    name,
    email:      normalizeEmail(email),
    triage,
    analysis,
    created_at: new Date().toISOString(),
    send_at:    new Date(Date.now() + PAID_SEND_DELAY_MS).toISOString(),
  };

  await env.SESSIONS_KV.put(key, JSON.stringify(entry));
  return key;
}

// ── Cron helpers ─────────────────────────────────────────────────────────────

export async function getDueEntries(env) {
  const now = Date.now();
  const due = [];

  let cursor;

  do {
    const list = await env.SESSIONS_KV.list(cursor ? { cursor } : undefined);
    cursor = list.cursor;

    for (const key of list.keys) {
      if (key.name.startsWith("paid_marker:")) continue;
      if (key.name.startsWith("free_triage:")) continue;
      if (key.name.startsWith("free_case:"))   continue;
      if (key.name.startsWith("track:"))        continue;

      try {
        const raw = await env.SESSIONS_KV.get(key.name);
        if (!raw) continue;

        const entry = JSON.parse(raw);
        if (!entry.send_at) continue;

        if (new Date(entry.send_at).getTime() <= now) {
          due.push({ key: key.name, entry });
        }
      } catch (err) {
        console.error(`Queue-Lesefehler für ${key.name}:`, err.message);
      }
    }
  } while (cursor);

  return due;
}

export async function deleteEntry(env, key) {
  await env.SESSIONS_KV.delete(key);
}
