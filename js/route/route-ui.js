// Маршрут в интерфейсе: точки А и Б, способ передвижения, варианты, пошаговые подсказки.
import { $, $$, esc, isMobile } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { fmtDuration, fmtDist, arrivalText } from '../core/format.js';
import { S, app } from '../app.js';
import { Panel } from '../ui/panel.js';
import { Hash } from '../ui/hash.js';
import { Geo } from '../ui/geolocation.js';
import { Router } from './router.js';
import { buildSteps, stepText, stepIcon } from './instructions.js';
import { emptyBlock } from '../catalog/rubric.js';

const AB_HTML = { a: 'А', b: 'Б' };

export const Route = {
  inputs: null, // { a: Suggest, b: Suggest } — подключаются в main.js

  router() {
    if (!app.router) app.router = new Router(app.store);
    return app.router;
  },

  open({ a, b } = {}) {
    if (a) S.route.a = a;
    if (b) S.route.b = b;
    if (!S.route.a && S.route.b && S.user && Geo.inCity()) S.route.a = { x: S.user.x, y: S.user.y, label: 'Моё местоположение' };
    Panel.show('route');
    this.syncMarkers();
    if (S.route.a && S.route.b) this.compute({ fit: true });
    else {
      this.render();
      Hash.write();
      if (!isMobile()) setTimeout(() => $(S.route.a ? '#rB' : '#rA').focus(), 50);
    }
  },

  setPoint(which, pt, { fit = true } = {}) {
    S.route[which] = pt;
    S.route.stepIdx = -1;
    app.map.setStep(null);
    this.syncMarkers();
    if (S.view !== 'route') Panel.show('route');
    this.compute({ fit });
  },

  syncMarkers() {
    for (const which of ['a', 'b']) {
      const p = S.route[which];
      if (!p) { app.map.removeMarker(which); continue; }
      app.map.setMarker(which, p.x, p.y, {
        html: AB_HTML[which], className: `ab ab-${which}`, title: 'Перетащите, чтобы изменить точку', draggable: true,
        onDragEnd: (x, y) => this.setPoint(which, { x, y, label: 'Точка на карте' }, { fit: false })
      });
    }
  },

  swap() {
    const r = S.route;
    [r.a, r.b] = [r.b, r.a];
    this.syncMarkers();
    this.compute({ fit: false });
  },

  setMode(mode) {
    if (S.route.mode === mode) return;
    S.route.mode = mode;
    this.compute({ fit: true });
  },

  compute({ fit = true, keepActive = false } = {}) {
    const r = S.route;
    r.stepIdx = -1;
    app.map.setStep(null);
    if (!r.a || !r.b) {
      r.routes = []; r.status = 'idle';
      app.map.setRoute([]);
      this.render(); Hash.write();
      return;
    }
    const router = this.router();
    const res = router.route(r.a, r.b, r.mode);
    if (res.error) {
      r.status = 'error';
      r.routes = [];
      r.error = res.error === 'nosnap'
        ? 'Рядом с точкой нет подходящей дороги. Поставьте точку ближе к улице.'
        : 'Не удалось проложить маршрут между этими точками. Попробуйте сдвинуть точку или выбрать другой способ передвижения.';
    } else {
      r.routes = res.routes.map(rt => ({ ...rt, steps: buildSteps(router, rt, r.mode) }));
      r.active = keepActive ? Math.min(r.active, r.routes.length - 1) : 0;
      r.status = 'ok';
    }
    this.draw();
    if (fit && r.status === 'ok') this.fit();
    this.render();
    Hash.write();
  },

  draw() {
    const r = S.route;
    app.map.setRoute(r.routes.map((rt, i) => ({ coords: rt.coords, primary: i === r.active, mode: r.mode })));
  },

  fit() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const rt of S.route.routes) {
      const c = rt.coords;
      for (let i = 0; i < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]); }
    }
    if (x0 < x1) app.map.fitBounds([x0, y0, x1, y1], Panel.padding(56), 16.5);
  },

  select(idx) {
    const r = S.route;
    if (idx === r.active || !r.routes[idx]) return;
    r.active = idx;
    r.stepIdx = -1;
    app.map.setStep(null);
    this.draw();
    this.render();
    Hash.write();
  },

  clear() {
    Object.assign(S.route, { a: null, b: null, routes: [], active: 0, status: 'idle', error: '', stepIdx: -1 });
    if (this.inputs) { this.inputs.a.reset(''); this.inputs.b.reset(''); }
    app.map.removeMarker('a'); app.map.removeMarker('b');
    app.map.setRoute([]); app.map.setStep(null);
    Hash.write();
  },

  focusStep(i) {
    const rt = S.route.routes[S.route.active];
    const step = rt && rt.steps[i];
    if (!step) return;
    S.route.stepIdx = i;
    const [x, y] = step.loc;
    app.map.setStep({ x, y });
    app.map.flyTo({ x, y, zoom: Math.max(app.map.camera.zoom, 16.8), offset: Panel.offset(), duration: 900 });
    for (const b of $$('.step')) b.classList.toggle('on', Number(b.dataset.i) === i);
  },

  /** Клик по серой альтернативе на карте: индекс варианта или -1. */
  hitAlt(point) {
    const r = S.route;
    if (r.status !== 'ok' || r.routes.length < 2) return -1;
    const cam = app.map.camera;
    let best = -1, bd = 10;
    r.routes.forEach((rt, i) => {
      if (i === r.active) return;
      const c = rt.coords;
      let prev = null;
      for (let k = 0; k < c.length; k += 2) {
        const s = cam.project(c[k], c[k + 1]);
        if (s[2] <= 0) { prev = null; continue; }
        if (prev) {
          const dx = s[0] - prev[0], dy = s[1] - prev[1], l2 = dx * dx + dy * dy;
          let t = l2 ? ((point[0] - prev[0]) * dx + (point[1] - prev[1]) * dy) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const d = Math.hypot(prev[0] + t * dx - point[0], prev[1] + t * dy - point[1]);
          if (d < bd) { bd = d; best = i; }
        }
        prev = s;
      }
    });
    return best;
  },

  render() {
    const r = S.route;
    for (const which of ['a', 'b']) {
      const input = $(which === 'a' ? '#rA' : '#rB');
      if (document.activeElement !== input && this.inputs) {
        input.value = r[which] ? r[which].label : '';
        this.inputs[which].clearBtn.hidden = !input.value;
      }
    }
    for (const b of $$('#modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === r.mode));
    const active = r.status === 'ok' ? r.routes[r.active] : null;
    $('#routeSum').textContent = active ? `${fmtDuration(active.duration)} · ${fmtDist(active.distance)}` : '';
    const body = $('#routeBody');
    if (!r.a || !r.b) {
      body.innerHTML = emptyBlock('route', r.a || r.b ? 'Укажите вторую точку' : 'Откуда и куда едем?',
        'Найдите адрес в полях выше, нажмите «Маршрут сюда» в карточке места или кликните правой кнопкой мыши по карте (на телефоне — долгое нажатие).',
        r.a ? '' : `<button class="btn btn-soft" type="button" data-act="use-my-loc">${icon('locate')}Моё местоположение как А</button>`);
      return;
    }
    if (r.status === 'error') {
      body.innerHTML = emptyBlock('alert', 'Маршрут не построен', r.error, '', true);
      return;
    }
    if (r.status !== 'ok') { body.innerHTML = ''; return; }
    const fastest = Math.min(...r.routes.map(x => x.duration));
    let html = `<div class="alts" role="group" aria-label="Варианты маршрута">${r.routes.map((rt, i) => {
      const tag = rt.duration === fastest ? 'Быстрее всего' : `+${fmtDuration(rt.duration - fastest)}`;
      return `<button class="alt" type="button" data-alt="${i}" aria-pressed="${i === r.active}">
        <span class="alt-main">${fmtDuration(rt.duration)} <span>· ${fmtDist(rt.distance)}</span></span>
        <span class="alt-eta">${arrivalText(rt.duration)}</span><span class="alt-tag">${tag}</span></button>`;
    }).join('')}</div>`;
    html += `<div class="steps-h">Как ${r.mode === 'foot' ? 'идти' : r.mode === 'bike' ? 'ехать на велосипеде' : 'ехать'}</div><ol class="steps">${active.steps.map((s, i) => `
      <li><button class="step${i === r.stepIdx ? ' on' : ''}" type="button" data-i="${i}"><span class="step-ico">${stepIcon(s)}</span>
      <span class="step-txt">${esc(stepText(s))}</span><span class="step-dist">${s.distance > 1 ? fmtDist(s.distance) : ''}</span></button></li>`).join('')}</ol>
      <p class="note">Маршрут ориентировочный: средние скорости по городу, без учёта пробок.</p>`;
    body.innerHTML = html;
  }
};
