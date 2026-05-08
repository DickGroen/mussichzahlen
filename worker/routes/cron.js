// routes/cron.js

import { getDueEntries, deleteEntry, hasPaid } from "../services/queue.js";
import { sendFreeEmail, sendPaidEmail, sendAbandonedEmail } from "../services/resend.js";

export async function handleCron(env) {
  console.log("Cron: Warteschlange wird geprüft…");

  const due = await getDueEntries(env);
  console.log(`Cron: ${due.length} fällige Einträge gefunden`);

  for (const { key, entry } of due) {
    try {
      if (entry.kind === "free") {
        const alreadyPaid = await hasPaid(env, entry.email);

        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: Recovery übersprungen, bereits bezahlt: ${entry.email}`);
          continue;
        }

        await sendFreeEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          triage:     entry.triage,
          stripeLink: entry.stripe_link || "https://mussichzahlen.de",
          stage:      entry.stage || 1,
        });

      } else if (entry.kind === "paid") {
        await sendPaidEmail(env, {
          name:     entry.name,
          email:    entry.email,
          type:     entry.type,
          triage:   entry.triage,
          analysis: entry.analysis,
        });

      } else if (entry.kind === "abandoned") {
        const alreadyPaid = await hasPaid(env, entry.email);

        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: Abandoned übersprungen, bereits bezahlt: ${entry.email}`);
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

      } else {
        console.warn(`Cron: Unbekannter Eintragstyp: ${entry.kind} (${key})`);
      }

      await deleteEntry(env, key);
      console.log(`Cron: Gesendet und gelöscht: ${key}`);
    } catch (err) {
      console.error(`Cron: Fehler bei ${key}:`, err.message);
    }
  }
}
