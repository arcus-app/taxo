import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { setOutput } from "./gh-utils.mjs";

/**
 * Pagine ufficiali monitorate.
 * Selettore CSS opzionale per restringere il contenuto da hashare
 * (così piccole variazioni di header/footer non innescano falsi positivi).
 */
const SOURCES = [
  { city: "roma",    url: "https://romamobilita.it/muoversi-a-roma/taxi/", selector: "main" },
  { city: "milano",  url: "https://www.comune.milano.it/servizi/trasporti-e-mobilita/taxi", selector: "main" },
  { city: "napoli",  url: "https://www.comune.napoli.it/flex/cm/pages/ServeBLOB.php/L/IT/IDPagina/1193", selector: "body" },
  { city: "torino",  url: "http://taxitorino.blogspot.com/p/tariffe-metropolitane.html", selector: ".post-body" },
  { city: "firenze", url: "https://www.comune.fi.it/pagina/tariffe-e-supplementi-del-servizio-taxi", selector: "main" },
  { city: "bologna", url: "https://www.comune.bologna.it/servizi-informazioni/taxi", selector: "main" },
];

const HASH_FILE = "data/source-hashes.json";

async function fetchAndHash(source) {
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "TassametroCivico-Watcher/1.0 (https://github.com/.../tassametro-civico)" },
      timeout: 30000,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const html = await res.text();
    const $ = cheerio.load(html);
    const content = source.selector ? $(source.selector).text() : $("body").text();
    const normalized = content.replace(/\s+/g, " ").trim();
    const hash = createHash("sha256").update(normalized).digest("hex");
    return { hash, length: normalized.length };
  } catch (e) {
    return { error: String(e.message) };
  }
}

async function main() {
  const previous = existsSync(HASH_FILE)
    ? JSON.parse(readFileSync(HASH_FILE, "utf8"))
    : {};
  const current = {};
  const changes = [];

  for (const source of SOURCES) {
    const result = await fetchAndHash(source);
    if (result.error) {
      changes.push({ ...source, status: "error", message: result.error });
      continue;
    }
    current[source.city] = { hash: result.hash, length: result.length, checked_at: new Date().toISOString() };
    const prev = previous[source.city];
    if (prev && prev.hash !== result.hash) {
      changes.push({ ...source, status: "changed", previous_hash: prev.hash, current_hash: result.hash });
    } else if (!prev) {
      changes.push({ ...source, status: "first_check", current_hash: result.hash });
    }
  }

  writeFileSync(HASH_FILE, JSON.stringify(current, null, 2));

  const meaningful = changes.filter(c => c.status === "changed" || c.status === "error");
  if (meaningful.length > 0) {
    const lines = [
      `# Watcher tariffe taxi — ${new Date().toISOString().slice(0, 10)}`,
      "",
      `Sono state rilevate ${meaningful.length} variazioni potenziali nelle pagine tariffarie ufficiali.`,
      "",
      "## Variazioni",
      "",
      ...meaningful.map(c =>
        `- **${c.city}** (${c.status}): [${c.url}](${c.url})${c.message ? ` — ${c.message}` : ""}`
      ),
      "",
      "## Cosa fare",
      "",
      "1. Aprire ciascun link e verificare se la modifica riguarda effettivamente le tariffe (vs. modifiche cosmetiche al sito comunale).",
      "2. Se le tariffe sono cambiate, aprire una PR aggiornando `data/tariffs.json` con una nuova `tariff_version`.",
      "3. Includere link/PDF della delibera nel campo `source` del nuovo record.",
      "4. Marcare la versione precedente con `valid_to` pari al giorno prima della nuova entrata in vigore.",
      "",
      "_Generato automaticamente da `.github/workflows/tariff-watcher.yml`_",
    ];
    writeFileSync("watcher-report.md", lines.join("\n"));
    setOutput("changes_detected", "true");
  } else {
    setOutput("changes_detected", "false");
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
