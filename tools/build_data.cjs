// Erzeugt data/airports.json, data/airlines.json und data/countries.json aus den Rohdaten.
// Aufruf: node tools/build_data.cjs <ordner-mit-rohdaten> <pfad-zu-countries-50m.json>
// Rohdaten: airports.csv (OurAirports, Public Domain), airports.dat + airlines.dat (OpenFlights, ODbL)
const fs = require('fs');
const path = require('path');
// Die UMD-Builds wie im Browser laden (hängen sich an globalThis.d3 / globalThis.topojson)
const vm = require('vm');
for (const f of ['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js']) {
  vm.runInThisContext(`(function(){var module,exports,define;${fs.readFileSync(path.join(__dirname, '..', 'vendor', f), 'utf8')}}).call(globalThis)`);
}
const { d3, topojson } = globalThis;

const [roh, atlasPfad] = process.argv.slice(2);
const ZIEL = path.join(__dirname, '..', 'data');

function csvZeilen(text) {
  const zeilen = []; let feld = '', zeile = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inQ = false; }
      else feld += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { zeile.push(feld); feld = ''; }
    else if (c === '\n') { zeile.push(feld.replace(/\r$/, '')); zeilen.push(zeile); zeile = []; feld = ''; }
    else feld += c;
  }
  if (feld || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen;
}

// --- Zeitzonen aus OpenFlights ---
const tzVonIata = {};
const tzPunkte = [];
for (const z of csvZeilen(fs.readFileSync(path.join(roh, 'of_airports.dat'), 'utf8'))) {
  const iata = z[4], tz = z[11];
  if (!tz || tz === '\\N') continue;
  tzPunkte.push([+z[7], +z[6], tz]);
  if (iata && iata !== '\\N') tzVonIata[iata] = tz;
}
function naechsteTz(lon, lat) {
  let best = null, bestD = Infinity;
  for (const [lo, la, tz] of tzPunkte) {
    const d = d3.geoDistance([lon, lat], [lo, la]);
    if (d < bestD) { bestD = d; best = tz; }
  }
  return best;
}

// --- Flughäfen aus OurAirports ---
const [kopf, ...reihen] = csvZeilen(fs.readFileSync(path.join(roh, 'airports.csv'), 'utf8'));
const idx = Object.fromEntries(kopf.map((k, i) => [k, i]));
const RANG = { large_airport: 4, medium_airport: 3, small_airport: 2, seaplane_base: 1, heliport: 0 };
const airports = {};
const rang = {};
for (const r of reihen) {
  const iata = r[idx.iata_code];
  if (!iata || !/^[A-Z0-9]{3}$/.test(iata)) continue;
  const typ = r[idx.type];
  if (typ === 'closed') continue;
  const rg = (RANG[typ] ?? 0) + (r[idx.scheduled_service] === 'yes' ? 10 : 0);
  if (airports[iata] && rang[iata] >= rg) continue;
  const lat = +(+r[idx.latitude_deg]).toFixed(4), lon = +(+r[idx.longitude_deg]).toFixed(4);
  airports[iata] = [r[idx.name], r[idx.municipality] || '', r[idx.iso_country], lat, lon, null, r[idx.icao_code] || r[idx.gps_code] || '', rg >= 14 ? 2 : rg >= 13 ? 1 : 0];
  rang[iata] = rg;
}
// Geschlossene Flughäfen (z. B. Berlin-Tegel TXL) fehlen bei OurAirports mit IATA-Code → aus OpenFlights ergänzen
const isoVonName = {};
for (const z of csvZeilen(fs.readFileSync(path.join(roh, 'countries.csv'), 'utf8')).slice(1)) isoVonName[z[2]] = z[1];
Object.assign(isoVonName, { 'Burma': 'MM', 'Congo (Kinshasa)': 'CD', 'Congo (Brazzaville)': 'CG', "Cote d'Ivoire": 'CI', 'Czech Republic': 'CZ', 'Macau': 'MO', 'Russia': 'RU', 'South Korea': 'KR', 'North Korea': 'KP', 'United States': 'US', 'United Kingdom': 'GB', 'Iran': 'IR', 'Syria': 'SY', 'Vietnam': 'VN', 'Laos': 'LA', 'Taiwan': 'TW', 'Hong Kong': 'HK', 'Bolivia': 'BO', 'Venezuela': 'VE', 'Tanzania': 'TZ', 'Moldova': 'MD', 'Macedonia': 'MK', 'Micronesia': 'FM' });
let ergaenzt = 0;
for (const z of csvZeilen(fs.readFileSync(path.join(roh, 'of_airports.dat'), 'utf8'))) {
  const iata = z[4];
  if (!iata || !/^[A-Z0-9]{3}$/.test(iata) || airports[iata] || z[12] !== 'airport') continue;
  airports[iata] = [z[1], z[2] || '', isoVonName[z[3]] || '', +(+z[6]).toFixed(4), +(+z[7]).toFixed(4), null, z[5] !== '\\N' ? z[5] : '', 0];
  ergaenzt++;
}
console.log(`Aus OpenFlights ergänzt: ${ergaenzt}`);
let ohneTz = 0;
for (const [iata, a] of Object.entries(airports)) {
  a[5] = tzVonIata[iata] || (ohneTz++, naechsteTz(a[4], a[3]));
}

// --- Länder: ISO-Alpha-2 → id im world-atlas (Mehrheitsentscheid über die Flughäfen) ---
const atlas = JSON.parse(fs.readFileSync(atlasPfad, 'utf8'));
const laender = topojson.feature(atlas, atlas.objects.countries).features;
const stimmen = {};
for (const a of Object.values(airports)) {
  const f = laender.find((l) => d3.geoContains(l, [a[4], a[3]]));
  if (!f || f.id == null) continue;
  (stimmen[a[2]] ??= {})[f.id] = (stimmen[a[2]][f.id] || 0) + 1;
}
const countries = {};
for (const [iso, s] of Object.entries(stimmen)) {
  countries[iso] = Object.entries(s).sort((x, y) => y[1] - x[1])[0][0];
}

// --- Airlines aus OpenFlights ---
const airlines = {};
for (const z of csvZeilen(fs.readFileSync(path.join(roh, 'airlines.dat'), 'utf8'))) {
  const [, name, , iata, icao, , land, aktiv] = z;
  if (!iata || iata === '\\N' || !/^[A-Z0-9]{2}$/.test(iata)) continue;
  if (airlines[iata] && (airlines[iata][3] === 'Y' || aktiv !== 'Y')) continue;
  airlines[iata] = [name, icao && icao !== '\\N' ? icao : '', land || '', aktiv];
}
// OpenFlights führt manche eingestellten Airlines noch als aktiv (Swissair, Air Berlin, Flybe)
for (const alt of ['SR', 'AB', 'BE']) if (airlines[alt]) airlines[alt][3] = 'N';
// ICAO-Codes ehemaliger Airlines entfernen, wenn eine aktive Airline denselben Code nutzt (SWR: Swiss statt Swissair)
const aktiveIcao = new Set(Object.values(airlines).filter((a) => a[3] === 'Y').map((a) => a[1]));
for (const a of Object.values(airlines)) { if (a[3] !== 'Y' && aktiveIcao.has(a[1])) a[1] = ''; a.pop(); }

// OpenFlights ist bei neueren/umbenannten Airlines veraltet – hier korrigieren bzw. ergänzen
Object.assign(airlines, {
  VB: ['Viva Aerobus', 'VIV', 'Mexico'],
  DM: ['Arajet', 'DWI', 'Dominican Republic'],
  DE: ['Condor', 'CFG', 'Germany'],
});

fs.writeFileSync(path.join(ZIEL, 'airports.json'), JSON.stringify(airports));
fs.writeFileSync(path.join(ZIEL, 'airlines.json'), JSON.stringify(airlines));
fs.writeFileSync(path.join(ZIEL, 'countries.json'), JSON.stringify(countries));
console.log(`Flughäfen: ${Object.keys(airports).length} (Zeitzone geschätzt: ${ohneTz}), Airlines: ${Object.keys(airlines).length}, Länder: ${Object.keys(countries).length}`);
