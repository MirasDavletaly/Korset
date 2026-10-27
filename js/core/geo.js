// Локальная метрическая проекция Астаны и геометрия на плоскости (метры, ось Y на север).

export class Projection {
  constructor([lon0, lat0], [kx, ky]) { this.lon0 = lon0; this.lat0 = lat0; this.kx = kx; this.ky = ky; }
  toXY(lon, lat) { return [(lon - this.lon0) * this.kx, (lat - this.lat0) * this.ky]; }
  toLonLat(x, y) { return [this.lon0 + x / this.kx, this.lat0 + y / this.ky]; }
}

/** Раскодирует дельта-массив дециметров [x0,y0,dx,dy,...] в Float32Array метров. */
export function decodeDelta(arr, out = new Float32Array(arr.length)) {
  let x = 0, y = 0;
  for (let i = 0; i < arr.length; i += 2) {
    x += arr[i]; y += arr[i + 1];
    out[i] = x / 10; out[i + 1] = y / 10;
  }
  return out;
}

export function pointInRing(x, y, ring) {
  let inside = false;
  const n = ring.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2], yi = ring[i * 2 + 1], xj = ring[j * 2], yj = ring[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) return false;
  return true;
}

export function ringBBox(ring, bb = [Infinity, Infinity, -Infinity, -Infinity]) {
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i], y = ring[i + 1];
    if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y;
    if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
  }
  return bb;
}

/** Ближайшая точка отрезка AB к P: { t, x, y, d2 }. */
export function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx, y = ay + t * dy;
  return { t, x, y, d2: (x - px) ** 2 + (y - py) ** 2 };
}

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Азимут в градусах по часовой от севера. */
export const bearingDeg = (ax, ay, bx, by) => (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360;
