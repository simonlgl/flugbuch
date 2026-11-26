// Optionale Flugdaten-Abfrage über AeroDataBox (RapidAPI, kostenloser Basic-Tarif reicht für private Nutzung).
// Der Schlüssel liegt nur im localStorage dieses Geräts.
import { ref } from './data.js';

const KEY = 'flugbuch.apikey';
export const apiKey = {
  get: () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  set: (v) => { try { v ? localStorage.setItem(KEY, v.trim()) : localStorage.removeItem(KEY); } catch {} },
};

const HOST = 'aerodatabox.p.rapidapi.com';

/** Sucht einen Flug (z. B. „LH400“, „2025-03-14“). Gibt eine Liste möglicher Flüge (Teilfelder) zurück. */
export async function lookupFlight(flightNo, date) {
  const key = apiKey.get();
  if (!key) throw new Error('Kein API-Schlüssel hinterlegt (Mehr → Flugdaten-API).');
  const num = flightNo.replace(/\s+/g, '').toUpperCase();
  const url = `https://${HOST}/flights/number/${encodeURIComponent(num)}/${date}?withAircraftImage=false&withLocation=false`;
  const res = await fetch(url, { headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': HOST } });
  if (res.status === 204 || res.status === 404) return [];
  if (res.status === 401 || res.status === 403) throw new Error('API-Schlüssel ungültig oder AeroDataBox nicht abonniert.');
  if (res.status === 429) throw new Error('API-Limit erreicht – später erneut versuchen.');
  if (!res.ok) throw new Error(`API-Fehler ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [data]).map((x) => toFlight(x, num, date)).filter((f) => f.from && f.to);
}

function localTime(t) {
  const s = t?.local || t?.scheduledTimeLocal || (typeof t === 'string' ? t : '');
  const m = s.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? { date: m[1], time: m[2] } : {};
}

function toFlight(x, num, date) {
  const d = x.departure || {}, a = x.arrival || {};
  const dep = localTime(d.scheduledTime || d.scheduledTimeLocal);
  const arr = localTime(a.scheduledTime || a.scheduledTimeLocal);
  const depAct = localTime(d.revisedTime || d.actualTime || d.runwayTime);
  const arrAct = localTime(a.revisedTime || a.actualTime || a.runwayTime);
  const f = {
    date: dep.date || date,
    flightNo: (x.number || num).replace(/\s+/g, ''),
    airline: x.airline?.iata || (x.airline?.icao && ref.airlinesIcao[x.airline.icao]) || num.slice(0, 2),
    from: d.airport?.iata || '',
    to: a.airport?.iata || '',
    dep: dep.time, arr: arr.time,
    aircraft: x.aircraft?.model || '',
    reg: x.aircraft?.reg || '',
    depTerminal: d.terminal || '', depGate: d.gate || '',
  };
  if (arr.date && arr.date !== f.date) f.arrDate = arr.date;
  if (depAct.time && depAct.time !== f.dep) f.depActual = depAct.time;
  if (arrAct.time && arrAct.time !== f.arr) f.arrActual = arrAct.time;
  for (const k of Object.keys(f)) if (!f[k]) delete f[k];
  f._status = x.status || '';
  return f;
}
