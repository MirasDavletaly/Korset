// Точка входа Korset: загрузка данных Астаны, карта, панель, поиск, рубрики, карточки, маршруты.
import { CITY, MODES } from './config.js';
import { $, $$, esc, isMobile, lsGet, lsSet, nextFrame } from './core/dom.js';
import { icon } from './core/icons.js';
import { Store } from './data/store.js';
import { MapView } from './map/map-view.js';
import { SearchIndex } from './search/search-index.js';
import { Suggest } from './search/suggest.js';
import { S, app } from './app.js';
import { Panel } from './ui/panel.js';
import { Sheet } from './ui/sheet.js';
import { Hash } from './ui/hash.js';
import { Ctx } from './ui/context-menu.js';
import { Geo } from './ui/geolocation.js';
import { Rubric, renderChips, setHover } from './catalog/rubric.js';
import { Place, render as renderPlace, placeFromSearch, placeFromPoi, placeFromPoint } from './place/place.js';
import { Route } from './route/route-ui.js';

// ---------- Загрузка ----------
function setLoader(text, frac) {
  $('#loaderText').textContent = text;
  $('#loaderBar').style.transform = `scaleX(${Math.max(0.04, Math.min(1, frac))})`;
}
function showFatal(title, text) {
  const el = $('#fatal');
  el.innerHTML = `<div>${icon('alert')}<h1>${esc(title)}</h1><p>${esc(text)}</p></div>`;
  el.hidden = false;
  $('#loader').hidden = true;
}

// ---------- Тема и 3D ----------
function applyTheme(theme) {
  S.theme = theme;
  document.documentElement.dataset.theme = theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#1B1F25' : '#0A7EA4';
  $('#themeBtn').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  $('#themeBtn').title = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  if (app.map) app.map.setTheme(theme);
}
function show3D(on) {
  S.is3D = on;
  const b = $('#btn3d');
  b.setAttribute('aria-pressed', String(on));
  b.innerHTML = `<span class="txt">${on ? '2D' : '3D'}</span>`;
  b.title = on ? 'Плоская карта (2D)' : 'Объёмные здания (3D)';
}
function updateCompass() {
  const cam = app.map.camera;
  const btn = $('#compassBtn');
  const rotated = Math.abs(Math.sin(cam.bearing / 2)) > 0.01;
  btn.hidden = !rotated;
  btn.firstElementChild.style.transform = `rotate(${(-cam.bearing * 180) / Math.PI}deg)`;
}

// ---------- Восстановление из ссылки ----------
function applyHash(h, { initial = false } = {}) {
  const map = app.map;
  const cam = Hash.camera(h);
  if (!initial && cam) {
    const [x, y] = app.store.proj.toXY(cam.lon, cam.lat);
    map.jumpTo({ x, y, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch });
  }
  if (cam && cam.pitch > 0.2 && !S.is3D) { show3D(true); map.set3D(true, false); map.camera.set({ pitch: cam.pitch }); }

  const cat = Hash.categoryOf(h);
  if (cat) { S.openOnly = h.oo === '1'; if (!S.cat || S.cat.id !== cat) Rubric.run(cat); }
  else if (S.cat) Rubric.clear();

  const r = Hash.parseRoute(h);
  if (r && (r.a || r.b)) {
    Object.assign(S.route, { mode: r.mode, a: r.a, b: r.b, active: r.active });
    Panel.show('route');
    Route.syncMarkers();
    if (r.a && r.b) Route.compute({ fit: !cam, keepActive: true }); else Route.render();
  } else if (S.route.a || S.route.b) Route.clear();

  if (h.o) { if (!Place.openPoi(h.o, { fly: !cam })) Place.close(); }
  else if (h.pt) {
    const [lat, lon] = h.pt.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const [x, y] = app.store.proj.toXY(lon, lat);
      Place.open(placeFromPoint(x, y), { fly: !cam });
    }
  } else if (S.place) Place.close();

  Panel.stack = ['home', S.cat && 'results', (S.route.a || S.route.b) && 'route', S.place && 'place'].filter(Boolean);
  Panel.apply();
  Hash.flush();
}

// ---------- Интерфейс ----------
function bindPanel() {
  Panel.el = $('#panel');
  Panel.body = $('#panelBody');
  Panel.onLeave('place', () => Place.close());
  Panel.onLeave('route', () => Route.clear());
  Panel.onLeave('results', () => { Rubric.clear(); app.search && searchSuggest.reset(''); });
  Panel.onShow('place', () => renderPlace());
  Panel.onShow('results', () => Rubric.render());
  Panel.alive = (v) => (v === 'results' ? !!S.cat : v === 'route' ? !!(S.route.a || S.route.b) : v === 'place' ? !!S.place : true);
  Sheet.init(Panel.el, Panel.body);
  Sheet.onChange = () => { if (app.map) app.map.requestRender(); };

  Panel.body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-id],[data-sort],[data-alt],[data-poi],.step');
    if (!t) return;
    if (t.dataset.id) { const p = Rubric.find(t.dataset.id); if (p) Place.open(placeFromPoi(p)); return; }
    if (t.dataset.poi) { Place.openPoi(t.dataset.poi); return; }
    if (t.dataset.sort) {
      const want = t.dataset.sort;
      if (want === 'user' && !S.user) {
        Geo.locate({ fly: false }).then(() => { S.sort = 'user'; Rubric.refresh(); Rubric.render(); }).catch(() => {});
        return;
      }
      S.sort = want; Rubric.refresh(); Rubric.render();
      return;
    }
    if (t.dataset.alt) { Route.select(Number(t.dataset.alt)); return; }
    if (t.classList.contains('step')) { Route.focusStep(Number(t.dataset.i)); return; }
    const p = S.place;
    switch (t.dataset.act) {
      case 'back': Panel.back(); Hash.write(); break;
      case 'close-results': Panel.back(); Hash.write(); break;
      case 'open-now': S.openOnly = !S.openOnly; Rubric.syncMap(); Rubric.refresh(); Rubric.render(); Hash.write(); break;
      case 'fit-rubric': Rubric.fitAll(); break;
      case 'route-to': if (p) Route.open({ b: Place.asPoint(p) }); break;
      case 'route-from': if (p) Route.open({ a: Place.asPoint(p) }); break;
      case 'share': Place.share(); break;
      case 'open-route': Route.open(); break;
      case 'route-close': Panel.back(); Hash.write(); break;
      case 'use-my-loc': $('#rMyLoc').click(); break;
    }
  });
  Panel.body.addEventListener('mouseover', (e) => { const row = e.target.closest('.res-item'); if (row) setHover(row.dataset.id, 'list'); });
  $('#vResults').addEventListener('mouseleave', () => { if (S.hoverId) setHover(null); });
}

let searchSuggest;
function bindSearch() {
  searchSuggest = new Suggest($('#q'), $('#qList'), {
    clearBtn: $('#qClear'),
    onPick(it) {
      $('#q').blur();
      if (it.kind === 'category') { Rubric.run(it.cat.id); return; }
      searchSuggest.reset(it.r.title);
      Place.open(placeFromSearch(it.r), { fly: true });
    }
  });
  Rubric.onStart = (cat) => searchSuggest.reset(cat.label);
  $('#q').addEventListener('focus', () => { if (isMobile()) Sheet.set('full'); });
  $('#qClear').addEventListener('click', () => {
    searchSuggest.reset('');
    if (S.cat) { if (Panel.current() === 'results') Panel.back(); else Rubric.clear(); }
    $('#q').focus();
  });
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    if (S.cat && S.cat.id === b.dataset.cat) { if (Panel.current() === 'results') Panel.back(); else Rubric.clear(); Hash.write(); }
    else Rubric.run(b.dataset.cat);
  });

  const routeField = (which) => {
    const input = $(which === 'a' ? '#rA' : '#rB');
    const wrap = input.closest('.search');
    const clearBtn = $('[data-clear]', wrap);
    const sg = new Suggest(input, $('.suggest', wrap), {
      categories: false, clearBtn,
      onPick(it) { input.blur(); if (it.kind === 'place') Route.setPoint(which, { x: it.r.x, y: it.r.y, label: it.r.title }); }
    });
    input.addEventListener('focus', () => { input.select(); if (isMobile()) Sheet.set('full'); });
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input && S.route[which]) input.value = S.route[which].label; }, 150));
    clearBtn.addEventListener('click', () => {
      sg.reset('');
      S.route[which] = null;
      Route.syncMarkers();
      Route.compute();
      input.focus();
    });
    return sg;
  };
  Route.inputs = { a: routeField('a'), b: routeField('b') };
  $('#rSwap').addEventListener('click', () => Route.swap());
  $('#rMyLoc').addEventListener('click', () => {
    Geo.locate({ fly: false }).then(p => Route.setPoint('a', { x: p.x, y: p.y, label: 'Моё местоположение' })).catch(() => {});
  });
  $('#modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) Route.setMode(b.dataset.mode); });
}

function bindControls() {
  $('#zoomIn').addEventListener('click', () => app.map.zoomBy(1));
  $('#zoomOut').addEventListener('click', () => app.map.zoomBy(-1));
  $('#locateBtn').addEventListener('click', () => { Geo.locate({ fly: true }).catch(() => {}); });
  $('#btn3d').addEventListener('click', () => { show3D(!S.is3D); app.map.set3D(S.is3D); });
  $('#themeBtn').addEventListener('click', () => { const t = S.theme === 'dark' ? 'light' : 'dark'; applyTheme(t); lsSet('korset.theme', t); });
  $('#compassBtn').addEventListener('click', () => app.map.easeTo({ bearing: 0, duration: 500 }));
  Ctx.init((kind, pt) => {
    const point = { x: pt.x, y: pt.y, label: 'Точка на карте' };
    if (kind === 'from') Route.open({ a: point });
    else if (kind === 'to') Route.open({ b: point });
    else Place.openPoint(pt.x, pt.y);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!Ctx.el.hidden) { Ctx.close(); return; }
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      if (S.view === 'place' || S.view === 'results') { Panel.back(); Hash.write(); }
    } else if (e.key === '/' && document.activeElement === document.body) {
      e.preventDefault();
      $('#q').focus();
    }
  });
  window.addEventListener('hashchange', () => { if (location.hash.slice(1) !== Hash.last) applyHash(Hash.parse(location.hash)); });
}

function bindMap() {
  const map = app.map;
  map.on('click', ({ point, ground }) => {
    Ctx.close();
    const hit = map.overlay.hitTest(point[0], point[1]);
    if (hit && hit.kind === 'poi') { Place.openPoi(hit.id, { fly: false }); return; }
    if (hit && hit.kind === 'cluster') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of hit.items) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      map.fitBounds([x0 - 30, y0 - 30, x1 + 30, y1 + 30], Panel.padding(60), 18.5, 600);
      return;
    }
    const alt = Route.hitAlt(point);
    if (alt >= 0) { Route.select(alt); return; }
    if (ground) Place.openPoint(ground[0], ground[1]);
  });
  map.on('contextmenu', ({ point, ground }) => Ctx.open(ground, point));
  map.on('hover', ({ point }) => {
    if (!point) { map.glCanvas.style.cursor = ''; if (S.hoverId) setHover(null); return; }
    const hit = map.overlay.hitTest(point[0], point[1]);
    const alt = hit ? -1 : Route.hitAlt(point);
    map.container.style.cursor = hit || alt >= 0 ? 'pointer' : '';
    const id = hit && hit.kind === 'poi' && Rubric.find(hit.id) ? hit.id : null;
    if (id !== S.hoverId && (id || !$('.res-item.hover:hover'))) setHover(id, 'map');
  });
  map.on('move', () => { Ctx.close(); updateCompass(); });
  map.on('gesturestart', () => Ctx.close());
  map.on('moveend', () => {
    map.syncPitch();
    Hash.write();
    if (S.cat) {
      const top = Panel.body.scrollTop;
      Rubric.refresh();
      if (S.view === 'results') { Rubric.render(); Panel.body.scrollTop = top; }
    }
  });
  map.on('mode3d', (on) => show3D(on));
}

function staticIcons() {
  $('#qIcon').outerHTML = icon('search');
  $('#qClear').innerHTML = icon('close');
  $('#zoomIn').innerHTML = icon('plus');
  $('#zoomOut').innerHTML = icon('minus');
  $('#locateBtn').innerHTML = icon('locate');
  $('#compassBtn').innerHTML = icon('compass');
  $('#routeClose').innerHTML = icon('close');
  $('#rMyLoc').innerHTML = icon('locate');
  $('#rSwap').innerHTML = icon('swap');
  for (const b of $$('[data-clear]')) b.innerHTML = icon('close');
  $('#modes').innerHTML = MODES.map(m => `<button type="button" data-mode="${m.id}" aria-pressed="false">${icon(m.icon)}${m.label}</button>`).join('');
  $('#vHome').innerHTML = `
    <h2>Что ищем в Астане?</h2>
    <p class="lead">Адреса, организации и маршруты — карта целиком работает в браузере, без внешних сервисов.</p>
    <button class="btn btn-primary btn-block" type="button" data-act="open-route">${icon('route')}Построить маршрут</button>
    <ul class="tips">
      <li>${icon('search')}<span>Начните вводить адрес или название, например <b>Кенесары 40</b>, <b>Хан Шатыр</b> или <b>аптека</b>.</span></li>
      <li>${icon('pointer')}<span>Нажмите на здание — покажем адрес, высоту и организации внутри.</span></li>
      <li>${icon('hand')}<span><b>Правый клик</b> или <b>долгое нажатие</b> на карте — маршрут «отсюда» или «сюда».</span></li>
      <li>${icon('rotate3d')}<span><b>3D</b> — объёмные здания. Наклон и поворот: правая кнопка мыши или два пальца.</span></li>
    </ul>`;
  renderChips();
}

async function main() {
  staticIcons();
  applyTheme(lsGet('korset.theme') === 'dark' ? 'dark' : 'light');
  show3D(false);
  bindPanel();
  bindSearch();
  Panel.apply();
  Sheet.layout();

  if (!document.createElement('canvas').getContext('webgl2')) {
    showFatal('Браузер не поддерживает WebGL 2', 'Откройте карту в свежей версии Chrome, Safari, Edge или Firefox.');
    return;
  }
  let store;
  try {
    store = await Store.load(setLoader);
  } catch (e) {
    showFatal('Не удалось загрузить данные Астаны', 'Проверьте подключение и обновите страницу. Карту нужно открывать через веб-сервер, а не как файл.');
    return;
  }
  app.store = store;
  const h = Hash.parse(location.hash);
  const camH = Hash.camera(h);
  const [cx, cy] = camH ? store.proj.toXY(camH.lon, camH.lat) : store.proj.toXY(CITY.center.lon, CITY.center.lat);
  setLoader('Рисуем карту', 0.75);
  await nextFrame();
  try {
    app.map = new MapView($('#map'), store, {
      theme: S.theme,
      camera: { x: cx, y: cy, zoom: camH ? camH.zoom : CITY.zoom, bearing: camH ? camH.bearing : 0, pitch: camH ? camH.pitch : 0 },
      is3D: !!(camH && camH.pitch > 0.2)
    });
  } catch (e) {
    showFatal('Не удалось запустить карту', 'Похоже, в браузере отключено аппаратное ускорение (WebGL). Включите его или откройте другой браузер.');
    return;
  }
  setLoader('Строим здания', 0.85);
  await nextFrame();
  app.map.setBuildings();
  setLoader('Готовим поиск и справочник', 0.95);
  await nextFrame();
  app.map.setPlaces();
  app.search = new SearchIndex(store);
  bindControls();
  bindMap();
  if (camH && camH.pitch > 0.2) show3D(true);
  applyHash(h, { initial: true });
  $('#loader').classList.add('done');
  setTimeout(() => { $('#loader').hidden = true; }, 400);
  $('#dataDate').textContent = store.generated ? `данные от ${store.generated.split('-').reverse().join('.')}` : '';
  // граф дорог — заранее, пока пользователь осматривается
  setTimeout(() => Route.router(), 600);
}

main().catch(() => showFatal('Не удалось запустить карту', 'Обновите страницу. Если ошибка повторится — откройте карту в другом браузере.'));
