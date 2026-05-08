// routes/track.js
import { jsonResponse } from "../utils/response.js";
import { saveAbandoned } from "../services/queue.js";

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
  const id   = crypto.randomUUID();

  const entry = {
    ...payload,
    event,
    type,
    received_at: new Date().toISOString(),
    user_agent:  request.headers.get("user-agent") || null,
    ip_country:  request.headers.get("cf-ipcountry") || null,
  };

  const key = `track:${type}:${event}:${Date.now()}:${id}`;

  try {
    await env.SESSIONS_KV.put(key, JSON.stringify(entry), {
      expirationTtl: TRACK_TTL_SECONDS,
    });
  } catch (err) {
    console.error("Track KV error:", err.message);
  }

  // Bij stripe_clicked — abandoned entry opslaan
  if (event === "stripe_clicked" && payload.email && payload.name && payload.stripeLink) {
    try {
      await saveAbandoned(env, {
        email:      payload.email,
        name:       payload.name,
        type:       payload.type || "mahnung",
        amount:     payload.amount || null,
        stripeLink: payload.stripeLink,
      });
    } catch (err) {
      console.error("Abandoned save error:", err.message);
    }
  }

  return jsonResponse({ ok: true });
}
