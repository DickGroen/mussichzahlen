// worker/services/queue.js — mussichzahlen

const PAID_MARKER_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const FREE_CASE_TTL_SECONDS = 60 * 60 * 24 * 3; // 3 days
const FREE_TRIAGE_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const QUEUE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ABANDONED_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const PAID_SEND_DELAY_MS = 0;

function kv(env) {
  return env.DEBT_QUEUE || env.SESSIONS_KV;
}

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

function abandonedKey(email, stage) {
  return `abandoned:${safeEmailKey(email)}:stage_${stage}`;
}

function isTier3({ triage, tier, emailType } = {}) {
  return (
    tier === "tier3" ||
    emailType === "trust" ||
    triage?.tier === "tier3" ||
    triage?.emailType === "trust"
  );
}

function nextWorkdayAt15CET(fromMs = Date.now()) {
  // CET = UTC+1, CEST = UTC+2 (last Sunday March → last Sunday October)
  function isCEST(date) {
    const year = date.getUTCFullYear();
    const lastSundayMarch = new Date(Date.UTC(year, 2, 31));
    lastSundayMarch.setUTCDate(31 - lastSundayMarch.getUTCDay());
    const lastSundayOctober = new Date(Date.UTC(year, 9, 31));
    lastSundayOctober.setUTCDate(31 - lastSundayOctober.getUTCDay());
    return date >= lastSundayMarch && date < lastSundayOctober;
  }

  const d = new Date(fromMs);
  d.setUTCDate(d.getUTCDate() + 1);

  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const offset = isCEST(d) ? 2 : 1; // CEST=UTC+2, CET=UTC+1
  d.setUTCHours(15 - offset, 15, 0, 0); // 15:15 lokaal = 13:15 of 14:15 UTC
}

function nextWorkdayAt1519CET(fromMs = Date.now()) {
  function isCEST(date) {
    const year = date.getUTCFullYear();
    const lastSundayMarch = new Date(Date.UTC(year, 2, 31));
    lastSundayMarch.setUTCDate(31 - lastSundayMarch.getUTCDay());
    const lastSundayOctober = new Date(Date.UTC(year, 9, 31));
    lastSundayOctober.setUTCDate(31 - lastSundayOctober.getUTCDay());
    return date >= lastSundayMarch && date < lastSundayOctober;
  }
  const d = new Date(fromMs);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const offset = isCEST(d) ? 2 : 1;
  d.setUTCHours(15 - offset, 19, 0, 0); // 15:19 lokaal

  return d.toISOString();
}

function addHours(ms, hours) {
  return new Date(ms + hours * 60 * 60 * 1000).toISOString();
}

export async function markPaid(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  await kv(env).put(paidMarkerKey(normalized), "1", {
    expirationTtl: PAID_MARKER_TTL_SECONDS,
  });
}

export async function hasPaid(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const value = await kv(env).get(paidMarkerKey(normalized));
  return value === "1";
}

export async function saveFreeTriage(env, { type, rawType, name, email, triage, stripeLink }) {
  const entry = {
    type,
    rawType: rawType || type,
    name,
    email: normalizeEmail(email),
    triage,
    stripe_link: stripeLink || null,
    created_at: new Date().toISOString(),
  };

  await kv(env).put(freeTriageKey(type, email), JSON.stringify(entry), {
    expirationTtl: FREE_TRIAGE_TTL_SECONDS,
  });

  return entry;
}

export async function getFreeTriage(env, { type, email }) {
  const raw = await kv(env).get(freeTriageKey(type, email));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveFreeCase(env, {
  type,
  rawType,
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
    rawType: rawType || type,
    name,
    email: normalizeEmail(email),
    triage,
    stripe_link: stripeLink || null,
    file_base64: fileBase64 || null,
    media_type: mediaType || null,
    file_name: fileName || null,
    file_size: fileSize || null,
    created_at: new Date().toISOString(),
  };

  await kv(env).put(freeCaseKey(type, email), JSON.stringify(entry), {
    expirationTtl: FREE_CASE_TTL_SECONDS,
  });

  return entry;
}

export async function getFreeCase(env, { type, email }) {
  const raw = await kv(env).get(freeCaseKey(type, email));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function enqueueFree(env, {
  type,
  rawType,
  name,
  email,
  triage,
  stripeLink,
  tier,
  emailType,
}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  await saveFreeTriage(env, {
    type,
    rawType,
    name,
    email: normalized,
    triage,
    stripeLink,
  });

  if (isTier3({ triage, tier, emailType })) {
    console.log("QUEUE: tier3 free recovery suppressed:", normalized);
    return null;
  }

  const createdAt = Date.now();
  const emailKey = safeEmailKey(normalized);
  const baseKey = `free:${type}:${createdAt}:${emailKey}`;

  // Stage 1 via cron — volgende werkdag 15:15 CET.
  // Stage 2 en 3 zijn recovery na 24h en 48h.
  const stage1SendAt = nextWorkdayAt15CET(createdAt);
  const stage2SendAt = addHours(createdAt, 24);
  const stage3SendAt = addHours(createdAt, 48);

  const sendAts = {
    1: stage1SendAt,
    2: stage2SendAt,
    3: stage3SendAt,
  };

  for (const stage of [1, 2, 3]) {
    const key = `${baseKey}:stage_${stage}`;

    const entry = {
      kind: "free",
      stage,
      type,
      rawType: rawType || type,
      name,
      email: normalized,
      triage,
      tier: triage?.tier || tier || null,
      emailType: triage?.emailType || emailType || null,
      stripe_link: stripeLink || null,
      created_at: new Date(createdAt).toISOString(),
      send_at: sendAts[stage],
    };

    await kv(env).put(key, JSON.stringify(entry), {
      expirationTtl: QUEUE_TTL_SECONDS,
    });

    console.log("ENQUEUED FREE RECOVERY:", key, "SEND_AT:", sendAts[stage]);
  }

  return baseKey;
}

export async function enqueuePaid(env, {
  type,
  rawType,
  name,
  email,
  triage,
  analysis,
  file_base64,
  media_type,
  fileName,
  fileSize,
  sessionId,
  payment,
}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const key = `paid:${type}:${Date.now()}:${safeEmailKey(normalized)}`;

  const entry = {
    kind: "paid",
    type,
    rawType: rawType || type,
    name,
    email: normalized,
    sessionId: sessionId || payment?.sessionId || null,
    payment: payment || null,
    triage,
    analysis: analysis || null,
    file_base64: file_base64 || null,
    media_type: media_type || null,
    file_name: fileName || null,
    file_size: fileSize || null,
    created_at: new Date().toISOString(),
    send_at: nextWorkdayAt1519CET(Date.now()),
  };

  await kv(env).put(key, JSON.stringify(entry), {
    expirationTtl: QUEUE_TTL_SECONDS,
  });

  console.log("ENQUEUED PAID:", key, "SEND_AT:", entry.send_at);

  return key;
}

export async function saveAbandoned(env, {
  email,
  name,
  type,
  rawType,
  amount,
  stripeLink,
  tier,
  emailType,
  triage,
}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  if (isTier3({ triage, tier, emailType })) {
    console.log("QUEUE: tier3 abandoned recovery suppressed:", normalized);
    return null;
  }

  const now = Date.now();

  const sendAts = {
    1: addHours(now, 1),
    2: addHours(now, 24),
    3: addHours(now, 48),
  };

  for (const stage of [1, 2, 3]) {
    const key = abandonedKey(normalized, stage);

    const existing = await kv(env).get(key);
    if (existing) continue;

    const entry = {
      kind: "abandoned",
      stage,
      type,
      rawType: rawType || type,
      name,
      email: normalized,
      amount: amount || null,
      stripe_link: stripeLink || null,
      tier: triage?.tier || tier || null,
      emailType: triage?.emailType || emailType || null,
      triage: triage || null,
      created_at: new Date(now).toISOString(),
      send_at: sendAts[stage],
    };

    await kv(env).put(key, JSON.stringify(entry), {
      expirationTtl: ABANDONED_TTL_SECONDS,
    });

    console.log("ENQUEUED ABANDONED:", key, "SEND_AT:", sendAts[stage]);
  }

  return true;
}

export async function getDueEntries(env) {
  const now = Date.now();
  const due = [];
  let cursor;

  console.log("GET DUE START:", new Date(now).toISOString());

  do {
    const list = await kv(env).list(cursor ? { cursor } : undefined);
    cursor = list.cursor;

    for (const key of list.keys) {
      if (key.name.startsWith("paid_marker:")) continue;
      if (key.name.startsWith("free_triage:")) continue;
      if (key.name.startsWith("free_case:")) continue;
      if (key.name.startsWith("track:")) continue;
      if (key.name.startsWith("analysis_sent:")) continue;
      if (key.name.startsWith("paid_missing_free_case:")) continue;
      if (key.name.startsWith("paid_missing_email:")) continue;
      if (key.name.startsWith("paid_failed_missing_file:")) continue;

      try {
        const raw = await kv(env).get(key.name);
        if (!raw) continue;

        const entry = JSON.parse(raw);
        if (!entry?.send_at) continue;

        const sendAtMs = new Date(entry.send_at).getTime();
        if (!Number.isFinite(sendAtMs)) continue;

        if (sendAtMs <= now) {
          due.push({ key: key.name, entry });
        }
      } catch (err) {
        console.error(`Queue read error for ${key.name}:`, err.message);
      }
    }
  } while (cursor);

  console.log("GET DUE DONE:", due.length);

  return due;
}

export async function deleteEntry(env, key) {
  await kv(env).delete(key);
  console.log("DELETED QUEUE KEY:", key);
}
