# TAXO

Strumento web open per stimare il costo di una corsa in taxi nelle principali città italiane (Roma, Milano, Napoli, Torino, Firenze, Bologna), partendo dalle tariffe ufficiali pubblicate dai Comuni.

**Non è un'app commerciale.** Non chiama taxi, non prenota, non incassa pagamenti. Mostra solo cosa dovresti pagare secondo le tariffe in vigore, così non vieni truffato.

## Stack

- **Client**: PWA statica, vanilla JS (o Svelte). Mobile-first. Funziona offline per le tariffe fisse.
- **Hosting**: Cloudflare Pages o Netlify (gratuito).
- **Routing/geocoding**: OSRM + Nominatim. Nominatim self-hosted appena il traffico lo giustifica; OSRM via istanza pubblica `router.project-osrm.org` per la v1, self-hosted in v2.
- **Dati tariffari**: file JSON statico versionato in questo repo Git. Servito via CDN, cacheable.
- **Backoffice**: nessun pannello admin. Aggiornamenti via Pull Request.
- **Watcher**: GitHub Action settimanale che fa hash delle pagine ufficiali; apre una issue se cambiano.
- **Tool diff manuale**: CLI in `scripts/tariff-update.mjs` per aggiornare le tariffe a partire da una delibera.

## Layout del repo

```
.
├── data/
│   └── tariffs.json          # Fonte di verità delle tariffe, versionata
│   └── source-hashes.json    # Generato dal watcher
├── schema/
│   └── tariffs.schema.json   # JSON Schema di validazione
├── scripts/
│   ├── engine.ts             # Engine di calcolo, indipendente da UI
│   ├── watcher.mjs           # Watcher pagine ufficiali
│   ├── tariff-update.mjs     # Tool CLI di aggiornamento manuale
│   └── gh-utils.mjs
├── i18n/
│   ├── it.json
│   ├── en.json
│   ├── es.json (todo)
│   ├── fr.json (todo)
│   └── de.json (todo)
├── public/                   # PWA statica
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js                 # Service worker per offline-first
│   └── app.js
└── .github/workflows/
    └── tariff-watcher.yml
```

## Flusso di aggiornamento tariffe

Pensato per essere il più friction-less possibile pur restando difendibile.

1. **Watcher**. Lunedì mattina la GitHub Action fa scraping leggero delle pagine tariffarie ufficiali, calcola hash del contenuto e lo confronta con quello precedente.
2. **Issue automatica**. Se rileva variazioni o errori HTTP, apre una issue con i link da rivedere.
3. **Revisione umana**. Un maintainer apre i link, verifica se è cambiata realmente una tariffa (vs. modifica cosmetica al sito comunale), recupera la delibera.
4. **Aggiornamento**. Il maintainer lancia `node scripts/tariff-update.mjs <city>`, segue il prompt interattivo, valida contro lo schema.
5. **PR**. Apre PR con il diff del JSON e link alla delibera. Mai commit diretto su main.
6. **Deploy**. Merge → Cloudflare Pages rebuilda → CDN invalidata → utenti vedono la nuova tariffa entro pochi minuti.

Lo storico completo delle tariffe rimane in Git: `git log data/tariffs.json` ricostruisce ogni cambiamento.

## Modello dati: principi

- Ogni città ha un array `tariff_versions`. Ogni versione ha `valid_from` e `valid_to`.
- Si tiene SEMPRE lo storico. Non si sostituisce mai una versione, si aggiunge.
- Ogni versione ha un campo `source` con titolo della delibera + URL. Senza questo non è valida.
- Tariffe chilometriche progressive sono modellate nativamente (vedi Roma, Torino).
- Le tariffe fisse aeroportuali sono `fixed_routes`; le tariffe con tetto massimo sono `max_capped_routes` (es. Torino, Roma GRA).
- Tariffe collettive (Napoli) hanno `per_person: true`.

## Calcolo: filosofia

- Mai un numero al centesimo. Sempre un **range** ±10–15%.
- Mostra sempre il **breakdown** (scatto + km + tempo + supplementi).
- Mostra sempre la **fonte** della tariffa (delibera + data).
- In modalità GPS live, confronto del percorso effettivo con il percorso ottimale via OSRM → segnala possibili "giri lunghi".

## Cose volutamente NON nel progetto v1

- Account utente, registrazione, profili.
- Pagamenti, prenotazioni, ride hailing.
- Recensioni di tassisti, sistemi reputazionali.
- Tracciamento utente o analytics non-essenziali.
- Pubblicità.

L'unico touchpoint con "il sistema" è il pulsante **Segnala abuso**, che apre un mailto: precompilato verso l'email del Comune competente, con i dati della corsa e il numero CP del taxi.

## Note legali (da rifinire prima del rilascio)

- Strumento informativo. Non sostituisce il tassametro ufficiale e non costituisce prova in sede di contestazione.
- Le stime sono basate su tariffe ufficiali pubblicate; in caso di discrepanza fa fede la delibera comunale citata.
- Privacy: nessun dato personale raccolto. Le richieste di routing al provider sono in chiaro e potrebbero essere loggate dal provider stesso (vedi privacy policy di OSRM/Nominatim).
