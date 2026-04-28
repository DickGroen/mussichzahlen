// routes/cron.js
import { getDueEntries, deleteEntry } from "../services/queue.js";
import { sendFreeEmail, sendPaidEmail } from "../services/resend.js";

export async function handleCron(env) {
  console.log("Cron: Warteschlange wird geprüft…");

  const due = await getDueEntries(env);
  console.log(`Cron: ${due.length} fällige Einträge gefunden`);

  for (const { key, entry } of due) {
    try {
      if (entry.kind === "free") {
        await sendFreeEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          triage:     entry.triage,
          stripeLink: entry.stripe_link || "https://mussichzahlen.de",
        });
      } else if (entry.kind === "paid") {
        await sendPaidEmail(env, {
          name:     entry.name,
          email:    entry.email,
          type:     entry.type,
          triage:   entry.triage,
          analysis: entry.analysis,
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
