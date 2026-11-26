// „Pass“-Seite: Reisepass-Karte mit Weltkarte, Kennzahlen, Diagramme, Ranglisten, Erfolge, Teilen als Bild.
import { ref, airport, airlineName } from './data.js';
import { computeStats, achievements, LONG_HAUL_MIN } from './stats.js';
import { createMap } from './map.js';
import {
  esc, nf, nf1, nf2, flag, regionName, fmtDate, fmtDur, durHtml, daysHours, fmtKm, cityName, airlineBadge, share, store, toast,
} from './util.js';

const view = {
  per: store('per') || 'year',
  airlineBy: 'n', routeBy: 'n',
  open: new Set(),
};
let maps = [];

const MAP_COLORS = {
  ocean: 'transparent', land: '#6d3cf2', visited: '#7c4dff', border: 'rgba(30, 10, 90, 0.35)',
  route: 'rgba(255,255,255,0.92)', glow: 'rgba(255,255,255,0.12)', dot: '#ffb43c', ring: '#2a1380', label: '#fff',
};

export function destroyPassMaps() { maps.forEach((m) => m.destroy()); maps = []; }

export function renderPass($app, { flights, year, years, onYear, openFlight }) {
  destroyPassMaps();
  const s = computeStats(flights);
  const label = year === 'alle' ? 'Alle Jahre' : year;
  const rerender = () => renderPass($app, { flights, year, years, onYear, openFlight });

  $app.innerHTML = `
    <header class="top"><h1>Pass</h1>
      <button class="icon-btn" id="share-pass" aria-label="Pass als Bild teilen"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button>
    </header>
    ${yearTabs(years, year)}
    ${passport(s, label)}
    ${s.upcoming.length ? nextFlight(s.upcoming[0]) : ''}
    ${!s.n ? '<div class="empty"><h2>Noch keine vergangenen Flüge</h2><p>Sobald Flüge eingetragen sind, erscheinen hier Kennzahlen und Diagramme.</p></div>' : `
      ${s.delays.known ? delayCard(s) : ''}
      ${s.aircraft.length ? aircraftCard(s) : ''}
      ${flightsSection(s, year)}
      ${distanceSection(s)}
      ${timeSection(s)}
      ${airportsSection(s)}
      ${airlinesSection(s)}
      ${routesSection(s)}
      ${countriesSection(s)}
      ${achievementsSection(s)}
      ${recordsSection(s)}
      ${extrasSection(s)}
    `}
  `;

  // Karte im Pass
  const c = $app.querySelector('.pp-map');
  if (c) {
    const m = createMap(c, { mode: 'flat', interactive: false, graticule: false, colors: MAP_COLORS });
    m.setData(s.past);
    maps.push(m);
  }
  $app.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => onYear(b.dataset.year)));
  $app.querySelectorAll('[data-per]').forEach((b) => b.addEventListener('click', () => { view.per = b.dataset.per; store('per', view.per); rerender(); }));
  $app.querySelectorAll('[data-by]').forEach((b) => b.addEventListener('click', () => { const [k, v] = b.dataset.by.split(':'); view[k] = v; rerender(); }));
  $app.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.more; view.open.has(k) ? view.open.delete(k) : view.open.add(k); rerender();
  }));
  $app.querySelectorAll('[data-flight]').forEach((b) => b.addEventListener('click', () => openFlight(b.dataset.flight)));
  $app.querySelector('#share-pass').addEventListener('click', () => sharePassImage(s, label));
}

function yearTabs(years, year) {
  return `<div class="chips">${['alle', ...years].map((y) =>
    `<button class="chip ${String(y) === year ? 'on' : ''}" data-year="${y}">${y === 'alle' ? 'Gesamt' : y}</button>`).join('')}</div>`;
}

function mrz(s, label) {
  const name = (store('name') || 'FLUGBUCH').toUpperCase().normalize('NFD').replace(/[^A-Z ]/g, '').trim().replace(/\s+/g, '<');
  const pad = (t) => (t + '<'.repeat(44)).slice(0, 44);
  const d = new Date();
  const issued = `${String(d.getDate()).padStart(2, '0')}${d.toLocaleString('en', { month: 'short' }).toUpperCase()}${String(d.getFullYear()).slice(2)}`;
  const home = s.airports[0]?.key || 'XXX';
  return [pad(`${label === 'Alle Jahre' ? 'ALLTIME' : `JAHR${label}`}<<${name}<<${s.n}FLUEGE<<${Math.round(s.km)}KM`),
    pad(`ISSUED${issued}${home}`).slice(0, 34) + '<<<<FLUGBUCH'];
}

function passport(s, label) {
  const flags = s.countries.map((c) => `<span title="${esc(regionName(c.key))}">${flag(c.key)}</span>`).join('');
  return `<section class="passport">
    <div class="pp-strip">${'<span>✈</span>'.repeat(26)}</div>
    <canvas class="pp-map"></canvas>
    ${flags ? `<div class="pp-flags">${flags}</div>` : ''}
    <div class="pp-body">
      <div class="pp-title"><div><b>${label === 'Alle Jahre' ? 'MEIN FLUGBUCH-PASS' : `FLUGBUCH-PASS ${esc(label)}`}</b><small>▭ REISEPASS · PASSPORT · PASSEPORT</small></div><span class="pp-logo">✈</span></div>
      <div class="pp-grid">
        <div><small>FLÜGE</small><b>${nf.format(s.n)}</b><span>${s.longHaul} Langstrecke</span></div>
        <div><small>DISTANZ</small><b>${nf.format(Math.round(s.km))}<i> km</i></b><span>${nf1.format(s.earth)}× um die Erde</span></div>
        <div><small>FLUGZEIT</small><b>${daysHours(s.min)}</b></div>
        <div class="pp-two"><div><small>FLUGHÄFEN</small><b>${s.airports.length}</b></div><div><small>AIRLINES</small><b>${s.airlines.length}</b></div></div>
      </div>
    </div>
    <div class="mrz">${mrz(s, label).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
  </section>`;
}

function nextFlight(f) {
  const d = Math.ceil((f._depUtc - Date.now()) / 86400000);
  return `<button class="next card" data-flight="${esc(f.id)}">
    <small>NÄCHSTER FLUG · ${d <= 0 ? 'HEUTE' : d === 1 ? 'MORGEN' : `IN ${d} TAGEN`}</small>
    <div class="next-route"><b>${esc(f.from)}</b><span class="next-line"></span><b>${esc(f.to)}</b></div>
    <span>${esc(fmtDate(f.date))}${f.dep ? ` · ${esc(f.dep)}` : ''} · ${esc(f.flightNo || '')} ${esc(airlineName(f._airline))}</span>
  </button>`;
}

function delayCard(s) {
  const dl = s.delays;
  return `<section class="tile tile-red">
    <b class="tile-big">${nf1.format(dl.totalMin / 60)}</b>
    <h3>Stunden durch Verspätung verloren</h3>
    <p>${dl.late} von ${dl.known} Flügen verspätet${dl.late ? ` · Ø ${Math.round(dl.totalMin / dl.late)} min` : ''}${dl.worst ? ` · max. ${dl.worst.d} min (${esc(dl.worst.f.flightNo || '')})` : ''}</p>
  </section>`;
}

function aircraftCard(s) {
  const a = s.aircraft[0];
  return `<section class="tile tile-light">
    <h3>Meistgeflogenes Flugzeug</h3>
    <b class="tile-big">${esc(a.key.replace(/^(Airbus|Boeing|Embraer|Bombardier|ATR) /, ''))}</b>
    <p>${esc(a.key.split(' ')[0])} · ${a.n} ${a.n === 1 ? 'Flug' : 'Flüge'}</p>
  </section>`;
}

// ---------- Diagramme ----------
function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) || v;
}
function columns(items, label) {
  const max = niceMax(Math.max(1, ...items.map((x) => x.n)));
  const ticks = [0, max / 2, max];
  return `<div class="chart">
    <div class="chart-grid">${ticks.reverse().map((t) => `<div><span>${nf.format(t)}</span></div>`).join('')}</div>
    <div class="chart-cols">${items.map((x) => `
      <div class="col" title="${esc(label(x))}: ${x.n}"><span class="cb"><i style="height:${(100 * x.n) / max}%"><em>${x.n || ''}</em></i></span><span class="cl">${esc(label(x))}</span></div>`).join('')}
    </div></div>`;
}
function hbars(items, { key, label, value = (x) => x.n, fmt = (v) => nf.format(v), max = 8, onFlight } = {}) {
  const all = view.open.has(key);
  const list = all ? items : items.slice(0, max);
  if (!list.length) return '<p class="muted">Noch keine Daten.</p>';
  const m = Math.max(...list.map(value));
  return `<div class="hbars">${list.map((x) => `
    <div class="hb"><span class="hb-l">${label(x)}</span><span class="hb-t"><i style="width:${Math.max(3, (100 * value(x)) / m)}%"></i><em>${fmt(value(x))}</em></span></div>`).join('')}
  </div>${items.length > max ? `<button class="more" data-more="${key}">${all ? 'Weniger anzeigen' : `Alle ${items.length} anzeigen`}</button>` : ''}`;
}
function seg(name, options, current) {
  return `<div class="seg2">${options.map(([v, l]) => `<button data-${name}="${v}" class="${v === current ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function bySeg(k, current) {
  return `<div class="seg2">${[['n', 'Flüge'], ['km', 'Distanz']].map(([v, l]) => `<button data-by="${k}:${v}" class="${v === current ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function flightRow(title, f, value) {
  if (!f) return '';
  return `<div class="rec-row"><h4>${title}</h4><button class="rec-flight" data-flight="${esc(f.id)}">${airlineBadge(f._airline)}
    <span><b>${esc(cityName(f._from))} → ${esc(cityName(f._to))}</b><small>${esc(f.flightNo || '')} · ${esc(fmtDate(f.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</small></span>
    <em>${value}</em></button></div>`;
}

// ---------- Abschnitte ----------
function flightsSection(s, year) {
  const intl = s.n - s.domestic;
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const wd = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const per = year !== 'alle' && view.per === 'year' ? 'month' : view.per;
  const data = per === 'year' ? s.years : per === 'month' ? s.months : s.weekdays;
  const lab = per === 'year' ? (x) => String(x.key) : per === 'month' ? (x) => months[x.key].slice(0, 1) : (x) => wd[x.key];
  const opts = [...(year === 'alle' ? [['year', 'Jahr']] : []), ['month', 'Monat'], ['weekday', 'Wochentag']];
  return `<section class="block">
    <h2>Flüge</h2>
    <div class="big">${nf.format(s.n)}</div>
    <ul class="facts"><li><b>${s.domestic}</b> Inland</li><li><b>${intl}</b> international</li><li><b>${s.longHaul}</b> Langstrecke</li></ul>
    <div class="per"><span>FLÜGE PRO</span>${seg('per', opts, per)}</div>
    ${columns(data, lab)}
  </section>`;
}

function distanceSection(s) {
  const meter = (icon, x, text) => `<div class="meter2"><span class="m-icon">${icon}</span><span class="m-bar"><i style="width:${x >= 1 ? 100 : 16 + 84 * x}%"></i></span><span class="m-text"><b>${nf2.format(x < 0.1 ? x : +x.toFixed(1))}×</b> ${text}</span></div>`;
  return `<section class="block">
    <h2>Distanz</h2>
    <div class="big">${nf.format(Math.round(s.km))}<small> km</small></div>
    <p class="sub">${nf.format(Math.round(s.km * 0.621371))} mi · Ø ${fmtKm(s.km / s.n)} pro Flug</p>
    ${meter('🌍', s.earth, 'um die Erde')}
    ${meter('🌕', s.moon, 'zum Mond')}
    ${meter('☀️', s.sun, 'um die Sonne')}
    ${s.n > 1 ? flightRow('Kürzester Flug', s.shortest, fmtKm(s.shortest._km)) : ''}
    ${flightRow('Längster Flug', s.longest, fmtKm(s.longest._km))}
  </section>`;
}

function timeSection(s) {
  const d = s.min / 1440;
  return `<section class="block">
    <h2>Flugzeit</h2>
    <div class="big">${durHtml(s.min)}</div>
    <div class="grid2s">
      <div><small>Tage</small><b>${nf1.format(d)}</b></div><div><small>Wochen</small><b>${nf1.format(d / 7)}</b></div>
      <div><small>Monate</small><b>${nf1.format(d / 30.44)}</b></div><div><small>Jahre</small><b>${nf2.format(d / 365.25)}</b></div>
      <div><small>Ø pro Flug</small><b>${durHtml(s.min / s.n)}</b></div><div><small>Langstrecke (≥ ${LONG_HAUL_MIN / 60} h)</small><b>${s.longHaul}</b></div>
    </div>
    ${s.estimated ? `<p class="sub">${s.estimated} Flugzeit${s.estimated === 1 ? '' : 'en'} aus der Distanz geschätzt.</p>` : ''}
    ${s.n > 1 ? flightRow('Kürzester Flug', s.shortestTime, durHtml(s.shortestTime._min)) : ''}
    ${flightRow('Längster Flug', s.longestTime, durHtml(s.longestTime._min))}
  </section>`;
}

function airportsSection(s) {
  return `<section class="block">
    <h2>Flughäfen</h2>
    <div class="big">${s.airports.length}<small> Flughäfen</small></div>
    <p class="sub">Umsteigen unter 8 Stunden zählt als ein Besuch statt zwei.</p>
    ${hbars(s.airports, { key: 'ap', label: (x) => `<b title="${esc(airport(x.key)?.name)}">${esc(x.key)}</b>` })}
  </section>`;
}

function airlinesSection(s) {
  const by = view.airlineBy;
  const list = by === 'km' ? [...s.airlines].sort((a, b) => b.km - a.km) : s.airlines;
  return `<section class="block">
    <h2>Airlines</h2>
    <div class="big">${s.airlines.length}<small> Airlines</small></div>
    ${bySeg('airlineBy', by)}
    ${hbars(list, { key: 'al', label: (x) => `${airlineBadge(x.key, 'sm')}<span class="hb-name">${esc(airlineName(x.key))}</span>`, value: (x) => (by === 'km' ? x.km : x.n), fmt: (v) => (by === 'km' ? fmtKm(v) : nf.format(v)) })}
  </section>`;
}

function routesSection(s) {
  const by = view.routeBy;
  const list = by === 'km' ? [...s.routes].sort((a, b) => b.km - a.km) : s.routes;
  return `<section class="block">
    <h2>Strecken</h2>
    <div class="big">${s.routes.length}<small> Strecken</small></div>
    ${bySeg('routeBy', by)}
    ${hbars(list, { key: 'rt', label: (x) => `<b>${esc(x.key)}</b>`, value: (x) => (by === 'km' ? x.km : x.n), fmt: (v) => (by === 'km' ? fmtKm(v) : nf.format(v)) })}
  </section>`;
}

function countriesSection(s) {
  const all = view.open.has('co');
  const list = all ? s.countries : s.countries.slice(0, 4);
  return `<section class="block">
    <h2>Länder &amp; Gebiete</h2>
    <div class="big">${s.countries.length}<small> Länder</small></div>
    <ul class="clist">${list.map((c) => `<li><span class="cflag">${flag(c.key)}</span><b>${esc(regionName(c.key))}</b><span>${c.n} ${c.n === 1 ? 'Flug' : 'Flüge'}</span></li>`).join('')}</ul>
    ${s.countries.length > 4 ? `<button class="more" data-more="co">${all ? 'Weniger anzeigen' : `Alle ${s.countries.length} anzeigen`}</button>` : ''}
    <div class="regions">${s.regions.map((r) => `<div class="${r.n ? 'on' : ''}"><small>${r.name}</small><b>${r.n}</b><span>${Math.round((100 * r.n) / r.total)} %</span></div>`).join('')}</div>
  </section>`;
}

function achievementsSection(s) {
  const list = achievements(s);
  const done = list.filter((a) => a.done).length;
  return `<section class="block">
    <h2>Erfolge</h2>
    <div class="big">${done}<small> von ${list.length}</small></div>
    <div class="badges">${list.map((a) => `<div class="badge2 ${a.done ? 'done' : ''}" title="${esc(a.text)}">
      <span class="b-icon">${a.icon}</span><b>${esc(a.title)}</b><small>${esc(a.text)}</small>
      ${a.done ? '' : `<span class="b-prog"><i style="width:${(100 * a.value) / a.goal}%"></i></span>`}
    </div>`).join('')}</div>
  </section>`;
}

function recordsSection(s) {
  const ap = (title, a) => (a ? `<div class="rec"><small>${title}</small><b>${flag(a.country)} ${esc(a.code)}</b><span>${esc(cityName(a))} · ${nf1.format(Math.abs(a.lat))}° ${a.lat >= 0 ? 'N' : 'S'}, ${nf1.format(Math.abs(a.lon))}° ${a.lon >= 0 ? 'O' : 'W'}</span></div>` : '');
  return `<section class="block">
    <h2>Himmelsrichtungen</h2>
    <div class="recs">${ap('Nördlichster', s.north)}${ap('Südlichster', s.south)}${ap('Östlichster', s.east)}${ap('Westlichster', s.west)}</div>
  </section>`;
}

function extrasSection(s) {
  const parts = [['Flugzeugtypen', s.aircraft, 'ac'], ['Klasse', s.cabins, 'cb'], ['Sitzplatz', s.seatTypes, 'st'], ['Reisegrund', s.reasons, 'rs']]
    .filter(([, l]) => l.length);
  return parts.map(([t, l, k]) => `<section class="block"><h2>${t}</h2>${hbars(l, { key: k, label: (x) => `<span class="hb-name">${esc(x.key)}</span>` })}</section>`).join('')
    + (s.regs.length ? `<section class="block"><h2>Einzelne Flugzeuge</h2><p class="sub">${s.regs.length} verschiedene Kennzeichen${s.regs[0].n > 1 ? ` · am häufigsten ${esc(s.regs[0].key)} (${s.regs[0].n}×)` : ''}</p></section>` : '');
}

// ---------- Pass als Bild teilen ----------
async function sharePassImage(s, label) {
  const W = 1080, H = 1500;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2b0f8a'); g.addColorStop(0.55, '#1b0a5c'); g.addColorStop(1, '#0e0630');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Karte
  const proj = d3.geoNaturalEarth1().rotate([-10, 0]).fitExtent([[30, 110], [W - 30, 640]], { type: 'Sphere' });
  const path = d3.geoPath(proj, ctx);
  const land = topojson.feature(ref.atlas, ref.atlas.objects.countries);
  ctx.beginPath(); path(land); ctx.fillStyle = '#6d3cf2'; ctx.fill();
  const seen = new Set(), pts = new Map();
  ctx.lineCap = 'round';
  for (const f of s.past) {
    const k = [f.from, f.to].sort().join();
    pts.set(f.from, f._from); pts.set(f.to, f._to);
    if (seen.has(k)) continue; seen.add(k);
    ctx.beginPath(); path({ type: 'LineString', coordinates: [[f._from.lon, f._from.lat], [f._to.lon, f._to.lat]] });
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.stroke();
  }
  for (const a of pts.values()) {
    const [x, y] = proj([a.lon, a.lat]);
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fillStyle = '#2a1380'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = '#ffb43c'; ctx.fill();
  }
  const font = (w, px, fam = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif') => `${w} ${px}px ${fam}`;
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.font = font(700, 40); ctx.fillText('✈  F L U G B U C H  ✈', W / 2, 72);
  // Flaggen
  ctx.font = font(400, 46);
  const fl = s.countries.slice(0, 14).map((c) => flag(c.key)).join(' ');
  ctx.fillText(fl, W / 2, 710);
  // Kennzahlen
  ctx.textAlign = 'left';
  ctx.font = font(700, 52); ctx.fillText(label === 'Alle Jahre' ? 'MEIN FLUGBUCH-PASS' : `FLUGBUCH-PASS ${label}`, 70, 820);
  ctx.globalAlpha = 0.7; ctx.font = font(600, 26); ctx.fillText('REISEPASS · PASSPORT · PASSEPORT', 70, 862); ctx.globalAlpha = 1;
  const stat = (x, y, t, v, sub) => {
    ctx.globalAlpha = 0.7; ctx.font = font(600, 28); ctx.fillText(t, x, y); ctx.globalAlpha = 1;
    ctx.font = font(800, 86); ctx.fillText(v, x, y + 92);
    if (sub) { ctx.globalAlpha = 0.75; ctx.font = font(500, 28); ctx.fillText(sub, x, y + 134); ctx.globalAlpha = 1; }
  };
  stat(70, 950, 'FLÜGE', nf.format(s.n), `${s.longHaul} Langstrecke`);
  stat(520, 950, 'DISTANZ', `${nf.format(Math.round(s.km))} km`, `${nf1.format(s.earth)}× um die Erde`);
  stat(70, 1150, 'FLUGZEIT', daysHours(s.min));
  stat(520, 1150, 'FLUGHÄFEN', String(s.airports.length));
  stat(800, 1150, 'LÄNDER', String(s.countries.length));
  // MRZ
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = font(500, 30, 'ui-monospace, Menlo, Consolas, monospace');
  mrz(s, label).forEach((l, i) => ctx.fillText(l, 70, 1380 + i * 44));

  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  if (!blob) return toast('Bild konnte nicht erstellt werden');
  share(`flugbuch-pass-${label.replace(/\s/g, '-').toLowerCase()}.png`, blob, 'image/png');
}
