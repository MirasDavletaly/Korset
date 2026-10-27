// Триангуляция полигонов с отверстиями: отрезание «ушей» по связному списку вершин
// с ускорением через кривую Мортона. Алгоритм по мотивам earcut (Mapbox, ISC).
//
// triangulate(flatCoords, holeIndices) → индексы вершин треугольников.

export function triangulate(data, holeIndices = null) {
  const dim = 2;
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  let outer = linkedList(data, 0, outerLen, true);
  const triangles = [];
  if (!outer || outer.next === outer.prev) return triangles;
  if (hasHoles) outer = eliminateHoles(data, holeIndices, outer);
  let minX = 0, minY = 0, invSize = 0;
  if (data.length > 80 * dim) {
    let maxX = data[0], maxY = data[1];
    minX = maxX; minY = maxY;
    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i], y = data[i + 1];
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }
  earcutLinked(outer, triangles, minX, minY, invSize, 0);
  return triangles;
}

function linkedList(data, start, end, clockwise) {
  let last;
  if (clockwise === (signedArea(data, start, end) > 0)) {
    for (let i = start; i < end; i += 2) last = insertNode(i, data[i], data[i + 1], last);
  } else {
    for (let i = end - 2; i >= start; i -= 2) last = insertNode(i, data[i], data[i + 1], last);
  }
  if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
  return last;
}

function filterPoints(start, end) {
  if (!start) return start;
  if (!end) end = start;
  let p = start, again;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else p = p.next;
  } while (again || p !== end);
  return end;
}

function earcutLinked(ear, triangles, minX, minY, invSize, pass) {
  if (!ear) return;
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
  let stop = ear;
  while (ear.prev !== ear.next) {
    const prev = ear.prev, next = ear.next;
    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      triangles.push(prev.i >> 1, ear.i >> 1, next.i >> 1);
      removeNode(ear);
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) earcutLinked(filterPoints(ear), triangles, minX, minY, invSize, 1);
      else if (pass === 1) earcutLinked(cureLocalIntersections(filterPoints(ear), triangles), triangles, minX, minY, invSize, 2);
      else if (pass === 2) splitEarcut(ear, triangles, minX, minY, invSize);
      break;
    }
  }
}

function isEar(ear) {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
  let p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
      pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}

function isEarHashed(ear, minX, minY, invSize) {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;
  const ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
  const x0 = Math.min(ax, bx, cx), y0 = Math.min(ay, by, cy), x1 = Math.max(ax, bx, cx), y1 = Math.max(ay, by, cy);
  const minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
  const blocks = (q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1 && q !== a && q !== c &&
    pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, q.x, q.y) && area(q.prev, q, q.next) >= 0;
  let p = ear.prevZ, n = ear.nextZ;
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (blocks(p)) return false;
    p = p.prevZ;
    if (blocks(n)) return false;
    n = n.nextZ;
  }
  while (p && p.z >= minZ) { if (blocks(p)) return false; p = p.prevZ; }
  while (n && n.z <= maxZ) { if (blocks(n)) return false; n = n.nextZ; }
  return true;
}

function cureLocalIntersections(start, triangles) {
  let p = start;
  do {
    const a = p.prev, b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i >> 1, p.i >> 1, b.i >> 1);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}

function splitEarcut(start, triangles, minX, minY, invSize) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earcutLinked(a, triangles, minX, minY, invSize, 0);
        earcutLinked(c, triangles, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function eliminateHoles(data, holeIndices, outer) {
  const queue = [];
  for (let i = 0; i < holeIndices.length; i++) {
    const start = holeIndices[i] * 2;
    const end = i < holeIndices.length - 1 ? holeIndices[i + 1] * 2 : data.length;
    const list = linkedList(data, start, end, false);
    if (!list) continue;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const hole of queue) outer = eliminateHole(hole, outer);
  return outer;
}

function eliminateHole(hole, outer) {
  const bridge = findHoleBridge(hole, outer);
  if (!bridge) return outer;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}

function findHoleBridge(hole, outer) {
  let p = outer;
  const hx = hole.x, hy = hole.y;
  let qx = -Infinity, m;
  if (equals(hole, p)) return p;
  do {
    if (equals(hole, p.next)) return p.next;
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m;
      }
    }
    p = p.next;
  } while (p !== outer);
  if (!m) return null;
  const stop = m, mx = m.x, my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x &&
      pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

const sectorContainsSector = (m, p) => area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;

function indexCurve(start, minX, minY, invSize) {
  let p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);
  p.prevZ.nextZ = null;
  p.prevZ = null;
  sortLinked(p);
}

function sortLinked(list) {
  let inSize = 1, numMerges;
  do {
    let p = list, tail = null;
    list = null;
    numMerges = 0;
    while (p) {
      numMerges++;
      let q = p, pSize = 0;
      for (let i = 0; i < inSize; i++) { pSize++; q = q.nextZ; if (!q) break; }
      let qSize = inSize;
      while (pSize > 0 || (qSize > 0 && q)) {
        let e;
        if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) { e = p; p = p.nextZ; pSize--; }
        else { e = q; q = q.nextZ; qSize--; }
        if (tail) tail.nextZ = e; else list = e;
        e.prevZ = tail;
        tail = e;
      }
      p = q;
    }
    tail.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);
  return list;
}

function zOrder(x, y, minX, minY, invSize) {
  x = ((x - minX) * invSize) | 0;
  y = ((y - minY) * invSize) | 0;
  x = (x | (x << 8)) & 0x00FF00FF; x = (x | (x << 4)) & 0x0F0F0F0F; x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555;
  y = (y | (y << 8)) & 0x00FF00FF; y = (y | (y << 4)) & 0x0F0F0F0F; y = (y | (y << 2)) & 0x33333333; y = (y | (y << 1)) & 0x55555555;
  return x | (y << 1);
}

function getLeftmost(start) {
  let p = start, leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

const pointInTriangle = (ax, ay, bx, by, cx, cy, px, py) =>
  (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
  (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
  (bx - px) * (cy - py) >= (cx - px) * (by - py);

const pointInTriangleExceptFirst = (ax, ay, bx, by, cx, cy, px, py) =>
  !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py);

function isValidDiagonal(a, b) {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
      (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
}

const area = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
const equals = (p1, p2) => p1.x === p2.x && p1.y === p2.y;
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const onSegment = (p, q, r) => q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);

function intersects(p1, q1, p2, q2) {
  const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function intersectsPolygon(a, b) {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}

function locallyInside(a, b) {
  return area(a.prev, a, a.next) < 0
    ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
    : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a, b) {
  let p = a, inside = false;
  const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do {
    if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x) inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}

function splitPolygon(a, b) {
  const a2 = createNode(a.i, a.x, a.y), b2 = createNode(b.i, b.x, b.y);
  const an = a.next, bp = b.prev;
  a.next = b; b.prev = a;
  a2.next = an; an.prev = a2;
  b2.next = a2; a2.prev = b2;
  bp.next = b2; b2.prev = bp;
  return b2;
}

function insertNode(i, x, y, last) {
  const p = createNode(i, x, y);
  if (!last) { p.prev = p; p.next = p; }
  else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
  return p;
}

function removeNode(p) {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

const createNode = (i, x, y) => ({ i, x, y, prev: null, next: null, z: 0, prevZ: null, nextZ: null, steiner: false });

function signedArea(data, start, end) {
  let sum = 0;
  for (let i = start, j = end - 2; i < end; i += 2) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}
