/**
 * Service worker minimale per offline-first.
 *
 * Strategia:
 * - Cache-first per asset statici (HTML, CSS, JS, manifest)
 * - Stale-while-revalidate per tariffs.json e file i18n
 *   → l'utente vede subito la versione cached, in background si aggiorna
 *
 * In v1 nessuna gestione versioni service worker; cache invalidata cambiando CACHE_NAME.
 */
const CACHE_NAME = "tassametro-civico-v1";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.json",
  "../data/tariffs.json",
  "../i18n/it.json",
  "../i18n/en.json",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Stale-while-revalidate per i dati versionati
  if (url.pathname.endsWith("/tariffs.json") || url.pathname.includes("/i18n/")) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }
  // Cache-first per il resto
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

function staleWhileRevalidate(req) {
  return caches.open(CACHE_NAME).then(cache =>
    cache.match(req).then(cached => {
      const fetched = fetch(req).then(res => {
        cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
}
