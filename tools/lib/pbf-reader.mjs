// Минимальный потоковый читатель OSM PBF (https://wiki.openstreetmap.org/wiki/PBF_Format).
// Только встроенные модули Node: zlib для блоков, ручной разбор protobuf.
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Курсор по protobuf-буферу. Числа до 2^53 возвращаются как Number. */
class Proto {
  constructor(buf, pos = 0, end = buf.length) { this.buf = buf; this.pos = pos; this.end = end; }
  more() { return this.pos < this.end; }
  varint() {
    const b = this.buf;
    let byte = b[this.pos++];
    let val = byte & 0x7f;
    if (byte < 0x80) return val;
    byte = b[this.pos++]; val |= (byte & 0x7f) << 7; if (byte < 0x80) return val;
    byte = b[this.pos++]; val |= (byte & 0x7f) << 14; if (byte < 0x80) return val;
    byte = b[this.pos++]; val |= (byte & 0x7f) << 21; if (byte < 0x80) return val;
    let mul = 268435456; // 2^28
    for (let i = 0; i < 6; i++) {
      byte = b[this.pos++];
      val += (byte & 0x7f) * mul;
      if (byte < 0x80) return val;
      mul *= 128;
    }
    throw new Error('varint too long');
  }
  svarint() { const n = this.varint(); return n % 2 === 1 ? -(n + 1) / 2 : n / 2; }
  key() { const k = this.varint(); return [k >>> 3, k & 7]; }
  bytes() { const len = this.varint(); const start = this.pos; this.pos += len; return [start, this.pos]; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) { const len = this.varint(); this.pos += len; }
    else if (wire === 5) this.pos += 4;
    else throw new Error('unsupported wire type ' + wire);
  }
  sub() { const [s, e] = this.bytes(); return new Proto(this.buf, s, e); }
  packedVarints(out = []) { const p = this.sub(); while (p.more()) out.push(p.varint()); return out; }
  packedSDelta(out = []) { const p = this.sub(); let acc = 0; while (p.more()) { acc += p.svarint(); out.push(acc); } return out; }
}

/** Перебор сырых блоков файла: { type: 'OSMHeader' | 'OSMData', data: Buffer (распакованный) }. */
export function* blocks(path) {
  const fd = fs.openSync(path, 'r');
  const size = fs.fstatSync(fd).size;
  let offset = 0;
  const lenBuf = Buffer.alloc(4);
  try {
    while (offset < size) {
      fs.readSync(fd, lenBuf, 0, 4, offset); offset += 4;
      const hlen = lenBuf.readUInt32BE(0);
      const hbuf = Buffer.alloc(hlen);
      fs.readSync(fd, hbuf, 0, hlen, offset); offset += hlen;
      const h = new Proto(hbuf);
      let type = '', datasize = 0;
      while (h.more()) {
        const [f, w] = h.key();
        if (f === 1) { const [s, e] = h.bytes(); type = hbuf.toString('utf8', s, e); }
        else if (f === 3) datasize = h.varint();
        else h.skip(w);
      }
      const bbuf = Buffer.alloc(datasize);
      fs.readSync(fd, bbuf, 0, datasize, offset); offset += datasize;
      const b = new Proto(bbuf);
      let data = null;
      while (b.more()) {
        const [f, w] = b.key();
        if (f === 1) { const [s, e] = b.bytes(); data = bbuf.subarray(s, e); }
        else if (f === 3) { const [s, e] = b.bytes(); data = zlib.inflateSync(bbuf.subarray(s, e)); }
        else b.skip(w);
      }
      if (!data) throw new Error('unsupported blob compression');
      yield { type, data };
    }
  } finally { fs.closeSync(fd); }
}

/**
 * Разбор блока OSMData. handlers: { node(id, lat, lon, tags|null), way(id, tags, refs), relation(id, tags, members) }.
 * Теги узлов разбираются лениво: node получает функцию getTags() или null, если тегов нет.
 */
export function parseBlock(data, handlers) {
  const p = new Proto(data);
  const strings = [];
  const groups = [];
  let gran = 100, latOff = 0, lonOff = 0;
  while (p.more()) {
    const [f, w] = p.key();
    if (f === 1) {
      const st = p.sub();
      while (st.more()) {
        const [sf, sw] = st.key();
        if (sf === 1) { const [s, e] = st.bytes(); strings.push(data.toString('utf8', s, e)); } else st.skip(sw);
      }
    } else if (f === 2) groups.push(p.bytes());
    else if (f === 17) gran = p.varint();
    else if (f === 19) latOff = p.varint();
    else if (f === 20) lonOff = p.varint();
    else p.skip(w);
  }
  const toLat = (raw) => 1e-9 * (latOff + gran * raw);
  const toLon = (raw) => 1e-9 * (lonOff + gran * raw);
  const tagsOf = (keys, vals) => {
    const t = {};
    for (let i = 0; i < keys.length; i++) t[strings[keys[i]]] = strings[vals[i]];
    return t;
  };
  for (const [gs, ge] of groups) {
    const g = new Proto(data, gs, ge);
    while (g.more()) {
      const [f, w] = g.key();
      if (f === 2 && handlers.node) {
        const d = g.sub();
        let ids = [], lats = [], lons = [], kv = null;
        while (d.more()) {
          const [df, dw] = d.key();
          if (df === 1) ids = d.packedSDelta();
          else if (df === 8) lats = d.packedSDelta();
          else if (df === 9) lons = d.packedSDelta();
          else if (df === 10) kv = d.packedVarints();
          else d.skip(dw);
        }
        let k = 0;
        for (let i = 0; i < ids.length; i++) {
          let start = -1;
          if (kv) {
            if (kv[k] !== 0) start = k;
            while (kv[k] !== 0 && k < kv.length) k += 2;
            k++;
          }
          const s0 = start;
          const getTags = s0 < 0 ? null : () => {
            const t = {};
            for (let j = s0; kv[j] !== 0 && j < kv.length; j += 2) t[strings[kv[j]]] = strings[kv[j + 1]];
            return t;
          };
          handlers.node(ids[i], toLat(lats[i]), toLon(lons[i]), getTags);
        }
      } else if (f === 1 && handlers.node) {
        const n = g.sub();
        let id = 0, lat = 0, lon = 0, keys = [], vals = [];
        while (n.more()) {
          const [nf, nw] = n.key();
          if (nf === 1) id = n.svarint();
          else if (nf === 2) keys = n.packedVarints();
          else if (nf === 3) vals = n.packedVarints();
          else if (nf === 8) lat = n.svarint();
          else if (nf === 9) lon = n.svarint();
          else n.skip(nw);
        }
        handlers.node(id, toLat(lat), toLon(lon), keys.length ? () => tagsOf(keys, vals) : null);
      } else if (f === 3 && handlers.way) {
        const wy = g.sub();
        let id = 0, keys = [], vals = [], refs = [];
        while (wy.more()) {
          const [wf, ww] = wy.key();
          if (wf === 1) id = wy.varint();
          else if (wf === 2) keys = wy.packedVarints();
          else if (wf === 3) vals = wy.packedVarints();
          else if (wf === 8) refs = wy.packedSDelta();
          else wy.skip(ww);
        }
        handlers.way(id, tagsOf(keys, vals), refs);
      } else if (f === 4 && handlers.relation) {
        const r = g.sub();
        let id = 0, keys = [], vals = [], roles = [], memids = [], types = [];
        while (r.more()) {
          const [rf, rw] = r.key();
          if (rf === 1) id = r.varint();
          else if (rf === 2) keys = r.packedVarints();
          else if (rf === 3) vals = r.packedVarints();
          else if (rf === 8) roles = r.packedVarints();
          else if (rf === 9) memids = r.packedSDelta();
          else if (rf === 10) types = r.packedVarints();
          else r.skip(rw);
        }
        const members = memids.map((ref, i) => ({ type: ['node', 'way', 'relation'][types[i]], ref, role: strings[roles[i]] || '' }));
        handlers.relation(id, tagsOf(keys, vals), members);
      } else g.skip(w);
    }
  }
}
