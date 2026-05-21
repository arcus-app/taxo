/**
 * Tassametro Civico — engine di calcolo
 * Indipendente da DOM. Riceve dati + input, restituisce stima.
 *
 * Output: range di stima (lo / hi) + breakdown spiegabile.
 * Filosofia: meglio onesti su +/- 10-15% che falsamente precisi.
 */

export type FareBand = "weekday_day" | "weekday_night" | "holiday_day";

export interface TripInput {
  distanceKm: number;
  durationMin: number;
  fareBand: FareBand;
  extras: {
    luggageItems?: number;
    radioCall?: boolean;
    pet?: boolean;
    minivan?: boolean;
  };
}

export interface FareEstimate {
  lowEur: number;
  midEur: number;
  highEur: number;
  breakdown: BreakdownItem[];
  warnings: string[];
  sourceTitle: string;
  sourceUrl: string;
}

export interface BreakdownItem {
  label: string;
  amountEur: number;
}

/**
 * Calcola la componente chilometrica gestendo tariffe progressive
 * con scatti cumulativi (T1/T2/T3 di Roma, Torino).
 */
function computeKmCost(perKm: any, distanceKm: number): number {
  if (perKm.flat !== undefined) {
    return distanceKm * perKm.flat;
  }
  if (perKm.tiers) {
    // Simulazione semplificata: assume velocità >= soglia, applica progressione su km.
    // Modello più raffinato: i tier sono basati su EUR cumulati totali, qui
    // approssimiamo distribuendo i km nelle fasce per cumulato proporzionale.
    let totalEur = 0;
    let remainingKm = distanceKm;
    let cumulative = 0;
    for (const tier of perKm.tiers) {
      const cap = tier.up_to_cumulative_eur;
      const rate = tier.rate_per_km;
      if (cap === null || cap === undefined) {
        totalEur += remainingKm * rate;
        return totalEur;
      }
      // Quanti km posso fare in questo tier prima di superare il cumulato?
      const eurAvailable = cap - cumulative;
      const kmInThisTier = Math.min(remainingKm, eurAvailable / rate);
      totalEur += kmInThisTier * rate;
      cumulative += kmInThisTier * rate;
      remainingKm -= kmInThisTier;
      if (remainingKm <= 0) return totalEur;
    }
    return totalEur;
  }
  return 0;
}

/**
 * Calcola la componente oraria sotto soglia velocità.
 * Approssimazione: assumiamo che metà del tempo sia "fermo" sotto soglia
 * se la velocità media è bassa.
 */
function computeHourCost(perHour: any, durationMin: number, distanceKm: number): number {
  if (!perHour) return 0;
  const avgSpeedKmh = distanceKm / (durationMin / 60);
  if (avgSpeedKmh >= perHour.speed_threshold_kmh) return 0;
  // Frazione del tempo sotto soglia (stima euristica):
  // più la velocità è bassa, più tempo si passa effettivamente fermi.
  const slowFraction = Math.min(1, (perHour.speed_threshold_kmh - avgSpeedKmh) / perHour.speed_threshold_kmh);
  const slowHours = (durationMin / 60) * slowFraction;
  return slowHours * perHour.rate_per_hour;
}

export function estimateFare(
  tariffVersion: any,
  trip: TripInput
): FareEstimate {
  const breakdown: BreakdownItem[] = [];
  const warnings: string[] = [];

  // 1. Scatto iniziale
  const baseFare = tariffVersion.base_fare[trip.fareBand];
  breakdown.push({ label: "Scatto iniziale", amountEur: baseFare });

  // 2. Componente chilometrica
  const kmCost = computeKmCost(tariffVersion.per_km, trip.distanceKm);
  breakdown.push({ label: `Distanza ${trip.distanceKm.toFixed(1)} km`, amountEur: kmCost });

  // 3. Componente oraria sotto soglia
  const hourCost = computeHourCost(tariffVersion.per_hour_under_threshold, trip.durationMin, trip.distanceKm);
  if (hourCost > 0) {
    breakdown.push({ label: "Tempo in traffico/sosta", amountEur: hourCost });
  }

  // 4. Supplementi
  if (trip.extras.luggageItems && trip.extras.luggageItems > 0) {
    const luggageSupp = tariffVersion.supplements.find((s: any) => s.id === "luggage_extra");
    if (luggageSupp) {
      const chargeable = Math.max(0, trip.extras.luggageItems - (luggageSupp.first_free ?? 0));
      const cost = chargeable * luggageSupp.amount_eur;
      if (cost > 0) breakdown.push({ label: `${chargeable} bagagli extra`, amountEur: cost });
    }
  }
  if (trip.extras.radioCall) {
    const radioSupp = tariffVersion.supplements.find((s: any) => s.id === "radio_call");
    if (radioSupp) breakdown.push({ label: "Chiamata radio taxi", amountEur: radioSupp.amount_eur });
  }
  if (trip.extras.pet) {
    const petSupp = tariffVersion.supplements.find((s: any) => s.id === "pet");
    if (petSupp) breakdown.push({ label: "Animale", amountEur: petSupp.amount_eur });
  }
  if (trip.extras.minivan) {
    const vanSupp = tariffVersion.supplements.find((s: any) => s.id === "minivan");
    if (vanSupp) breakdown.push({ label: "Minivan/5+", amountEur: vanSupp.amount_eur });
  }

  // 5. Totale e range
  const total = breakdown.reduce((sum, b) => sum + b.amountEur, 0);
  const lowEur = total * 0.90;
  const highEur = total * 1.15;

  // 6. Warning automatici
  if (trip.distanceKm < 1) {
    warnings.push("Tragitto molto breve: la stima può sovrastimare per via dello scatto iniziale dominante.");
  }
  if (trip.fareBand === "weekday_night") {
    warnings.push("Tariffa notturna applicata, scatto iniziale maggiorato.");
  }

  return {
    lowEur,
    midEur: total,
    highEur,
    breakdown,
    warnings,
    sourceTitle: tariffVersion.source.title,
    sourceUrl: tariffVersion.source.url,
  };
}

export interface FixedRouteMatch {
  routeId: string;
  priceEur: number;
  perPerson: boolean;
  warnings: string[];
}

export function lookupFixedRoute(
  tariffVersion: any,
  routeId: string
): FixedRouteMatch | null {
  const route = tariffVersion.fixed_routes?.find((r: any) => r.id === routeId);
  if (!route) return null;
  return {
    routeId: route.id,
    priceEur: route.price_eur,
    perPerson: route.per_person ?? false,
    warnings: [
      "Chiedi la tariffa fissa PRIMA di salire — il tassametro non deve essere attivato.",
      route.applies_when?.direct_route_only ? "Solo percorso diretto, senza deviazioni." : "",
    ].filter(Boolean),
  };
}

/**
 * Modalità GPS live: confronta percorso effettivo con percorso ottimale.
 * Restituisce un'analisi di possibile "giro lungo".
 */
export interface DetourAnalysis {
  actualKm: number;
  optimalKm: number;
  detourRatio: number; // >1 = più lungo dell'ottimale
  isLikelyDetour: boolean;
  estimatedOvercharge: number;
}

export function analyzeDetour(
  actualKm: number,
  optimalKm: number,
  perKmRate: number
): DetourAnalysis {
  const ratio = actualKm / optimalKm;
  const threshold = 1.20; // 20% di tolleranza per variazioni stradali normali
  return {
    actualKm,
    optimalKm,
    detourRatio: ratio,
    isLikelyDetour: ratio > threshold,
    estimatedOvercharge: ratio > threshold ? (actualKm - optimalKm) * perKmRate : 0,
  };
}
