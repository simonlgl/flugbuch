// CSV-Import (eigenes Format, Flighty-Export, myFlightradar24-Export, generische Spaltennamen) und -Export.
import { ref, airport } from './data.js';

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = [';', '\t', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = []; let field = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// Spaltennamen (klein, ohne Sonderzeichen) → Feld
const ALIAS = {
  date: ['date', 'datum', 'flightdate', 'flugdatum', 'day', 'tag'],
  flightNo: ['flightno', 'flight', 'flightnumber', 'flugnummer', 'flugnr', 'flight_no', 'number', 'nr'],
  airline: ['airline', 'fluggesellschaft', 'carrier', 'airlinecode'],
  from: ['from', 'von', 'origin', 'depairport', 'departureairport', 'abflughafen', 'start', 'abflugort'],
  to: ['to', 'nach', 'destination', 'arrairport', 'arrivalairport', 'zielflughafen', 'ziel', 'ankunftsort'],
  dep: ['dep', 'deptime', 'departuretime', 'abflug', 'abflugzeit', 'std', 'gatedeparturescheduled', 'takeoffscheduled', 'dep_time'],
  arr: ['arr', 'arrtime', 'arrivaltime', 'ankunft', 'ankunftszeit', 'sta', 'gatearrivalscheduled', 'landingscheduled', 'arr_time'],
  depActual: ['gatedepartureactual', 'takeoffactual', 'atd', 'abflugtatsaechlich'],
  arrActual: ['gatearrivalactual', 'landingactual', 'ata', 'ankunfttatsaechlich'],
  durationMin: ['durationmin', 'dauermin', 'minuten'],
  duration: ['duration', 'dauer', 'flugzeit'],
  aircraft: ['aircraft', 'aircrafttypename', 'flugzeug', 'flugzeugtyp', 'aircrafttype', 'type', 'typ', 'equipment'],
  reg: ['reg', 'registration', 'tailnumber', 'kennzeichen', 'registrierung', 'tail'],
  seat: ['seat', 'seatnumber', 'sitz', 'sitzplatz', 'platz'],
  seatType: ['seattype', 'sitztyp', 'sitzart'],
  cabin: ['class', 'cabinclass', 'flightclass', 'klasse', 'cabin', 'buchungsklasse', 'reiseklasse'],
  reason: ['reason', 'flightreason', 'grund', 'reisegrund', 'zweck'],
  note: ['note', 'notes', 'notiz', 'notizen', 'bemerkung', 'kommentar'],
  pnr: ['pnr', 'buchungscode', 'bookingreference'],
  canceled: ['canceled', 'cancelled', 'annulliert', 'gestrichen'],
  depTerminal: ['depterminal', 'abflugterminal'],
  depGate: ['depgate', 'abfluggate'],
};
const norm = (s) => s.toLowerCase().replace(/[äöü]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue' }[c])).replace(/[^a-z0-9_]/g, '');

const CABIN = { 1: 'Economy', 2: 'Business', 3: 'First', 4: 'Premium Economy', 5: 'Private', premium: 'Premium Economy', premium_economy: 'Premium Economy', economy_plus: 'Premium Economy' };
const SEAT_TYPE = { 1: 'Fenster', 2: 'Mitte', 3: 'Gang', window: 'Fenster', middle: 'Mitte', aisle: 'Gang' };
const REASON = { 1: 'Urlaub', 2: 'Geschäftlich', 3: 'Crew', 4: 'Sonstiges', leisure: 'Urlaub', business: 'Geschäftlich', personal: 'Privat' };

/** Wandelt Tabellenzeilen in Flüge um. Gibt { flights, problems } zurück. */
export function rowsToFlights(rows) {
  const [head, ...body] = rows;
  const col = {};
  // Pro Feld alle passenden Spalten in Alias-Reihenfolge merken; genommen wird die erste nicht-leere
  const cols = {};
  for (const [field, names] of Object.entries(ALIAS)) {
    const idx = names.flatMap((name) => head.map((h, i) => (norm(h) === name ? i : -1)).filter((i) => i >= 0));
    if (idx.length) { cols[field] = idx; col[field] = idx[0]; }
  }
  const problems = [];
  if (col.date === undefined && col.dep === undefined) problems.push('Keine Datumsspalte gefunden (z. B. „date“ oder „datum“).');
  if (col.from === undefined || col.to === undefined) {
    if (col.flightNo === undefined) problems.push('Spalten „from“/„to“ (oder „von“/„nach“) fehlen.');
  }
  if (problems.length) return { flights: [], problems, columns: col };

  const flights = [];
  body.forEach((r, n) => {
    const get = (k) => { for (const i of cols[k] || []) { const v = (r[i] ?? '').trim(); if (v) return v; } return ''; };
    const line = n + 2;
    if (/^(true|yes|ja|1)$/i.test(get('canceled'))) return;
    const f = {};
    // Datum + Zeiten (Zeitfelder können ganze ISO-Zeitstempel sein, z. B. im Flighty-Export)
    const depDT = splitDateTime(get('dep'));
    f.date = parseDate(get('date')) || depDT.date;
    if (!f.date) { problems.push(`Zeile ${line}: Datum „${get('date')}“ nicht erkannt – übersprungen.`); return; }
    if (depDT.time) f.dep = depDT.time;
    const arrDT = splitDateTime(get('arr'));
    if (arrDT.time) f.arr = arrDT.time;
    if (arrDT.date && arrDT.date !== f.date) f.arrDate = arrDT.date;
    const da = splitDateTime(get('depActual')).time; if (da) f.depActual = da;
    const aa = splitDateTime(get('arrActual')); if (aa.time) f.arrActual = aa.time;
    if (aa.date && aa.date !== f.date && !f.arrDate) f.arrDate = aa.date;

    f.from = airportCode(get('from'));
    f.to = airportCode(get('to'));
    const fn = get('flightNo').replace(/\s+/g, '').toUpperCase();
    const al = airlineCode(get('airline'));
    if (fn) f.flightNo = /^\d+$/.test(fn) && al ? al + fn : fn;
    if (al) f.airline = al;
    else if (f.flightNo && /^[A-Z0-9]{2}\d/.test(f.flightNo)) f.airline = f.flightNo.slice(0, 2);

    const dur = get('durationMin') || get('duration');
    if (dur && !(f.dep && f.arr)) { const m = parseDuration(dur); if (m) f.durationMin = m; }
    const ac = get('aircraft').replace(/\s*\([A-Z0-9]{3,4}\)\s*$/, ''); if (ac) f.aircraft = ac;
    const reg = get('reg'); if (reg) f.reg = reg.toUpperCase();
    const seat = get('seat'); if (seat) f.seat = seat.toUpperCase();
    const st = get('seatType'); if (st) f.seatType = SEAT_TYPE[st.toLowerCase()] || st;
    const cab = get('cabin'); if (cab) f.cabin = CABIN[cab.toLowerCase()] || cap(cab.replace(/_/g, ' '));
    const rs = get('reason'); if (rs) f.reason = REASON[rs.toLowerCase()] || cap(rs);
    const note = get('note'); if (note) f.note = note;
    const pnr = get('pnr'); if (pnr) f.pnr = pnr;

    const unknown = [f.from, f.to].filter((c) => c && !airport(c));
    if (!f.from || !f.to) {
      if (f.flightNo) f._needsLookup = true;
      else { problems.push(`Zeile ${line}: Abflug-/Zielflughafen fehlt – übersprungen.`); return; }
    } else if (unknown.length) {
      problems.push(`Zeile ${line}: Flughafen ${unknown.join(', ')} unbekannt – übersprungen.`); return;
    }
    flights.push(f);
  });
  return { flights, problems, columns: col };
}

function cap(s) { if (s === s.toUpperCase()) s = s.toLowerCase(); return s.replace(/(^|\s)\S/g, (c) => c.toUpperCase()); }

/** „Frankfurt (FRA/EDDF)“, „FRA“, „EDDF“ → FRA */
export function airportCode(s) {
  if (!s) return '';
  const m = s.match(/\(([A-Z0-9]{3})(?:\/[A-Z0-9]{4})?\)/);
  if (m) return m[1];
  const t = s.trim().toUpperCase();
  if (/^[A-Z0-9]{3}$/.test(t)) return t;
  if (/^[A-Z]{4}$/.test(t)) {
    for (const [code, a] of Object.entries(ref.airports)) if (a[6] === t) return code;
  }
  return t;
}
/** „Lufthansa (LH/DLH)“, „LH“, „DLH“, „Lufthansa“ → LH */
export function airlineCode(s) {
  if (!s) return '';
  const m = s.match(/\(([A-Z0-9]{2})\/[A-Z]{3}\)/); if (m) return m[1];
  const t = s.trim().toUpperCase();
  if (/^[A-Z0-9]{2}$/.test(t)) return t;
  if (/^[A-Z]{3}$/.test(t) && ref.airlinesIcao[t]) return ref.airlinesIcao[t];
  const lower = s.trim().toLowerCase();
  for (const [code, a] of Object.entries(ref.airlines)) if (a[0].toLowerCase() === lower) return code;
  return '';
}

export function parseDate(s) {
  if (!s) return '';
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    // Punkt = deutsch (TT.MM.JJJJ); Schrägstrich: wenn die erste Zahl > 12 ist, TT/MM, sonst MM/TT (US-Exporte)
    let d = m[1], mo = m[2];
    if (s.includes('/') && +m[1] <= 12 && +m[2] > 12) { d = m[2]; mo = m[1]; }
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return '';
}
function splitDateTime(s) {
  if (!s) return {};
  const m = s.match(/(\d{4}-\d{2}-\d{2})?[T\s]*(\d{1,2}):(\d{2})/);
  if (!m) return { date: parseDate(s) };
  return { date: m[1] || '', time: `${m[2].padStart(2, '0')}:${m[3]}` };
}
function parseDuration(s) {
  let m = s.match(/^(\d+):(\d{2})/); if (m) return +m[1] * 60 + +m[2];
  m = s.match(/(\d+)\s*h\D*(\d+)?/i); if (m) return +m[1] * 60 + +(m[2] || 0);
  if (/^\d+$/.test(s)) return +s;
  return 0;
}

// --- Export ---
const EXPORT_COLS = ['date', 'flightNo', 'airline', 'from', 'to', 'dep', 'arr', 'arrDate', 'depActual', 'arrActual',
  'durationMin', 'aircraft', 'reg', 'seat', 'seatType', 'cabin', 'reason', 'pnr', 'note'];
export function toCsv(flights) {
  const esc = (v) => (v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [EXPORT_COLS.join(','), ...flights.map((f) => EXPORT_COLS.map((c) => esc(f[c])).join(','))].join('\n');
}
export const CSV_TEMPLATE = `date,flightNo,from,to,dep,arr,aircraft,reg,seat,cabin,reason,note
2025-03-14,LH400,FRA,JFK,10:05,12:50,Airbus A340-300,D-AIGX,34A,Economy,Urlaub,
2025-03-28,LH401,JFK,FRA,17:45,07:30,,,,Economy,Urlaub,Nachtflug
`;
