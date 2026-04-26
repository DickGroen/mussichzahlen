
import { getDueEntries, deleteEntry } from "../services/queue.js";
import { sendFreeEmail, sendPaidEmail } from "../services/resend.js";

export async function handleCron(env) {
  console.log("Cron: Warteschlange wird gepr\u00fcft\u2026");

  const due = await getDueEntries(env);
  console.log(`Cron: ${due.length} f\u00e4llige Eintr\u00e4ge gefunden`);

  for (const { key, entry } of due) {
    try {
      if (entry.kind === "free") {
        await sendFreeEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          triage:     entry.triage,
          stripeLink: entry.stripe_link || "https://mussichzahlen.de"
        });
      } else if (entry.kind === "paid") {
        await sendPaidEmail(env, {
          name:     entry.name,
          email:    entry.email,
          type:     entry.type,
          triage:   entry.triage,
          analysis: entry.analysis
        });
      } else {
        console.warn(`Cron: Unbekannter Eintragstyp: ${entry.kind} (${key})`);
      }

      await deleteEntry(env, key);
      console.log(`Cron: Gesendet und gel\u00f6scht: ${key}`);
    } catch (err) {
      console.error(`Cron: Fehler bei ${key}:`, err.message);
    }
  }
}
