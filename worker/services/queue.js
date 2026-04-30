// services/queue.js

const PAID_MARKER_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 Tage
const FREE_TRIAGE_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 Tage

const RECOVERY_DELAYS = [
  { stage: 1, delay_ms: 3  * 60 * 60 * 1000 },
  { stage: 2, delay_ms: 24 * 60 * 60 * 1000 },
  { stage: 3, delay_ms: 48 * 60 * 60 * 1000 },
];

const PAID_SEND_DELAY_MS = 23 * 60 * 60 * 1000;

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

export async function markPaid(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  await env.MAHNUNG_QUEUE.put(
    paidMarkerKey(normalized),
    "1",
    { expirationTtl: PAID_MARKER_TTL_SECONDS }
  );
}

export async function hasPaid(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const value = await env.MAHNUNG_QUEUE.get(paidMarkerKey(normalized));
  return value === "1";
}

export async function saveFreeTriage(env, { type, name, email, triage, stripeLink }) {
  const entry = {
    type,
    name,
    email,
    triage,
    stripe_link: stripeLink,
    created_at: new Date().toISOString(),
  };

  await env.MAHNUNG_QUEUE.put(
    freeTriageKey(type, email),
    JSON.stringify(entry),
    { expirationTtl: FREE_TRIAGE_TTL_SECONDS }
  );

  return entry;
}

export async function getFreeTriage(env, { type, email }) {
  const raw = await env.MAHNUNG_QUEUE.get(freeTriageKey(type, email));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export async function enqueueFree(env, { type, name, email, triage, stripeLink }) {
  await saveFreeTriage(env, { type, name, email, triage, stripeLink });

  const createdAt = Date.now();
  const emailKey = safeEmailKey(email);
  const baseKey = `free:${type}:${createdAt}:${emailKey}`;

  for (const item of RECOVERY_DELAYS) {
    const key = `${baseKey}:stage_${item.stage}`;

    const entry = {
      kind: "free",
      stage: item.stage,
      type,
      name,
      email,
      triage,
      stripe_link: stripeLink,
      created_at: new Date(createdAt).toISOString(),
      send_at: new Date(createdAt + item.delay_ms).toISOString(),
    };

    await env.MAHNUNG_QUEUE.put(key, JSON.stringify(entry));
  }

  return baseKey;
}

export async function enqueuePaid(env, { type, name, email, triage, analysis }) {
  const key = `paid:${type}:${Date.now()}:${safeEmailKey(email)}`;

  const entry = {
    kind: "paid",
    type,
    name,
    email,
    triage,
    analysis,
    created_at: new Date().toISOString(),
    send_at: new Date(Date.now() + PAID_SEND_DELAY_MS).toISOString(),
  };

  await env.MAHNUNG_QUEUE.put(key, JSON.stringify(entry));
  return key;
}

export async function getDueEntries(env) {
  const now = Date.now();
  const due = [];

  let cursor;

  do {
    const list = await env.MAHNUNG_QUEUE.list(cursor ? { cursor } : undefined);
    cursor = list.cursor;

    for (const key of list.keys) {
      if (key.name.startsWith("paid_marker:")) continue;
      if (key.name.startsWith("free_triage:")) continue;
      if (key.name.startsWith("track:")) continue;

      try {
        const raw = await env.MAHNUNG_QUEUE.get(key.name);
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
  await env.MAHNUNG_QUEUE.delete(key);
}
