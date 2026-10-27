// Адрес по точке на карте — локально, по зданиям, адресам и улицам Астаны.
import { pointInPolygon, closestOnSegment } from '../core/geo.js';

export function districtAt(store, x, y) {
  for (const d of store.districts) if (d.rings.length && pointInPolygon(x, y, d.rings)) return d.name;
  return null;
}

export function buildingAt(store, x, y) {
  if (!store.buildingGrid) return null;
  let best = null;
  for (const b of store.buildingGrid.query(x - 1, y - 1, x + 1, y + 1)) {
    const [x0, y0, x1, y1] = b.bbox;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    if (!pointInPolygon(x, y, b.rings)) continue;
    // предпочитаем здание целиком, а не его часть
    if (!best || ((best.flags & 1) && !(b.flags & 1))) best = b;
  }
  return best;
}

export function poisInBuilding(store, b) {
  if (!store.poiGrid) return [];
  const [x0, y0, x1, y1] = b.bbox;
  return store.poiGrid.query(x0, y0, x1, y1).filter(p => p.name && p.tag !== 'highway=bus_stop' && pointInPolygon(p.x, p.y, b.rings));
}

export function nearestAddress(store, x, y, maxD = 35) {
  if (!store.addrGrid) return null;
  let best = null, bd = maxD;
  for (const a of store.addrGrid.query(x - maxD, y - maxD, x + maxD, y + maxD)) {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

export function nearestStreet(store, x, y, maxD = 70) {
  const { pts, ways } = store.roads;
  let best = null, bd2 = maxD * maxD;
  for (const code of store.segGrid.query(x - maxD, y - maxD, x + maxD, y + maxD)) {
    const w = ways[Math.floor(code / 65536)], s = code % 65536;
    if (w.name < 0) continue;
    const a = w.idx[s] * 2, b = w.idx[s + 1] * 2;
    const c = closestOnSegment(x, y, pts[a], pts[a + 1], pts[b], pts[b + 1]);
    if (c.d2 < bd2) { bd2 = c.d2; best = store.roads.names[w.name]; }
  }
  return best;
}

/** Описание точки: { kind: building|point, title, typeLabel, address, area, building?, inside? } */
export function reverseGeocode(store, x, y) {
  const area = districtAt(store, x, y);
  const b = buildingAt(store, x, y);
  if (b) {
    const inside = poisInBuilding(store, b);
    const named = inside.find(p => p.tag.startsWith('building=')) || null;
    const addr = b.addr ? `${b.addr.street}, ${b.addr.hn}` : null;
    return {
      kind: 'building', x, y, building: b, inside: inside.filter(p => p !== named),
      title: named ? named.name : addr || 'Здание',
      typeLabel: named ? 'Здание' : addr ? 'Здание' : 'Здание без адреса',
      address: named ? addr : (addr ? null : nearestStreet(store, x, y, 60)),
      area
    };
  }
  const a = nearestAddress(store, x, y);
  const street = nearestStreet(store, x, y);
  if (a) return { kind: 'point', x, y, title: `${a.street}, ${a.hn}`, typeLabel: 'Рядом с адресом', address: null, area };
  if (street) return { kind: 'point', x, y, title: street, typeLabel: 'Улица', address: null, area };
  return { kind: 'point', x, y, title: area || 'Точка на карте', typeLabel: area ? 'Район Астаны' : 'Точка на карте', address: null, area: null };
}
