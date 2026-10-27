// Геометрия для GPU: площади (треугольники), линии (полосы с шириной в шейдере), объёмные здания.
import { triangulate } from './triangulate.js';
import { ROAD_FLAG } from '../config.js';

/** Растущий типизированный буфер, чтобы не копить миллионы JS-чисел. */
class Buf {
  constructor(Type, cap = 4096) { this.Type = Type; this.a = new Type(cap); this.n = 0; }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new this.Type(cap); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  push1(v) { this.reserve(1); this.a[this.n++] = v; }
  done() { return this.a.slice(0, this.n); }
}

/** Площади по классам: { cls: { vertices, indices } }. */
export function buildAreaMeshes(areas) {
  const out = {};
  for (const { cls, rings } of areas) {
    if (!out[cls]) out[cls] = { v: new Buf(Float32Array), i: new Buf(Uint32Array) };
    const m = out[cls];
    let len = 0;
    for (const r of rings) len += r.length;
    const flat = new Float64Array(len);
    const holes = [];
    let o = 0;
    rings.forEach((r, k) => { if (k) holes.push(o / 2); flat.set(r, o); o += r.length; });
    const tris = triangulate(flat, holes.length ? holes : null);
    if (!tris.length) continue;
    const base = m.v.n / 2;
    m.v.reserve(len);
    m.v.a.set(flat, m.v.n); m.v.n += len;
    m.i.reserve(tris.length);
    for (const t of tris) m.i.a[m.i.n++] = base + t;
  }
  for (const k of Object.keys(out)) out[k] = { vertices: out[k].v.done(), indices: out[k].i.done() };
  return out;
}

/**
 * Полосы линий. Вершина: x, y, смещение (нормаль ± направление для торцов), пройденное расстояние.
 * polylines: итератор массивов точек [x0, y0, x1, y1, ...].
 */
export function buildLineArrays(polylines) {
  const v = new Buf(Float32Array, 1 << 16), idx = new Buf(Uint32Array, 1 << 15);
  for (const pts of polylines) {
    let dist = 0;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
      const base = v.n / 5;
      v.reserve(20);
      const a = v.a;
      let o = v.n;
      a[o++] = ax; a[o++] = ay; a[o++] = nx - ux; a[o++] = ny - uy; a[o++] = dist;
      a[o++] = ax; a[o++] = ay; a[o++] = -nx - ux; a[o++] = -ny - uy; a[o++] = dist;
      a[o++] = bx; a[o++] = by; a[o++] = nx + ux; a[o++] = ny + uy; a[o++] = dist + len;
      a[o++] = bx; a[o++] = by; a[o++] = -nx + ux; a[o++] = -ny + uy; a[o++] = dist + len;
      v.n = o;
      idx.reserve(6);
      const ii = idx.a;
      let p = idx.n;
      ii[p++] = base; ii[p++] = base + 1; ii[p++] = base + 2; ii[p++] = base + 1; ii[p++] = base + 3; ii[p++] = base + 2;
      idx.n = p;
      dist += len;
    }
  }
  return { vertices: v.done(), indices: idx.done() };
}

/** Дороги по классам, отдельно обычные и мосты. */
export function buildRoadMeshes(roads) {
  const groups = {};
  const { pts, ways } = roads;
  for (const w of ways) {
    const key = `${w.cls}:${w.flags & ROAD_FLAG.BRIDGE ? 'b' : 'n'}`;
    if (!groups[key]) groups[key] = [];
    const line = new Float32Array(w.idx.length * 2);
    for (let i = 0; i < w.idx.length; i++) { line[i * 2] = pts[w.idx[i] * 2]; line[i * 2 + 1] = pts[w.idx[i] * 2 + 1]; }
    groups[key].push(line);
  }
  const out = {};
  for (const [key, lines] of Object.entries(groups)) out[key] = buildLineArrays(lines);
  return out;
}

const LIGHT = (() => { const x = -0.55, y = 0.83, l = Math.hypot(x, y); return [x / l, y / l]; })();

/**
 * Здания: крыши (тень 1.0) и стены (тень < 1 по направлению к свету) + индексы контуров крыш для gl.LINES.
 * filter(b) решает, какие здания попадают в сетку.
 */
export function buildBuildingMesh(buildings, filter) {
  const v = new Buf(Float32Array, 1 << 18), idx = new Buf(Uint32Array, 1 << 17), lines = new Buf(Uint32Array, 1 << 16);
  for (const b of buildings) {
    if (!filter(b)) continue;
    appendBuilding(b, v, idx, lines);
  }
  return { vertices: v.done(), indices: idx.done(), lineIndices: lines.done() };
}

function appendBuilding(b, v, idx, lines) {
  const { rings, h, minH } = b;
  let len = 0;
  for (const r of rings) len += r.length;
  const flat = new Float64Array(len);
  const holes = [];
  let o = 0;
  rings.forEach((r, k) => { if (k) holes.push(o / 2); flat.set(r, o); o += r.length; });
  const tris = triangulate(flat, holes.length ? holes : null);
  // крыша
  const roofBase = v.n / 4;
  v.reserve(len * 2);
  for (let i = 0; i < len; i += 2) { v.a[v.n++] = flat[i]; v.a[v.n++] = flat[i + 1]; v.a[v.n++] = h; v.a[v.n++] = 1; }
  idx.reserve(tris.length);
  for (const t of tris) idx.a[idx.n++] = roofBase + t;
  // контуры крыши и стены
  let start = 0;
  for (const r of rings) {
    const n = r.length / 2;
    lines.reserve(n * 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      lines.a[lines.n++] = roofBase + start + i;
      lines.a[lines.n++] = roofBase + start + j;
      const ax = r[i * 2], ay = r[i * 2 + 1], bx = r[j * 2], by = r[j * 2 + 1];
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
      if (l < 0.05) continue;
      const nx = dy / l, ny = -dx / l; // наружная нормаль для кольца против часовой
      const shade = 0.6 + 0.32 * ((nx * LIGHT[0] + ny * LIGHT[1]) * 0.5 + 0.5);
      const wb = v.n / 4;
      v.reserve(16);
      const a = v.a;
      let p = v.n;
      a[p++] = ax; a[p++] = ay; a[p++] = minH; a[p++] = shade;
      a[p++] = bx; a[p++] = by; a[p++] = minH; a[p++] = shade;
      a[p++] = ax; a[p++] = ay; a[p++] = h; a[p++] = shade;
      a[p++] = bx; a[p++] = by; a[p++] = h; a[p++] = shade;
      v.n = p;
      idx.reserve(6);
      const ii = idx.a;
      let q = idx.n;
      ii[q++] = wb; ii[q++] = wb + 1; ii[q++] = wb + 2; ii[q++] = wb + 1; ii[q++] = wb + 3; ii[q++] = wb + 2;
      idx.n = q;
    }
    start += n;
  }
}

/** Сетка одного здания — для подсветки выбранного. */
export function buildSingleBuilding(b) {
  const v = new Buf(Float32Array, 256), idx = new Buf(Uint32Array, 256), lines = new Buf(Uint32Array, 64);
  appendBuilding(b, v, idx, lines);
  return { vertices: v.done(), indices: idx.done(), lineIndices: lines.done() };
}
