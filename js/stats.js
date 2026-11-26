// Kennzahlen über eine Liste von Flügen.
import { airlineName } from './data.js';

const EARTH_CIRCUMFERENCE = 40075;
const MOON = 384400;

function count(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (k == null || k === '') continue;
    const e = m.get(k) || { key: k, n: 0, km: 0, min: 0 };
    e.n++; e.km += x._km || 0; e.min += x._min || 0;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.km - a.km);
}

export function computeStats(flights) {
  const past = flights.filter((f) => !f._future && f._from && f._to);
  const km = past.reduce((s, f) => s + f._km, 0);
  const min = past.reduce((s, f) => s + f._min, 0);
  const airports = count(past.flatMap((f) => [f._from, f._to]), (a) => a.code);
  const countries = count(past.flatMap((f) => [f._from, f._to]), (a) => a.country);
  const airlines = count(past, (f) => f._airline);
  const aircraft = count(past, (f) => normalizeAircraft(f.aircraft));
  const routes = count(past, (f) => [f.from, f.to].sort().join(' – '));
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
  const byKm = [...past].sort((a, b) => b._km - a._km);
  const allAirports = airports.map((a) => past.find((f) => f.from === a.key)?._from || past.find((f) => f.to === a.key)?._to);
  const extreme = (fn) => allAirports.reduce((best, a) => (!best || fn(a, best) ? a : best), null);

  return {
    n: past.length, km, min,
    upcoming: flights.filter((f) => f._future).length,
    earth: km / EARTH_CIRCUMFERENCE, moon: km / MOON,
    airports, countries, airlines, aircraft, routes, regs, years, months, weekdays, hours,
    cabins: count(past, (f) => f.cabin),
    seatTypes: count(past, (f) => f.seatType || seatTypeFromSeat(f.seat)),
    reasons: count(past, (f) => f.reason),
    longest: byKm[0], shortest: byKm[byKm.length - 1],
    north: extreme((a, b) => a.lat > b.lat), south: extreme((a, b) => a.lat < b.lat),
    east: extreme((a, b) => a.lon > b.lon), west: extreme((a, b) => a.lon < b.lon),
    domestic: past.filter((f) => f._from.country === f._to.country).length,
    estimated: past.filter((f) => f._minEstimated).length,
    airlineName,
  };
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
  if ('AK'.includes(l) || l === 'L') return 'Fenster';
  if ('CDGH'.includes(l)) return 'Gang';
  if ('BEJ'.includes(l)) return 'Mitte';
  if (l === 'F') return ''; // je nach Flugzeug Fenster oder Gang
  return '';
}
