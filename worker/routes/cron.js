// routes/cron.js

import { getDueEntries, deleteEntry, hasPaid } from "../services/queue.js";
import { runAnalysis } from "../services/claude.js";
import { loadPrompts } from "../config/prompts.js";
import {
  sendFreeEmail,
  sendPaidEmail,
  sendAbandonedEmail,
  notifyAdminPaid,
} from "../services/resend.js";

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
        stage:   entry?.stage || null,
        email:   entry?.email || null,
        type:    entry?.type || null,
        send_at: entry?.send_at || null,
      }));

      if (!entry?.kind) {
        console.warn(`Cron: Eintrag ohne kind übersprungen: ${key}`);
        await deleteEntry(env, key);
        continue;
      }

      // ── Free recovery emails ───────────────────────────────────────────────
      if (entry.kind === "free") {
        const alreadyPaid = await hasPaid(env, entry.email);
        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: Free-Recovery übersprungen, bereits bezahlt: ${entry.email}`);
          continue;
        }

        await sendFreeEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          triage:     entry.triage,
          stripeLink: entry.stripe_link || null,
          stage:      entry.stage || 1,
        });

        console.log(`Cron: Free-Mail gesendet: ${entry.email}, stage ${entry.stage || 1}`);
      }

      // ── Paid analysis emails ───────────────────────────────────────────────
      else if (entry.kind === "paid") {
        let analysis = entry.analysis || null;

        // Als de webhook analysis: null heeft opgeslagen, draaien we runAnalysis hier
        if (!analysis) {
          if (!entry.file_base64 || !entry.media_type) {
            console.error(`Cron: Paid zonder file_base64/media_type — kan geen analyse draaien: ${key}`);
            await deleteEntry(env, key);
            continue;
          }

          try {
            const prompts = await loadPrompts(entry.type);

            analysis = await runAnalysis(env, {
              fileBase64:   entry.file_base64,
              mediaType:    entry.media_type,
              route:        entry.triage?.route || "SONNET",
              haikuPrompt:  prompts.haiku,
              sonnetPrompt: prompts.sonnet,
            });

            console.log(`Cron: Analyse afgerond voor ${entry.email}`);
          } catch (err) {
            console.error(`Cron: runAnalysis mislukt voor ${entry.email}:`, err.message, err.stack);
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
        });

        console.log(`Cron: Paid-Mail gesendet: ${entry.email}`);

        try {
          await notifyAdminPaid(env, {
            name:     entry.name,
            email:    entry.email,
            type:     entry.type,
            triage:   entry.triage,
            analysis,
          });
        } catch (err) {
          console.error("Cron: Admin-Benachrichtigung fehlgeschlagen:", err.message);
        }
      }

      // ── Abandoned checkout emails ──────────────────────────────────────────
      else if (entry.kind === "abandoned") {
        const alreadyPaid = await hasPaid(env, entry.email);
        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: Abandoned übersprungen, bereits bezahlt: ${entry.email}`);
          continue;
        }

        if (!entry.stripe_link) {
          console.warn(`Cron: Abandoned ohne stripe_link gelöscht: ${key}`);
          await deleteEntry(env, key);
          continue;
        }

        await sendAbandonedEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          amount:     entry.amount,
          stripeLink: entry.stripe_link,
          stage:      entry.stage || 1,
        });

        console.log(`Cron: Abandoned-Mail gesendet: ${entry.email}, stage ${entry.stage || 1}`);
      }

      // ── Onbekend type ──────────────────────────────────────────────────────
      else {
        console.warn(`Cron: Unbekannter Eintragstyp: ${entry.kind} (${key})`);
        await deleteEntry(env, key);
        continue;
      }

      await deleteEntry(env, key);
      console.log(`Cron: Gesendet und gelöscht: ${key}`);

    } catch (err) {
      console.error(`Cron: Fehler bei ${key}:`, err?.message, err?.stack);
    }
  }

  console.log("Cron: Verarbeitung fertig.");
}
