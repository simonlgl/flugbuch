// Weltkarte auf Canvas: drehbarer Globus oder flache Karte, Routen als Großkreisbögen.
import { ref } from './data.js';

let landCache = null;
function land() {
  if (!landCache) {
    const atlas = ref.atlas;
    landCache = {
      countries: topojson.feature(atlas, atlas.objects.countries).features,
      borders: topojson.mesh(atlas, atlas.objects.countries, (a, b) => a !== b),
      outline: { type: 'Sphere' },
      graticule: d3.geoGraticule10(),
    };
  }
  return landCache;
}

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{mode?: 'globe'|'flat', interactive?: boolean, labels?: boolean, onTap?: Function}} opt
 */
export function createMap(canvas, opt = {}) {
  const ctx = canvas.getContext('2d');
  let mode = opt.mode || 'globe';
  let routes = [], airports = [], visited = new Set();
  let w = 0, h = 0, dpr = 1;
  let rotate = [-10, -30, 0];
  let zoom = 1, baseScale = 1, pan = [0, 0];
  let projection;
  let autoFit = false; // nach Größenänderung erneut ausrichten, solange niemand gezogen hat
  let api;

  function makeProjection() {
    if (mode === 'globe') {
      baseScale = Math.min(w, h) / 2 - 8;
      projection = d3.geoOrthographic().clipAngle(90).precision(0.4)
        .scale(baseScale * zoom).translate([w / 2, h / 2]).rotate(rotate);
    } else {
      projection = d3.geoNaturalEarth1().precision(0.4);
      projection.fitExtent([[6, 6], [w - 6, h - 6]], { type: 'Sphere' });
      baseScale = projection.scale();
      const [tx, ty] = projection.translate();
      projection.scale(baseScale * zoom).translate([tx + pan[0], ty + pan[1]]).rotate([rotate[0], 0, 0]);
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (autoFit) api.fit(); else draw();
  }

  function draw() {
    if (!w || !ref.atlas) return;
    makeProjection();
    const L = land();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const path = d3.geoPath(projection, ctx);
    const c = {
      ocean: css('--map-ocean'), land: css('--map-land'), visited: css('--map-visited'),
      border: css('--map-border'), grat: css('--map-grat'), route: css('--route'), glow: css('--route-glow'),
      dot: css('--text'), label: css('--text-2'),
    };

    ctx.beginPath(); path(L.outline); ctx.fillStyle = c.ocean; ctx.fill();
    ctx.beginPath(); path(L.graticule); ctx.strokeStyle = c.grat; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.beginPath(); for (const f of L.countries) if (!visited.has(f.id)) path(f); ctx.fillStyle = c.land; ctx.fill();
    if (visited.size) {
      ctx.beginPath(); for (const f of L.countries) if (visited.has(f.id)) path(f); ctx.fillStyle = c.visited; ctx.fill();
    }
    ctx.beginPath(); path(L.borders); ctx.strokeStyle = c.border; ctx.lineWidth = 0.5; ctx.stroke();

    // Routen: erst ein weicher Schein, dann die Linie
    const maxN = Math.max(1, ...routes.map((r) => r.n));
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (const r of routes) {
        ctx.beginPath();
        path({ type: 'LineString', coordinates: [r.a, r.b] });
        const wdt = 1.2 + 1.8 * Math.sqrt(r.n / maxN);
        ctx.strokeStyle = pass ? (r.future ? c.label : c.route) : c.glow;
        ctx.lineWidth = pass ? wdt : wdt + 4;
        ctx.setLineDash(pass && r.future ? [4, 4] : []);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Flughäfen
    const center = mode === 'globe' ? projection.invert([w / 2, h / 2]) : null;
    ctx.font = '600 11px -apple-system, system-ui, sans-serif';
    for (const a of airports) {
      if (center && d3.geoDistance([a.lon, a.lat], center) > Math.PI / 2 - 0.02) { a._xy = null; continue; }
      const p = projection([a.lon, a.lat]);
      a._xy = p;
      if (!p) continue;
      const r = 2.2 + Math.min(3, Math.sqrt(a.n) * 0.6);
      ctx.beginPath(); ctx.arc(p[0], p[1], r + 1.5, 0, 2 * Math.PI); ctx.fillStyle = c.ocean; ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.fillStyle = c.dot; ctx.fill();
      if (opt.labels) {
        ctx.fillStyle = c.dot; ctx.fillText(a.code, p[0] + r + 4, p[1] + 4);
      }
    }
  }

  // --- Interaktion: ziehen = drehen/verschieben, zwei Finger / Mausrad = zoomen, tippen = Flughafen ---
  const pointers = new Map();
  let start = null, moved = false;
  function onDown(e) {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    start = { rotate: [...rotate], pan: [...pan], zoom, pts: [...pointers.values()].map((p) => [...p]) };
    moved = false;
    autoFit = false;
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    const pts = [...pointers.values()];
    if (pts.length === 1 && start.pts.length === 1) {
      const dx = pts[0][0] - start.pts[0][0], dy = pts[0][1] - start.pts[0][1];
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (mode === 'globe') {
        const k = 90 / (baseScale * zoom);
        rotate = [start.rotate[0] + dx * k, Math.max(-85, Math.min(85, start.rotate[1] - dy * k)), 0];
      } else {
        pan = [start.pan[0] + dx, start.pan[1] + dy];
      }
      requestDraw();
    } else if (pts.length === 2 && start.pts.length === 2) {
      const d0 = Math.hypot(start.pts[0][0] - start.pts[1][0], start.pts[0][1] - start.pts[1][1]);
      const d1 = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      zoom = clampZoom(start.zoom * d1 / d0);
      moved = true;
      requestDraw();
    }
  }
  function onUp(e) {
    if (!moved && pointers.size === 1 && opt.onTap) {
      const [x, y] = [e.offsetX, e.offsetY];
      let best = null, bd = 22;
      for (const a of airports) {
        if (!a._xy) continue;
        const d = Math.hypot(a._xy[0] - x, a._xy[1] - y);
        if (d < bd) { bd = d; best = a; }
      }
      opt.onTap(best);
    }
    pointers.delete(e.pointerId);
    start = { rotate: [...rotate], pan: [...pan], zoom, pts: [...pointers.values()].map((p) => [...p]) };
  }
  function onWheel(e) {
    e.preventDefault();
    zoom = clampZoom(zoom * Math.exp(-e.deltaY * 0.002));
    requestDraw();
  }
  const clampZoom = (z) => Math.max(mode === 'globe' ? 0.6 : 1, Math.min(12, z));
  let raf = 0;
  function requestDraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

  if (opt.interactive !== false) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  api = {
    setData(flights) {
      const rmap = new Map(), amap = new Map(), countries = new Set();
      for (const f of flights) {
        if (!f._from || !f._to) continue;
        const key = [f.from, f.to].sort().join('-');
        const r = rmap.get(key) || { a: [f._from.lon, f._from.lat], b: [f._to.lon, f._to.lat], n: 0, future: true };
        r.n++; if (!f._future) r.future = false;
        rmap.set(key, r);
        for (const a of [f._from, f._to]) {
          const x = amap.get(a.code) || { ...a, n: 0 };
          x.n++; amap.set(a.code, x);
          if (!f._future) { const id = ref.countries[a.country]; if (id) countries.add(id); }
        }
      }
      routes = [...rmap.values()].sort((x, y) => (y.future - x.future) || (x.n - y.n));
      airports = [...amap.values()].sort((x, y) => x.n - y.n);
      visited = countries;
      requestDraw();
    },
    setMode(m) { mode = m; zoom = 1; pan = [0, 0]; requestDraw(); },
    get mode() { return mode; },
    /** Ansicht auf die aktuellen Flughäfen ausrichten */
    fit() {
      autoFit = true;
      if (!airports.length || !w) return draw();
      const pts = airports.map((a) => [a.lon, a.lat]);
      const c = d3.geoCentroid({ type: 'MultiPoint', coordinates: pts });
      const spread = Math.max(...pts.map((p) => d3.geoDistance(p, c)));
      if (mode === 'globe') {
        rotate = [-c[0], -c[1], 0];
        zoom = clampZoom(spread > 0 ? Math.min(6, 1.25 / Math.sin(Math.min(Math.PI / 2, spread + 0.15)) * 0.8) : 4);
      } else {
        rotate = [-c[0], 0, 0];
        const p = d3.geoNaturalEarth1().rotate(rotate).fitExtent([[6, 6], [w - 6, h - 6]], { type: 'Sphere' });
        const b = d3.geoPath(p).bounds({ type: 'MultiPoint', coordinates: pts });
        const bw = Math.max(40, b[1][0] - b[0][0]), bh = Math.max(40, b[1][1] - b[0][1]);
        zoom = clampZoom(Math.min(8, 0.7 * Math.min(w / bw, h / bh)));
        const [tx, ty] = p.translate();
        const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
        pan = [w / 2 - (tx + (cx - tx) * zoom), h / 2 - (ty + (cy - ty) * zoom)];
      }
      draw();
    },
    redraw: requestDraw,    destroy() { ro.disconnect(); },
  };
  return api;
}
