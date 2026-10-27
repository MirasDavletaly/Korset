// Карточка места: организация, здание, улица, район или точка на карте.
import { $, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { plural, fmtCoord } from '../core/format.js';
import { CAT_BY_ID, CUISINE_RU } from '../config.js';
import { S, app } from '../app.js';
import { Panel } from '../ui/panel.js';
import { Hash } from '../ui/hash.js';
import { toast } from '../ui/toast.js';
import { hoursStatus, prettyHours } from '../catalog/hours.js';
import { typeLabel, poiTitle, poiAddress } from '../catalog/places.js';
import { reverseGeocode, districtAt, buildingAt } from './reverse.js';

const KIND_ICON = { org: 'store', building: 'building', street: 'road', house: 'building', district: 'layers', point: 'pin' };
const PIN_HTML = '<svg viewBox="0 0 36 46" aria-hidden="true"><path d="M18 45s15-13.4 15-26.4A15 15 0 0 0 3 18.6C3 31.6 18 45 18 45z" fill="var(--brand)" stroke="#fff" stroke-width="2.5"/><circle cx="18" cy="18.5" r="6" fill="#fff"/></svg>';

export function placeFromPoi(p) {
  const store = app.store;
  const b = buildingAt(store, p.x, p.y);
  return {
    key: `o:${p.key}`, kind: 'org', x: p.x, y: p.y,
    title: poiTitle(p), typeLabel: typeLabel(p.tag), catId: p.cat,
    address: poiAddress(p) || (b && b.addr ? `${b.addr.street}, ${b.addr.hn}` : null),
    area: districtAt(store, p.x, p.y), poi: p, extra: p.extra || {}, building: b
  };
}

export function placeFromPoint(x, y) {
  const r = reverseGeocode(app.store, x, y);
  return { key: `pt:${x.toFixed(1)},${y.toFixed(1)}`, ...r, catId: null, extra: {} };
}

export function placeFromSearch(r) {
  if (r.kind === 'org') return placeFromPoi(r.ref);
  if (r.kind === 'house') {
    const p = placeFromPoint(r.x, r.y);
    p.title = r.title;
    if (p.kind !== 'building') { p.kind = 'house'; p.typeLabel = 'Здание'; }
    return p;
  }
  const area = districtAt(app.store, r.x, r.y);
  return { key: `pt:${r.x.toFixed(1)},${r.y.toFixed(1)}`, kind: r.kind, x: r.x, y: r.y, title: r.title, typeLabel: r.kind === 'street' ? 'Улица' : r.sub, address: null, area: r.kind === 'district' ? null : area, extra: {}, catId: null };
}

export const Place = {
  open(place, { fly = true, zoom = null } = {}) {
    S.place = place;
    app.map.setMarker('sel', place.x, place.y, { html: PIN_HTML, className: 'pin', anchor: 'bottom' });
    app.map.setSelectedBuilding(place.building || null);
    Panel.show('place');
    render();
    if (fly) {
      const z = zoom ?? (place.kind === 'district' ? 13.2 : place.kind === 'street' ? 15.5 : Math.max(app.map.camera.zoom, 16.6));
      app.map.flyTo({ x: place.x, y: place.y, zoom: z, offset: Panel.offset() });
    }
    Hash.write();
  },
  openPoint(x, y) { this.open(placeFromPoint(x, y), { fly: false }); },
  openPoi(key, opts) {
    const p = app.store.poiByKey.get(key);
    if (p) this.open(placeFromPoi(p), opts);
    return !!p;
  },
  close() {
    S.place = null;
    if (app.map) { app.map.removeMarker('sel'); app.map.setSelectedBuilding(null); }
  },
  asPoint(p) { return { x: p.x, y: p.y, label: p.title }; },
  async share() {
    Hash.flush();
    const url = location.href;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(url); ok = true; }
    } catch (e) { ok = false; }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    toast(ok ? 'Ссылка скопирована — по ней откроется это же место' : 'Не удалось скопировать. Ссылка — в адресной строке браузера.', { type: ok ? 'ok' : 'error' });
  }
};

export function render() {
  const el = $('#vPlace');
  const p = S.place;
  const prev = Panel.previous();
  const backTo = prev === 'results' ? 'К списку' : prev === 'route' ? 'К маршруту' : '';
  const bar = `<div class="view-bar"><button class="icon-btn" type="button" data-act="back" aria-label="${backTo || 'Закрыть карточку'}" title="${backTo || 'Закрыть'}">${icon(backTo ? 'back' : 'close')}</button><span class="bar-label">${esc(backTo)}</span></div>`;
  if (!p) { el.innerHTML = bar; return; }
  const e = p.extra || {};
  const cat = CAT_BY_ID[p.catId];
  const color = cat ? cat.color : 'var(--brand)';
  const ico = cat ? cat.icon : (KIND_ICON[p.kind] || 'pin');
  const st = hoursStatus(e);
  const statusHtml = st.kind === 'none' || st.kind === 'raw' ? '' : `<div class="place-status st-${st.kind}">${esc(st.text)}</div>`;
  const facts = [];
  if (p.address) facts.push(['pin', `${esc(p.address)}${p.area ? `<small>${esc(p.area)}</small>` : ''}`]);
  else if (p.area) facts.push(['pin', esc(p.area)]);
  if (e.oh) facts.push(['clock', `<div class="sched">${prettyHours(e.oh).map(r => `<span>${esc(r)}</span>`).join('')}</div>`]);
  const phones = String(e.ph || '').split(/\s*[;,]\s*/).filter(Boolean);
  if (phones.length) facts.push(['phone', phones.map(ph => `<a href="tel:${esc(ph.replace(/[^\d+]/g, ''))}">${esc(ph)}</a>`).join('<br>')]);
  if (e.web) {
    let site = String(e.web).split(';')[0].trim();
    if (!/^https?:\/\//i.test(site)) site = 'https://' + site;
    let host = site;
    try { host = new URL(site).hostname.replace(/^www\./, ''); } catch (err) { host = ''; }
    if (host) facts.push(['globe', `<a href="${esc(site)}" target="_blank" rel="noopener nofollow">${esc(host)}</a>`]);
  }
  if (e.wc) {
    const w = { yes: 'Доступно для колясок', limited: 'Частично доступно для колясок', no: 'Недоступно для колясок', designated: 'Оборудовано для колясок' }[e.wc];
    if (w) facts.push(['wheelchair', esc(w)]);
  }
  if (e.cu) facts.push(['utensils', `Кухня: ${esc(String(e.cu).split(/\s*;\s*/).map(c => CUISINE_RU[c.toLowerCase()] || c.replace(/_/g, ' ')).join(', '))}`]);
  if (p.poi && p.poi.tag === 'amenity=parking') {
    const bits = [];
    if (e.fee === 'yes') bits.push('платная'); else if (e.fee === 'no') bits.push('бесплатная');
    if (e.cap && /^\d+$/.test(e.cap)) bits.push(`${e.cap} ${plural(+e.cap, 'место', 'места', 'мест')}`);
    if (bits.length) facts.push(['parking', esc(bits.join(', ').replace(/^./, s => s.toUpperCase()))]);
  }
  const brand = e.op || e.br;
  if (brand && brand !== p.title) facts.push(['tag', `${esc(brand)}<small>${e.op ? 'Оператор' : 'Сеть'}</small>`]);
  if (p.building && (p.kind === 'building' || p.kind === 'house')) {
    const h = Math.round(p.building.h);
    facts.push(['building', `Высота около ${h} м${h >= 9 ? ` · ≈ ${Math.max(1, Math.round((h - 1) / 3.2))} ${plural(Math.max(1, Math.round((h - 1) / 3.2)), 'этаж', 'этажа', 'этажей')}` : ''}`]);
  }
  if (p.inside && p.inside.length) {
    const list = p.inside.slice(0, 8).map(o => `<button class="inside" type="button" data-poi="${esc(o.key)}">${esc(o.name)}<small>${esc(typeLabel(o.tag))}</small></button>`).join('');
    facts.push(['store', `<div class="inside-h">В здании ${p.inside.length} ${plural(p.inside.length, 'организация', 'организации', 'организаций')}</div>${list}`]);
  }
  const [lon, lat] = app.store.proj.toLonLat(p.x, p.y);
  facts.push(['nav', `<span class="coords">${fmtCoord(lat, lon)}</span>`]);

  el.innerHTML = bar + `
    <div class="place-kind"><span class="kind-ico" style="--c:${color}">${icon(ico)}</span>${esc(p.typeLabel || '')}</div>
    <h2 class="place-title">${esc(p.title)}</h2>
    ${statusHtml}
    <div class="actions">
      <button class="act primary" type="button" data-act="route-to">${icon('route')}Маршрут сюда</button>
      <button class="act" type="button" data-act="route-from">${icon('nav')}Отсюда</button>
      <button class="act" type="button" data-act="share">${icon('share')}Поделиться</button>
    </div>
    <ul class="facts">${facts.map(([i, h]) => `<li>${icon(i)}<div>${h}</div></li>`).join('')}</ul>`;
}
