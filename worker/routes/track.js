// routes/track.js

import { jsonResponse } from "../utils/response.js";

const TRACK_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 Tage

export async function handleTrack(request, env) {
  let payload;

  try {
    payload = await request.json();
  } catch (_) {
    return jsonResponse({ ok: false, error: "Ungültiges JSON" }, 400);
  }

  const event = String(payload.event || "").trim();

  if (!event) {
    return jsonResponse({ ok: false, error: "Event fehlt" }, 400);
  }

  const type = String(payload.type || "unknown").trim();
  const id = crypto.randomUUID();

  const entry = {
    ...payload,
    event,
    type,
    received_at: new Date().toISOString(),
    user_agent: request.headers.get("user-agent") || null,
    ip_country: request.headers.get("cf-ipcountry") || null,
  };

  const key = `track:${type}:${event}:${Date.now()}:${id}`;

  await env.MAHNUNG_QUEUE.put(key, JSON.stringify(entry), {
    expirationTtl: TRACK_TTL_SECONDS,
  });

  return jsonResponse({ ok: true });
}
