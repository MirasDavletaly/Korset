// Состояние в адресной строке: камера, рубрика, место, маршрут. Ссылкой можно поделиться.
import { S, app } from '../app.js';
import { CAT_BY_ID, MODES } from '../config.js';
import { clamp } from '../core/dom.js';

export const Hash = {
  last: null, timer: null,

  parse(str) {
    const out = {};
    for (const part of String(str || '').replace(/^#/, '').split('&')) {
      const i = part.indexOf('=');
      if (i > 0) {
        try { out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch (e) { /* битый параметр */ }
      }
    }
    return out;
  },

  /** Камера из ссылки: { lat, lon, zoom, bearing (рад), pitch (рад) } или null. */
  camera(h) {
    const m = (h.map || '').split('/').map(Number);
    if (m.length >= 3 && m.slice(0, 3).every(Number.isFinite) && Math.abs(m[1]) <= 85 && Math.abs(m[2]) <= 180) {
      return {
        zoom: clamp(m[0], 9, 20), lat: m[1], lon: m[2],
        bearing: Number.isFinite(m[3]) ? (m[3] * Math.PI) / 180 : 0,
        pitch: Number.isFinite(m[4]) ? (clamp(m[4], 0, 60) * Math.PI) / 180 : 0
      };
    }
    return null;
  },

  build() {
    const cam = app.map.camera;
    const [lon, lat] = app.store.proj.toLonLat(cam.x, cam.y);
    const b = Math.round((cam.bearing * 180) / Math.PI), p = Math.round((cam.pitch * 180) / Math.PI);
    const ll = (x, y) => { const [lo, la] = app.store.proj.toLonLat(x, y); return `${la.toFixed(5)},${lo.toFixed(5)}`; };
    const parts = [`map=${cam.zoom.toFixed(2)}/${lat.toFixed(5)}/${lon.toFixed(5)}${b || p ? `/${b}/${p}` : ''}`];
    if (S.cat) parts.push(`c=${S.cat.id}`);
    if (S.cat && S.openOnly) parts.push('oo=1');
    const pl = S.place;
    if (pl) {
      if (pl.kind === 'org' && pl.poi) parts.push(`o=${pl.poi.key}`);
      else parts.push(`pt=${ll(pl.x, pl.y)}`);
    }
    const r = S.route;
    if (r.a || r.b) {
      parts.push(`r=${r.mode}~${r.a ? ll(r.a.x, r.a.y) : ''}~${r.b ? ll(r.b.x, r.b.y) : ''}~${r.active}`);
      if (r.a) parts.push(`ra=${encodeURIComponent(r.a.label)}`);
      if (r.b) parts.push(`rb=${encodeURIComponent(r.b.label)}`);
    }
    return parts.join('&');
  },

  write() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 250); },

  flush() {
    clearTimeout(this.timer);
    if (!app.map) return;
    const h = this.build();
    if (h === this.last) return;
    this.last = h;
    try { history.replaceState(null, '', `#${h}`); } catch (e) { /* не критично */ }
  },

  parseRoute(h) {
    if (!h.r) return null;
    const [mode, a, b, idx] = h.r.split('~');
    const pt = (s, label) => {
      const [lat, lon] = String(s || '').split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const [x, y] = app.store.proj.toXY(lon, lat);
      return { x, y, label: label || 'Точка на карте' };
    };
    return { mode: MODES.some(m => m.id === mode) ? mode : 'car', a: pt(a, h.ra), b: pt(b, h.rb), active: Number(idx) || 0 };
  },

  categoryOf(h) { return h.c && CAT_BY_ID[h.c] ? h.c : null; }
};
