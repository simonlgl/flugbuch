// Datenhaltung: Referenzdaten (Flughäfen, Airlines), Flüge aus dem Repo + lokale Änderungen,
// abgeleitete Werte (Distanz, Dauer, UTC-Zeiten).

export const ref = { airports: {}, airlines: {}, countries: {}, airlinesIcao: {}, atlas: null };
export const state = { repo: [], repoVersion: 0, flights: [] };

const LOCAL_KEY = 'flugbuch.lokal.v1';
const EARTH_KM = 6371.0088;

export async function loadReference() {
  const [airports, airlines, countries, atlas] = await Promise.all(
    ['data/airports.json', 'data/airlines.json', 'data/countries.json', 'vendor/countries-110m.json']
      .map((u) => fetch(u).then((r) => r.json())),
  );
  Object.assign(ref, { airports, airlines, countries, atlas });
  for (const [iata, a] of Object.entries(airlines)) if (a[1]) ref.airlinesIcao[a[1]] = iata;
}

export async function loadRepoFlights() {
  try {
    const r = await fetch('data/flights.json', { cache: 'no-cache' });
    const j = await r.json();
    state.repo = j.flights || [];
    state.repoVersion = j.version || 0;
  } catch (e) {
    console.warn('flights.json nicht geladen', e);
  }
  rebuild();
}

// --- lokale Änderungen (nur auf diesem Gerät) ---
export function local() {
  try {
    const l = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (l) return { added: l.added || [], overrides: l.overrides || {}, deleted: l.deleted || [] };
  } catch {}
  return { added: [], overrides: {}, deleted: [] };
}
function saveLocal(l) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(l));
  rebuild();
}

export function upsertFlight(f) {
  const l = local();
  if (!f.id) f.id = newId(f);
  const i = l.added.findIndex((x) => x.id === f.id);
  if (i >= 0) l.added[i] = f;
  else if (state.repo.some((x) => x.id === f.id)) l.overrides[f.id] = f;
  else l.added.push(f);
  saveLocal(l);
  return f.id;
}
export function addFlights(list) {
  const l = local();
  for (const f of list) { if (!f.id) f.id = newId(f); l.added.push(f); }
  saveLocal(l);
}
export function deleteFlight(id) {
  const l = local();
  const i = l.added.findIndex((x) => x.id === id);
  if (i >= 0) l.added.splice(i, 1);
  else { delete l.overrides[id]; if (!l.deleted.includes(id)) l.deleted.push(id); }
  saveLocal(l);
}
export function resetLocal() { localStorage.removeItem(LOCAL_KEY); rebuild(); }
export function hasLocalChanges() {
  const l = local();
  return l.added.length + Object.keys(l.overrides).length + l.deleted.length > 0;
}

export function newId(f) {
  const base = `${f.date || 'x'}-${(f.flightNo || `${f.from}${f.to}`).replace(/\s/g, '')}`.toLowerCase();
  const all = new Set([...state.repo, ...local().added].map((x) => x.id));
  let id = base, n = 2;
  while (all.has(id)) id = `${base}-${n++}`;
  return id;
}

/** Alle Flüge = Repo + lokale Ergänzungen/Änderungen − gelöschte, angereichert und sortiert. */
export function rebuild() {
  const l = local();
  const del = new Set(l.deleted);
  const list = [];
  for (const f of state.repo) {
    if (del.has(f.id)) continue;
    list.push({ ...(l.overrides[f.id] || f), _src: l.overrides[f.id] ? 'geändert' : 'repo' });
  }
  for (const f of l.added) list.push({ ...f, _src: 'lokal' });
  state.flights = list.map(enrich).sort((a, b) => b._depUtc - a._depUtc);
  document.dispatchEvent(new CustomEvent('flights-changed'));
}

/** Für den Export an Claude / ins Repo: Flüge ohne berechnete Felder. */
export function plain(f) {
  const o = {};
  for (const [k, v] of Object.entries(f)) if (!k.startsWith('_') && v !== '' && v != null) o[k] = v;
  return o;
}

// --- Berechnungen ---
export function airport(code) {
  const a = ref.airports[code];
  return a ? { code, name: a[0], city: a[1] || a[0], country: a[2], lat: a[3], lon: a[4], tz: a[5], icao: a[6] } : null;
}
export function airlineName(code) { return ref.airlines[code]?.[0] || code || ''; }

export function distanceKm(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

const tzFmt = {};
function tzOffsetMs(utcMs, tz) {
  try {
    const f = (tzFmt[tz] ??= new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
  } catch { return 0; }
}
/** Lokale Zeit (Datum + HH:MM) in einer Zeitzone → UTC-Millisekunden */
export function localToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '12:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - tzOffsetMs(guess, tz);
  utc = guess - tzOffsetMs(utc, tz);
  return utc;
}
export function addDays(date, n) {
  const t = new Date(`${date}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function enrich(f) {
  const o = { ...f };
  o._from = airport(f.from); o._to = airport(f.to);
  o._km = o._from && o._to ? distanceKm(o._from, o._to) : 0;
  const tzA = o._from?.tz || 'UTC', tzB = o._to?.tz || 'UTC';
  const depT = f.depActual || f.dep, arrT = f.arrActual || f.arr;
  o._depUtc = localToUtc(f.date, depT || '12:00', tzA);
  if (f.durationMin) {
    o._min = +f.durationMin;
  } else if (depT && arrT) {
    let arrUtc = localToUtc(f.arrDate || f.date, arrT, tzB);
    if (!f.arrDate) while (arrUtc <= o._depUtc) arrUtc += 86400000;
    o._min = Math.round((arrUtc - o._depUtc) / 60000);
  } else {
    o._min = Math.round(30 + (o._km / 820) * 60); // grobe Schätzung aus der Distanz
    o._minEstimated = true;
  }
  o._arrUtc = o._depUtc + o._min * 60000;
  o._arrDate = f.arrDate || isoDateIn(o._arrUtc, tzB);
  o._year = +f.date.slice(0, 4);
  o._future = o._depUtc > Date.now();
  o._airline = f.airline || (f.flightNo ? f.flightNo.replace(/\s/g, '').slice(0, 2).toUpperCase() : '');
  return o;
}
function isoDateIn(utcMs, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(utcMs)); }
  catch { return new Date(utcMs).toISOString().slice(0, 10); }
}

// --- Airport-Suche für Eingabefelder ---
export function searchAirports(q, limit = 8) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const [code, a] of Object.entries(ref.airports)) {
    const c = code.toLowerCase();
    let score = -1;
    if (c === q) score = 100;
    else if (a[6]?.toLowerCase() === q) score = 90;
    else if (a[1].toLowerCase().startsWith(q)) score = 50;
    else if (a[0].toLowerCase().includes(q)) score = 30;
    else if (a[1].toLowerCase().includes(q)) score = 20;
    if (score >= 0) hits.push([score + (a[7] || 0) * 12, code]);
  }
  return hits.sort((x, y) => y[0] - x[0]).slice(0, limit).map((h) => airport(h[1]));
}
