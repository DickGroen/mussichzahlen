// services/queue.js

const SEND_DELAY_MS = 23 * 60 * 60 * 1000; // 23 Stunden — Versand am nächsten Tag vor 16:00 Uhr

export async function enqueueFree(env, { type, name, email, triage, stripeLink }) {
  const key = `free:${type}:${Date.now()}:${email.replace(/[^a-z0-9]/gi, "_")}`;
  const entry = {
    kind:        "free",
    type,
    name,
    email,
    triage,
    stripe_link: stripeLink,
    created_at:  new Date().toISOString(),
    send_at:     new Date(Date.now() + SEND_DELAY_MS).toISOString(),
  };
  await env.MAHNUNG_QUEUE.put(key, JSON.stringify(entry));
  return key;
}

export async function enqueuePaid(env, { type, name, email, triage, analysis }) {
  const key = `paid:${type}:${Date.now()}:${email.replace(/[^a-z0-9]/gi, "_")}`;
  const entry = {
    kind:       "paid",
    type,
    name,
    email,
    triage,
    analysis,
    created_at: new Date().toISOString(),
    send_at:    new Date(Date.now() + SEND_DELAY_MS).toISOString(),
  };
  await env.MAHNUNG_QUEUE.put(key, JSON.stringify(entry));
  return key;
}

export async function getDueEntries(env) {
  const now  = Date.now();
  const list = await env.MAHNUNG_QUEUE.list();
  const due  = [];

  for (const key of list.keys) {
    try {
      const raw = await env.MAHNUNG_QUEUE.get(key.name);
      if (!raw) continue;
      const entry = JSON.parse(raw);
      if (new Date(entry.send_at).getTime() <= now) {
        due.push({ key: key.name, entry });
      }
    } catch (err) {
      console.error(`Queue-Lesefehler für ${key.name}:`, err.message);
    }
  }

  return due;
}

export async function deleteEntry(env, key) {
  await env.MAHNUNG_QUEUE.delete(key);
}
