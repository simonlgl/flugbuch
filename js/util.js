// Kleine gemeinsame Helfer für Formatierung und Darstellung.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nf = new Intl.NumberFormat('de-DE');
export const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
export const nf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
export const regionName = (() => {
  try { const d = new Intl.DisplayNames(['de'], { type: 'region' }); return (c) => { try { return d.of(c); } catch { return c; } }; }
  catch { return (c) => c; }
})();
export const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

export function fmtDate(d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('de-DE', { ...opts, timeZone: 'UTC' });
}
export function fmtDur(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
/** „86 h 13 m“ als HTML mit kleinen Einheiten */
export function durHtml(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${h ? `${nf.format(h)}<small>h</small> ` : ''}${m}<small>m</small>`;
}
export function daysHours(min) {
  const d = Math.floor(min / 1440), h = Math.round((min % 1440) / 60);
  return d ? `${d}d ${h}h` : `${h}h`;
}
export function fmtKm(km) { return `${nf.format(Math.round(km))} km`; }

// Deutsche Namen für häufige Städte (die Flughafendaten sind englisch)
const STADT = {
  Munich: 'München', Vienna: 'Wien', Copenhagen: 'Kopenhagen', Warsaw: 'Warschau', Tokyo: 'Tokio', Rome: 'Rom',
  Milan: 'Mailand', Prague: 'Prag', Brussels: 'Brüssel', Lisbon: 'Lissabon', Cologne: 'Köln', Nuremberg: 'Nürnberg',
  Venice: 'Venedig', Naples: 'Neapel', Athens: 'Athen', Moscow: 'Moskau', 'Ho Chi Minh City': 'Ho-Chi-Minh-Stadt',
  'Mexico City': 'Mexiko-Stadt', Zurich: 'Zürich', Geneva: 'Genf', Florence: 'Florenz', Seville: 'Sevilla',
  Cairo: 'Kairo', Beijing: 'Peking', Singapore: 'Singapur', 'Frankfurt am Main': 'Frankfurt', Hanover: 'Hannover',
  Valletta: 'Malta', 'Da Lat': 'Đà Lạt', Bucharest: 'Bukarest', Belgrade: 'Belgrad', Kyiv: 'Kiew', Krakow: 'Krakau',
  Gothenburg: 'Göteborg', 'The Hague': 'Den Haag', Antwerp: 'Antwerpen', Turin: 'Turin', Genoa: 'Genua',
  'Palma De Mallorca': 'Palma', Heraklion: 'Heraklion', Nice: 'Nizza', Marrakesh: 'Marrakesch', Havana: 'Havanna',
  Sydney: 'Sydney', 'Cape Town': 'Kapstadt', Jerusalem: 'Jerusalem', Istanbul: 'Istanbul', Seoul: 'Seoul',
};
export function cityName(a) {
  if (!a) return '?';
  const c = (a.city || a.name).split(/[,(]/)[0].trim();
  return STADT[c] || c;
}

/** Runder Airline-Kreis mit Code, Farbe aus dem Code abgeleitet */
export function airlineBadge(code, size = '') {
  const c = code || '✈';
  let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="al-badge ${size}" style="--h:${h}">${esc(c)}</span>`;
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
export function download(name, data, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export async function share(name, data, type) {
  const file = new File([data], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(name, data, type);
}
export function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(`flugbuch.ui.${k}`);
    localStorage.setItem(`flugbuch.ui.${k}`, v);
  } catch { return null; }
  return v;
}
