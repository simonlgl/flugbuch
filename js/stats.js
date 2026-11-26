// Kennzahlen über eine Liste von Flügen.
import { ref, airlineName } from './data.js';

export const EARTH_KM = 40075;
export const MOON_KM = 384400;
export const SUN_KM = 4370005; // Umfang der Sonne
export const LONG_HAUL_MIN = 6 * 60;
const CONNECTION_MS = 8 * 3600 * 1000;

export const REGIONS = [
  ['NA', 'Nordamerika'], ['CB', 'Karibik'], ['EU', 'Europa'], ['AS', 'Asien'], ['AF', 'Afrika'],
  ['CA', 'Mittelamerika'], ['ME', 'Nahost'], ['OC', 'Ozeanien'], ['SA', 'Südamerika'],
];

function count(list, keyFn, weight = () => 1) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (k == null || k === '') continue;
    const e = m.get(k) || { key: k, n: 0, km: 0, min: 0 };
    e.n += weight(x); e.km += x._km || 0; e.min += x._min || 0;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.km - a.km);
}

/** Flughafen-Besuche: Umsteigen unter 8 Stunden zählt als ein Besuch statt zwei. */
function airportVisits(past) {
  const asc = [...past].sort((a, b) => a._depUtc - b._depUtc);
  const visits = new Map();
  const add = (code) => visits.set(code, (visits.get(code) || 0) + 1);
  asc.forEach((f, i) => {
    const prev = asc[i - 1];
    const connection = prev && prev.to === f.from && f._depUtc - prev._arrUtc < CONNECTION_MS;
    if (!connection) add(f.from);
    add(f.to);
  });
  return [...visits].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

export function computeStats(flights) {
  const past = flights.filter((f) => !f._future && f._from && f._to);
  const km = past.reduce((s, f) => s + f._km, 0);
  const min = past.reduce((s, f) => s + f._min, 0);
  const airports = airportVisits(past);
  const countryFlights = count(past.flatMap((f) => [...new Set([f._from.country, f._to.country])].map((c) => ({ c }))), (x) => x.c);
  const airlines = count(past, (f) => f._airline);
  const aircraft = count(past, (f) => normalizeAircraft(f.aircraft));
  const routes = count(past, (f) => [f.from, f.to].sort().join('–'));
  const regs = count(past, (f) => f.reg);
  const years = count(past, (f) => f._year).sort((a, b) => a.key - b.key);
  const months = Array.from({ length: 12 }, (_, i) => ({ key: i, n: 0 }));
  const weekdays = Array.from({ length: 7 }, (_, i) => ({ key: i, n: 0 }));
  const hours = Array.from({ length: 24 }, (_, i) => ({ key: i, n: 0 }));
  for (const f of past) {
    months[+f.date.slice(5, 7) - 1].n++;
    weekdays[(new Date(`${f.date}T12:00:00Z`).getUTCDay() + 6) % 7].n++;
    const t = f.depActual || f.dep; if (t) hours[+t.slice(0, 2)].n++;
  }
  // Regionen: besuchte Länder je Region / alle Länder der Region
  const regionTotal = {}, regionVisited = {};
  for (const [iso, r] of Object.entries(ref.regions)) regionTotal[r] = (regionTotal[r] || 0) + 1;
  for (const c of countryFlights) { const r = ref.regions[c.key]; if (r) regionVisited[r] = (regionVisited[r] || 0) + 1; }
  const regions = REGIONS.map(([code, name]) => ({ code, name, n: regionVisited[code] || 0, total: regionTotal[code] || 1 }));

  const byKm = [...past].sort((a, b) => b._km - a._km);
  const byMin = [...past].sort((a, b) => b._min - a._min);
  const allAirports = airports.map((a) => { const f = past.find((x) => x.from === a.key); return f ? f._from : past.find((x) => x.to === a.key)._to; });
  const extreme = (fn) => allAirports.reduce((best, a) => (!best || fn(a, best) ? a : best), null);

  // Verspätungen (nur Flüge mit tatsächlicher Ankunftszeit)
  const delays = past.filter((f) => f.arr && f.arrActual).map((f) => ({ f, d: diffMin(f.arr, f.arrActual) }));
  const late = delays.filter((x) => x.d > 0);

  return {
    n: past.length, km, min,
    upcoming: flights.filter((f) => f._future).sort((a, b) => a._depUtc - b._depUtc),
    earth: km / EARTH_KM, moon: km / MOON_KM, sun: km / SUN_KM,
    airports, countries: countryFlights, airlines, aircraft, routes, regs, years, months, weekdays, hours, regions,
    cabins: count(past, (f) => f.cabin),
    seatTypes: count(past, (f) => f.seatType || seatTypeFromSeat(f.seat)),
    reasons: count(past, (f) => f.reason),
    longest: byKm[0], shortest: byKm[byKm.length - 1],
    longestTime: byMin[0], shortestTime: byMin[byMin.length - 1],
    north: extreme((a, b) => a.lat > b.lat), south: extreme((a, b) => a.lat < b.lat),
    east: extreme((a, b) => a.lon > b.lon), west: extreme((a, b) => a.lon < b.lon),
    domestic: past.filter((f) => f._from.country === f._to.country).length,
    longHaul: past.filter((f) => f._min >= LONG_HAUL_MIN).length,
    estimated: past.filter((f) => f._minEstimated).length,
    delays: { known: delays.length, late: late.length, totalMin: late.reduce((s, x) => s + x.d, 0), worst: late.sort((a, b) => b.d - a.d)[0] },
    past,
    airlineName,
  };
}

function diffMin(a, b) {
  const d = (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3));
  return ((d + 720 + 1440) % 1440) - 720;
}

/** „Airbus A320-214“ → „Airbus A320“ (Untervarianten zusammenfassen) */
export function normalizeAircraft(s) {
  if (!s) return '';
  return s.replace(/\s*\(.*\)$/, '').replace(/^(Airbus A3\d\d)(neo)?-?\d*/i, (_, a, neo) => a + (neo ? 'neo' : ''))
    .replace(/^(Boeing 7\d7)-?(\d)\d*(ER|MAX)?/i, (_, b, v, x) => `${b}-${v}00${x || ''}`)
    .trim();
}
function seatTypeFromSeat(seat) {
  if (!seat) return '';
  const l = seat.slice(-1).toUpperCase();
  if ('AKL'.includes(l)) return 'Fenster';
  if ('CDGH'.includes(l)) return 'Gang';
  if ('BEJ'.includes(l)) return 'Mitte';
  return '';
}

// ---------- Erfolge ----------
export function achievements(s) {
  const p = s.past;
  const months = count(p, (f) => f.date.slice(0, 7));
  const continents = new Set(s.countries.map((c) => ({ CB: 'NA', CA: 'NA', ME: 'AS' }[ref.regions[c.key]] || ref.regions[c.key])).filter(Boolean));
  const early = p.filter((f) => f.dep && f.dep < '07:00' && f.dep >= '04:00').length;
  const night = p.filter((f) => f.dep && f.dep < '04:00').length;
  const equator = p.filter((f) => Math.sign(f._from.lat) !== Math.sign(f._to.lat)).length;
  const dateline = p.filter((f) => Math.abs(f._from.lon - f._to.lon) > 180).length;
  const topAirline = s.airlines[0]?.n || 0;
  const def = (icon, title, text, value, goal) => ({ icon, title, text, value: Math.min(value, goal), goal, done: value >= goal });
  return [
    def('🛫', 'Abgehoben', 'Erster Flug', s.n, 1),
    def('🔟', 'Zweistellig', '10 Flüge', s.n, 10),
    def('🎖️', 'Vielflieger', '25 Flüge', s.n, 25),
    def('🏅', 'Halbe Hundert', '50 Flüge', s.n, 50),
    def('🌍', 'Einmal rum', '40.075 km – einmal um die Erde', Math.round(s.km), EARTH_KM),
    def('🌙', 'Mondfahrt', '384.400 km – bis zum Mond', Math.round(s.km), MOON_KM),
    def('✈️', 'Langstrecke', 'Ein Flug über 6 Stunden', s.longHaul, 1),
    def('🛌', 'Ultralangstrecke', 'Ein Flug über 12 Stunden', p.filter((f) => f._min >= 720).length, 1),
    def('🗺️', 'Weltenbummler', '10 Länder', s.countries.length, 10),
    def('🧭', 'Kontinentsammler', '4 Kontinente', continents.size, 4),
    def('🌐', 'Äquator', 'Den Äquator überflogen', equator, 1),
    def('📅', 'Datumsgrenze', 'Die Datumsgrenze überflogen', dateline, 1),
    def('🏢', 'Flughafen-Fan', '20 verschiedene Flughäfen', s.airports.length, 20),
    def('🏷️', 'Airline-Hopper', '10 verschiedene Airlines', s.airlines.length, 10),
    def('💙', 'Treue Seele', '10 Flüge mit derselben Airline', topAirline, 10),
    def('🌅', 'Frühaufsteher', 'Abflug zwischen 4 und 7 Uhr', early, 1),
    def('🦉', 'Nachteule', 'Abflug nach Mitternacht', night, 1),
    def('🔁', 'Pendler', '4 Flüge in einem Monat', months[0]?.n || 0, 4),
  ];
}
