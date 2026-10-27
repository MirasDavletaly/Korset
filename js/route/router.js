// Маршрутизатор: граф дорог Астаны, привязка точек к дорогам, A*, альтернативные варианты.
import { ROAD, ROAD_FLAG as F } from '../config.js';
import { closestOnSegment } from '../core/geo.js';

// Средние скорости в городе (км/ч) — со светофорами, без пробок.
const CAR_KMH = [75, 60, 42, 36, 30, 20, 12, 10, 0, 0, 0, 0];
const BIKE_KMH = [0, 14, 16, 16, 16, 16, 14, 12, 12, 0, 18, 10];
const FOOT_KMH = 4.8;
const MAX_MS = { car: 70 / 3.6, foot: FOOT_KMH / 3.6, bike: 18 / 3.6 };
const CAR_NODE_PENALTY = 4; // секунд на перекрёсток (кроме магистралей)

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0], topK = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    this.lastKey = topK;
    return top;
  }
}

export class Router {
  constructor(store) {
    this.store = store;
    const { pts, ways } = store.roads;
    const nPts = pts.length / 2;
    const deg = new Uint16Array(nPts);
    for (const w of ways) {
      const n = w.idx.length;
      for (let i = 0; i < n; i++) deg[w.idx[i]] += i === 0 || i === n - 1 ? 1 : 2;
    }
    const nodeOf = new Int32Array(nPts).fill(-1);
    const nodePt = [];
    const ensureNode = (p) => { if (nodeOf[p] < 0) { nodeOf[p] = nodePt.length; nodePt.push(p); } return nodeOf[p]; };
    for (const w of ways) { ensureNode(w.idx[0]); ensureNode(w.idx[w.idx.length - 1]); }
    for (let p = 0; p < nPts; p++) if (deg[p] > 2) ensureNode(p);
    // рёбра: участки линий между узлами
    const eFrom = [], eTo = [], eLen = [], eWay = [], eI0 = [], eI1 = [];
    this.wayEdges = ways.map(() => []);
    ways.forEach((w, wi) => {
      let start = 0, len = 0;
      for (let i = 1; i < w.idx.length; i++) {
        const a = w.idx[i - 1] * 2, b = w.idx[i] * 2;
        len += Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1]);
        if (nodeOf[w.idx[i]] >= 0) {
          this.wayEdges[wi].push(eFrom.length);
          eFrom.push(nodeOf[w.idx[start]]); eTo.push(nodeOf[w.idx[i]]); eLen.push(len); eWay.push(wi); eI0.push(start); eI1.push(i);
          start = i; len = 0;
        }
      }
    });
    const nE = eFrom.length, nN = nodePt.length;
    this.eFrom = Int32Array.from(eFrom); this.eTo = Int32Array.from(eTo); this.eLen = Float32Array.from(eLen);
    this.eWay = Int32Array.from(eWay); this.eI0 = Int32Array.from(eI0); this.eI1 = Int32Array.from(eI1);
    this.nodePt = Int32Array.from(nodePt);
    this.nodeX = new Float64Array(nN); this.nodeY = new Float64Array(nN);
    for (let n = 0; n < nN; n++) { this.nodeX[n] = pts[nodePt[n] * 2]; this.nodeY[n] = pts[nodePt[n] * 2 + 1]; }
    this.nodeDeg = new Uint16Array(nN);
    // смежность (CSR): для узла — список (ребро, направление)
    const count = new Int32Array(nN + 1);
    for (let e = 0; e < nE; e++) { count[this.eFrom[e] + 1]++; count[this.eTo[e] + 1]++; }
    for (let n = 0; n < nN; n++) count[n + 1] += count[n];
    this.adjStart = count.slice();
    this.adjEdge = new Int32Array(nE * 2);
    this.adjDir = new Int8Array(nE * 2);
    const fill = count.slice();
    for (let e = 0; e < nE; e++) {
      const a = this.eFrom[e], b = this.eTo[e];
      this.adjEdge[fill[a]] = e; this.adjDir[fill[a]++] = 1;
      this.adjEdge[fill[b]] = e; this.adjDir[fill[b]++] = -1;
    }
    for (let n = 0; n < nN; n++) this.nodeDeg[n] = this.adjStart[n + 1] - this.adjStart[n];
    // связность для каждого способа: точки привязываем только к основной сети, а не к оторванным кусочкам дорожек
    this.comp = {}; this.mainComp = {};
    for (const mode of ['car', 'foot', 'bike']) {
      const comp = new Int32Array(nN).fill(-1);
      let id = 0, best = -1, bestSize = 0;
      const stack = [];
      for (let s = 0; s < nN; s++) {
        if (comp[s] >= 0) continue;
        let size = 0;
        comp[s] = id; stack.push(s);
        while (stack.length) {
          const n = stack.pop(); size++;
          for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) {
            const e = this.adjEdge[k];
            if (!this.allowed(e, mode, true) && !this.allowed(e, mode, false)) continue;
            const nb = this.adjDir[k] === 1 ? this.eTo[e] : this.eFrom[e];
            if (comp[nb] < 0) { comp[nb] = id; stack.push(nb); }
          }
        }
        if (size > bestSize) { bestSize = size; best = id; }
        id++;
      }
      this.comp[mode] = comp; this.mainComp[mode] = best;
    }
    this.g = new Float64Array(nN);
    this.prevE = new Int32Array(nN);
    this.stamp = new Int32Array(nN);
    this.gen = 0;
  }

  way(e) { return this.store.roads.ways[this.eWay[e]]; }

  allowed(e, mode, forward) {
    const w = this.way(e), f = w.flags;
    if (mode === 'car') {
      if (f & F.NOCAR) return false;
      if ((f & F.FWD) && !forward) return false;
      if ((f & F.BACK) && forward) return false;
      return true;
    }
    if (mode === 'foot') return !(f & F.NOFOOT);
    if (f & F.NOBIKE) return false;
    if (w.cls <= ROAD.SERVICE && (((f & F.FWD) && !forward) || ((f & F.BACK) && forward))) return false;
    return true;
  }

  speed(e, mode) {
    const w = this.way(e);
    if (mode === 'foot') return (w.cls === ROAD.STEPS ? 2.5 : FOOT_KMH) / 3.6;
    if (mode === 'bike') return (BIKE_KMH[w.cls] || 12) / 3.6;
    let v = CAR_KMH[w.cls] || 10;
    if (w.flags & F.LINK) v *= 0.75;
    if (w.flags & F.ROUNDABOUT) v = Math.min(v, 25);
    return v / 3.6;
  }

  /** Ближайшая к точке дорога, доступная для способа передвижения. */
  snap(x, y, mode) {
    const { pts, ways } = this.store.roads;
    let best = null;
    const comp = this.comp[mode], main = this.mainComp[mode];
    for (const r of [80, 250, 700, 2000]) {
      for (const code of this.store.segGrid.query(x - r, y - r, x + r, y + r)) {
        const wi = Math.floor(code / 65536), s = code % 65536;
        const w = ways[wi];
        const a = w.idx[s] * 2, b = w.idx[s + 1] * 2;
        const c = closestOnSegment(x, y, pts[a], pts[a + 1], pts[b], pts[b + 1]);
        if (best && c.d2 >= best.d2) continue;
        const e = this.edgeOf(wi, s);
        if (e < 0 || comp[this.eFrom[e]] !== main || (!this.allowed(e, mode, true) && !this.allowed(e, mode, false))) continue;
        best = { ...c, wi, s, e };
      }
      if (best) break;
    }
    if (!best) return null;
    // расстояние от начала ребра до точки
    const w = ways[best.wi];
    let along = 0;
    for (let i = this.eI0[best.e]; i < best.s; i++) {
      const a = w.idx[i] * 2, b = w.idx[i + 1] * 2;
      along += Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1]);
    }
    const a = w.idx[best.s] * 2, b = w.idx[best.s + 1] * 2;
    along += Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1]) * best.t;
    return { e: best.e, along, x: best.x, y: best.y, seg: best.s, d: Math.sqrt(best.d2) };
  }

  edgeOf(wi, s) {
    const list = this.wayEdges[wi];
    let lo = 0, hi = list.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1, e = list[m];
      if (s < this.eI0[e]) hi = m - 1;
      else if (s >= this.eI1[e]) lo = m + 1;
      else return e;
    }
    return -1;
  }

  edgeCost(e, mode, penalty) {
    const c = this.eLen[e] / this.speed(e, mode);
    return penalty && penalty.has(e) ? c * penalty.get(e) : c;
  }

  /** A* от точки до точки. Возвращает { cost, path: [{ e, dir }], start, end, direct } или null. */
  search(S, T, mode, penalty = null) {
    const nN = this.nodeX.length;
    const g = this.g, prevE = this.prevE, stamp = this.stamp;
    const gen = ++this.gen;
    const vmax = MAX_MS[mode];
    const heap = new Heap();
    const seen = (n) => stamp[n] === gen;
    const relax = (n, cost, e) => {
      if (!seen(n) || cost < g[n]) {
        stamp[n] = gen; g[n] = cost; prevE[n] = e;
        heap.push(cost + Math.hypot(this.nodeX[n] - T.x, this.nodeY[n] - T.y) / vmax, n);
      }
    };
    const sCostAlong = (e, d) => (d / this.speed(e, mode)) * (penalty && penalty.has(e) ? penalty.get(e) : 1);
    // старт: по ребру точки к его концам
    if (this.allowed(S.e, mode, true)) relax(this.eTo[S.e], sCostAlong(S.e, this.eLen[S.e] - S.along), -1 - 1);
    if (this.allowed(S.e, mode, false)) relax(this.eFrom[S.e], sCostAlong(S.e, S.along), -1 - 2);
    // финиш: с концов ребра цели к точке
    const tExtra = new Map();
    if (this.allowed(T.e, mode, true)) tExtra.set(this.eFrom[T.e], [sCostAlong(T.e, T.along), 1]);
    if (this.allowed(T.e, mode, false)) {
      const c = sCostAlong(T.e, this.eLen[T.e] - T.along);
      const prev = tExtra.get(this.eTo[T.e]);
      if (!prev || c < prev[0]) tExtra.set(this.eTo[T.e], [c, -1]);
    }
    let best = Infinity, bestNode = -1, direct = false;
    if (S.e === T.e) {
      if (T.along >= S.along && this.allowed(S.e, mode, true)) { best = sCostAlong(S.e, T.along - S.along); direct = true; }
      else if (T.along < S.along && this.allowed(S.e, mode, false)) { best = sCostAlong(S.e, S.along - T.along); direct = true; }
    }
    let iter = 0;
    while (heap.size) {
      const n = heap.pop();
      if (heap.lastKey >= best) break;
      if (++iter > nN * 3) break;
      const gn = g[n];
      const te = tExtra.get(n);
      if (te && gn + te[0] < best) { best = gn + te[0]; bestNode = n; direct = false; }
      for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) {
        const e = this.adjEdge[k], dir = this.adjDir[k];
        if (!this.allowed(e, mode, dir === 1)) continue;
        const nb = dir === 1 ? this.eTo[e] : this.eFrom[e];
        let c = gn + this.edgeCost(e, mode, penalty);
        if (mode === 'car' && this.nodeDeg[nb] >= 3 && this.way(e).cls > ROAD.TRUNK) c += CAR_NODE_PENALTY;
        relax(nb, c, dir === 1 ? e : -(e + 4)); // -2/-3 зарезервированы под старт
      }
    }
    if (best === Infinity) return null;
    if (direct) return { cost: best, path: [], S, T, direct: true, startNode: -1, endNode: -1 };
    // восстановление пути
    const path = [];
    let n = bestNode;
    while (true) {
      const pe = prevE[n];
      if (pe === -2 || pe === -3) { path.reverse(); return { cost: best, path, S, T, direct: false, startDir: pe === -2 ? 1 : -1, endDir: tExtra.get(bestNode)[1] }; }
      const e = pe >= 0 ? pe : -pe - 4;
      const dir = pe >= 0 ? 1 : -1;
      path.push({ e, dir });
      n = dir === 1 ? this.eFrom[e] : this.eTo[e];
    }
  }

  /** Точки ребра e (с i0 по i1), в направлении dir. */
  edgeCoords(e, dir) {
    const { pts } = this.store.roads;
    const w = this.way(e);
    const out = [];
    for (let i = this.eI0[e]; i <= this.eI1[e]; i++) out.push([pts[w.idx[i] * 2], pts[w.idx[i] * 2 + 1]]);
    return dir === 1 ? out : out.reverse();
  }

  /** Часть ребра от узла до точки привязки (или от точки до узла). */
  partial(snapPt, fromNodeSide) {
    const { pts } = this.store.roads;
    const e = snapPt.e, w = this.way(e);
    const out = [];
    if (fromNodeSide === 'from') {
      for (let i = this.eI0[e]; i <= snapPt.seg; i++) out.push([pts[w.idx[i] * 2], pts[w.idx[i] * 2 + 1]]);
      out.push([snapPt.x, snapPt.y]);
    } else {
      out.push([snapPt.x, snapPt.y]);
      for (let i = snapPt.seg + 1; i <= this.eI1[e]; i++) out.push([pts[w.idx[i] * 2], pts[w.idx[i] * 2 + 1]]);
    }
    return out;
  }

  /** Результат поиска → куски пути: [{ e, coords, len, endNode }] и итоговые время/длина без штрафов. */
  assemble(res, mode) {
    const { S, T } = res;
    const pieces = [];
    const lenOf = (c) => { let l = 0; for (let i = 1; i < c.length; i++) l += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); return l; };
    if (res.direct) {
      // точки между привязками на одном ребре
      const forward = T.along >= S.along;
      const a = forward ? S : T, b = forward ? T : S;
      const coords = [[a.x, a.y]];
      const w = this.way(S.e), { pts } = this.store.roads;
      for (let i = a.seg + 1; i <= b.seg; i++) coords.push([pts[w.idx[i] * 2], pts[w.idx[i] * 2 + 1]]);
      coords.push([b.x, b.y]);
      if (!forward) coords.reverse();
      pieces.push({ e: S.e, coords, len: lenOf(coords), endNode: -1 });
    } else {
      // начало: от точки старта к первому узлу
      const startCoords = res.startDir === 1 ? this.partial(S, 'to') : this.partial(S, 'from').reverse();
      pieces.push({ e: S.e, coords: startCoords, len: lenOf(startCoords), endNode: res.startDir === 1 ? this.eTo[S.e] : this.eFrom[S.e] });
      for (const { e, dir } of res.path) {
        const c = this.edgeCoords(e, dir);
        pieces.push({ e, coords: c, len: this.eLen[e], endNode: dir === 1 ? this.eTo[e] : this.eFrom[e] });
      }
      const endCoords = res.endDir === 1 ? this.partial(T, 'from') : this.partial(T, 'to').reverse();
      pieces.push({ e: T.e, coords: endCoords, len: lenOf(endCoords), endNode: -1 });
    }
    let duration = 0, distance = 0;
    for (const p of pieces) {
      distance += p.len;
      duration += p.len / this.speed(p.e, mode);
      if (mode === 'car' && p.endNode >= 0 && this.nodeDeg[p.endNode] >= 3 && this.way(p.e).cls > ROAD.TRUNK) duration += CAR_NODE_PENALTY;
    }
    const flat = [];
    for (const p of pieces) for (let i = 0; i < p.coords.length; i++) {
      const [x, y] = p.coords[i];
      const n = flat.length;
      if (n >= 2 && Math.abs(flat[n - 2] - x) < 0.01 && Math.abs(flat[n - 1] - y) < 0.01) continue;
      flat.push(x, y);
    }
    return { pieces, duration, distance, coords: new Float32Array(flat), edges: new Set([S.e, T.e, ...res.path.map(p => p.e)]) };
  }

  /** Маршрут A→B: до трёх вариантов, первый — быстрейший. */
  route(a, b, mode) {
    const S = this.snap(a.x, a.y, mode), T = this.snap(b.x, b.y, mode);
    if (!S || !T) return { error: 'nosnap' };
    const first = this.search(S, T, mode);
    if (!first) return { error: 'noroute' };
    const routes = [this.assemble(first, mode)];
    if (!first.direct && routes[0].distance > 400) {
      const penalty = new Map();
      for (let k = 0; k < 2; k++) {
        for (const r of routes) for (const e of r.edges) penalty.set(e, 1.7);
        const res = this.search(S, T, mode, penalty);
        if (!res || res.direct) break;
        const alt = this.assemble(res, mode);
        if (alt.duration > routes[0].duration * 1.45) break;
        // сколько пути общего с уже найденными
        let shared = 0, total = 0;
        for (const p of alt.pieces) { total += p.len; if (routes.some(r => r.edges.has(p.e))) shared += p.len; }
        if (total && shared / total > 0.72) continue;
        if (routes.some(r => Math.abs(r.duration - alt.duration) < 20 && Math.abs(r.distance - alt.distance) < 50)) continue;
        routes.push(alt);
      }
    }
    routes.sort((x, y) => x.duration - y.duration);
    return { routes, snapA: S, snapB: T };
  }
}
