// Подсказки поиска: мгновенно по локальному индексу. Стрелки, Enter, Esc. Используется и в полях маршрута.
import { $, $$, esc, debounce } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { norm } from '../core/text.js';
import { CAT_BY_ID } from '../config.js';
import { matchCategory } from '../catalog/places.js';
import { app } from '../app.js';

const KIND_ICON = { street: 'road', house: 'building', district: 'layers', org: 'store' };

function highlight(text, q) {
  const t = String(text || '');
  const qn = norm(q).split(' ')[0];
  if (!qn) return esc(t);
  const i = norm(t).indexOf(qn);
  if (i < 0 || norm(t).length !== t.length) return esc(t);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + qn.length)) + '</mark>' + esc(t.slice(i + qn.length));
}

export class Suggest {
  constructor(input, box, { onPick, categories = true, clearBtn = null }) {
    this.input = input; this.box = box; this.onPick = onPick; this.categories = categories; this.clearBtn = clearBtn;
    this.items = []; this.active = -1; this.status = ''; this.catItem = null;
    this.run = debounce(() => this.update(), 60);
    input.addEventListener('input', () => { if (this.clearBtn) this.clearBtn.hidden = !input.value; this.run(); });
    input.addEventListener('keydown', (e) => this.onKey(e));
    input.addEventListener('focus', () => { if (input.value.trim()) this.update(); });
    input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => { const row = e.target.closest('[data-i]'); if (row) this.pick(Number(row.dataset.i)); });
  }

  update() {
    const q = this.input.value.trim();
    this.active = -1;
    if (!q) { this.items = []; this.status = ''; this.close(); return; }
    const m = this.categories ? matchCategory(q) : null;
    this.catItem = m ? { kind: 'category', cat: m.cat, exact: m.exact } : null;
    if (!app.search) { this.items = this.catItem ? [this.catItem] : []; this.status = 'loading'; this.render(); return; }
    const center = app.map ? { x: app.map.camera.x, y: app.map.camera.y } : null;
    const res = q.length >= 2 ? app.search.query(q, { center, limit: 8 }) : [];
    this.items = [...(this.catItem ? [this.catItem] : []), ...res.map(r => ({ kind: 'place', r }))];
    this.status = this.items.length ? 'ok' : q.length < 2 ? 'short' : 'empty';
    this.render();
  }

  render() {
    const q = this.input.value.trim();
    let html = this.items.map((it, i) => {
      const sel = i === this.active ? 'true' : 'false';
      const id = `${this.box.id}-${i}`;
      if (it.kind === 'category') {
        return `<div class="sg" role="option" id="${id}" data-i="${i}" aria-selected="${sel}">
          <span class="sg-ico cat" style="--c:${it.cat.color}">${icon(it.cat.icon)}</span>
          <span class="sg-text"><span class="sg-title">${esc(it.cat.label)}</span><span class="sg-sub">Все места рубрики в Астане</span></span>
          <span class="sg-tag">Рубрика</span></div>`;
      }
      const r = it.r;
      const cat = r.ref && r.ref.cat ? CAT_BY_ID[r.ref.cat] : null;
      const ico = cat ? `<span class="sg-ico cat" style="--c:${cat.color}">${icon(cat.icon)}</span>` : `<span class="sg-ico">${icon(KIND_ICON[r.kind] || 'pin')}</span>`;
      return `<div class="sg" role="option" id="${id}" data-i="${i}" aria-selected="${sel}">${ico}
        <span class="sg-text"><span class="sg-title">${highlight(r.title, q)}</span><span class="sg-sub">${esc(r.sub || '')}</span></span></div>`;
    }).join('');
    if (this.status === 'loading') html += `<div class="sg-msg">${icon('info')}<span>Справочник ещё загружается…</span></div>`;
    else if (this.status === 'empty') html += `<div class="sg-msg">${icon('search')}<span>В Астане ничего не нашлось. Проверьте написание или попробуйте короче.</span></div>`;
    else if (this.status === 'short') html += `<div class="sg-msg">${icon('info')}<span>Введите ещё хотя бы одну букву</span></div>`;
    this.box.innerHTML = html;
    if (html) this.open(); else this.close();
  }

  open() {
    if (document.activeElement !== this.input) return;
    this.box.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }
  close() {
    this.box.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }
  move(delta) {
    if (!this.items.length) return;
    this.active = (this.active + delta + this.items.length + 1) % (this.items.length + 1);
    if (this.active === this.items.length) this.active = -1;
    for (const row of $$('.sg', this.box)) row.setAttribute('aria-selected', String(Number(row.dataset.i) === this.active));
    if (this.active >= 0) {
      const row = $(`#${this.box.id}-${this.active}`);
      this.input.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    } else this.input.removeAttribute('aria-activedescendant');
  }
  onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.box.hidden && this.items.length) { this.open(); return; }
      this.move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.run.cancel();
      this.update();
      if (this.active >= 0) { this.pick(this.active); return; }
      if (this.catItem && this.catItem.exact) { this.pick(this.items.indexOf(this.catItem)); return; }
      const i = this.items.findIndex(it => it.kind === 'place');
      if (i >= 0) this.pick(i); else if (this.items.length) this.pick(0);
    } else if (e.key === 'Escape') {
      if (!this.box.hidden) { e.preventDefault(); e.stopPropagation(); this.close(); }
      else this.input.blur();
    }
  }
  pick(i) {
    const it = this.items[i];
    if (!it) return;
    this.close();
    this.active = -1;
    this.onPick(it);
  }
  reset(value = '') {
    this.run.cancel();
    this.input.value = value;
    this.items = []; this.status = ''; this.catItem = null;
    if (this.clearBtn) this.clearBtn.hidden = !value;
    this.close();
  }
}
