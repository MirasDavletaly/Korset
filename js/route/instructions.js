// Пошаговые подсказки маршрута по-русски: повороты, смена улицы, круговое движение.
import { bearingDeg } from '../core/geo.js';
import { ROAD_FLAG as F } from '../config.js';
import { icon } from '../core/icons.js';

const COMPASS = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];

function modifierOf(ang) {
  const a = Math.abs(ang), side = ang > 0 ? 'right' : 'left';
  if (a < 25) return 'straight';
  if (a < 60) return `slight ${side}`;
  if (a < 135) return side;
  if (a < 170) return `sharp ${side}`;
  return 'uturn';
}

function bearingAt(coords, fromEnd) {
  const n = coords.length;
  if (fromEnd) {
    for (let i = n - 1; i > 0; i--) {
      const [x1, y1] = coords[i], [x0, y0] = coords[i - 1];
      if (Math.hypot(x1 - x0, y1 - y0) > 0.5) return bearingDeg(x0, y0, x1, y1);
    }
  } else {
    for (let i = 0; i + 1 < n; i++) {
      const [x0, y0] = coords[i], [x1, y1] = coords[i + 1];
      if (Math.hypot(x1 - x0, y1 - y0) > 0.5) return bearingDeg(x0, y0, x1, y1);
    }
  }
  return null;
}

export function buildSteps(router, route, mode) {
  const pieces = route.pieces.filter(p => p.len > 0.3 || p === route.pieces[route.pieces.length - 1]);
  if (!pieces.length) return [];
  const nameOf = (p) => router.store.roadName(router.way(p.e));
  const isRb = (p) => !!(router.way(p.e).flags & F.ROUNDABOUT);
  const hasExit = (node) => {
    for (let k = router.adjStart[node]; k < router.adjStart[node + 1]; k++) {
      const e = router.adjEdge[k], dir = router.adjDir[k];
      if (!(router.way(e).flags & F.ROUNDABOUT) && router.allowed(e, mode, dir === 1)) return true;
    }
    return false;
  };
  const steps = [];
  let cur = { type: 'depart', name: nameOf(pieces[0]), bearing: bearingAt(pieces[0].coords, false), loc: pieces[0].coords[0], distance: 0 };
  steps.push(cur);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    cur.distance += p.len;
    if (i === pieces.length - 1) break;
    const q = pieces[i + 1];
    if (isRb(q) && !isRb(p) && mode !== 'foot') {
      let j = i + 1, exits = 0;
      while (j + 1 < pieces.length && isRb(pieces[j + 1])) {
        const n = pieces[j].endNode;
        if (n >= 0 && hasExit(n)) exits++;
        j++;
      }
      exits++;
      const out = pieces[j + 1];
      cur = { type: 'roundabout', exit: exits, name: out ? nameOf(out) : '', loc: q.coords[0], distance: 0 };
      steps.push(cur);
      for (let k = i + 1; k <= j; k++) cur.distance += pieces[k].len;
      i = j;
      continue;
    }
    const a = bearingAt(p.coords, true), b = bearingAt(q.coords, false);
    if (a === null || b === null) continue;
    const ang = ((b - a + 540) % 360) - 180;
    const n1 = nameOf(p), n2 = nameOf(q);
    const deg = p.endNode >= 0 ? router.nodeDeg[p.endNode] : 2;
    const turn = (Math.abs(ang) >= 30 && deg >= 3) || Math.abs(ang) >= 100;
    const rename = !!n2 && n1 !== n2 && deg >= 3;
    if (turn || rename) {
      cur = { type: turn ? 'turn' : 'continue', modifier: modifierOf(ang), name: n2, loc: q.coords[0], distance: 0 };
      steps.push(cur);
    }
  }
  const last = pieces[pieces.length - 1];
  steps.push({ type: 'arrive', name: '', loc: last.coords[last.coords.length - 1], distance: 0 });
  // короткие «продолжайте по …» без поворота подряд с той же улицей — склеиваем
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && s.type === 'continue' && prev.name === s.name) { prev.distance += s.distance; continue; }
    out.push(s);
  }
  return out;
}

// «улица Акыртас» → «ул. Акыртас»: в подсказке после «на»/«по» сокращение читается естественно
const SHORT = [[/^улица\s+/i, 'ул. '], [/^проспект\s+/i, 'пр. '], [/^переулок\s+/i, 'пер. '], [/^бульвар\s+/i, 'бул. '],
  [/^площадь\s+/i, 'пл. '], [/^шоссе\s+/i, 'ш. '], [/^набережная\s+/i, 'наб. '], [/^проезд\s+/i, 'пр-д '], [/^микрорайон\s+/i, 'мкр. ']];
const shortName = (n) => SHORT.reduce((s, [re, to]) => s.replace(re, to), n || '');

export function stepText(s) {
  const name = shortName(s.name);
  const onto = name ? ` на ${name}` : '';
  const along = name ? ` по ${name}` : '';
  switch (s.type) {
    case 'depart': return `Начните движение${s.bearing !== null ? ` на ${COMPASS[Math.round(s.bearing / 45) % 8]}` : ''}${along}`;
    case 'arrive': return 'Вы прибыли';
    case 'roundabout': return `На круговом движении — ${s.exit}-й съезд${onto}`;
    case 'continue': return name ? `Продолжайте по ${name}` : 'Продолжайте прямо';
    default:
      switch (s.modifier) {
        case 'straight': return `Продолжайте прямо${along}`;
        case 'uturn': return `Развернитесь${along}`;
        case 'slight right': return `Плавно поверните направо${onto}`;
        case 'slight left': return `Плавно поверните налево${onto}`;
        case 'right': return `Поверните направо${onto}`;
        case 'left': return `Поверните налево${onto}`;
        case 'sharp right': return `Резко поверните направо${onto}`;
        case 'sharp left': return `Резко поверните налево${onto}`;
        default: return `Продолжайте${along}`;
      }
  }
}

export function stepIcon(s) {
  if (s.type === 'depart') return icon('dot');
  if (s.type === 'arrive') return icon('flag');
  if (s.type === 'roundabout') return icon('roundabout');
  const m = s.modifier || 'straight';
  if (m === 'uturn') return icon('uturn');
  if (m === 'straight') return icon('straight');
  const base = m.includes('slight') ? 'slightRight' : m.includes('sharp') ? 'sharpRight' : 'right';
  return icon(base, m.includes('left') ? 'flip' : '');
}
