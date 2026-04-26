
import mahnungTriage from "../../prompts/mahnung/triage.js";
import mahnungHaiku from "../../prompts/mahnung/haiku.js";
import mahnungSonnet from "../../prompts/mahnung/sonnet.js";

import parkstrafeTriage from "../../prompts/parkstrafe/triage.js";
import parkstrafeHaiku from "../../prompts/parkstrafe/haiku.js";
import parkstrafeSonnet from "../../prompts/parkstrafe/sonnet.js";

import rechnungTriage from "../../prompts/rechnung/triage.js";
import rechnungHaiku from "../../prompts/rechnung/haiku.js";
import rechnungSonnet from "../../prompts/rechnung/sonnet.js";

import vertragTriage from "../../prompts/vertrag/triage.js";
import vertragHaiku from "../../prompts/vertrag/haiku.js";
import vertragSonnet from "../../prompts/vertrag/sonnet.js";

export const PROMPTS = {
  mahnung: {
    triage: mahnungTriage,
    haiku:  mahnungHaiku,
    sonnet: mahnungSonnet
  },
  parkstrafe: {
    triage: parkstrafeTriage,
    haiku:  parkstrafeHaiku,
    sonnet: parkstrafeSonnet
  },
  rechnung: {
    triage: rechnungTriage,
    haiku:  rechnungHaiku,
    sonnet: rechnungSonnet
  },
  vertrag: {
    triage: vertragTriage,
    haiku:  vertragHaiku,
    sonnet: vertragSonnet
  }
};

export function loadPrompts(type) {
  const prompts = PROMPTS[type];
  if (!prompts) throw new Error(`Unbekannter Typ: ${type}`);
  return prompts;
}
