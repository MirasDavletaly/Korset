// Сборка данных Korset из выгрузки OpenStreetMap (.osm.pbf) — только Астана.
//
//   node tools/build-data.mjs <kazakhstan.osm.pbf> [выходная папка=data]
//
// Выгрузка: https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf
// Результат: data/base.json (рельеф города и дороги), data/buildings.json, data/places.json.
// Координаты — локальная метрическая проекция с центром в Астане, целые дециметры, дельта-кодирование.

import fs from 'node:fs';
import path from 'node:path';
import { blocks, parseBlock } from './lib/pbf-reader.mjs';
import { parseOpeningHours, packSchedule } from './lib/opening-hours.mjs';
import { ringArea, pointInPolygon, pointInRing, labelPoint, simplify, assembleRings, ringsToPolygons } from './lib/geometry.mjs';

const [, , PBF, OUT = 'data'] = process.argv;
if (!PBF) { console.error('usage: node tools/build-data.mjs <file.osm.pbf> [outdir]'); process.exit(1); }

// ---------- Параметры города ----------
const BBOX = { w: 71.25, s: 50.99, e: 71.68, n: 51.28 };   // городская застройка Астаны с аэропортом
const MARGIN = 0.03;                                         // узлы чуть шире рамки, чтобы не рвать линии на краю
const ORIGIN = { lon: 71.43, lat: 51.13 };
const phi = ORIGIN.lat * Math.PI / 180;
const KY = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi);
const KX = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
const proj = (lon, lat) => [Math.round((lon - ORIGIN.lon) * KX * 10), Math.round((lat - ORIGIN.lat) * KY * 10)]; // дециметры
const [MINX, MINY] = proj(BBOX.w, BBOX.s);
const [MAXX, MAXY] = proj(BBOX.e, BBOX.n);
const inMain = (x, y) => x >= MINX && x <= MAXX && y >= MINY && y <= MAXY;
const ringInMain = (ring) => ring.some(([x, y]) => inMain(x, y));

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------- Классификация тегов ----------
const ROAD_CLASS = {
  motorway: 0, motorway_link: 0, trunk: 1, trunk_link: 1, primary: 2, primary_link: 2, secondary: 3, secondary_link: 3,
  tertiary: 4, tertiary_link: 4, unclassified: 5, residential: 5, living_street: 5, road: 5, busway: 6,
  service: 6, track: 7, footway: 8, path: 8, bridleway: 8, steps: 9, cycleway: 10, pedestrian: 11
};
const F = { FWD: 1, BACK: 2, ROUNDABOUT: 4, BRIDGE: 8, TUNNEL: 16, NOCAR: 32, NOFOOT: 64, NOBIKE: 128, LINK: 256 };

function areaClass(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.water || ['reservoir', 'basin'].includes(t.landuse)) return 'water';
  if (['park', 'garden', 'playground', 'dog_park'].includes(t.leisure) || ['recreation_ground', 'village_green'].includes(t.landuse)) return 'park';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (['grass', 'meadow', 'flowerbed', 'plant_nursery'].includes(t.landuse) || ['grassland', 'scrub', 'heath', 'wetland'].includes(t.natural)) return 'grass';
  if (['farmland', 'orchard', 'allotments', 'farmyard'].includes(t.landuse)) return 'farm';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (['pitch', 'stadium', 'sports_centre', 'track', 'golf_course'].includes(t.leisure)) return 'sport';
  if (['school', 'university', 'college', 'kindergarten'].includes(t.amenity)) return 'edu';
  if (['hospital', 'clinic'].includes(t.amenity)) return 'hospital';
  if (t.amenity === 'parking' && t.parking !== 'underground' && t.parking !== 'multi-storey') return 'parking';
  if ((t.highway === 'pedestrian' && t.area === 'yes') || t.place === 'square' || t['area:highway'] === 'pedestrian') return 'plaza';
  if (['sand', 'beach'].includes(t.natural)) return 'sand';
  if (['industrial', 'commercial', 'retail', 'railway', 'garages', 'construction', 'brownfield', 'quarry', 'landfill'].includes(t.landuse)) return 'industrial';
  if (t.landuse === 'residential') return 'residential';
  return null;
}
const AREA_ORDER = ['residential', 'industrial', 'farm', 'edu', 'hospital', 'grass', 'forest', 'park', 'cemetery', 'sport', 'sand', 'parking', 'plaza', 'water'];

const isBuilding = (t) => (t.building && t.building !== 'no') || !!t['building:part'] && t['building:part'] !== 'no';
const POI_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'healthcare', 'craft', 'historic', 'man_made', 'railway', 'aeroway', 'public_transport', 'highway'];
const LEISURE_POI = new Set(['park', 'garden', 'fitness_centre', 'sports_centre', 'stadium', 'water_park', 'swimming_pool', 'ice_rink', 'amusement_arcade', 'bowling_alley', 'dance', 'playground', 'sports_hall']);
const AMENITY_SKIP = new Set(['bench', 'waste_basket', 'parking_space', 'bicycle_parking', 'vending_machine', 'waste_disposal', 'recycling',
  'shelter', 'drinking_water', 'post_box', 'telephone', 'clock', 'motorcycle_parking', 'parking_entrance', 'loading_dock', 'grit_bin',
  'smoking_area', 'hunting_stand', 'bbq', 'water_point', 'watering_place', 'trolley_bay', 'letter_box', 'photo_booth', 'atm_kiosk']);
const CAT_BY_TAG = {
  'amenity=pharmacy': 'pharmacy', 'amenity=cafe': 'food', 'amenity=restaurant': 'food', 'amenity=fast_food': 'food',
  'shop=supermarket': 'grocery', 'shop=convenience': 'grocery', 'amenity=atm': 'atm', 'amenity=bank': 'atm',
  'amenity=fuel': 'fuel', 'amenity=hospital': 'medical', 'amenity=clinic': 'medical', 'amenity=doctors': 'medical',
  'amenity=school': 'school', 'amenity=kindergarten': 'school', 'amenity=parking': 'parking'
};

function primaryTag(t) {
  for (const k of POI_KEYS) {
    const v = t[k];
    if (!v || v === 'no' || v === 'yes' && k !== 'office' && k !== 'shop' && k !== 'craft' && k !== 'healthcare') continue;
    if (k === 'leisure' && !LEISURE_POI.has(v)) continue;
    if (k === 'highway' && v !== 'bus_stop') continue;
    if (k === 'railway' && !['station', 'halt', 'tram_stop'].includes(v)) continue;
    if (k === 'aeroway' && !['aerodrome', 'terminal'].includes(v)) continue;
    if (k === 'public_transport' && v !== 'station') continue;
    if (k === 'man_made' && !['tower', 'water_tower', 'lighthouse'].includes(v)) continue;
    return `${k}=${v}`;
  }
  return null;
}
function poiInfo(t) {
  const tag = primaryTag(t);
  const name = t['name:ru'] || t.name || '';
  if (!tag) return (name && isBuilding(t) && !t['building:part']) ? { tag: `building=${t.building}`, cat: null, name } : null;
  const cat = CAT_BY_TAG[tag] || null;
  const [k, v] = tag.split('=');
  if (!name) {
    if (!cat) return null;
    if (cat === 'parking' && (['private', 'no', 'customers'].includes(t.access) || t.parking === 'underground')) return null;
  }
  if (k === 'amenity' && AMENITY_SKIP.has(v) && !name) return null;
  if (t.access === 'private' && !name) return null;
  return { tag, cat, name };
}
function poiExtra(t, name) {
  const e = {};
  const set = (k, v) => { if (v != null && v !== '') e[k] = v; };
  if (t.name && t.name !== name) set('nk', t.name);
  if (t['name:kk'] && t['name:kk'] !== name && t['name:kk'] !== t.name) set('nkk', t['name:kk']);
  if (t.opening_hours) { set('oh', t.opening_hours); set('s', packSchedule(parseOpeningHours(t.opening_hours))); }
  set('ph', t.phone || t['contact:phone'] || t['contact:mobile']);
  set('web', t.website || t['contact:website'] || t.url);
  set('cu', t.cuisine);
  set('wc', t.wheelchair);
  set('op', t.operator);
  set('br', t.brand);
  const street = t['addr:street'] || t['addr:place'];
  if (street || t['addr:housenumber']) set('ad', [street || '', t['addr:housenumber'] || '']);
  set('fee', t.fee);
  set('cap', t.capacity);
  set('lv', t['building:levels']);
  return Object.keys(e).length ? e : 0;
}

const num = (v) => { const m = String(v ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
const DEFAULT_H = {
  house: 6, detached: 6, semidetached_house: 6, terrace: 7, bungalow: 4, cabin: 4, garage: 3.5, garages: 3.5, shed: 3, hut: 3,
  kiosk: 3.5, roof: 4, carport: 3, container: 3, toilets: 3, service: 4, apartments: 16, residential: 13, dormitory: 15,
  industrial: 9, warehouse: 9, hangar: 11, commercial: 12, retail: 8, office: 15, school: 12, kindergarten: 7, university: 15,
  hospital: 15, public: 12, civic: 12, government: 15, church: 16, mosque: 18, cathedral: 22, construction: 8, stadium: 25
};
function heights(t) {
  let h = num(t.height);
  const lv = num(t['building:levels']), roofLv = num(t['roof:levels']) || 0;
  if (!Number.isFinite(h)) h = Number.isFinite(lv) ? (lv + roofLv) * 3.2 + 1 : (DEFAULT_H[t.building] ?? DEFAULT_H[t['building:part']] ?? 9);
  let minH = num(t.min_height);
  if (!Number.isFinite(minH)) { const ml = num(t['building:min_level']); minH = Number.isFinite(ml) ? ml * 3.2 : 0; }
  h = Math.max(2, Math.min(400, h));
  minH = Math.max(0, Math.min(h - 1, minH));
  return [Math.round(h * 10), Math.round(minH * 10)];
}

// ---------- Проход 1: отношения ----------
const relations = [];
const needWays = new Set();
for (const { type, data } of blocks(PBF)) {
  if (type !== 'OSMData') continue;
  parseBlock(data, {
    relation(id, tags, members) {
      const isMp = tags.type === 'multipolygon';
      const isAdmin = tags.type === 'boundary' && tags.boundary === 'administrative' && tags.admin_level && tags.name;
      if (!isMp && !isAdmin) return;
      if (isMp && !areaClass(tags) && !isBuilding(tags) && !poiInfo(tags)) return;
      const ways = members.filter(m => m.type === 'way');
      relations.push({ id, tags, members: ways, admin: isAdmin });
      for (const m of ways) needWays.add(m.ref);
    }
  });
}
log('relations of interest:', relations.length, 'member ways:', needWays.size);

// ---------- Проход 2: узлы и линии ----------
const nodeIds = [], nodeX = [], nodeY = [];
const nodeFeatures = [];
const ways = new Map();
// узлы берём по всей административной границе Астаны: иначе контуры районов не замкнутся
const ext = { w: Math.min(BBOX.w - MARGIN, 71.20), s: Math.min(BBOX.s - MARGIN, 50.84), e: Math.max(BBOX.e + MARGIN, 71.80), n: Math.max(BBOX.n + MARGIN, 51.37) };
function nodeIndex(id) {
  let lo = 0, hi = nodeIds.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, v = nodeIds[mid];
    if (v === id) return mid;
    if (v < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
const wayWanted = (t) => t.highway || isBuilding(t) || areaClass(t) || t.waterway || t.railway || poiInfo(t) || t['addr:housenumber'];
for (const { type, data } of blocks(PBF)) {
  if (type !== 'OSMData') continue;
  parseBlock(data, {
    node(id, lat, lon, getTags) {
      if (lat < ext.s || lat > ext.n || lon < ext.w || lon > ext.e) return;
      const [x, y] = proj(lon, lat);
      nodeIds.push(id); nodeX.push(x); nodeY.push(y);
      if (getTags && inMain(x, y)) {
        const t = getTags();
        if (poiInfo(t) || t.place || t['addr:housenumber']) nodeFeatures.push({ id, x, y, t });
      }
    },
    way(id, tags, refs) {
      if (!needWays.has(id) && !wayWanted(tags)) return;
      const idx = refs.map(nodeIndex);
      if (!idx.some(i => i >= 0)) return;
      ways.set(id, { id, tags, refs, idx });
    }
  });
}
log('nodes in area:', nodeIds.length, 'node features:', nodeFeatures.length, 'ways:', ways.size);

const ptOf = (i) => [nodeX[i], nodeY[i]];
const closed = (w) => w.refs.length >= 4 && w.refs[0] === w.refs[w.refs.length - 1] && w.idx.every(i => i >= 0);
const ringOf = (w) => w.idx.slice(0, -1).map(ptOf);

// ---------- Мультиполигоны ----------
function relationPolygons(rel) {
  const toMember = (m) => {
    const w = ways.get(m.ref);
    if (!w || !w.idx.every(i => i >= 0)) return null;
    return { ids: w.refs, pts: w.idx.map(ptOf) };
  };
  const outer = assembleRings(rel.members.filter(m => m.role !== 'inner').map(toMember).filter(Boolean));
  const inner = assembleRings(rel.members.filter(m => m.role === 'inner').map(toMember).filter(Boolean));
  return ringsToPolygons(outer, inner);
}
const normPoly = (rings) => rings.map((r, i) => { const a = ringArea(r); return (i === 0 ? a < 0 : a > 0) ? r.slice().reverse() : r; });

// ---------- Кодирование ----------
const enc = (pts) => { const out = []; let px = 0, py = 0; for (const [x, y] of pts) { out.push(x - px, y - py); px = x; py = y; } return out; };
const simplifyRing = (r, tol) => { if (r.length < 8) return r; const s = simplify([...r, r[0]], tol).slice(0, -1); return s.length >= 3 ? s : r; };

// ---------- Площадные объекты ----------
const areas = [];
const buildings = [];
const pois = [];
const usedPoiKeys = new Set();
function addPoi(key, x, y, t) {
  if (usedPoiKeys.has(key)) return;
  const info = poiInfo(t);
  if (!info) return;
  usedPoiKeys.add(key);
  pois.push([key, x, y, info.tag, info.cat || '', info.name, poiExtra(t, info.name)]);
}
function handleArea(key, tags, polys) {
  for (const poly of polys) {
    if (!poly.length || poly[0].length < 3 || !ringInMain(poly[0])) continue;
    const rings = normPoly(poly);
    const cls = areaClass(tags);
    if (cls && !isBuilding(tags)) areas.push([cls, rings]);
    if (isBuilding(tags)) buildings.push({ tags, rings, key });
    const info = poiInfo(tags);
    if (info) {
      const [x, y] = labelPoint(rings);
      if (inMain(x, y)) addPoi(key, Math.round(x), Math.round(y), tags);
    }
  }
}
for (const w of ways.values()) {
  const t = w.tags;
  if (t.highway && !(t.area === 'yes' || t['area:highway'])) continue;
  if (!closed(w)) continue;
  if (!areaClass(t) && !isBuilding(t) && !poiInfo(t)) continue;
  handleArea(`w${w.id}`, t, [[ringOf(w)]]);
}
const districtsRaw = [];
for (const rel of relations) {
  const polys = relationPolygons(rel);
  if (!polys.length) continue;
  if (rel.admin) { districtsRaw.push({ rel, polys }); continue; }
  handleArea(`r${rel.id}`, rel.tags, polys);
}
log('areas:', areas.length, 'buildings:', buildings.length);

// ---------- Здания: высоты, части, адреса ----------
const partGrid = new Map();
const cellOf = (x, y) => `${Math.floor(x / 2000)},${Math.floor(y / 2000)}`;
for (const b of buildings) {
  if (!b.tags['building:part'] || b.tags.building) continue;
  const [x, y] = labelPoint(b.rings);
  const c = cellOf(x, y);
  if (!partGrid.has(c)) partGrid.set(c, []);
  partGrid.get(c).push([x, y]);
}
const addrStreets = [], addrStreetIdx = new Map();
const streetRef = (s) => { if (!addrStreetIdx.has(s)) { addrStreetIdx.set(s, addrStreets.length); addrStreets.push(s); } return addrStreetIdx.get(s); };
const addresses = [];
const bOut = [];
for (const b of buildings) {
  const t = b.tags;
  const isPart = !!t['building:part'] && !t.building;
  let flags = isPart ? 1 : 0;
  if (!isPart) {
    const xs = b.rings[0].map(p => p[0]), ys = b.rings[0].map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let has = false;
    for (let cx = Math.floor(x0 / 2000); cx <= Math.floor(x1 / 2000) && !has; cx++) {
      for (let cy = Math.floor(y0 / 2000); cy <= Math.floor(y1 / 2000) && !has; cy++) {
        for (const [px, py] of partGrid.get(`${cx},${cy}`) || []) if (pointInRing(px, py, b.rings[0])) { has = true; break; }
      }
    }
    if (has) flags |= 2;
  }
  const [h, minH] = heights(t);
  const rings = b.rings.map(r => simplifyRing(r, 3));
  const idx = bOut.length;
  bOut.push([h, minH, flags, ...rings.map(enc)]);
  const hn = t['addr:housenumber'];
  const street = t['addr:street'] || t['addr:place'];
  if (hn && street && !isPart) {
    const [x, y] = labelPoint(b.rings);
    addresses.push([streetRef(street), hn, Math.round(x), Math.round(y), idx]);
  }
}
for (const f of nodeFeatures) {
  const hn = f.t['addr:housenumber'], street = f.t['addr:street'] || f.t['addr:place'];
  if (hn && street && !poiInfo(f.t)) addresses.push([streetRef(street), hn, f.x, f.y, -1]);
}
log('addresses:', addresses.length);

// ---------- Дороги ----------
const roadPts = [], roadPtOf = new Map(), roadNames = [], roadNameIdx = new Map();
const nameRef = (s) => { if (!s) return -1; if (!roadNameIdx.has(s)) { roadNameIdx.set(s, roadNames.length); roadNames.push(s); } return roadNameIdx.get(s); };
const roads = [];
const streetGroups = new Map();
const no = (v) => v === 'no' || v === 'private';
const yes = (v) => v === 'yes' || v === 'designated' || v === 'permissive';
for (const w of ways.values()) {
  const t = w.tags;
  const cls = ROAD_CLASS[t.highway];
  if (cls === undefined || t.area === 'yes' || t['area:highway']) continue;
  let flags = 0;
  const ow = t.oneway;
  if (ow === 'yes' || ow === 'true' || ow === '1') flags |= F.FWD;
  else if (ow === '-1' || ow === 'reverse') flags |= F.BACK;
  if (t.junction === 'roundabout' || t.junction === 'circular') { flags |= F.ROUNDABOUT; if (!(flags & F.BACK) && ow !== 'no') flags |= F.FWD; }
  if (cls === 0 && ow !== 'no' && !(flags & F.BACK)) flags |= F.FWD;
  if (t.bridge && t.bridge !== 'no') flags |= F.BRIDGE;
  if (t.tunnel && t.tunnel !== 'no') flags |= F.TUNNEL;
  if (t.highway.endsWith('_link')) flags |= F.LINK;
  const carOk = cls <= 6 && !(no(t.motor_vehicle) || no(t.motorcar) || no(t.vehicle)) && !(no(t.access) && !yes(t.motor_vehicle) && !yes(t.motorcar))
    && t.service !== 'emergency_access' && t.highway !== 'busway';
  const footOk = cls !== 0 && t.foot !== 'no' && !(no(t.access) && !yes(t.foot));
  const bikeOk = cls !== 0 && cls !== 9 && t.bicycle !== 'no' && !(no(t.access) && !yes(t.bicycle));
  if (!carOk) flags |= F.NOCAR;
  if (!footOk) flags |= F.NOFOOT;
  if (!bikeOk) flags |= F.NOBIKE;
  const name = t['name:ru'] || t.name || '';
  const nIdx = nameRef(name);
  // разрезаем на непрерывные куски с известными узлами
  let run = [];
  const flush = () => {
    if (run.length >= 2 && run.some(i => inMain(nodeX[i], nodeY[i]))) {
      const ptIdx = run.map(i => {
        if (!roadPtOf.has(i)) { roadPtOf.set(i, roadPts.length); roadPts.push([nodeX[i], nodeY[i]]); }
        return roadPtOf.get(i);
      });
      roads.push([cls, nIdx, flags, ptIdx]);
      if (name && cls <= 6) {
        const mid = roadPts[ptIdx[ptIdx.length >> 1]];
        let len = 0;
        for (let k = 1; k < ptIdx.length; k++) { const a = roadPts[ptIdx[k - 1]], b = roadPts[ptIdx[k]]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
        if (!streetGroups.has(name)) streetGroups.set(name, []);
        const alt = [...new Set([t.name, t['name:kk'], t['name:ru'], t.old_name, t.alt_name].filter(v => v && v !== name))];
        streetGroups.get(name).push({ x: mid[0], y: mid[1], len, alt });
      }
    }
    run = [];
  };
  for (const i of w.idx) { if (i >= 0) run.push(i); else flush(); }
  flush();
}
log('roads:', roads.length, 'road points:', roadPts.length, 'road names:', roadNames.length);

// Улицы для поиска: одинаковые названия, лежащие далеко друг от друга, — разные записи.
const streets = [];
for (const [name, parts] of streetGroups) {
  const clusters = [];
  for (const p of parts.sort((a, b) => b.len - a.len)) {
    const c = clusters.find(c => Math.hypot(c.x - p.x, c.y - p.y) < 25000);
    if (c) { c.len += p.len; p.alt.forEach(a => c.alt.add(a)); }
    else clusters.push({ x: p.x, y: p.y, len: p.len, alt: new Set(p.alt) });
  }
  for (const c of clusters) streets.push([name, [...c.alt], c.x, c.y, Math.round(c.len / 10)]);
}
log('streets:', streets.length);

// ---------- Водотоки и железные дороги ----------
const lines = [];
const WATERWAY = { river: 'river', canal: 'canal', stream: 'stream', ditch: 'ditch', drain: 'ditch' };
for (const w of ways.values()) {
  const t = w.tags;
  let cls = null;
  if (WATERWAY[t.waterway] && t.tunnel !== 'culvert') cls = WATERWAY[t.waterway];
  else if (['rail', 'light_rail', 'narrow_gauge', 'tram'].includes(t.railway) && !t.service) cls = t.railway === 'tram' ? 'tram' : 'rail';
  if (!cls) continue;
  let run = [];
  const flush = () => { if (run.length >= 2 && run.some(([x, y]) => inMain(x, y))) lines.push([cls, enc(simplify(run, 10))]); run = []; };
  for (const i of w.idx) { if (i >= 0) run.push(ptOf(i)); else flush(); }
  flush();
}
log('lines:', lines.length);

// ---------- Точки интереса ----------
for (const f of nodeFeatures) addPoi(`n${f.id}`, f.x, f.y, f.t);
log('pois:', pois.length);

// ---------- Районы и топонимы ----------
const city = districtsRaw.find(d => /^(Астана|Astana)$/i.test(d.rel.tags['name:ru'] || d.rel.tags.name) || d.rel.tags['name:en'] === 'Astana');
const cityLevel = city ? +city.rel.tags.admin_level : 4;
const cityPoly = city ? city.polys.slice().sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0])))[0] : null;
const districts = [];
for (const d of districtsRaw) {
  const lvl = +d.rel.tags.admin_level;
  if (!(lvl > cityLevel && lvl <= 9)) continue;
  const poly = d.polys.sort((a, b) => Math.abs(ringArea(b[0])) - Math.abs(ringArea(a[0])))[0];
  const [x, y] = labelPoint(poly);
  if (!inMain(x, y)) continue;
  if (cityPoly && !pointInPolygon(x, y, cityPoly)) continue;
  const name = d.rel.tags['name:ru'] || d.rel.tags.name;
  districts.push([name, Math.round(x), Math.round(y), ...normPoly(poly).map(r => enc(simplify([...r, r[0]], 100).slice(0, -1)))]);
}
log('city admin_level:', cityLevel, 'districts:', districts.map(d => d[0]).join(', '));
const places = [];
for (const f of nodeFeatures) {
  const p = f.t.place;
  if (!['suburb', 'quarter', 'neighbourhood', 'city', 'town', 'village', 'hamlet', 'locality'].includes(p)) continue;
  const name = f.t['name:ru'] || f.t.name;
  if (!name) continue;
  places.push([name, p, f.x, f.y, f.t.name && f.t.name !== name ? f.t.name : 0]);
}
log('places:', places.length);

// ---------- Запись ----------
areas.sort((a, b) => AREA_ORDER.indexOf(a[0]) - AREA_ORDER.indexOf(b[0]));
const areasOut = areas.map(([cls, rings]) => {
  const tol = cls === 'residential' || cls === 'farm' ? 30 : 8;
  return [cls, ...rings.map(r => enc(simplifyRing(r, tol)))];
});
const meta = {
  v: 1,
  generated: new Date().toISOString().slice(0, 10),
  source: '© OpenStreetMap contributors, ODbL',
  origin: [ORIGIN.lon, ORIGIN.lat], k: [+KX.toFixed(3), +KY.toFixed(3)], unit: 0.1,
  bbox: [MINX, MINY, MAXX, MAXY]
};
fs.mkdirSync(OUT, { recursive: true });
const write = (file, obj) => {
  const s = JSON.stringify(obj);
  fs.writeFileSync(path.join(OUT, file), s);
  log('wrote', file, (s.length / 1e6).toFixed(2), 'MB');
};
// точки дорог: дельта-кодирование в порядке появления; индексы точек в линиях — тоже дельты
const roadsOut = roads.map(([cls, n, flags, idx]) => {
  const d = []; let p = 0;
  for (const i of idx) { d.push(i - p); p = i; }
  return [cls, n, flags, d];
});
write('base.json', { ...meta, areas: areasOut, lines, roads: { p: enc(roadPts), n: roadNames, w: roadsOut } });
write('buildings.json', { ...meta, b: bOut });
write('places.json', { ...meta, pois, addr: addresses, addrStreets, streets, districts, places });
log('done');
