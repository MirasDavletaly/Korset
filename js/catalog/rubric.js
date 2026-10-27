// Рубрики: все места рубрики на карте (с кластерами), список — по видимой области, по расстоянию.
// Данные свои, поэтому список обновляется сам при сдвиге карты.
import { $, $$, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { plural, fmtDist } from '../core/format.js';
import { CAT_BY_ID, CATEGORIES } from '../config.js';
import { S, app } from '../app.js';
import { Panel } from '../ui/panel.js';
import { Hash } from '../ui/hash.js';
import { Geo } from '../ui/geolocation.js';
import { hoursStatus, isOpenNow } from './hours.js';
import { typeLabel, poiTitle, poiAddress } from './places.js';

const LIST_LIMIT = 120;

export const Rubric = {
  searchInput: null,

  run(id) {
    const cat = CAT_BY_ID[id];
    if (!cat || !app.store) return;
    S.cat = { id, all: app.store.pois.filter(p => p.cat === id), visible: [], origin: null };
    if (this.onStart) this.onStart(cat);
    renderChips();
    this.syncMap();
    this.refresh();
    Panel.show('results');
    this.render();
    Hash.write();
  },

  clear() {
    if (!S.cat) return;
    S.cat = null;
    S.hoverId = null;
    renderChips();
    if (app.map) { app.map.setRubric([], '#000'); app.map.setHighlight(null); }
    $('#vResults').innerHTML = '';
    Hash.write();
  },

  filtered() {
    if (!S.cat) return [];
    return S.openOnly ? S.cat.all.filter(p => isOpenNow(p.extra)) : S.cat.all;
  },

  syncMap() {
    if (!S.cat || !app.map) return;
    app.map.setRubric(this.filtered(), CAT_BY_ID[S.cat.id].color);
  },

  originKind() {
    const wantUser = S.sort === 'user' || (S.sort === 'auto' && Geo.inCity());
    return wantUser && S.user ? 'user' : 'center';
  },

  /** Места в видимой части карты, по расстоянию. */
  refresh() {
    if (!S.cat || !app.map) return;
    const map = app.map, cam = map.camera;
    const rect = Panel.visibleRect(cam.width, cam.height);
    const [x0, y0, x1, y1] = map.visibleBBox(rect);
    const c = map.unproject((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2) || [cam.x, cam.y];
    const origin = this.originKind() === 'user' ? S.user : { x: c[0], y: c[1] };
    S.cat.origin = origin;
    const list = this.filtered().filter(p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
    for (const p of list) p._dist = Math.hypot(p.x - origin.x, p.y - origin.y);
    list.sort((a, b) => a._dist - b._dist);
    S.cat.visible = list;
  },

  render() {
    const el = $('#vResults');
    const c = S.cat;
    if (!c) { el.innerHTML = ''; return; }
    const cat = CAT_BY_ID[c.id];
    const total = this.filtered().length, inView = c.visible.length;
    const kind = this.originKind();
    let html = `<div class="view-bar"><span class="kind-ico" style="--c:${cat.color}">${icon(cat.icon)}</span><h2>${esc(cat.label)}</h2>
      <button class="icon-btn" type="button" data-act="close-results" aria-label="Закрыть рубрику" title="Закрыть рубрику">${icon('close')}</button></div>`;
    html += `<div class="res-meta">${inView ? `В этой области ${inView} ${plural(inView, 'место', 'места', 'мест')}` : 'В этой области мест нет'} · всего ${S.openOnly ? 'открыто ' : ''}${total} в Астане</div>`;
    html += `<div class="res-tools">
      <button class="toggle" type="button" data-act="open-now" aria-pressed="${S.openOnly}">${icon('clock')}Открыто сейчас</button>
      <div class="seg" role="group" aria-label="Сортировка по расстоянию">
        <button type="button" data-sort="center" aria-pressed="${kind === 'center'}">От центра карты</button>
        <button type="button" data-sort="user" aria-pressed="${kind === 'user'}">От меня</button>
      </div></div>`;
    if (!total) {
      html += emptyBlock('clock', 'Сейчас всё закрыто', 'Снимите фильтр «Открыто сейчас», чтобы увидеть все места.', `<button class="btn btn-soft" type="button" data-act="open-now">Показать все</button>`);
    } else if (!inView) {
      html += emptyBlock('search', 'В этой части карты пусто', 'Отдалите или сдвиньте карту — список обновится сам.', `<button class="btn btn-soft" type="button" data-act="fit-rubric">Показать все на карте</button>`);
    } else {
      html += `<div class="res-list" id="resList">${c.visible.slice(0, LIST_LIMIT).map(p => row(p)).join('')}</div>`;
      if (inView > LIST_LIMIT) html += `<p class="note">Показаны ближайшие ${LIST_LIMIT}. Приблизьте карту, чтобы увидеть остальные.</p>`;
    }
    el.innerHTML = html;
  },

  find(key) { return S.cat ? S.cat.all.find(p => p.key === key) : null; },

  /** Показать все места рубрики. */
  fitAll() {
    const list = this.filtered();
    if (!list.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of list) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    app.map.fitBounds([x0, y0, x1, y1], Panel.padding(40), 16);
  }
};

function row(p) {
  const cat = CAT_BY_ID[p.cat];
  const st = hoursStatus(p.extra);
  const sub = [typeLabel(p.tag), poiAddress(p)].filter(Boolean).join(' · ');
  const stHtml = st.kind === 'none' ? '' : `<span class="st st-${st.kind}">${esc(st.kind === 'raw' ? `Часы: ${st.text}` : st.text)}</span>`;
  return `<button class="res-item${S.hoverId === p.key ? ' hover' : ''}" type="button" data-id="${esc(p.key)}">
    <span class="kind-ico" style="--c:${cat.color}">${icon(cat.icon)}</span>
    <span class="ri-main"><span class="ri-title">${esc(poiTitle(p))}</span><span class="ri-sub">${esc(sub)}</span>${stHtml}</span>
    <span class="ri-dist">${fmtDist(p._dist || 0)}</span></button>`;
}

export function emptyBlock(ic, title, text, action = '', isErr = false) {
  return `<div class="empty${isErr ? ' err' : ''}" role="${isErr ? 'alert' : 'status'}">${icon(ic)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}

export function renderChips() {
  $('#chips').innerHTML = CATEGORIES.map(c => `<button class="chip" type="button" data-cat="${c.id}" style="--c:${c.color}" aria-pressed="${!!S.cat && S.cat.id === c.id}">${icon(c.icon)}${esc(c.label)}</button>`).join('');
}

/** Подсветка: строка списка ↔ метка на карте. */
export function setHover(key, from) {
  if (S.hoverId === key) return;
  S.hoverId = key;
  app.map.setHighlight(key);
  for (const r of $$('.res-item.hover')) r.classList.remove('hover');
  if (key) {
    const r = $(`.res-item[data-id="${CSS.escape(key)}"]`);
    if (r) {
      r.classList.add('hover');
      if (from === 'map' && S.view === 'results') r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}
