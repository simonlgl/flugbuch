// Prüft data/flights.json, vergibt fehlende ids, sortiert nach Datum und schreibt die Datei sauber formatiert zurück.
// Aufruf: node tools/pruefen.cjs
const fs = require('fs');
const path = require('path');

const DATEI = path.join(__dirname, '..', 'data', 'flights.json');
const airports = require('../data/airports.json');
const airlines = require('../data/airlines.json');
const j = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
const FELDER = ['id', 'date', 'flightNo', 'airline', 'from', 'to', 'dep', 'arr', 'arrDate', 'depActual', 'arrActual',
  'durationMin', 'aircraft', 'reg', 'seat', 'seatType', 'cabin', 'reason', 'depTerminal', 'depGate', 'pnr', 'note', 'via'];

let fehler = 0, warn = 0;
const F = (m) => { console.log(`FEHLER  ${m}`); fehler++; };
const W = (m) => { console.log(`Hinweis ${m}`); warn++; };
const ids = new Set();

j.flights = (j.flights || []).map((f, i) => {
  const wo = `#${i + 1} ${f.date || '?'} ${f.flightNo || ''} ${f.from || '?'}-${f.to || '?'}`;
  for (const k of Object.keys(f)) if (!FELDER.includes(k)) F(`${wo}: unbekanntes Feld „${k}“`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) F(`${wo}: Datum muss JJJJ-MM-TT sein`);
  if (!airports[f.from]) F(`${wo}: Abflughafen „${f.from}“ unbekannt`);
  if (!airports[f.to]) F(`${wo}: Zielflughafen „${f.to}“ unbekannt`);
  for (const k of ['dep', 'arr', 'depActual', 'arrActual']) if (f[k] && !/^\d{2}:\d{2}$/.test(f[k])) F(`${wo}: ${k} muss HH:MM sein`);
  if (f.via !== undefined && !(Array.isArray(f.via) && f.via.every((p) => Array.isArray(p) && p.length === 2
    && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90))) F(`${wo}: via muss eine Liste von [lon, lat]-Punkten sein`);
  if (f.arrDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.arrDate)) F(`${wo}: arrDate muss JJJJ-MM-TT sein`);
  if (f.flightNo && !/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(f.flightNo)) W(`${wo}: Flugnummer „${f.flightNo}“ ungewöhnlich`);
  if (!f.airline && f.flightNo && airlines[f.flightNo.slice(0, 2)]) f.airline = f.flightNo.slice(0, 2);
  if (f.airline && !airlines[f.airline]) W(`${wo}: Airline „${f.airline}“ nicht in der Liste (Name wird nicht angezeigt)`);
  if (!(f.dep && f.arr) && !f.durationMin) W(`${wo}: keine Zeiten → Flugdauer wird geschätzt`);
  if (!f.id) {
    let base = `${f.date}-${(f.flightNo || `${f.from}${f.to}`)}`.toLowerCase(), id = base, n = 2;
    while (ids.has(id)) id = `${base}-${n++}`;
    f.id = id;
  }
  if (ids.has(f.id)) F(`${wo}: id „${f.id}“ doppelt`);
  ids.add(f.id);
  // Felder in fester Reihenfolge, leere weglassen
  return Object.fromEntries(FELDER.filter((k) => f[k] !== undefined && f[k] !== '').map((k) => [k, f[k]]));
});
j.flights.sort((a, b) => (a.date + (a.dep || '')).localeCompare(b.date + (b.dep || '')));

const text = `{\n  "version": ${j.version || 1},\n  "flights": [\n${j.flights.map((f) => `    ${JSON.stringify(f)}`).join(',\n')}\n  ]\n}\n`;
fs.writeFileSync(DATEI, text);
console.log(`${j.flights.length} Flüge, ${fehler} Fehler, ${warn} Hinweise.`);
process.exit(fehler ? 1 : 0);
