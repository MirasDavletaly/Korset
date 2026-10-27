// Равномерная пространственная сетка: быстрый поиск объектов в прямоугольнике.

export class Grid {
  constructor(cell = 250) { this.cell = cell; this.cells = new Map(); }
  key(cx, cy) { return cx * 100003 + cy; }
  insert(item, x0, y0, x1 = x0, y1 = y0) {
    const c = this.cell;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        const k = this.key(cx, cy);
        let list = this.cells.get(k);
        if (!list) { list = []; this.cells.set(k, list); }
        list.push(item);
      }
    }
  }
  /** Все объекты, чьи ячейки пересекают прямоугольник (возможны дубликаты — убираем). */
  query(x0, y0, x1, y1, out = []) {
    const c = this.cell, seen = new Set();
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const it of list) if (!seen.has(it)) { seen.add(it); out.push(it); }
      }
    }
    return out;
  }
}
