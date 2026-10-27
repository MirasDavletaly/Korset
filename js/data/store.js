// Данные Астаны: загрузка JSON из data/, раскодирование координат, пространственные индексы.
import { DATA_FILES } from '../config.js';
import { Projection, decodeDelta, ringBBox } from '../core/geo.js';
import { Grid } from '../core/grid.js';

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export class Store {
  constructor(base) {
    this.proj = new Projection(base.origin, base.k);
    const [x0, y0, x1, y1] = base.bbox;
    this.bbox = [x0 / 10, y0 / 10, x1 / 10, y1 / 10];
    this.generated = base.generated;
    this.decodeBase(base);
    this.buildings = [];
    this.pois = []; this.poiByKey = new Map();
    this.addr = []; this.streets = []; this.districts = []; this.places = [];
  }

  /** Загрузка: основа города → здания → места. onStage(название, доля). */
  static async load(onStage = () => {}) {
    const pBase = getJSON(DATA_FILES.base);
    const pBld = getJSON(DATA_FILES.buildings);
    const pPlaces = getJSON(DATA_FILES.places);
    onStage('Загружаем улицы и кварталы', 0.1);
    const store = new Store(await pBase);
    onStage('Загружаем здания', 0.4);
    store.decodeBuildings(await pBld);
    onStage('Загружаем организации и адреса', 0.65);
    store.decodePlaces(await pPlaces);
    return store;
  }

  decodeBase(base) {
    this.areas = base.areas.map(([cls, ...rings]) => ({ cls, rings: rings.map(r => decodeDelta(r)) }));
    this.lines = base.lines.map(([cls, pts]) => ({ cls, pts: decodeDelta(pts) }));
    const r = base.roads;
    const pts = decodeDelta(r.p);
    const ways = r.w.map(([cls, name, flags, d]) => {
      const idx = new Int32Array(d.length);
      let acc = 0;
      for (let i = 0; i < d.length; i++) { acc += d[i]; idx[i] = acc; }
      return { cls, name, flags, idx };
    });
    this.roads = { pts, names: r.n, ways };
    // сетка отрезков дорог: для адреса по клику и привязки маршрута
    const g = new Grid(120);
    ways.forEach((w, wi) => {
      for (let s = 0; s + 1 < w.idx.length; s++) {
        const a = w.idx[s] * 2, b = w.idx[s + 1] * 2;
        g.insert(wi * 65536 + s, Math.min(pts[a], pts[b]), Math.min(pts[a + 1], pts[b + 1]), Math.max(pts[a], pts[b]), Math.max(pts[a + 1], pts[b + 1]));
      }
    });
    this.segGrid = g;
  }

  decodeBuildings(data) {
    const g = new Grid(150);
    this.buildings = data.b.map(([h, minH, flags, ...rings], i) => {
      const rr = rings.map(r => decodeDelta(r));
      const bbox = ringBBox(rr[0]);
      const b = { i, h: h / 10, minH: minH / 10, flags, rings: rr, bbox, addr: -1 };
      g.insert(b, bbox[0], bbox[1], bbox[2], bbox[3]);
      return b;
    });
    this.buildingGrid = g;
  }

  decodePlaces(data) {
    const pg = new Grid(300);
    this.pois = data.pois.map(([key, x, y, tag, cat, name, extra]) => {
      const p = { key, x: x / 10, y: y / 10, tag, cat: cat || null, name, extra: extra || {} };
      pg.insert(p, p.x, p.y);
      this.poiByKey.set(key, p);
      return p;
    });
    this.poiGrid = pg;
    const ag = new Grid(150);
    this.addr = data.addr.map(([si, hn, x, y, b]) => {
      const a = { street: data.addrStreets[si], hn, x: x / 10, y: y / 10, b };
      ag.insert(a, a.x, a.y);
      if (b >= 0 && this.buildings[b]) this.buildings[b].addr = a;
      return a;
    });
    this.addrGrid = ag;
    this.streets = data.streets.map(([name, alt, x, y, len]) => ({ name, alt: alt || [], x: x / 10, y: y / 10, len }));
    this.districts = data.districts.map(([name, x, y, ...rings]) => ({ name, x: x / 10, y: y / 10, rings: rings.map(r => decodeDelta(r)) }));
    this.places = data.places.map(([name, kind, x, y, alt]) => ({ name, kind, x: x / 10, y: y / 10, alt: alt || null }));
  }

  roadName(way) { return way.name >= 0 ? this.roads.names[way.name] : ''; }
}
