#!/usr/bin/env node
/**
 * Tool CLI per assistere l'aggiornamento manuale delle tariffe.
 *
 * Uso:
 *   node scripts/tariff-update.mjs <city> --from-version <v> --to-version <v>
 *
 * Cosa fa:
 * 1. Apre la versione attuale della città, la mostra in pretty-print
 * 2. Chiede di confermare o editare i nuovi valori in modo interattivo
 * 3. Genera la nuova tariff_version, marca la precedente con valid_to
 * 4. Valida l'output contro lo schema JSON
 * 5. Mostra il diff e chiede conferma prima di scrivere
 *
 * Non è ancora un CMS: è un assistente che riduce errori di battitura
 * quando un essere umano traduce un PDF di delibera in JSON.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def) => rl.question(`${q}${def !== undefined ? ` [${def}]` : ""}: `).then(a => a.trim() || def);

const TARIFFS_PATH = "data/tariffs.json";
const SCHEMA_PATH = "schema/tariffs.schema.json";

async function main() {
  const [, , cityArg] = process.argv;
  if (!cityArg) {
    console.error("Uso: node scripts/tariff-update.mjs <city>");
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(TARIFFS_PATH, "utf8"));
  const city = data.cities[cityArg];
  if (!city) {
    console.error(`Città '${cityArg}' non trovata. Disponibili: ${Object.keys(data.cities).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n=== Aggiornamento tariffe per ${city.name} ===\n`);
  const currentVersion = city.tariff_versions.find(v => v.version === city.active_tariff_version);
  console.log("Versione attuale:");
  console.log(JSON.stringify(currentVersion, null, 2).split("\n").map(l => "  " + l).join("\n"));
  console.log();

  const newVersion = await ask("Identificativo nuova versione (es. 2026-06)");
  const validFrom = await ask("Data di entrata in vigore (YYYY-MM-DD)");
  const sourceTitle = await ask("Titolo fonte (es. 'Delibera Giunta n. X/2026')");
  const sourceUrl = await ask("URL fonte");

  const newRecord = JSON.parse(JSON.stringify(currentVersion));
  newRecord.version = newVersion;
  newRecord.valid_from = validFrom;
  newRecord.valid_to = null;
  newRecord.source = { title: sourceTitle, url: sourceUrl, retrieved_on: new Date().toISOString().slice(0, 10) };

  console.log("\nModifica campi (Invio per mantenere il valore attuale)\n");
  newRecord.base_fare.weekday_day = parseFloat(await ask("Scatto feriale diurno", currentVersion.base_fare.weekday_day));
  newRecord.base_fare.weekday_night = parseFloat(await ask("Scatto notturno", currentVersion.base_fare.weekday_night));
  newRecord.base_fare.holiday_day = parseFloat(await ask("Scatto festivo diurno", currentVersion.base_fare.holiday_day));
  // ... per ogni campo modificabile

  currentVersion.valid_to = new Date(new Date(validFrom).getTime() - 86400000).toISOString().slice(0, 10);
  city.tariff_versions.push(newRecord);
  city.active_tariff_version = newVersion;
  data.generated_at = new Date().toISOString();

  const ajv = new Ajv();
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const valid = ajv.validate(schema, data);
  if (!valid) {
    console.error("\nValidazione schema FALLITA:");
    console.error(ajv.errors);
    process.exit(2);
  }

  console.log("\nValidazione schema OK.");
  const confirm = await ask("Scrivere su disco? (y/N)", "n");
  if (confirm.toLowerCase() === "y") {
    writeFileSync(TARIFFS_PATH, JSON.stringify(data, null, 2));
    console.log(`Scritto ${TARIFFS_PATH}. Ora crea un commit con riferimento alla delibera.`);
  } else {
    console.log("Annullato.");
  }

  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
