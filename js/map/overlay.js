// Слой подписей и значков поверх WebGL (Canvas 2D): районы, улицы, организации, номера домов,
// метки рубрик с кластерами, подсветка. Подписи не перекрывают друг друга.
import { drawIcon } from '../core/icons.js';
import { CAT_BY_ID } from '../config.js';
import { Grid } from '../core/grid.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Значок и цвет для точки интереса без рубрики. */
export function poiStyle(p) {
  if (p.cat) { const c = CAT_BY_ID[p.cat]; return { icon: c.icon, color: c.color }; }
  const [k, v] = p.tag.split('=');
  if (k === 'shop') return { icon: 'store', color: '#3B82C4' };
  if (k === 'tourism' || k === 'historic') return { icon: 'star', color: '#C2410C' };
  if (k === 'leisure') return { icon: v === 'park' || v === 'garden' ? 'tree' : 'star', color: v === 'park' || v === 'garden' ? '#3F8F3A' : '#0E9384' };
  if (k === 'highway' || k === 'railway' || k === 'public_transport' || k === 'aeroway') return { icon: 'bus', color: '#56677A' };
  if (k === 'amenity') {
    if (['bar', 'pub', 'food_court', 'ice_cream'].includes(v)) return { icon: 'coffee', color: '#EE6A12' };
    if (['university', 'college', 'library'].includes(v)) return { icon: 'school', color: '#B7791F' };
    if (['dentist', 'veterinary'].includes(v)) return { icon: 'medical', color: '#D6409F' };
    if (['theatre', 'cinema', 'arts_centre', 'nightclub', 'community_centre'].includes(v)) return { icon: 'star', color: '#8E4EC6' };
  }
  return { icon: 'building', color: '#6B7785' };
}
function poiRank(p) {
  const t = p.tag;
  if (/^(shop=mall|tourism=attraction|tourism=museum|historic=|aeroway|railway=station|leisure=stadium|amenity=theatre|amenity=university|leisure=park)/.test(t)) return 1;
  if (/^(amenity=(hospital|cinema|marketplace|place_of_worship|townhall)|tourism=hotel|shop=supermarket|office=government)/.test(t)) return 2;
  if (t === 'highway=bus_stop') return 5;
  if (/^building=/.test(t)) return 4;
  return 3;
}

export class Overlay {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.rubric = []; this.rubricColor = '#0A7EA4'; this.highlightId = null;
    this.step = null;
    this.hits = [];
    this.widthCache = new Map();
    this.buildStreetAnchors();
    this.poiGrid = null; this.houseGrid = null;
  }

  /** Точки для подписей улиц: вдоль каждой именованной дороги через равные промежутки. */
  buildStreetAnchors() {
    const { pts, ways, names } = this.store.roads;
    const g = new Grid(400);
    for (const w of ways) {
      if (w.name < 0 || (w.cls > 6 && w.cls !== 11)) continue;
      const step = w.cls <= 2 ? 650 : w.cls <= 4 ? 450 : 320;
      let total = 0;
      const seg = [];
      for (let i = 0; i + 1 < w.idx.length; i++) {
        const a = w.idx[i] * 2, b = w.idx[i + 1] * 2;
        const l = Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1]);
        seg.push(l); total += l;
      }
      if (total < 70) continue;
      let next = total < step ? total / 2 : step / 2, acc = 0;
      for (let i = 0; i < seg.length && next <= total; i++) {
        while (next <= acc + seg[i] && seg[i] > 0) {
          const t = (next - acc) / seg[i];
          const a = w.idx[i] * 2, b = w.idx[i + 1] * 2;
          const dx = (pts[b] - pts[a]) / seg[i], dy = (pts[b + 1] - pts[a + 1]) / seg[i];
          const x = pts[a] + (pts[b] - pts[a]) * t, y = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * t;
          g.insert({ x, y, dx, dy, name: names[w.name], cls: w.cls, segLen: seg[i] }, x, y);
          next += step;
        }
        acc += seg[i];
      }
    }
    this.streetGrid = g;
  }

  setPlaces() {
    const pg = new Grid(300);
    for (const p of this.store.pois) {
      if (!p.name) continue;
      p._rank = poiRank(p);
      p._style = poiStyle(p);
      pg.insert(p, p.x, p.y);
    }
    this.poiGrid = pg;
    const hg = new Grid(200);
    for (const a of this.store.addr) if (a.b >= 0) hg.insert(a, a.x, a.y);
    this.houseGrid = hg;
  }

  setRubric(items, color) { this.rubric = items; this.rubricColor = color; }

  textWidth(font, text) {
    const k = font + '|' + text;
    let w = this.widthCache.get(k);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      if (this.widthCache.size > 20000) this.widthCache.clear();
      this.widthCache.set(k, w);
    }
    return w;
  }

  render(cam, pal, dpr, { rubricOnTop = true } = {}) {
    const ctx = this.ctx, W = cam.width, H = cam.height, z = cam.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.hits = [];
    this.palText = pal.label;
    this.palHalo = pal.labelHalo;
    const occupied = new Grid(64);
    const fits = (x0, y0, x1, y1) => {
      if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) return false;
      for (const b of occupied.query(x0, y0, x1, y1)) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false;
      return true;
    };
    const take = (x0, y0, x1, y1) => occupied.insert([x0, y0, x1, y1], x0, y0, x1, y1);
    const bbox = cam.groundBBox(40);
    const onScreen = (x, y, m = 0) => {
      const [sx, sy, w] = cam.project(x, y);
      return w > 0 && sx > -m && sy > -m && sx < W + m && sy < H + m ? [sx, sy] : null;
    };

    // 1. Метки рубрики (резервируют место первыми, рисуются последними — поверх подписей)
    const rubricHits = [];
    const rubricDraw = this.layoutRubric(cam, onScreen, take, rubricHits);

    // 2. Районы
    if (z < 13.8) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const font = `600 ${z < 11.5 ? 12 : 13}px ${FONT}`;
      for (const d of this.store.districts) {
        const s = onScreen(d.x, d.y);
        if (!s) continue;
        const text = d.name.toUpperCase();
        const tw = this.textWidth(font, text) + text.length * 1.2;
        if (!fits(s[0] - tw / 2, s[1] - 9, s[0] + tw / 2, s[1] + 9)) continue;
        take(s[0] - tw / 2, s[1] - 9, s[0] + tw / 2, s[1] + 9);
        this.text(text, s[0], s[1], font, pal.district, pal.labelHalo, 1.2);
      }
    }
    // 3. Микрорайоны и посёлки
    if (z >= 12.2 && z < 15.8) {
      const font = `600 12px ${FONT}`;
      for (const p of this.store.places) {
        if (p.kind === 'city') continue;
        const s = onScreen(p.x, p.y);
        if (!s) continue;
        const tw = this.textWidth(font, p.name);
        if (!fits(s[0] - tw / 2 - 2, s[1] - 8, s[0] + tw / 2 + 2, s[1] + 8)) continue;
        take(s[0] - tw / 2 - 2, s[1] - 8, s[0] + tw / 2 + 2, s[1] + 8);
        this.text(p.name, s[0], s[1], font, pal.label, pal.labelHalo);
      }
    }
    // 4. Улицы
    const minCls = z >= 16.3 ? 11 : z >= 15.2 ? 5 : z >= 14.2 ? 4 : z >= 13.2 ? 2 : -1;
    if (minCls >= 0) {
      const anchors = this.streetGrid.query(bbox[0], bbox[1], bbox[2], bbox[3]).filter(a => a.cls <= minCls || (a.cls === 11 && z >= 15.2));
      anchors.sort((a, b) => a.cls - b.cls || b.segLen - a.segLen);
      const font = `500 ${z >= 17 ? 13 : 12}px ${FONT}`;
      let placed = 0;
      for (const a of anchors) {
        if (placed > 140) break;
        const s = onScreen(a.x, a.y);
        if (!s) continue;
        const s2 = cam.project(a.x + a.dx * 10, a.y + a.dy * 10);
        let ang = Math.atan2(s2[1] - s[1], s2[0] - s[0]);
        if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
        const tw = this.textWidth(font, a.name);
        // подпись должна помещаться на отрезке дороги
        const segPx = a.segLen / cam.mpp;
        if (segPx < tw * 0.75 && a.cls > 2) continue;
        const c = Math.abs(Math.cos(ang)), si = Math.abs(Math.sin(ang));
        const hw = (tw * c + 14 * si) / 2, hh = (tw * si + 14 * c) / 2;
        if (!fits(s[0] - hw, s[1] - hh, s[0] + hw, s[1] + hh)) continue;
        take(s[0] - hw, s[1] - hh, s[0] + hw, s[1] + hh);
        ctx.save();
        ctx.translate(s[0], s[1]);
        ctx.rotate(ang);
        this.text(a.name, 0, 0, font, pal.street, pal.labelHalo);
        ctx.restore();
        placed++;
      }
    }
    // 5. Организации (без рубрики)
    if (z >= 15.6 && this.poiGrid) {
      // чем крупнее масштаб, тем больше мелких организаций: на 16-м — только заметные места
      const maxRank = z >= 17.4 ? 5 : z >= 16.8 ? 4 : z >= 16.2 ? 3 : 2;
      const cap = z >= 17.4 ? 110 : z >= 16.2 ? 55 : 30;
      const list = this.poiGrid.query(bbox[0], bbox[1], bbox[2], bbox[3]).filter(p => p._rank <= maxRank);
      list.sort((a, b) => a._rank - b._rank || (a.key < b.key ? -1 : 1));
      const font = `500 12px ${FONT}`;
      const rubricKeys = new Set(this.rubric.map(r => r.key));
      let placed = 0;
      for (const p of list) {
        if (placed > cap) break;
        if (rubricKeys.has(p.key)) continue;
        const s = onScreen(p.x, p.y);
        if (!s) continue;
        const tw = this.textWidth(font, p.name);
        const x0 = s[0] - 9, x1 = s[0] + 12 + tw, y0 = s[1] - 9, y1 = s[1] + 9;
        if (!fits(x0, y0, x1, y1)) continue;
        take(x0, y0, x1, y1);
        this.dot(s[0], s[1], 8, p._style.color, p._style.icon, pal.labelHalo);
        ctx.textAlign = 'left';
        this.text(p.name, s[0] + 12, s[1], font, pal.poiText, pal.labelHalo);
        ctx.textAlign = 'center';
        this.hits.push({ x: s[0], y: s[1], r: 11, kind: 'poi', id: p.key });
        placed++;
      }
    }
    // 6. Номера домов
    if (z >= 17.2 && this.houseGrid) {
      const font = `500 11px ${FONT}`;
      for (const a of this.houseGrid.query(bbox[0], bbox[1], bbox[2], bbox[3])) {
        const s = onScreen(a.x, a.y);
        if (!s) continue;
        const tw = this.textWidth(font, a.hn);
        if (!fits(s[0] - tw / 2, s[1] - 7, s[0] + tw / 2, s[1] + 7)) continue;
        take(s[0] - tw / 2, s[1] - 7, s[0] + tw / 2, s[1] + 7);
        this.text(a.hn, s[0], s[1], font, pal.house, pal.labelHalo);
      }
    }
    // 7. Рубрика поверх подписей
    rubricDraw();
    this.hits.push(...rubricHits);
    // 8. Отмеченный шаг маршрута
    if (this.step) {
      const s = onScreen(this.step.x, this.step.y);
      if (s) {
        ctx.beginPath(); ctx.arc(s[0], s[1], 8, 0, Math.PI * 2);
        ctx.fillStyle = pal.labelHalo; ctx.fill();
        ctx.lineWidth = 3.5; ctx.strokeStyle = pal.route; ctx.stroke();
      }
    }
  }

  /** Раскладка меток рубрики с кластерами; возвращает функцию отрисовки. */
  layoutRubric(cam, onScreen, take, hits) {
    const items = this.rubric;
    if (!items.length) return () => {};
    const cell = cam.zoom >= 17.5 ? 0 : 54;
    const singles = [], clusters = new Map();
    let hl = null;
    for (const it of items) {
      const s = onScreen(it.x, it.y, 30);
      if (!s) continue;
      if (it.key === this.highlightId) hl = { it, s };
      if (!cell) { singles.push({ it, s }); continue; }
      const k = `${Math.floor(s[0] / cell)}:${Math.floor(s[1] / cell)}`;
      const c = clusters.get(k);
      if (c) { c.items.push(it); c.sx += s[0]; c.sy += s[1]; } else clusters.set(k, { items: [it], sx: s[0], sy: s[1], first: s });
    }
    const draws = [];
    for (const c of clusters.values()) {
      if (c.items.length === 1) singles.push({ it: c.items[0], s: c.first });
      else {
        const x = c.sx / c.items.length, y = c.sy / c.items.length;
        const r = c.items.length >= 50 ? 23 : c.items.length >= 10 ? 19 : 16;
        take(x - r, y - r, x + r, y + r);
        draws.push(() => this.cluster(x, y, r, c.items.length));
        hits.push({ x, y, r: r + 2, kind: 'cluster', items: c.items });
      }
    }
    const showNames = cam.zoom >= 15.8;
    for (const { it, s } of singles) {
      take(s[0] - 15, s[1] - 15, s[0] + 15, s[1] + 15);
      draws.push(() => {
        this.dot(s[0], s[1], 13, this.rubricColor, CAT_BY_ID[it.cat] ? CAT_BY_ID[it.cat].icon : 'pin', '#FFFFFF', true);
        if (showNames && it.name) {
          this.ctx.textAlign = 'left';
          this.text(it.name, s[0] + 17, s[1], `600 12px ${FONT}`, this.palText || '#33373D', this.palHalo || '#FFFFFF');
          this.ctx.textAlign = 'center';
        }
      });
      hits.push({ x: s[0], y: s[1], r: 16, kind: 'poi', id: it.key });
    }
    if (hl) {
      draws.push(() => {
        const ctx = this.ctx;
        ctx.beginPath(); ctx.arc(hl.s[0], hl.s[1], 25, 0, Math.PI * 2);
        ctx.fillStyle = this.rubricColor + '38'; ctx.fill();
        this.dot(hl.s[0], hl.s[1], 17, this.rubricColor, CAT_BY_ID[hl.it.cat] ? CAT_BY_ID[hl.it.cat].icon : 'pin', '#FFFFFF', true);
      });
    }
    return () => draws.forEach(d => d());
  }

  text(t, x, y, font, color, halo, spacing = 0) {
    const ctx = this.ctx;
    ctx.font = font;
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing ? `${spacing}px` : '0px';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = halo;
    ctx.strokeText(t, x, y);
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  }

  dot(x, y, r, color, iconName, ring, shadow = false) {
    const ctx = this.ctx;
    ctx.save();
    if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1; }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = ring; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r - 2, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    drawIcon(ctx, iconName, x, y, (r - 2) * 1.2, '#FFFFFF', 2.4);
  }

  cluster(x, y, r, n) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r - 3, 0, Math.PI * 2);
    ctx.fillStyle = this.rubricColor; ctx.fill();
    ctx.font = `700 13px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(n > 999 ? `${Math.round(n / 100) / 10}k` : String(n), x, y + 0.5);
  }

  hitTest(sx, sy) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if ((h.x - sx) ** 2 + (h.y - sy) ** 2 <= h.r * h.r) return h;
    }
    return null;
  }
}
