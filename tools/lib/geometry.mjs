// Геометрия для сборки данных: площади, центры, упрощение, сборка мультиполигонов.

/** Знаковая площадь кольца [[x,y],...]. */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) return false;
  return true;
}

/** Точка для подписи/маркера внутри полигона: центр масс, а если он снаружи — середина самой широкой хорды. */
export function labelPoint(rings) {
  const ring = rings[0];
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) > 1e-9) { cx /= 3 * a; cy /= 3 * a; } else { cx = ring[0][0]; cy = ring[0][1]; }
  if (pointInPolygon(cx, cy, rings)) return [cx, cy];
  const xs = [];
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
    }
  }
  xs.sort((p, q) => p - q);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  return best ? [(best[0] + best[1]) / 2, cy] : [ring[0][0], ring[0][1]];
}

/** Упрощение Дугласа–Пекера. */
export function simplify(points, tol) {
  if (points.length <= 2 || tol <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Сборка колец из линий-участников мультиполигона. members: [{ ids: [nodeId...], pts: [[x,y]...] }].
 * Возвращает замкнутые кольца [[x,y]...] (без повтора первой точки); незамыкающиеся куски отбрасываются.
 */
export function assembleRings(members) {
  const pool = members.filter(m => m.ids.length >= 2).map(m => ({ ids: m.ids.slice(), pts: m.pts.slice() }));
  const rings = [];
  while (pool.length) {
    const cur = pool.pop();
    let guard = 0;
    while (cur.ids[0] !== cur.ids[cur.ids.length - 1] && guard++ < 10000) {
      const last = cur.ids[cur.ids.length - 1];
      let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (p.ids[0] === last) { found = i; break; }
        if (p.ids[p.ids.length - 1] === last) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      const [p] = pool.splice(found, 1);
      const ids = rev ? p.ids.slice().reverse() : p.ids;
      const pts = rev ? p.pts.slice().reverse() : p.pts;
      cur.ids.push(...ids.slice(1));
      cur.pts.push(...pts.slice(1));
    }
    if (cur.ids.length >= 4 && cur.ids[0] === cur.ids[cur.ids.length - 1]) rings.push(cur.pts.slice(0, -1));
  }
  return rings;
}

/** Группирует кольца в полигоны: внешнее кольцо + вложенные внутренние. Ориентация: внешнее против часовой. */
export function ringsToPolygons(outer, inner) {
  const polys = outer.filter(r => r.length >= 3).map(r => [ringArea(r) < 0 ? r.slice().reverse() : r]);
  for (const r of inner) {
    if (r.length < 3) continue;
    const host = polys.find(p => pointInRing(r[0][0], r[0][1], p[0]));
    if (host) host.push(ringArea(r) > 0 ? r.slice().reverse() : r);
  }
  return polys;
}
