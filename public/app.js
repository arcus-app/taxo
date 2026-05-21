/**
 * Taxo — client PWA
 * Vanilla JS, zero dipendenze.
 *
 * Carica i dati tariffari, le stringhe i18n, popola la UI delle 3 modalità.
 * L'engine di calcolo è duplicato qui inline (versione JS dell'engine.ts)
 * per evitare bundling. In v1 si può estrarre in modulo separato.
 */

const ROUTING_BASE = "https://router.project-osrm.org";  // sostituibile con istanza self-hosted
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

const state = {
  tariffs: null,
  i18n: null,
  lang: "it",
  city: "roma",
  mode: "fixed",
  liveSession: null,
};

async function bootstrap() {
  const browserLang = (navigator.language || "it").slice(0, 2);
  state.lang = ["it", "en"].includes(browserLang) ? browserLang : "it";

  const [tariffs, i18n] = await Promise.all([
    fetch("/data/tariffs.json").then(r => r.json()),
    fetch(`/i18n/${state.lang}.json`).then(r => r.json()),
  ]);
  state.tariffs = tariffs;
  state.i18n = i18n;

  applyI18n();
  populateCities();
  bindTabs();
  bindLang();
  renderMode();
}

function t(key) {
  const parts = key.split(".");
  let v = state.i18n;
  for (const p of parts) v = v?.[p];
  return v ?? key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    if (el.querySelector("img")) return;
    el.textContent = t(el.dataset.i18n);
  });
  document.documentElement.lang = state.lang;
}

function populateCities() {
  const sel = document.getElementById("city");
  sel.innerHTML = Object.entries(state.tariffs.cities)
    .map(([id, c]) => `<option value="${id}">${c.name}</option>`)
    .join("");
  sel.value = state.city;
  sel.addEventListener("change", e => {
    state.city = e.target.value;
    renderMode();
  });
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.mode = tab.dataset.mode;
      ["fixed", "meter", "live"].forEach(m => {
        document.getElementById("panel-" + m).hidden = m !== state.mode;
      });
      renderMode();
    });
  });
}

function bindLang() {
  document.getElementById("lang").addEventListener("change", async e => {
    state.lang = e.target.value;
    state.i18n = await fetch(`/i18n/${state.lang}.json`).then(r => r.json());
    applyI18n();
    renderMode();
  });
}

function currentTariff() {
  const city = state.tariffs.cities[state.city];
  return city.tariff_versions.find(v => v.version === city.active_tariff_version);
}

function renderMode() {
  const tv = currentTariff();
  document.getElementById("src").textContent =
    `${t("disclaimer.source_prefix")} ${tv.source.title}`;
  if (state.mode === "fixed") renderFixed(tv);
  if (state.mode === "meter") renderMeter(tv);
  if (state.mode === "live")  renderLive(tv);
}

function renderFixed(tv) {
  const panel = document.getElementById("panel-fixed");
  const allFixed = [...(tv.fixed_routes || []), ...(tv.max_capped_routes || [])];

  if (allFixed.length === 0) {
    panel.innerHTML = `<p>${state.lang === "it"
      ? "In questa città non ci sono tariffe fisse: usa la modalità Tassametro."
      : "No flat fares in this city: use Meter mode."}</p>`;
    return;
  }

  panel.innerHTML = `
    <label data-i18n="fixed.route_label">${t("fixed.route_label")}</label>
    <select id="route">
      ${allFixed.map(r => {
        const name = r.name?.[state.lang] || r.name?.it || r.id;
        const isCap = r.price_cap_eur !== undefined;
        return `<option value="${r.id}" data-cap="${isCap}">${name}${isCap ? " (tetto)" : ""}</option>`;
      }).join("")}
    </select>
    <div class="result" id="fixed-result"></div>
    <div class="warn">${t("fixed.warning_title")}<br><span style="font-weight:400">${t("fixed.warning_body")}</span></div>
  `;
  document.getElementById("route").addEventListener("change", updateFixedResult);
  updateFixedResult();
}

function updateFixedResult() {
  const tv = currentTariff();
  const id = document.getElementById("route").value;
  const route =
    tv.fixed_routes?.find(r => r.id === id) ||
    tv.max_capped_routes?.find(r => r.id === id);
  const isCap = route.price_cap_eur !== undefined;
  const price = isCap ? route.price_cap_eur : route.price_eur;
  const perPerson = route.per_person;
  document.getElementById("fixed-result").innerHTML = `
    <div style="font-size:12px">${isCap ? (state.lang === "it" ? "Tetto massimo" : "Maximum cap") : t("fixed.official_price")}</div>
    <div class="big">€ ${price.toFixed(2).replace(".", ",")}${perPerson ? " /pax" : ""}</div>
    <div style="font-size:12px">${t("fixed.includes_all")}</div>
  `;
}

function renderMeter(tv) {
  const panel = document.getElementById("panel-meter");
  panel.innerHTML = `
    <div class="row">
      <div>
        <label>${state.lang === "it" ? "Distanza (km)" : "Distance (km)"}</label>
        <input type="number" id="km" value="6" min="0.5" step="0.5">
      </div>
      <div>
        <label>${state.lang === "it" ? "Tempo (min)" : "Time (min)"}</label>
        <input type="number" id="min" value="18" min="1" step="1">
      </div>
    </div>
    <label>${t("meter.fare_band")}</label>
    <select id="fascia">
      <option value="weekday_day">${t("meter.weekday_day")}</option>
      <option value="weekday_night">${t("meter.weekday_night")}</option>
      <option value="holiday_day">${t("meter.holiday_day")}</option>
    </select>
    <label style="margin-top:0.75rem">${t("meter.supplements")}</label>
    <div class="checks">
      <label><input type="checkbox" id="sup-bag"> ${t("supplements.luggage")}</label>
      <label><input type="checkbox" id="sup-radio"> ${t("supplements.radio")}</label>
      <label><input type="checkbox" id="sup-pet"> ${t("supplements.pet")}</label>
      <label><input type="checkbox" id="sup-van"> ${t("supplements.minivan")}</label>
    </div>
    <div class="result" id="meter-result"></div>
  `;
  ["km", "min", "fascia", "sup-bag", "sup-radio", "sup-pet", "sup-van"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateMeter);
    document.getElementById(id).addEventListener("change", updateMeter);
  });
  updateMeter();
}

function updateMeter() {
  const tv = currentTariff();
  const km = parseFloat(document.getElementById("km").value) || 0;
  const min = parseFloat(document.getElementById("min").value) || 1;
  const fascia = document.getElementById("fascia").value;
  const extras = {
    luggageItems: document.getElementById("sup-bag").checked ? 2 : 0,
    radioCall: document.getElementById("sup-radio").checked,
    pet: document.getElementById("sup-pet").checked,
    minivan: document.getElementById("sup-van").checked,
  };
  const est = estimateFare(tv, { distanceKm: km, durationMin: min, fareBand: fascia, extras });
  document.getElementById("meter-result").innerHTML = `
    <div style="font-size:12px">${t("meter.estimated_range")}</div>
    <div class="big">€ ${Math.round(est.lowEur)} – € ${Math.round(est.highEur)}</div>
    <div class="breakdown">
      ${est.breakdown.map(b => `<div><span>${b.label}${b.tooltip ? ` <span class="info-icon" title="${b.tooltip}">ⓘ</span>` : ""}</span><span>€ ${b.amountEur.toFixed(2).replace(".", ",")}</span></div>`).join("")}
    </div>
  `;
}

function renderLive(tv) {
  const panel = document.getElementById("panel-live");
  if (!state.liveSession) {
    panel.innerHTML = `
      <p>${state.lang === "it"
        ? "Premi 'Inizia' all'avvio della corsa. A fine corsa confronteremo il percorso effettivo con il percorso ottimale per smascherare un eventuale giro lungo."
        : "Tap 'Start' when the trip begins. At the end we'll compare the actual route with the optimal route to detect possible detours."}</p>
      <button class="primary" id="start-live">${t("live.start")}</button>
    `;
    document.getElementById("start-live").addEventListener("click", startLive);
  } else {
    const elapsed = Math.round((Date.now() - state.liveSession.startTime) / 60000);
    panel.innerHTML = `
      <p>${state.lang === "it" ? "Corsa in corso" : "Trip in progress"} (${elapsed} min)</p>
      <button class="primary" id="stop-live">${t("live.stop")}</button>
    `;
    document.getElementById("stop-live").addEventListener("click", stopLive);
  }
}

function startLive() {
  if (!navigator.geolocation) {
    alert("Geolocalizzazione non disponibile in questo browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    state.liveSession = {
      startTime: Date.now(),
      startCoords: [pos.coords.longitude, pos.coords.latitude],
      track: [],
    };
    renderMode();
  }, err => alert("Errore GPS: " + err.message));
}

async function stopLive() {
  navigator.geolocation.getCurrentPosition(async pos => {
    const endCoords = [pos.coords.longitude, pos.coords.latitude];
    const startCoords = state.liveSession.startCoords;
    const durationMin = (Date.now() - state.liveSession.startTime) / 60000;

    const url = `${ROUTING_BASE}/route/v1/driving/${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}?overview=false`;
    try {
      const r = await fetch(url);
      const data = await r.json();
      const optimalKm = data.routes[0].distance / 1000;
      const optimalMin = data.routes[0].duration / 60;

      const tv = currentTariff();
      const fareBand = inferFareBand();
      const est = estimateFare(tv, {
        distanceKm: optimalKm,
        durationMin: durationMin,
        fareBand,
        extras: {},
      });

      const ratio = durationMin / optimalMin;
      const likelyDetour = ratio > 1.30;

      document.getElementById("panel-live").innerHTML = `
        <div class="result">
          <div style="font-size:12px">${t("meter.estimated_range")}</div>
          <div class="big">€ ${Math.round(est.lowEur)} – € ${Math.round(est.highEur)}</div>
          <div class="breakdown">
            <div><span>${state.lang === "it" ? "Distanza ottimale" : "Optimal distance"}</span><span>${optimalKm.toFixed(1)} km</span></div>
            <div><span>${state.lang === "it" ? "Tempo effettivo" : "Actual time"}</span><span>${durationMin.toFixed(0)} min</span></div>
            <div><span>${state.lang === "it" ? "Tempo ottimale" : "Optimal time"}</span><span>${optimalMin.toFixed(0)} min</span></div>
          </div>
        </div>
        ${likelyDetour ? `<div class="warn">${t("live.detected_detour")}</div>` : `<div class="warn" style="background:#e1f5ee;color:#085041">${t("live.no_detour")}</div>`}
        <button class="primary" id="reset" style="margin-top:0.5rem">${state.lang === "it" ? "Nuova corsa" : "New trip"}</button>
      `;
      document.getElementById("reset").addEventListener("click", () => {
        state.liveSession = null;
        renderMode();
      });
    } catch (e) {
      alert("Errore routing: " + e.message);
    }
  });
}

function inferFareBand() {
  const now = new Date();
  const h = now.getHours();
  const day = now.getDay();
  if (h >= 22 || h < 6) return "weekday_night";
  if (day === 0 || day === 6) return "holiday_day";
  return "weekday_day";
}

function estimateFare(tv, trip) {
  const breakdown = [];
  const baseFare = tv.base_fare[trip.fareBand];
  breakdown.push({ label: state.lang === "it" ? "Scatto iniziale" : "Base fare", amountEur: baseFare });

  let kmCost = 0;
  if (tv.per_km.flat !== undefined) {
    kmCost = trip.distanceKm * tv.per_km.flat;
  } else if (tv.per_km.tiers) {
    let remaining = trip.distanceKm, cum = 0;
    for (const tier of tv.per_km.tiers) {
      const cap = tier.up_to_cumulative_eur;
      if (cap === null) { kmCost += remaining * tier.rate_per_km; break; }
      const eurAvail = cap - cum;
      const kmHere = Math.min(remaining, eurAvail / tier.rate_per_km);
      kmCost += kmHere * tier.rate_per_km;
      cum += kmHere * tier.rate_per_km;
      remaining -= kmHere;
      if (remaining <= 0) break;
    }
  }
  breakdown.push({ label: `${trip.distanceKm.toFixed(1)} km`, amountEur: kmCost });

  const ph = tv.per_hour_under_threshold;
  if (ph) {
    const avgSpeed = trip.distanceKm / (trip.durationMin / 60);
    let cost = 0;
    if (avgSpeed < ph.speed_threshold_kmh) {
      const slowFrac = Math.min(1, (ph.speed_threshold_kmh - avgSpeed) / ph.speed_threshold_kmh);
      cost = (trip.durationMin / 60) * slowFrac * ph.rate_per_hour;
    }
    breakdown.push({
      label: state.lang === "it" ? "Tempo in coda" : "Slow time",
      amountEur: cost,
      tooltip: state.lang === "it"
        ? `Si attiva sotto i ${ph.speed_threshold_kmh} km/h di velocità media (€${ph.rate_per_hour}/h)`
        : `Triggered below ${ph.speed_threshold_kmh} km/h average speed (€${ph.rate_per_hour}/h)`
    });
  }

  if (trip.extras.luggageItems > 0) {
    const s = tv.supplements.find(x => x.id === "luggage_extra");
    if (s) {
      const c = Math.max(0, trip.extras.luggageItems - (s.first_free || 0)) * s.amount_eur;
      if (c > 0) breakdown.push({ label: `${trip.extras.luggageItems} bagagli`, amountEur: c });
    }
  }
  ["radio_call", "pet", "minivan"].forEach(id => {
    const flag = id === "radio_call" ? "radioCall" : id;
    if (trip.extras[flag]) {
      const s = tv.supplements.find(x => x.id === id);
      if (s) breakdown.push({ label: s.label?.[state.lang] || s.label?.it || id, amountEur: s.amount_eur });
    }
  });

  const total = breakdown.reduce((sum, b) => sum + b.amountEur, 0);
  return { lowEur: total * 0.90, midEur: total, highEur: total * 1.15, breakdown };
}

bootstrap();
