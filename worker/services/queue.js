// services/queue.js

const PAID_MARKER_TTL_SECONDS  = 60 * 60 * 24 * 30;
const FREE_CASE_TTL_SECONDS    = 60 * 60 * 24 * 3;
const FREE_TRIAGE_TTL_SECONDS  = 60 * 60 * 24 * 14;

const PAID_SEND_DELAY_MS = 0;

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

function nextWorkdayAt15CET(fromMs) {
  const TARGET_HOUR_UTC = 14; // 15:00 CET = 14:00 UTC

  const d = new Date(fromMs);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(TARGET_HOUR_UTC, 0, 0, 0);

  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return d.toISOString();
}

// ── Paid marker ──────────────────────────────────────────────────────────────

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

// ── Free triage ──────────────────────────────────────────────────────────────

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

// ── Free case ────────────────────────────────────────────────────────────────

export async function saveFreeCase(env, {
  type, name, email, triage, stripeLink,
  fileBase64, mediaType, fileName, fileSize,
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

  const createdAt    = Date.now();
  const emailKey     = safeEmailKey(email);
  const baseKey      = `free:${type}:${createdAt}:${emailKey}`;

  const stage1SendAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const stage1Ms     = new Date(stage1SendAt).getTime();

  const sendAts = {
    1: stage1SendAt,
    2: new Date(stage1Ms + 24 * 60 * 60 * 1000).toISOString(),
    3: new Date(stage1Ms + 48 * 60 * 60 * 1000).toISOString(),
  };

  for (const stage of [1, 2, 3]) {
    const key = `${baseKey}:stage_${stage}`;

    const entry = {
      kind:        "free",
      stage,
      type,
      name,
      email:       normalizeEmail(email),
      triage,
      stripe_link: stripeLink,
      created_at:  new Date(createdAt).toISOString(),
      send_at:     sendAts[stage],
    };

    await env.SESSIONS_KV.put(key, JSON.stringify(entry), {
      expirationTtl: 60 * 60 * 24 * 7,
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
