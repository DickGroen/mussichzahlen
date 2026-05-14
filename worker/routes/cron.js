// worker/routes/cron.js

import { getDueEntries, deleteEntry, hasPaid } from "../services/queue.js";
import { runAnalysis } from "../services/claude.js";
import { loadPrompts } from "../config/prompts.js";
import {
  sendFreeEmail,
  sendPaidEmail,
  sendAbandonedEmail,
  notifyAdminPaid,
} from "../services/resend.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTier3(entry) {
  return (
    entry?.triage?.tier === "tier3" ||
    entry?.tier === "tier3" ||
    entry?.triage?.emailType === "vertrauen" ||
    entry?.emailType === "vertrauen"
  );
}

function getStripeLink(entry) {
  return (
    entry?.stripe_link ||
    entry?.stripeLink ||
    entry?.paymentLink ||
    null
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleCron(env) {
  console.log("Cron: Warteschlange wird geprüft…");

  let due = [];
  try {
    due = await getDueEntries(env);
  } catch (err) {
    console.error("Cron: getDueEntries FAILED:", err?.message, err?.stack);
    return;
  }

  console.log(`Cron: ${due.length} fällige Einträge gefunden`);

  for (const { key, entry } of due) {
    try {
      console.log("Cron: Eintrag wird verarbeitet:", JSON.stringify({
        key,
        kind:    entry?.kind,
        stage:   entry?.stage    || null,
        email:   entry?.email    || null,
        type:    entry?.type     || null,
        tier:    entry?.triage?.tier || entry?.tier || null,
        send_at: entry?.send_at  || null,
      }));

      if (!entry?.kind) {
        console.warn(`Cron: Eintrag ohne kind übersprungen und gelöscht: ${key}`);
        await deleteEntry(env, key);
        continue;
      }

      if (!entry?.email) {
        console.warn(`Cron: Eintrag ohne E-Mail übersprungen und gelöscht: ${key}`);
        await deleteEntry(env, key);
        continue;
      }

      // ── Free recovery emails ─────────────────────────────────────────────
      if (entry.kind === "free") {
        const alreadyPaid = await hasPaid(env, entry.email);
        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: Free-Recovery übersprungen, bereits bezahlt: ${entry.email}`);
          continue;
        }

        // Tier 3 krijgt geen follow-up recovery emails na stage 1
        if (isTier3(entry) && Number(entry.stage || 1) > 1) {
          await deleteEntry(env, key);
          console.log(`Cron: Tier3-Recovery unterdrückt: ${entry.email}`);
          continue;
        }

        const stripeLink = getStripeLink(entry);

        await sendFreeEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          triage:     entry.triage,
          stripeLink,
          stage:      entry.stage || 1,
        });

        console.log(`Cron: Free-Mail gesendet: ${entry.email}, stage ${entry.stage || 1}`);
      }

      // ── Paid analysis emails ─────────────────────────────────────────────
      else if (entry.kind === "paid") {
        let analysis = entry.analysis || null;

        if (!analysis) {
          if (!entry.file_base64 || !entry.media_type) {
            console.error(`Cron: Paid-Eintrag ohne file_base64/media_type — Analyse nicht möglich: ${key}`);

            // Log mislukte entry voor handmatige opvolging
            await env.SESSIONS_KV.put(
              `paid_failed_missing_file:${entry.email}:${Date.now()}`,
              JSON.stringify({
                key,
                type:        entry.type,
                email:       entry.email,
                reason:      "missing_file_base64_or_media_type",
                received_at: new Date().toISOString(),
              }),
              { expirationTtl: 60 * 60 * 24 * 30 }
            );

            await deleteEntry(env, key);
            continue;
          }

          try {
            const prompts = await loadPrompts(entry.type);

            if (!prompts?.haiku || !prompts?.sonnet) {
              throw new Error(`Analyse-Prompts nicht gefunden für type: ${entry.type}`);
            }

            analysis = await runAnalysis(env, {
              fileBase64:   entry.file_base64,
              mediaType:    entry.media_type,
              route:        entry.triage?.route || "SONNET",
              haikuPrompt:  prompts.haiku,
              sonnetPrompt: prompts.sonnet,
            });

            console.log(`Cron: Analyse abgeschlossen für ${entry.email}`);
          } catch (err) {
            console.error(`Cron: runAnalysis fehlgeschlagen für ${entry.email}:`, err.message, err.stack);
            // Niet verwijderen — volgende cron-run probeert het opnieuw
            continue;
          }
        }

        await sendPaidEmail(env, {
          name:     entry.name,
          email:    entry.email,
          type:     entry.type,
          triage:   entry.triage,
          analysis,
          payment:  entry.payment || null,
        });

        console.log(`Cron: Paid-Mail gesendet: ${entry.email}`);

        try {
          await notifyAdminPaid(env, {
            name:     entry.name,
            email:    entry.email,
            type:     entry.type,
            triage:   entry.triage,
            analysis,
            payment:  entry.payment || null,
          });
        } catch (err) {
          console.error("Cron: Admin-Benachrichtigung fehlgeschlagen:", err.message);
        }
      }

      // ── Abandoned checkout emails ────────────────────────────────────────
      else if (entry.kind === "abandoned") {
        const alreadyPaid = await hasPaid(env, entry.email);
        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: Abandoned übersprungen, bereits bezahlt: ${entry.email}`);
          continue;
        }

        // Tier 3 krijgt geen abandoned/pressure emails
        if (isTier3(entry)) {
          await deleteEntry(env, key);
          console.log(`Cron: Tier3-Abandoned unterdrückt: ${entry.email}`);
          continue;
        }

        const stripeLink = getStripeLink(entry);

        if (!stripeLink) {
          console.warn(`Cron: Abandoned ohne Stripe-Link gelöscht: ${key}`);
          await deleteEntry(env, key);
          continue;
        }

        await sendAbandonedEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          amount:     entry.amount,
          stripeLink,
          stage:      entry.stage || 1,
        });

        console.log(`Cron: Abandoned-Mail gesendet: ${entry.email}, stage ${entry.stage || 1}`);
      }

      // ── Onbekend type ────────────────────────────────────────────────────
      else {
        console.warn(`Cron: Unbekannter Eintragstyp: ${entry.kind} (${key})`);
        await deleteEntry(env, key);
        continue;
      }

      await deleteEntry(env, key);
      console.log(`Cron: Gesendet und gelöscht: ${key}`);

    } catch (err) {
      console.error(`Cron: Fehler bei ${key}:`, err?.message, err?.stack);
      // Niet globaal gooien — volgende entry wordt gewoon verwerkt
    }
  }

  console.log("Cron: Verarbeitung abgeschlossen.");
}
