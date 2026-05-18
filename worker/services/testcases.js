// worker/services/testcases.js
//
// Vaste testcases voor end-to-end analyse-testing.
// Elk geval bevat een base64-encoded minimale PDF placeholder
// én een tekstbeschrijving die als document-context dient.
//
// Gebruik: /api/test-analysis?secret=XXX&type=mahnung&case=tier1-inflated-fees

// Minimale 1-pagina PDF in base64 (leeg wit blad — voldoende voor Claude)
// Claude ontvangt ook de textContent als extra context via de prompt
const BLANK_PDF_B64 =
  "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2Jq" +
  "CjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPJ4KZW5kb2Jq" +
  "CjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIg" +
  "NzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAw" +
  "MDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8" +
  "Ci9TaXplIDQKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjE5MAolJUVPRgo=";

export const TEST_CASES = {

  // ── Mahnung ────────────────────────────────────────────────────────────────

  "mahnung:tier1-inflated-fees": {
    type:        "mahnung",
    name:        "Test User",
    email:       null, // wordt overschreven door env.TEST_EMAIL
    description: "Tier-1 Mahnung — aufgeblähte Inkassokosten",
    textContent: `
CREDITUM INKASSO GMBH
Kaiserdamm 31 · 14057 Berlin

Herrn Thomas Bauer
Fichtenweg 14 · 10715 Berlin

Berlin, 14. März 2025
Letzte Mahnung — Aktenzeichen CI/2025/BB-44122

Gesamtforderung: 847,00 EUR

Sehr geehrter Herr Bauer,

wir wurden beauftragt, die offene Forderung gegen Sie in Höhe von 847,00 EUR einzuziehen.
Diese Forderung bezieht sich auf Leistungen, die durch unseren Mandanten erbracht wurden.

Aufschlüsselung:
— Hauptforderung: 512,00 EUR
— Mahnkosten (3 Mahnungen): 75,00 EUR
— Inkassogebühren und Bearbeitungskosten: 260,00 EUR

Eine Kopie des ursprünglichen Vertrags ist diesem Schreiben nicht beigefügt.
Das Datum der ursprünglichen Leistungserbringung war nach unseren Unterlagen im Jahr 2019.

Wir fordern Sie auf, den Gesamtbetrag von 847,00 EUR innerhalb von 7 Tagen zu überweisen.

Mit freundlichen Grüßen
Creditum Inkasso GmbH
HRB 88441 B · Geschäftsführer: M. Hartmann
    `.trim(),
  },

  "mahnung:tier2-telecom-confusion": {
    type:        "mahnung",
    name:        "Test User",
    email:       null,
    description: "Tier-2 Mahnung — Telekommunikation, unklarer Forderungsübergang",
    textContent: `
FORDERUNGSWERK GMBH
Im Mediapark 8 · 50670 Köln

Frau Anna Schmitt
Gartenstraße 22 · 50823 Köln

Köln, 12. März 2025
Zahlungsaufforderung — Ref. FW/2025/0312-AS

Offener Betrag: 312,00 EUR (inkl. Mahnkosten)

Sehr geehrte Frau Schmitt,

Forderungswerk GmbH hat die Forderung der ConnectTel GmbH gegen Sie übernommen.
Der ursprüngliche Vertrag wurde nach unseren Unterlagen im Jahr 2022 abgeschlossen.

Der Betrag setzt sich wie folgt zusammen:
— Rückstand Grundgebühr: 189,00 EUR (4 Monate)
— Mahnkosten: 30,00 EUR
— Bearbeitungsgebühr: 93,00 EUR

Eine Abtretungsanzeige liegt diesem Schreiben nicht bei.
Der Nachweis über erbrachte Leistungen kann auf Anfrage zugesandt werden.

Bei Nichtreagieren leiten wir rechtliche Schritte ein.

Mit freundlichen Grüßen
Forderungswerk GmbH
    `.trim(),
  },

  "mahnung:tier3-valid-invoice": {
    type:        "mahnung",
    name:        "Test User",
    email:       null,
    description: "Tier-3 Mahnung — nachvollziehbare Forderung, geringe Auffälligkeiten",
    textContent: `
STADTWERKE MÜNCHEN GMBH
Emmy-Noether-Straße 2 · 80992 München

Herrn Klaus Weber
Rosenheimer Str. 45 · 81669 München

München, 5. März 2025
Zahlungserinnerung — Kundennummer 4401-8812

Offener Betrag: 187,50 EUR

Sehr geehrter Herr Weber,

leider haben wir für Ihre Jahresabrechnung Strom/Gas 2024 noch keinen Zahlungseingang
feststellen können.

Aufschlüsselung:
— Nachzahlung Strom (Ablesedatum 28.02.2025, tatsächliche Ablesung): 142,50 EUR
— Nachzahlung Gas (Ablesedatum 28.02.2025, tatsächliche Ablesung): 45,00 EUR

Bitte überweisen Sie den Betrag von 187,50 EUR bis zum 25. März 2025.
IBAN: DE12 7002 0270 0012 3456 78

Mit freundlichen Grüßen
Stadtwerke München GmbH
    `.trim(),
  },

  // ── Parking ───────────────────────────────────────────────────────────────

  "parking:tier1-unclear-signage": {
    type:        "parking",
    name:        "Test User",
    email:       null,
    description: "Tier-1 private PCN — onduidelijke bebording, geen bewijs bijgevoegd",
    textContent: `
EURO CAR PARKS LIMITED
PO Box 1230 · Manchester M1 9WT

PARKING CHARGE NOTICE

Vehicle Registration: AB21 XYZ
Date of Event: 14 March 2025
Location: Manchester Arndale Car Park, Level 3
Charge Amount: £100 (reduced to £60 if paid within 14 days)
PCN Reference: ECP-2025-441829

You have received this Parking Charge Notice because your vehicle was observed
parked in breach of the terms and conditions displayed at this car park.

Alleged breach: Parked beyond permitted stay (max 2 hours)
Observed stay: 3 hours 14 minutes (ANPR entry 10:12, exit 13:26)

No photographic evidence is enclosed with this notice.
No signage photographs are enclosed.
Authority to manage this car park: not stated in this notice.

Payment must be made within 28 days.
    `.trim(),
  },

  "parking:tier2-anpr-mismatch": {
    type:        "parking",
    name:        "Test User",
    email:       null,
    description: "Tier-2 private PCN — ANPR timing inconsistentie, lichte aandachtspunten",
    textContent: `
SMART PARKING LTD
Central House · Leeds LS1 2AB

NOTICE TO KEEPER

Vehicle Registration: DX19 RKT
Date of Event: 22 February 2025
Location: Retail Park, Station Road, Leeds
PCN Reference: SP/2025/0882/DX

Amount outstanding: £85

Dear Keeper,

We write as the registered keeper of the above vehicle.

Our records indicate your vehicle was present at the above location on 22 February 2025.
Entry recorded: 14:03
Exit recorded: 16:31
Permitted stay: 2 hours 30 minutes
Alleged overstay: 28 minutes

Please note: our ANPR system records entry and exit times at the barrier.
Grace periods of 10 minutes apply at entry and exit per our terms.

This notice has been issued under the Protection of Freedoms Act 2012.
Keeper liability applies from the date of this notice.

Appeal rights and POPLA details are shown overleaf.
    `.trim(),
  },

  // ── Bill ──────────────────────────────────────────────────────────────────

  "bill:tier2-unclear-utility-fee": {
    type:        "bill",
    name:        "Test User",
    email:       null,
    description: "Tier-2 energierekening — geschatte aflezingen, onduidelijke toeslag",
    textContent: `
OVO ENERGY LTD
1 Rivergate · Bristol BS1 6EH
Account: 44012-887

Ms Sarah Collins
14 Maple Avenue · Bristol BS6 5AT

Date: 10 March 2025
Your energy bill — period 1 December 2024 to 28 February 2025

ELECTRICITY
Opening read (01/12/24): 12,450 kWh (ESTIMATED)
Closing read (28/02/25): 13,210 kWh (ESTIMATED)
Units used: 760 kWh
Unit rate: 28.5p/kWh — £216.60
Standing charge: 53p/day × 89 days — £47.17

ADDITIONAL CHARGES
Smart meter installation fee: £45.00 (reason: not stated)
Previous balance adjustment: £23.50 (reference: not stated)

Total due: £332.27
Payment due: 5 April 2025

Direct debit will increase from £95/month to £127/month from 1 May 2025.
Reason for increase: not explained in this bill.
    `.trim(),
  },

};

export function getTestCase(type, caseName) {
  const key = `${type}:${caseName}`;
  return TEST_CASES[key] || null;
}

export function listTestCases() {
  return Object.keys(TEST_CASES).map(key => {
    const [type, caseName] = key.split(":");
    return { key, type, caseName, description: TEST_CASES[key].description };
  });
}

export { BLANK_PDF_B64 };
