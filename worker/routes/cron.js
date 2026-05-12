// routes/cron.js

import { getDueEntries, deleteEntry, hasPaid } from "../services/queue.js";
import {
  sendFreeEmail,
  sendPaidEmail,
  sendAbandonedEmail,
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
        kind: entry?.kind,
        stage: entry?.stage || null,
        email: entry?.email || null,
        type: entry?.type || null,
        send_at: entry?.send_at || null,
      }));

      if (!entry?.kind) {
        console.warn(`Cron: Eintrag ohne kind übersprungen: ${key}`);
        await deleteEntry(env, key);
        continue;
      }

      if (entry.kind === "free") {
        const alreadyPaid = await hasPaid(env, entry.email);

        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: Free-Recovery übersprungen, bereits bezahlt: ${entry.email}`);
          continue;
        }

        await sendFreeEmail(env, {
          name: entry.name,
          email: entry.email,
          type: entry.type,
          triage: entry.triage,
          stripeLink: entry.stripe_link || null,
          stage: entry.stage || 1,
        });

        console.log(`Cron: Free-Mail gesendet: ${entry.email}, stage ${entry.stage || 1}`);
      }

      else if (entry.kind === "paid") {
        await sendPaidEmail(env, {
          name: entry.name,
          email: entry.email,
          type: entry.type,
          triage: entry.triage,
          analysis: entry.analysis,
        });

        console.log(`Cron: Paid-Mail gesendet: ${entry.email}`);
      }

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
          name: entry.name,
          email: entry.email,
          type: entry.type,
          amount: entry.amount,
          stripeLink: entry.stripe_link,
          stage: entry.stage || 1,
        });

        console.log(`Cron: Abandoned-Mail gesendet: ${entry.email}, stage ${entry.stage || 1}`);
      }

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
