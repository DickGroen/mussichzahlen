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

  // ── Debt (UK) ─────────────────────────────────────────────────────────────

  "debt:tier1-inflated-fees": {
    type:        "debt",
    name:        "Test User",
    email:       null,
    description: "Tier-1 debt collection — inflated fees, no contract enclosed",
    textContent: `
CREDIT RECOVERY SOLUTIONS LTD
12 Finance Street · London EC2V 8RT

Mr James Wilson
44 Oak Road · London SE15 3AB

London, 18 March 2025
Final Demand — Reference: CRS/2025/JW-8821

Total amount due: £1,240.00

Balance breakdown:
— Original balance: £780.00
— Late payment charges: £95.00
— Collection fees: £285.00
— Administration charge: £80.00

No copy of the original agreement is enclosed with this letter.
The original service provider is not named in this correspondence.
The date the original debt arose is not stated.

Payment must be made within 14 days to avoid further action.

Yours faithfully
Credit Recovery Solutions Ltd
    `.trim(),
  },

  // ── Subscription (UK) ────────────────────────────────────────────────────

  "subscription:tier2-unclear-renewal": {
    type:        "subscription",
    name:        "Test User",
    email:       null,
    description: "Tier-2 subscription — auto-renewal unclear, price increase, no exit right mentioned",
    textContent: `
GYMFLEX MEMBERSHIPS LTD
Unit 4, Fitness House · Birmingham B1 2JT

Ms Claire Thompson
8 Park Lane · Birmingham B29 6AB

Date: 1 March 2025
Membership Renewal Notice — Member ID: GF-44109

Your GymFlex membership renews automatically on 1 April 2025.

Current monthly rate: £39.99
Renewed monthly rate: £44.99 (price increase of £5.00/month)

Your membership will renew for a further 12 months unless written notice of
cancellation is received at least 30 days before the renewal date.

Cancellation must be submitted in writing by post only.
Online cancellation is not available for annual memberships.

No information about your right to cancel due to the price increase is provided.
    `.trim(),
  },

  // ── Quote (UK) ───────────────────────────────────────────────────────────

  "quote:tier2-unclear-scope": {
    type:        "quote",
    name:        "Test User",
    email:       null,
    description: "Tier-2 quote — lump sum materials, unclear scope, no timeframe",
    textContent: `
BUILDRIGHT CONTRACTORS LTD
14 Trade Estate · Bristol BS3 2JT

Quote for: Ms Amanda Fox, 22 Clifton Road, Bristol BS8 1AF
Date: 5 March 2025 · Quote Reference: BR/2025/0341

BATHROOM REFURBISHMENT

Labour (allowance): £1,800.00
Materials (lump sum): £1,200.00
Tiling (supply and fit): £600.00
Contingency: £300.00

Total ex VAT: £3,900.00
VAT (20%): £780.00
Total inc VAT: £4,680.00

Notes:
- Waste disposal not included
- Additional works identified during project quoted separately
- 50% deposit required before works commence
- Quote valid for 30 days

No breakdown of materials provided.
No completion timeframe stated.
No guarantee or aftercare information included.
    `.trim(),
  },

  // ── Parkstrafe (DE) ───────────────────────────────────────────────────────

  "parkstrafe:tier1-unclear-signage": {
    type:        "parkstrafe",
    name:        "Test User",
    email:       null,
    description: "Tier-1 private Parkforderung — unklare Beschilderung, kein Beweis beigefügt",
    textContent: `
EURO PARKING MANAGEMENT GMBH
Postfach 1230 · 80001 München

Herrn Klaus Müller
Hauptstraße 14
80333 München

München, 14. März 2025

Zahlungsaufforderung — Ref. EPM/2025/441829

Fahrzeug: M-AB 1234
Datum des Vorfalls: 6. März 2025
Ort: Parkplatz Schillerstraße 12, München
Forderungsbetrag: 65,00 EUR (reduziert auf 39,00 EUR bei Zahlung innerhalb von 14 Tagen)

Sehr geehrter Herr Müller,

Ihr Fahrzeug wurde am oben genannten Datum auf unserem bewirtschafteten Parkplatz festgestellt.
Es wurde ein Verstoß gegen die am Standort ausgeschilderten Nutzungsbedingungen festgestellt.

Behaupteter Verstoß: Überschreitung der zulässigen Parkdauer (max. 2 Stunden)
Festgestellte Parkdauer: 3 Stunden 14 Minuten (ANPR-Einfahrt 10:12 Uhr, Ausfahrt 13:26 Uhr)

Diesem Schreiben liegen keine Fotonachweise bei.
Keine Beschilderungsfotos beigefügt.
Bewirtschaftungsbefugnis durch den Eigentümer: nicht angegeben.

Bitte zahlen Sie den Betrag innerhalb von 28 Tagen.

Mit freundlichen Grüßen
Euro Parking Management GmbH
    `.trim(),
  },

  "parkstrafe:tier2-anpr-mismatch": {
    type:        "parkstrafe",
    name:        "Test User",
    email:       null,
    description: "Tier-2 private Parkforderung — ANPR-Timing, mögliche Kulanzzeit",
    textContent: `
SMART PARKING DEUTSCHLAND GMBH
Zentralstraße 8 · 40210 Düsseldorf

Halterbenachrichtigung

Fahrzeug: D-RK 5678
Datum des Vorfalls: 22. Februar 2025
Ort: Kundenparkplatz Hauptbahnhof, Düsseldorf
Ref.: SPD/2025/0882

Offener Betrag: 49,00 EUR

Sehr geehrte Damen und Herren,

wir wenden uns an Sie als Halter des oben genannten Fahrzeugs.

Unsere Aufzeichnungen zeigen, dass Ihr Fahrzeug am 22. Februar 2025 auf dem oben genannten Parkplatz stand.
Einfahrt erfasst: 14:03 Uhr
Ausfahrt erfasst: 16:31 Uhr
Zulässige Parkdauer: 2 Stunden 30 Minuten
Angebliche Überschreitung: 28 Minuten

Hinweis: Unser ANPR-System erfasst die Ein- und Ausfahrtzeiten an der Schranke.
Kulanzzeiten von 10 Minuten gelten laut unseren Nutzungsbedingungen bei Ein- und Ausfahrt.

Dieses Schreiben erfolgt auf Basis des deutschen Zivilrechts.
Eine Halterhaftung besteht ab dem Datum dieses Schreibens.

Einspruchsmöglichkeiten finden Sie auf der Rückseite.
    `.trim(),
  },

  "parkstrafe:tier3-valid-pcn": {
    type:        "parkstrafe",
    name:        "Test User",
    email:       null,
    description: "Tier-3 behördlicher Bußgeldbescheid — nachvollziehbar, geringe Auffälligkeiten",
    textContent: `
LANDESHAUPTSTADT MÜNCHEN
Kreisverwaltungsreferat — Bußgeldstelle
Ruppertstraße 19 · 80466 München

Herrn Thomas Bauer
Fichtenweg 14 · 10715 Berlin

München, 5. März 2025

Bußgeldbescheid
Aktenzeichen: KVR/2025/BU-441122

Sehr geehrter Herr Bauer,

gegen Sie wird wegen einer Ordnungswidrigkeit nach § 24 StVG ein Bußgeld festgesetzt.

Tatvorwurf: Parken im Halteverbot
Tatdatum: 18. Februar 2025
Tatzeit: 14:32 Uhr
Tatort: Maximilianstraße 22, 80539 München
Bußgeld: 55,00 EUR
Rechtsgrundlage: § 24 Abs. 1 StVG i.V.m. § 13 Abs. 2 BKatV

Gegen diesen Bescheid können Sie innerhalb von zwei Wochen nach Zustellung Einspruch einlegen.

Mit freundlichen Grüßen
Landeshauptstadt München
Kreisverwaltungsreferat
    `.trim(),
  },

  // ── Rechnung (DE) ─────────────────────────────────────────────────────────

  "rechnung:tier1-inflated-invoice": {
    type:        "rechnung",
    name:        "Test User",
    email:       null,
    description: "Tier-1 Rechnung — überhöhte Positionen, fehlende Leistungsnachweise",
    textContent: `
HANDWERKER PROFI GMBH
Werkstraße 14 · 12345 Berlin

Test User
Musterstraße 1
10115 Berlin

Berlin, 5. März 2025

Rechnung Nr. 2025-0441

Sehr geehrte Damen und Herren,

wir berechnen Ihnen für die erbrachten Leistungen an Ihrem Objekt folgende Positionen:

1. Sanitärarbeiten Badezimmer (pauschal)         €1.850,00
2. Materialkosten (pauschal)                       €920,00
3. Anfahrtspauschale (3x)                          €180,00
4. Verwaltungsgebühr                               €150,00
5. Dokumentationspauschale                         €95,00

Gesamtbetrag: €3.195,00

Zahlungsziel: 14 Tage nach Rechnungseingang

Bitte überweisen Sie den Betrag auf unser Konto.

Einzelnachweise über die erbrachten Leistungen sowie Materialbelege werden auf Anfrage zur Verfügung gestellt.

Mit freundlichen Grüßen
Handwerker Profi GmbH
    `.trim(),
  },

  "rechnung:tier2-unclear-fee": {
    type:        "rechnung",
    name:        "Test User",
    email:       null,
    description: "Tier-2 Rechnung — unklare Positionen, keine Einzelaufstellung",
    textContent: `
DIGITAL SERVICES GMBH
Hauptstraße 88 · 80331 München

Test User
Musterstraße 1
10115 Berlin

München, 12. März 2025

Rechnung Nr. DS-2025-0192

Leistungszeitraum: Januar–Februar 2025

Pos. 1: IT-Beratungsleistungen (pauschal)        €780,00
Pos. 2: Softwarelizenz Q1 2025                    €240,00
Pos. 3: Support-Pauschale                         €120,00

Nettobetrag:   €1.140,00
MwSt. 19%:       €216,60
Gesamtbetrag:  €1.356,60

Zahlungsziel: 30 Tage

Hinweis: Eine detaillierte Leistungsbeschreibung ist auf Anfrage erhältlich.

Mit freundlichen Grüßen
Digital Services GmbH
    `.trim(),
  },

  "rechnung:tier3-valid-invoice": {
    type:        "rechnung",
    name:        "Test User",
    email:       null,
    description: "Tier-3 Rechnung — nachvollziehbare Positionen, geringe Auffälligkeiten",
    textContent: `
STADTWERKE KÖLN GMBH
Parkgürtel 24 · 50823 Köln

Test User
Musterstraße 1
10115 Berlin

Köln, 1. März 2025

Jahresrechnung Strom 2024
Kundennummer: 7741-2209
Zählernummer: 1100-4482

Abrechnungszeitraum: 1.1.2024 – 31.12.2024

Verbrauch laut Ablesung vom 15.1.2025: 3.240 kWh
Geleistete Abschlagszahlungen 2024: €960,00
Berechneter Verbrauchspreis: €1.101,60 (€0,34/kWh)
Grundgebühr 2024: €108,00

Gesamtbetrag: €1.209,60
Abzüglich geleisteter Abschläge: -€960,00
Nachzahlungsbetrag: €249,60

Zahlungsfrist: 28 Tage nach Rechnungseingang

Mit freundlichen Grüßen
Stadtwerke Köln GmbH
    `.trim(),
  },

  // ── Vertrag (DE) ──────────────────────────────────────────────────────────

  "vertrag:tier1-unfair-renewal": {
    type:        "vertrag",
    name:        "Test User",
    email:       null,
    description: "Tier-1 Vertrag — automatische Verlängerung, Preiserhöhung ohne Kündigungsrecht",
    textContent: `
FITNESS FIRST GMBH
Sportweg 1 · 10115 Berlin

Test User
Musterstraße 1
10115 Berlin

Berlin, 3. März 2025

Mitteilung zur Vertragsänderung — Mitgliedsnummer FF-2291-04

Sehr geehrte Damen und Herren,

wir informieren Sie über folgende Änderungen Ihres Vertrages:

Ab dem 1. April 2025 erhöht sich Ihr monatlicher Beitrag von 39,90 EUR auf 49,90 EUR.

Ihr Vertrag verlängert sich automatisch um 12 Monate, sofern keine Kündigung erfolgt.
Kündigungsfrist: 6 Wochen vor Vertragsende.

Ein Sonderkündigungsrecht aufgrund der Preiserhöhung besteht nach unseren Vertragsbedingungen nicht.

Die aktualisierten AGB sind auf unserer Website abrufbar.

Mit freundlichen Grüßen
Fitness First GmbH
    `.trim(),
  },

  "vertrag:tier2-unclear-cancellation": {
    type:        "vertrag",
    name:        "Test User",
    email:       null,
    description: "Tier-2 Vertrag — unklare Kündigungsfrist, automatische Verlängerung",
    textContent: `
STREAMPLUS GMBH
Digitalstraße 44 · 80331 München

Test User
Musterstraße 1
10115 Berlin

München, 10. März 2025

Ihre StreamPlus-Mitgliedschaft — Kundennummer SP-9921

Sehr geehrte Damen und Herren,

Ihre Mitgliedschaft wird am 15. April 2025 automatisch um ein weiteres Jahr verlängert.

Monatlicher Beitrag ab Verlängerung: 14,99 EUR

Zur Kündigung wenden Sie sich bitte an unseren Kundenservice. Die Kündigungsfrist entnehmen Sie bitte Ihren Vertragsunterlagen.

Bei Fragen stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen
StreamPlus GmbH
    `.trim(),
  },

  "vertrag:tier3-standard-contract": {
    type:        "vertrag",
    name:        "Test User",
    email:       null,
    description: "Tier-3 Vertrag — nachvollziehbare Vertragsbedingungen",
    textContent: `
TELEKOM DEUTSCHLAND GMBH
Postfach 2000 · 53105 Bonn

Test User
Musterstraße 1
10115 Berlin

Bonn, 1. März 2025

Ihre Vertragsbestätigung — Kundennummer TD-441882

Sehr geehrte Damen und Herren,

wir bestätigen Ihren Vertrag für den Tarif MagentaZuhause M.

Monatlicher Grundpreis: 39,95 EUR
Vertragslaufzeit: 24 Monate ab 1. März 2025
Kündigungsfrist: 1 Monat zum Vertragsende
Automatische Verlängerung: 1 Monat, monatlich kündbar

Im Anhang finden Sie die vollständigen Vertragsunterlagen und AGB.

Mit freundlichen Grüßen
Telekom Deutschland GmbH
    `.trim(),
  },

  // ── Angebot (DE) ──────────────────────────────────────────────────────────

  "angebot:tier1-inflated-quote": {
    type:        "angebot",
    name:        "Test User",
    email:       null,
    description: "Tier-1 Angebot — überhöhte Pauschalpreise, unklarer Leistungsumfang",
    textContent: `
RENOVIERUNG PROFI GMBH
Handwerkerweg 12 · 13355 Berlin

Test User
Musterstraße 1
10115 Berlin

Berlin, 7. März 2025

Angebot Nr. 2025-0112 — Badezimmerrenovierung

Sehr geehrte Damen und Herren,

wir unterbreiten Ihnen folgendes Angebot:

1. Komplettentkernung Badezimmer (pauschal)         €2.800,00
2. Fliesenarbeiten inkl. Material (pauschal)         €4.200,00
3. Sanitärinstallation (pauschal)                    €1.900,00
4. Malerarbeiten (pauschal)                            €850,00
5. Projektmanagement und Koordination                  €600,00

Gesamtbetrag netto:  €10.350,00
MwSt. 19%:            €1.966,50
Gesamtbetrag brutto: €12.316,50

Gültig bis: 21. März 2025

Dieses Angebot ist freibleibend. Einzelaufstellungen und Materiallisten werden nach Auftragserteilung bereitgestellt.

Mit freundlichen Grüßen
Renovierung Profi GmbH
    `.trim(),
  },

  "angebot:tier2-missing-details": {
    type:        "angebot",
    name:        "Test User",
    email:       null,
    description: "Tier-2 Angebot — fehlende Einzelpositionen, kein Zeitplan",
    textContent: `
IT SOLUTIONS GMBH
Technikstraße 5 · 70173 Stuttgart

Test User
Musterstraße 1
10115 Berlin

Stuttgart, 12. März 2025

Angebot — Webseitenentwicklung

Sehr geehrte Damen und Herren,

hiermit bieten wir Ihnen die Entwicklung Ihrer neuen Unternehmenswebseite an.

Leistungsumfang: Entwicklung, Design und Inbetriebnahme einer responsiven Webseite

Festpreis: €4.800,00 netto (inkl. MwSt.: €5.712,00)

Zahlungsbedingungen: 50% bei Auftragserteilung, 50% bei Fertigstellung.

Hinweis: Änderungswünsche nach Projektbeginn werden separat berechnet.

Mit freundlichen Grüßen
IT Solutions GmbH
    `.trim(),
  },

  "angebot:tier3-clear-quote": {
    type:        "angebot",
    name:        "Test User",
    email:       null,
    description: "Tier-3 Angebot — nachvollziehbare Positionen, klarer Leistungsumfang",
    textContent: `
MALER SCHMIDT GMBH
Pinselweg 3 · 50667 Köln

Test User
Musterstraße 1
10115 Berlin

Köln, 5. März 2025

Angebot Nr. 2025-0088 — Malerarbeiten Wohnzimmer

Sehr geehrte Damen und Herren,

wir unterbreiten Ihnen folgendes Angebot für die Malerarbeiten in Ihrem Wohnzimmer (ca. 28 m²):

1. Untergrund vorbereiten, schleifen, grundieren     €180,00
2. 2× Anstrich Wände und Decke (Farbe nach Wahl)    €420,00
3. Materialkosten (Farbe, Grundierung, Abdeckmaterial)  €95,00

Nettobetrag:     €695,00
MwSt. 19%:       €132,05
Gesamtbetrag:    €827,05

Ausführungszeitraum: 2 Tage
Zahlungsziel: 14 Tage nach Fertigstellung

Mit freundlichen Grüßen
Maler Schmidt GmbH
    `.trim(),
  },



  // ── Nebenkosten (DE) ──────────────────────────────────────────────────────

  "nebenkosten:tier1-inflated-costs": {
    type:        "nebenkosten",
    name:        "Test User",
    email:       null,
    description: "Tier-1 Nebenkostenabrechnung — nicht umlagefähige Kosten, fehlender Verteilerschlüssel",
    textContent: `
HAUSVERWALTUNG SCHMIDT GMBH
Verwaltungsstraße 12 · 10115 Berlin

Test User
Musterstraße 1
10115 Berlin

Berlin, 28. Februar 2025

Nebenkostenabrechnung 2024
Mietobjekt: Musterstraße 1, 10115 Berlin, 3. OG links
Kundennummer: 4401-8812

Abrechnungszeitraum: 01.01.2024 – 31.12.2024

Gesamtkosten des Hauses 2024:
– Heizkosten (Öl)                    €12.400,00
– Warmwasser                          €2.100,00
– Hausmeisterkosten                   €3.600,00
– Verwaltungskosten                   €4.800,00
– Instandhaltungsrücklage             €2.400,00
– Gebäudeversicherung                 €1.800,00
– Aufzugswartung                      €1.200,00

Gesamtkosten:                        €28.300,00

Ihr Anteil (Verteilungsschlüssel: Wohnfläche):
Ihre Wohnfläche: 68 m²
Gesamtwohnfläche: nicht angegeben

Ihr Kostenanteil:                     €1.847,00
Geleistete Vorauszahlungen:          -€1.200,00
Nachzahlung:                            €647,00

Zahlungsziel: 30 Tage
    `.trim(),
  },

  "nebenkosten:tier2-unclear-heating": {
    type:        "nebenkosten",
    name:        "Test User",
    email:       null,
    description: "Tier-2 Nebenkostenabrechnung — unklare Heizkostenverteilung",
    textContent: `
WOHNPARK VERWALTUNG GMBH
Parkstraße 5 · 80331 München

Test User
Parkstraße 5, Whg. 12
80331 München

München, 15. Februar 2025

Nebenkostenabrechnung 2024
Wohneinheit: Parkstraße 5, Whg. 12

Abrechnungszeitraum: 01.01.2024 – 31.12.2024

Heizkostenabrechnung:
Grundkosten (30%):                     €380,00
Verbrauchskosten (70%):                €520,00
Gesamtheizkosten:                      €900,00

Betriebskosten:
Wasser/Abwasser:                       €245,00
Hausreinigung:                         €180,00
Versicherungen:                        €156,00

Gesamtbetrag:                        €1.481,00
Vorauszahlungen:                    -€1.320,00
Nachzahlung:                           €161,00

Hinweis: Heizkostenabrechnung basiert auf Schätzwerten, da der Zählerstand für Ihre Einheit im Dezember 2024 nicht abgelesen werden konnte.
    `.trim(),
  },

  "nebenkosten:tier3-standard-billing": {
    type:        "nebenkosten",
    name:        "Test User",
    email:       null,
    description: "Tier-3 Nebenkostenabrechnung — nachvollziehbar, geringe Auffälligkeiten",
    textContent: `
STADTWERKE WOHNEN GMBH
Wohnstraße 8 · 50667 Köln

Test User
Wohnstraße 8, Whg. 4
50667 Köln

Köln, 1. März 2025

Nebenkostenabrechnung 2024
Wohneinheit: Whg. 4, 52 m²

Abrechnungszeitraum: 01.01.2024 – 31.12.2024
Gesamtwohnfläche des Hauses: 624 m²
Ihr Anteil: 8,33%

Kostenaufstellung:
Wasser/Abwasser (Verbrauch lt. Zähler):    €312,00
Heizung (Verbrauch lt. Zähler):            €580,00
Hausreinigung (Fläche):                    €156,00
Gebäudeversicherung (Fläche):               €98,00
Allgemeinstrom (Fläche):                    €44,00

Gesamtkosten Ihr Anteil:                 €1.190,00
Geleistete Vorauszahlungen 2024:        -€1.140,00
Nachzahlung:                               €50,00

Zahlungsziel: 14 Tage nach Zustellung
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
