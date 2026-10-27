// Локальный поиск по Астане: улицы, адреса, организации, районы.
// Инвертированный индекс по нормализованным словам + поиск по началу слова (бинарный поиск в словаре).
import { norm, nameTokens, normHouse, hasDigit } from '../core/text.js';
import { poiTitle, poiAddress, typeLabel } from '../catalog/places.js';

const KIND_BOOST = { district: 30, street: 24, org: 20, house: 18 };
// известные места выше, остановки — ниже одноимённых зданий
const TAG_BOOST = (tag) => /^(shop=mall|tourism=(attraction|museum)|historic=|amenity=(theatre|university)|aeroway|leisure=(stadium|park))/.test(tag) ? 9 : /^railway=station/.test(tag) ? 4
  : /^highway=bus_stop|^railway=tram_stop/.test(tag) ? -14 : 0;

export class SearchIndex {
  constructor(store) {
    this.store = store;
    this.entries = [];
    this.post = new Map();        // слово → [id записи]
    this.addrByStreet = new Map(); // нормализованная улица → адреса
    this.build();
  }

  add(entry, words) {
    const id = this.entries.length;
    entry.words = [...new Set(words)];
    this.entries.push(entry);
    for (const w of entry.words) {
      let list = this.post.get(w);
      if (!list) { list = []; this.post.set(w, list); }
      list.push(id);
    }
  }

  build() {
    const s = this.store;
    for (const d of s.districts) this.add({ kind: 'district', title: d.name, sub: 'Район Астаны', x: d.x, y: d.y, ref: d }, nameTokens(d.name));
    for (const p of s.places) {
      if (p.kind === 'city') continue;
      this.add({ kind: 'district', title: p.name, sub: 'Микрорайон', x: p.x, y: p.y, ref: p }, [...nameTokens(p.name), ...(p.alt ? nameTokens(p.alt) : [])]);
    }
    for (const st of s.streets) {
      const words = [...nameTokens(st.name), ...st.alt.flatMap(nameTokens)];
      this.add({ kind: 'street', title: st.name, sub: 'Улица', x: st.x, y: st.y, weight: Math.min(10, st.len / 300), ref: st }, words);
    }
    for (const p of s.pois) {
      if (!p.name) continue;
      const e = p.extra || {};
      const words = [...nameTokens(p.name), ...(e.nk ? nameTokens(e.nk) : []), ...(e.nkk ? nameTokens(e.nkk) : []), ...nameTokens(typeLabel(p.tag))];
      this.add({ kind: 'org', title: poiTitle(p), sub: [typeLabel(p.tag), poiAddress(p)].filter(Boolean).join(' · '), x: p.x, y: p.y, ref: p }, words);
    }
    // адреса группируем по улице: «кенесары 40» = слова улицы + номер
    const seen = new Set();
    for (const a of s.addr) {
      const key = norm(a.street) + '|' + normHouse(a.hn);
      if (seen.has(key)) continue;
      seen.add(key);
      const words = nameTokens(a.street);
      const k = words.join(' ');
      if (!this.addrByStreet.has(k)) this.addrByStreet.set(k, { words, list: [] });
      this.addrByStreet.get(k).list.push(a);
    }
    this.vocab = [...this.post.keys()].sort();
    this.streetKeys = [...this.addrByStreet.values()];
  }

  /** Все слова словаря, начинающиеся с prefix. */
  prefixWords(prefix) {
    const v = this.vocab;
    let lo = 0, hi = v.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (v[m] < prefix) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < v.length && v[i].startsWith(prefix) && out.length < 400; i++) out.push(v[i]);
    return out;
  }

  /** results: [{ kind, title, sub, x, y, ref, score }] */
  query(raw, { center = null, limit = 8 } = {}) {
    const q = norm(raw);
    if (!q) return [];
    const toks = q.split(' ').filter(Boolean);
    const num = toks.find(t => hasDigit(t) && /^\d/.test(t));
    const words = nameTokens(toks.filter(t => t !== num).join(' '));
    const results = [];
    const dist = (x, y) => center ? Math.hypot(x - center.x, y - center.y) : 0;

    if (words.length) {
      // кандидаты по самому длинному слову, проверка остальных
      const key = words.slice().sort((a, b) => b.length - a.length)[0];
      const cand = new Set();
      for (const w of this.prefixWords(key)) for (const id of this.post.get(w)) cand.add(id);
      for (const id of cand) {
        const e = this.entries[id];
        let score = 0, ok = true;
        for (const t of words) {
          let best = 0;
          for (const w of e.words) {
            if (w === t) { best = 3; break; }
            if (w.startsWith(t)) best = Math.max(best, 2);
          }
          if (!best) { ok = false; break; }
          score += best;
        }
        if (!ok) continue;
        if (num && e.kind !== 'org') continue; // с номером — ищем адреса
        score = score * 10 + KIND_BOOST[e.kind] + (e.weight || 0) - Math.min(15, dist(e.x, e.y) / 1500);
        if (e.words[0] && e.words[0].startsWith(words[0])) score += 6;
        if (e.ref && e.ref.tag) score += TAG_BOOST(e.ref.tag);
        results.push({ ...e, score });
      }
    }

    if (num) {
      const n = normHouse(num);
      for (const st of this.streetKeys) {
        if (words.length && !words.every(t => st.words.some(w => w.startsWith(t)))) continue;
        if (!words.length) continue;
        for (const a of st.list) {
          const h = normHouse(a.hn);
          if (!h.startsWith(n)) continue;
          const exact = h === n ? 12 : h.replace(/[^\d]/g, '') === n ? 6 : 0;
          results.push({ kind: 'house', title: `${a.street}, ${a.hn}`, sub: 'Здание', x: a.x, y: a.y, ref: a, score: 60 + exact - h.length * 0.3 - Math.min(10, dist(a.x, a.y) / 2000) });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    // одинаковые названия рядом — одна строка
    const out = [], seen = new Set();
    for (const r of results) {
      const k = `${r.kind}|${norm(r.title)}|${Math.round(r.x / 400)}|${Math.round(r.y / 400)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }
}
