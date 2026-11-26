import {
  ref, state, loadReference, loadRepoFlights, rebuild, upsertFlight, addFlights, deleteFlight, resetLocal,
  local, hasLocalChanges, plain, airport, airlineName, searchAirports,
} from './data.js';
import { parseCsv, rowsToFlights, toCsv, CSV_TEMPLATE } from './csv.js';
import { computeStats, normalizeAircraft } from './stats.js';
import { createMap } from './map.js';
import { apiKey, lookupFlight } from './api.js';
import { renderPass, destroyPassMaps } from './pass.js';
import {
  esc, nf, nf1, flag, fmtDate, fmtDur, fmtKm, cityName, airlineBadge, toast, share, store,
} from './util.js';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $sheetBg = document.getElementById('sheet-bg');
const ui = {
  tab: store('tab') || 'fluege',
  year: 'alle',
  search: '',
  sort: store('sort') || 'date',
  mapMode: store('mapMode') || 'globe',
};
if (ui.tab === 'statistik') ui.tab = 'pass';
let mainMap = null;

// ---------- Hilfsfunktionen ----------
const sessionSet = store;
function tzAbbr(utcMs, tz) {
  try {
    return new Intl.DateTimeFormat('de-DE', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}
function daysUntil(f) {
  const d = Math.ceil((f._depUtc - Date.now()) / 86400000);
  return d <= 0 ? 'heute' : d === 1 ? 'morgen' : `in ${d} Tagen`;
}
function years() { return [...new Set(state.flights.map((f) => f._year))].sort((a, b) => b - a); }
function filtered() {
  return ui.year === 'alle' ? state.flights : state.flights.filter((f) => String(f._year) === ui.year);
}
function yearChips() {
  const ys = years();
  if (!ys.length) return '';
  return `<div class="chips" role="tablist">${['alle', ...ys].map((y) =>
    `<button class="chip ${String(y) === ui.year ? 'on' : ''}" data-year="${y}">${y === 'alle' ? 'Gesamt' : y}</button>`).join('')}</div>`;
}
function bindYearChips(root, rerender) {
  root.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => {
    ui.year = b.dataset.year; rerender();
  }));
}

// ---------- Tabs ----------
function setTab(tab) {
  ui.tab = tab; sessionSet('tab', tab);
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

function render() {
  if (mainMap && ui.tab !== 'karte') { mainMap.destroy(); mainMap = null; }
  if (ui.tab !== 'pass') destroyPassMaps();
  document.body.dataset.tab = ui.tab;
  ({ fluege: renderFlights, karte: renderMap, pass: renderStats, einstellungen: renderMore })[ui.tab]();
}

// ---------- Flüge ----------
const PLANE = '<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';

function flightRow(f) {
  return `<button class="frow" data-id="${esc(f.id)}">
    ${airlineBadge(f._airline)}
    <span class="frow-main">
      <small>${esc((f.flightNo || '').replace(/^([A-Z0-9]{2})(\d)/, '$1 $2'))} &nbsp;${esc(f.from)} → ${esc(f.to)}</small>
      <b>${esc(cityName(f._from))} <span>nach</span> ${esc(cityName(f._to))}</b>
    </span>
    <span class="frow-date">${esc(fmtDate(f.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
  </button>`;
}

function upcomingCard(f) {
  const depT = f.depActual || f.dep, arrT = f.arrActual || f.arr;
  return `<button class="ucard" data-id="${esc(f.id)}">
    <div class="u-top"><span class="badge">${daysUntil(f)}</span><span>${esc(fmtDate(f.date))}</span><span class="muted">${esc(f.flightNo || '')}</span></div>
    <div class="u-route">
      <div><b>${esc(f.from)}</b><small>${esc(cityName(f._from))}</small>${depT ? `<time>${esc(depT)}</time>` : ''}</div>
      <div class="u-mid"><span class="u-line">${PLANE}</span><small>${f._minEstimated ? '~' : ''}${fmtDur(f._min)}</small></div>
      <div class="r"><b>${esc(f.to)}</b><small>${esc(cityName(f._to))}</small>${arrT ? `<time>${esc(arrT)}${f._arrDate !== f.date ? '<sup>+1</sup>' : ''}</time>` : ''}</div>
    </div>
  </button>`;
}

const SORTS = [
  ['date', 'Datum'], ['from', 'Von'], ['to', 'Nach'], ['airline', 'Airline'], ['aircraft', 'Flugzeug'],
];
function groupFlights(list) {
  const key = {
    date: (f) => [String(f._year), String(f._year)],
    from: (f) => [f.from, `${flag(f._from?.country)} ${f.from} · ${cityName(f._from)}`],
    to: (f) => [f.to, `${flag(f._to?.country)} ${f.to} · ${cityName(f._to)}`],
    airline: (f) => [f._airline || '?', airlineName(f._airline) || 'Unbekannt'],
    aircraft: (f) => { const a = normalizeAircraft(f.aircraft) || 'Unbekannt'; return [a, a]; },
  }[ui.sort];
  const groups = new Map();
  for (const f of list) {
    const [k, title] = key(f);
    if (!groups.has(k)) groups.set(k, { title, list: [] });
    groups.get(k).list.push(f);
  }
  const arr = [...groups.values()];
  if (ui.sort !== 'date') arr.sort((a, b) => b.list.length - a.list.length || a.title.localeCompare(b.title));
  return arr;
}

function renderFlights() {
  const q = ui.search.trim().toLowerCase();
  const match = (f) => !q || [f.flightNo, f.from, f.to, f._from?.city, f._to?.city, cityName(f._from), cityName(f._to), airlineName(f._airline), f.aircraft, f.reg, f.note, f.date]
    .some((x) => x && String(x).toLowerCase().includes(q));
  const list = state.flights.filter(match);
  const upcoming = list.filter((f) => f._future).reverse();
  const past = list.filter((f) => !f._future);
  const groups = groupFlights(past);

  $app.innerHTML = `
    <header class="top">
      <h1>Flüge</h1>
      <button class="icon-btn accent" id="add" aria-label="Flug hinzufügen"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    </header>
    ${!state.flights.length ? `<div class="empty">
        ${PLANE}
        <h2>Noch keine Flüge</h2>
        <p>Füge einen Flug hinzu, importiere eine CSV-Datei (Mehr → Import) oder lass Claude Code die Flüge in <code>data/flights.json</code> eintragen.</p>
        <button class="btn primary" id="add2">Flug hinzufügen</button>
      </div>` : ''}
    ${upcoming.length ? `<h3 class="sec">Bevorstehend</h3>${upcoming.map(upcomingCard).join('')}` : ''}
    ${state.flights.length ? `
      <div class="list-head"><h2>Vergangene Flüge</h2></div>
      <div class="sortbar">
        <label class="search-pill"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" id="search" placeholder="Suchen" value="${esc(ui.search)}"></label>
        ${SORTS.map(([k, l]) => `<button class="sort ${ui.sort === k ? 'on' : ''}" data-sort="${k}">${l}${ui.sort === k && k === 'date' ? ' ↓' : ''}</button>`).join('')}
      </div>` : ''}
    ${groups.map((g) => `<div class="ghead"><span>${esc(g.title)}</span><span>${g.list.length} ${g.list.length === 1 ? 'FLUG' : 'FLÜGE'}</span></div>
      <div class="glist">${g.list.map(flightRow).join('')}</div>`).join('')}
    ${q && !list.length ? '<p class="muted center">Keine Treffer.</p>' : ''}
  `;
  $app.querySelector('#add')?.addEventListener('click', () => openEditor());
  $app.querySelector('#add2')?.addEventListener('click', () => openEditor());
  const s = $app.querySelector('#search');
  s?.addEventListener('input', () => {
    ui.search = s.value;
    const pos = s.selectionStart;
    renderFlights();
    const s2 = $app.querySelector('#search'); s2.focus(); s2.setSelectionRange(pos, pos);
  });
  $app.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { ui.sort = b.dataset.sort; store('sort', ui.sort); renderFlights(); }));
  $app.querySelectorAll('.frow, .ucard').forEach((el) => el.addEventListener('click', () => openFlight(el.dataset.id)));
}

// ---------- Flugdetails ----------
function openFlight(id) {
  const f = state.flights.find((x) => x.id === id);
  if (!f) return;
  const a = f._from, b = f._to;
  const row = (k, v) => (v ? `<div class="kv"><span>${k}</span><b>${v}</b></div>` : '');
  const depT = f.depActual || f.dep, arrT = f.arrActual || f.arr;
  const delay = (sched, act) => {
    if (!sched || !act || sched === act) return '';
    const d = (+act.slice(0, 2) * 60 + +act.slice(3)) - (+sched.slice(0, 2) * 60 + +sched.slice(3));
    const dd = ((d + 720) % 1440) - 720;
    return ` <small class="${dd > 15 ? 'late' : 'ok'}">${dd > 0 ? '+' : ''}${dd} min</small>`;
  };
  openSheet(`
    <div class="sheet-head">
      <button class="link" data-close>Schließen</button>
      <span>${esc(f.flightNo || 'Flug')}</span>
      <button class="link" id="edit">Bearbeiten</button>
    </div>
    <div class="detail-route">
      <div><b>${esc(f.from)}</b><span>${esc(cityName(a))}</span></div>
      <div class="arc"><svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg></div>
      <div class="r"><b>${esc(f.to)}</b><span>${esc(cityName(b))}</span></div>
    </div>
    <canvas class="detail-map"></canvas>
    <div class="times">
      <div><small>Abflug</small><b>${esc(depT || '–')}</b>${delay(f.dep, f.depActual)}<span>${esc(fmtDate(f.date, { weekday: 'short', day: 'numeric', month: 'short' }))} ${a ? tzAbbr(f._depUtc, a.tz) : ''}</span></div>
      <div class="c"><small>Dauer</small><b>${f._minEstimated ? '~' : ''}${fmtDur(f._min)}</b><span>${fmtKm(f._km)}</span></div>
      <div class="r"><small>Ankunft</small><b>${esc(arrT || '–')}</b>${delay(f.arr, f.arrActual)}<span>${esc(fmtDate(f._arrDate, { weekday: 'short', day: 'numeric', month: 'short' }))} ${b ? tzAbbr(f._arrUtc, b.tz) : ''}</span></div>
    </div>
    <div class="card kvs">
      ${row('Airline', esc(airlineName(f._airline)))}
      ${row('Von', a ? `${flag(a.country)} ${esc(a.name)}` : esc(f.from))}
      ${row('Nach', b ? `${flag(b.country)} ${esc(b.name)}` : esc(f.to))}
      ${row('Flugzeug', esc(f.aircraft))}
      ${row('Kennzeichen', esc(f.reg))}
      ${row('Sitz', esc([f.seat, f.seatType].filter(Boolean).join(' · ')))}
      ${row('Klasse', esc(f.cabin))}
      ${row('Reisegrund', esc(f.reason))}
      ${row('Terminal / Gate', esc([f.depTerminal, f.depGate].filter(Boolean).join(' / ')))}
      ${row('Buchungscode', esc(f.pnr))}
      ${row('Notiz', esc(f.note))}
      ${row('Gespeichert', { repo: 'im Flugbuch (Repo)', lokal: 'nur auf diesem Gerät', 'geändert': 'Repo, lokal geändert' }[f._src])}
    </div>
    ${f._minEstimated ? '<p class="hint">Flugzeit aus der Distanz geschätzt – für genaue Werte Abflug- und Ankunftszeit eintragen.</p>' : ''}
    <button class="btn danger" id="del">Flug löschen</button>
  `, (root) => {
    const m = createMap(root.querySelector('.detail-map'), { mode: 'flat', labels: true });
    m.setData([f]);
    requestAnimationFrame(() => m.fit());
    root.querySelector('#edit').addEventListener('click', () => openEditor(f));
    root.querySelector('#del').addEventListener('click', () => {
      if (!confirm(`Flug ${f.flightNo || ''} ${f.from}–${f.to} am ${fmtDate(f.date)} löschen?`)) return;
      deleteFlight(f.id); closeSheet(); toast('Flug gelöscht');
    });
    return () => m.destroy();
  });
}

// ---------- Flug bearbeiten / hinzufügen ----------
function openEditor(existing) {
  const f = existing ? plain(existing) : { date: new Date().toISOString().slice(0, 10) };
  const opt = (list, v) => ['', ...list].map((x) => `<option ${x === (v || '') ? 'selected' : ''} value="${esc(x)}">${esc(x || '–')}</option>`).join('');
  const hasKey = !!apiKey.get();
  openSheet(`
    <div class="sheet-head">
      <button class="link" data-close>Abbrechen</button>
      <span>${existing ? 'Flug bearbeiten' : 'Neuer Flug'}</span>
      <button class="link strong" id="save">Sichern</button>
    </div>
    <form class="form" autocomplete="off" onsubmit="return false">
      <div class="grid2">
        <label>Flugnummer<input name="flightNo" placeholder="LH400" value="${esc(f.flightNo)}" autocapitalize="characters"></label>
        <label>Datum<input name="date" type="date" required value="${esc(f.date)}"></label>
      </div>
      ${hasKey ? '<button class="btn" id="lookup" type="button">Flugdaten abrufen</button><div id="lookup-res"></div>'
        : '<p class="hint">Tipp: Mit einem kostenlosen API-Schlüssel (Mehr → Flugdaten-API) werden Strecke, Zeiten und Flugzeug automatisch ausgefüllt.</p>'}
      <div class="grid2">
        <label class="ac">Von<input name="from" placeholder="FRA oder Frankfurt" required value="${esc(f.from)}" autocapitalize="characters"><small class="ap-name"></small><div class="ac-list"></div></label>
        <label class="ac">Nach<input name="to" placeholder="JFK oder New York" required value="${esc(f.to)}" autocapitalize="characters"><small class="ap-name"></small><div class="ac-list"></div></label>
      </div>
      <div class="grid2">
        <label>Abflug (Ortszeit)<input name="dep" type="time" value="${esc(f.dep)}"></label>
        <label>Ankunft (Ortszeit)<input name="arr" type="time" value="${esc(f.arr)}"></label>
      </div>
      <details ${f.depActual || f.arrActual || f.arrDate || f.durationMin ? 'open' : ''}>
        <summary>Tatsächliche Zeiten, Ankunftsdatum</summary>
        <div class="grid2">
          <label>Abflug tatsächlich<input name="depActual" type="time" value="${esc(f.depActual)}"></label>
          <label>Ankunft tatsächlich<input name="arrActual" type="time" value="${esc(f.arrActual)}"></label>
          <label>Ankunftsdatum<input name="arrDate" type="date" value="${esc(f.arrDate)}"><small>leer = automatisch</small></label>
          <label>Dauer (Minuten)<input name="durationMin" type="number" min="1" value="${esc(f.durationMin)}"><small>nur ohne Zeiten nötig</small></label>
        </div>
      </details>
      <div class="grid2">
        <label>Airline (IATA)<input name="airline" placeholder="aus Flugnummer" value="${esc(f.airline)}" autocapitalize="characters" maxlength="2"><small class="al-name"></small></label>
        <label>Flugzeug<input name="aircraft" placeholder="Airbus A320neo" value="${esc(f.aircraft)}"></label>
        <label>Kennzeichen<input name="reg" placeholder="D-AINA" value="${esc(f.reg)}" autocapitalize="characters"></label>
        <label>Sitz<input name="seat" placeholder="12A" value="${esc(f.seat)}" autocapitalize="characters"></label>
        <label>Sitzart<select name="seatType">${opt(['Fenster', 'Mitte', 'Gang'], f.seatType)}</select></label>
        <label>Klasse<select name="cabin">${opt(['Economy', 'Premium Economy', 'Business', 'First'], f.cabin)}</select></label>
        <label>Reisegrund<select name="reason">${opt(['Urlaub', 'Geschäftlich', 'Privat', 'Sonstiges'], f.reason)}</select></label>
        <label>Buchungscode<input name="pnr" value="${esc(f.pnr)}" autocapitalize="characters"></label>
      </div>
      <label>Notiz<textarea name="note" rows="2">${esc(f.note)}</textarea></label>
    </form>
  `, (root) => {
    const form = root.querySelector('form');
    const field = (n) => form.elements[n];
    // Flughafen-Autovervollständigung
    root.querySelectorAll('.ac').forEach((lab) => {
      const inp = lab.querySelector('input'), list = lab.querySelector('.ac-list'), name = lab.querySelector('.ap-name');
      const show = () => { const a = airport(inp.value.trim().toUpperCase()); name.textContent = a ? `${flag(a.country)} ${a.name}` : ''; };
      show();
      inp.addEventListener('input', () => {
        show();
        const hits = inp.value.length >= 2 ? searchAirports(inp.value) : [];
        list.innerHTML = hits.map((a) => `<button type="button" data-code="${a.code}"><b>${a.code}</b> ${esc(a.city)} <small>${esc(a.name)}</small></button>`).join('');
      });
      list.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        e.preventDefault(); inp.value = btn.dataset.code; list.innerHTML = ''; show();
      });
      inp.addEventListener('blur', () => setTimeout(() => { list.innerHTML = ''; inp.value = inp.value.trim().toUpperCase(); show(); }, 150));
    });
    const alName = root.querySelector('.al-name');
    const showAl = () => {
      const code = field('airline').value.trim().toUpperCase() || field('flightNo').value.replace(/\s/g, '').slice(0, 2).toUpperCase();
      alName.textContent = ref.airlines[code] ? ref.airlines[code][0] : '';
    };
    field('airline').addEventListener('input', showAl); field('flightNo').addEventListener('input', showAl); showAl();

    const fill = (r) => {
      for (const [k, v] of Object.entries(r)) if (!k.startsWith('_') && field(k)) field(k).value = v;
      root.querySelectorAll('.ac input').forEach((i) => i.dispatchEvent(new Event('input')));
      root.querySelectorAll('.ac-list').forEach((l) => { l.innerHTML = ''; });
      if (r.arrDate || r.depActual || r.arrActual) root.querySelector('details').open = true;
      showAl();
    };
    root.querySelector('#lookup')?.addEventListener('click', async (e) => {
      const fn = field('flightNo').value, d = field('date').value;
      const out = root.querySelector('#lookup-res');
      if (!fn || !d) { toast('Flugnummer und Datum eingeben'); return; }
      e.target.disabled = true; e.target.textContent = 'Suche …';
      try {
        const res = await lookupFlight(fn, d);
        if (!res.length) out.innerHTML = '<p class="hint">Kein Flug gefunden.</p>';
        else if (res.length === 1) { fill(res[0]); out.innerHTML = `<p class="hint ok">Übernommen: ${esc(res[0].from)} → ${esc(res[0].to)}${res[0].aircraft ? `, ${esc(res[0].aircraft)}` : ''}</p>`; }
        else {
          out.innerHTML = `<p class="hint">Mehrere Teilstrecken – bitte wählen:</p>${res.map((r, i) => `<button type="button" class="btn small" data-i="${i}">${esc(r.from)} → ${esc(r.to)} ${esc(r.dep || '')}</button>`).join('')}`;
          out.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { fill(res[+b.dataset.i]); out.innerHTML = ''; }));
        }
      } catch (err) { out.innerHTML = `<p class="hint late">${esc(err.message)}</p>`; }
      e.target.disabled = false; e.target.textContent = 'Flugdaten abrufen';
    });

    root.querySelector('#save').addEventListener('click', () => {
      const data = Object.fromEntries(new FormData(form));
      const g = {};
      for (const [k, v] of Object.entries(data)) if (String(v).trim()) g[k] = String(v).trim();
      for (const k of ['from', 'to', 'airline', 'flightNo', 'reg', 'seat', 'pnr']) if (g[k]) g[k] = g[k].toUpperCase().replace(k === 'flightNo' ? /\s/g : /^$/, '');
      if (g.durationMin) g.durationMin = +g.durationMin;
      if (!g.date) return toast('Datum fehlt');
      if (!airport(g.from)) return toast(`Abflughafen „${g.from || ''}“ unbekannt`);
      if (!airport(g.to)) return toast(`Zielflughafen „${g.to || ''}“ unbekannt`);
      if (!g.airline && g.flightNo && ref.airlines[g.flightNo.slice(0, 2)]) g.airline = g.flightNo.slice(0, 2);
      if (existing) g.id = existing.id;
      const id = upsertFlight(g);
      closeSheet();
      toast(existing ? 'Gespeichert' : 'Flug hinzugefügt');
      if (existing) setTimeout(() => openFlight(id), 320);
    });
  });
}

// ---------- Karte ----------
function renderMap() {
  const list = filtered();
  const s = computeStats(list);
  $app.innerHTML = `
    <header class="top"><h1>Karte</h1>
      <div class="seg"><button data-mode="globe" class="${ui.mapMode === 'globe' ? 'on' : ''}">Globus</button><button data-mode="flat" class="${ui.mapMode === 'flat' ? 'on' : ''}">Flach</button></div>
    </header>
    ${yearChips()}
    <div class="map-wrap"><canvas id="bigmap" class="${ui.mapMode}"></canvas><div id="map-tip" class="map-tip"></div>
      <button class="icon-btn map-fit" id="fit" aria-label="Ausrichten"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
    </div>
    <div class="mini-stats">
      <div><b>${nf.format(s.n)}</b><span>Flüge</span></div>
      <div><b>${nf.format(s.airports.length)}</b><span>Flughäfen</span></div>
      <div><b>${nf.format(s.countries.length)}</b><span>Länder</span></div>
      <div><b>${nf.format(s.routes.length)}</b><span>Strecken</span></div>
    </div>
    <p class="hint center">Ziehen zum Drehen · zwei Finger zum Zoomen · Flughafen antippen</p>
  `;
  const tip = $app.querySelector('#map-tip');
  mainMap = createMap($app.querySelector('#bigmap'), {
    mode: ui.mapMode,
    onTap(a) {
      if (!a) { tip.classList.remove('show'); return; }
      const n = s.airports.find((x) => x.key === a.code)?.n || a.n;
      tip.innerHTML = `<b>${flag(a.country)} ${esc(a.code)} · ${esc(a.city)}</b><span>${esc(a.name)}</span><span>${n}× besucht</span>`;
      tip.classList.add('show');
    },
  });
  mainMap.setData(list);
  requestAnimationFrame(() => mainMap.fit());
  $app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    ui.mapMode = b.dataset.mode; sessionSet('mapMode', ui.mapMode);
    $app.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    $app.querySelector('#bigmap').className = ui.mapMode;
    mainMap.setMode(ui.mapMode); requestAnimationFrame(() => mainMap.fit());
  }));
  $app.querySelector('#fit').addEventListener('click', () => mainMap.fit());
  bindYearChips($app, () => { mainMap?.destroy(); mainMap = null; renderMap(); });
}

// ---------- Pass (Statistik) ----------
function renderStats() {
  renderPass($app, {
    flights: filtered(), year: ui.year, years: years(),
    onYear: (y) => { ui.year = y; renderStats(); },
    openFlight,
  });
}

// ---------- Mehr: Import / Export / API ----------
function renderMore() {
  const l = local();
  const nOver = Object.keys(l.overrides).length;
  $app.innerHTML = `
    <header class="top"><h1>Mehr</h1></header>
    <section class="card">
      <h3>Daten</h3>
      <div class="kv"><span>Im Flugbuch (Repo)</span><b>${state.repo.length} Flüge · Version ${state.repoVersion}</b></div>
      <div class="kv"><span>Nur auf diesem Gerät</span><b>${l.added.length} neu · ${nOver} geändert · ${l.deleted.length} gelöscht</b></div>
      ${hasLocalChanges() ? `
        <p class="hint">Lokale Änderungen gibt es nur in diesem Browser. Damit sie dauerhaft ins Flugbuch kommen: „Für Claude kopieren“ und in Claude Code einfügen – danach hier „Lokale Änderungen verwerfen“.</p>
        <div class="btns"><button class="btn" id="copy-local">Für Claude kopieren</button><button class="btn danger" id="reset-local">Lokale Änderungen verwerfen</button></div>` : ''}
    </section>

    <section class="card">
      <h3>Import</h3>
      <p class="muted small">CSV-Datei mit Spalten wie <code>date, flightNo, from, to, dep, arr</code> (auch deutsch: <code>datum, flugnummer, von, nach, abflug, ankunft</code>). Exporte aus Flighty und myFlightradar24 werden erkannt. Komma oder Semikolon.</p>
      <div class="btns">
        <label class="btn primary">CSV importieren<input type="file" id="csv" accept=".csv,text/csv,text/plain" hidden></label>
        <button class="btn" id="tpl">Vorlage</button>
      </div>
      <details><summary>Text einfügen statt Datei</summary>
        <textarea id="csv-text" rows="5" placeholder="date,flightNo,from,to,dep,arr&#10;2025-03-14,LH400,FRA,JFK,10:05,12:50"></textarea>
        <button class="btn" id="csv-paste">Einlesen</button>
      </details>
    </section>

    <section class="card">
      <h3>Export</h3>
      <div class="btns"><button class="btn" id="exp-csv">Alle als CSV</button><button class="btn" id="exp-json">Alle als JSON</button></div>
    </section>

    <section class="card">
      <h3>Flugdaten-API</h3>
      <p class="muted small">Optional. Mit einem kostenlosen <a href="https://rapidapi.com/aedbx-aedbx/api/aerodatabox" target="_blank" rel="noopener">AeroDataBox-Schlüssel (RapidAPI)</a> füllt „Flugdaten abrufen“ Strecke, Zeiten, Flugzeug und Kennzeichen aus Flugnummer + Datum aus. Der Schlüssel bleibt nur auf diesem Gerät.</p>
      <input id="key" type="password" placeholder="X-RapidAPI-Key" value="${esc(apiKey.get())}" autocomplete="off">
      <div class="btns"><button class="btn" id="key-save">Speichern</button>${apiKey.get() ? '<button class="btn" id="key-test">Testen</button>' : ''}</div>
      <p id="key-res" class="hint"></p>
    </section>

    <section class="card">
      <h3>Name im Pass</h3>
      <p class="muted small">Erscheint in der maschinenlesbaren Zeile des Passes (nur auf diesem Gerät gespeichert).</p>
      <input id="pp-name" placeholder="z. B. Max Mustermann" value="${esc(store('name') || '')}" autocomplete="name">
      <div class="btns"><button class="btn" id="name-save">Speichern</button></div>
    </section>

    <section class="card">
      <h3>Über</h3>
      <p class="muted small">Flugbuch · Flughafendaten: OurAirports (Public Domain), Zeitzonen/Airlines: OpenFlights (ODbL), Karte: Natural Earth.</p>
      <button class="btn" id="reload">Neu laden</button>
    </section>
  `;
  const on = (id, fn) => $app.querySelector(id)?.addEventListener('click', fn);
  on('#copy-local', async () => {
    const payload = JSON.stringify({ neu: l.added.map(plain), geaendert: Object.values(l.overrides).map(plain), geloescht: l.deleted }, null, 1);
    const text = `Bitte diese Flüge ins Flugbuch übernehmen (data/flights.json) und pushen:\n${payload}`;
    try { await navigator.clipboard.writeText(text); toast('Kopiert – jetzt in Claude Code einfügen'); }
    catch { share('flugbuch-aenderungen.json', payload, 'application/json'); }
  });
  on('#reset-local', () => {
    if (confirm('Alle nur lokal gespeicherten Änderungen verwerfen? (Erst tun, wenn sie im Repo sind.)')) { resetLocal(); toast('Verworfen'); }
  });
  $app.querySelector('#csv').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    importText(await file.text()); e.target.value = '';
  });
  on('#csv-paste', () => importText($app.querySelector('#csv-text').value));
  on('#tpl', () => share('flugbuch-vorlage.csv', CSV_TEMPLATE, 'text/csv'));
  const all = () => [...state.flights].reverse().map(plain);
  on('#exp-csv', () => share(`flugbuch-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(all()), 'text/csv'));
  on('#exp-json', () => share(`flugbuch-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ flights: all() }, null, 1), 'application/json'));
  on('#key-save', () => { apiKey.set($app.querySelector('#key').value); toast('Gespeichert'); renderMore(); });
  on('#key-test', async () => {
    const out = $app.querySelector('#key-res');
    out.textContent = 'Teste …';
    const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    try { const r = await lookupFlight('LH400', d); out.textContent = r.length ? `OK – LH400 gestern: ${r[0].from} → ${r[0].to}` : 'Verbindung OK (kein Flug gefunden).'; }
    catch (err) { out.textContent = err.message; }
  });
  on('#name-save', () => { store('name', $app.querySelector('#pp-name').value.trim()); toast('Gespeichert'); });
  on('#reload', () => location.reload());
}

async function importText(text) {
  if (!text.trim()) return toast('Keine Daten');
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('CSV enthält keine Zeilen');
  const { flights, problems } = rowsToFlights(rows);
  // Dubletten: gleiches Datum + gleiche Strecke (oder Flugnummer) schon vorhanden
  const key = (f) => `${f.date}|${(f.flightNo || '').toUpperCase()}|${f.from}|${f.to}`;
  const key2 = (f) => `${f.date}|${f.from}|${f.to}`;
  const have = new Set(state.flights.flatMap((f) => [key(f), key2(f)]));
  const fresh = flights.filter((f) => !have.has(key(f)) && !(f.from && have.has(key2(f))));
  const dups = flights.length - fresh.length;
  const needLookup = fresh.filter((f) => f._needsLookup);
  openSheet(`
    <div class="sheet-head"><button class="link" data-close>Abbrechen</button><span>Import</span><button class="link strong" id="do" ${fresh.length ? '' : 'disabled'}>Importieren</button></div>
    <div class="card">
      <div class="kv"><span>Erkannte Flüge</span><b>${flights.length}</b></div>
      <div class="kv"><span>Davon schon vorhanden</span><b>${dups}</b></div>
      <div class="kv"><span>Neu</span><b>${fresh.length}</b></div>
      ${needLookup.length ? `<div class="kv"><span>Ohne Strecke (per API ergänzen)</span><b>${needLookup.length}</b></div>` : ''}
    </div>
    ${needLookup.length && !apiKey.get() ? '<p class="hint late">Flüge ohne Von/Nach brauchen einen API-Schlüssel (Mehr → Flugdaten-API) und werden sonst übersprungen.</p>' : ''}
    ${problems.length ? `<details class="card" ${problems.length < 6 ? 'open' : ''}><summary>${problems.length} Hinweis${problems.length === 1 ? '' : 'e'}</summary><ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
    <div class="preview">${fresh.slice(0, 50).map((f) => `<div><span>${esc(f.date)}</span><b>${esc(f.flightNo || '')}</b><span>${esc(f.from || '?')} → ${esc(f.to || '?')}</span><span class="muted">${esc(f.dep || '')}</span></div>`).join('')}
    ${fresh.length > 50 ? `<p class="muted small">… und ${fresh.length - 50} weitere</p>` : ''}</div>
    <p id="imp-status" class="hint"></p>
  `, (root) => {
    root.querySelector('#do').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const status = root.querySelector('#imp-status');
      const ready = fresh.filter((f) => !f._needsLookup);
      if (needLookup.length && apiKey.get()) {
        let i = 0;
        for (const f of needLookup) {
          status.textContent = `Frage API ab … ${++i}/${needLookup.length}`;
          try {
            const r = await lookupFlight(f.flightNo, f.date);
            if (r[0]) { const { _status, ...rest } = r[0]; ready.push({ ...rest, ...Object.fromEntries(Object.entries(f).filter(([k, v]) => v && !k.startsWith('_'))) }); }
          } catch (err) { status.textContent = err.message; break; }
          await new Promise((res) => setTimeout(res, 1100));
        }
      }
      for (const f of ready) delete f._needsLookup;
      addFlights(ready);
      closeSheet();
      toast(`${ready.length} Flüge importiert`);
      setTab('fluege');
    });
  });
}

// ---------- Sheet (von unten einfahrendes Fenster) ----------
let sheetCleanup = null;
function openSheet(html, mount) {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  $sheet.innerHTML = `<div class="grip"></div><div class="sheet-body">${html}</div>`;
  $sheet.scrollTop = 0;
  document.body.classList.add('sheet-open');
  $sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  sheetCleanup = mount?.($sheet) || null;
}
function closeSheet() {
  document.body.classList.remove('sheet-open');
  const c = sheetCleanup; sheetCleanup = null;
  setTimeout(() => { if (!document.body.classList.contains('sheet-open')) { c?.(); $sheet.innerHTML = ''; } }, 300);
}
$sheetBg.addEventListener('click', closeSheet);
// Nach unten wischen am Griff schließt das Fenster
let dragY = null;
$sheet.addEventListener('touchstart', (e) => { if ($sheet.scrollTop <= 0 && e.target.closest('.grip, .sheet-head')) dragY = e.touches[0].clientY; }, { passive: true });
$sheet.addEventListener('touchmove', (e) => {
  if (dragY == null) return;
  const dy = Math.max(0, e.touches[0].clientY - dragY);
  $sheet.style.transform = `translateY(${dy}px)`;
}, { passive: true });
$sheet.addEventListener('touchend', (e) => {
  if (dragY == null) return;
  const dy = e.changedTouches[0].clientY - dragY; dragY = null;
  $sheet.style.transform = '';
  if (dy > 100) closeSheet();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) closeSheet(); });

// ---------- Start ----------
document.addEventListener('flights-changed', () => { if (!document.body.classList.contains('sheet-open') || ui.tab !== 'einstellungen') render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadRepoFlights(); });

(async function start() {
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  $app.innerHTML = '<div class="loading">Lade …</div>';
  await loadReference();
  await loadRepoFlights();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();

// Für Tests in der Konsole
window.flugbuch = { state, ref, rebuild, normalizeAircraft };
