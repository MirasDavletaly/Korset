// Меню по правому клику или долгому нажатию: «Отсюда», «Сюда», «Что здесь?».
import { $, clamp, isMobile } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { fmtCoord } from '../core/format.js';
import { app } from '../app.js';

export const Ctx = {
  el: null, pt: null, openedAt: 0, onAction: null,

  init(onAction) {
    this.el = $('#ctx');
    this.onAction = onAction;
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ctx]');
      if (b) this.act(b.dataset.ctx);
    });
    document.addEventListener('pointerdown', (e) => { if (!this.el.hidden && !this.el.contains(e.target)) this.close(); });
  },

  open(ground, point) {
    if (!ground || Date.now() - this.openedAt < 600) return;
    this.openedAt = Date.now();
    this.pt = { x: ground[0], y: ground[1] };
    const [lon, lat] = app.store.proj.toLonLat(ground[0], ground[1]);
    this.el.innerHTML = `
      <button type="button" role="menuitem" data-ctx="from"><span class="badge badge-a">А</span>Отсюда</button>
      <button type="button" role="menuitem" data-ctx="to"><span class="badge badge-b">Б</span>Сюда</button>
      <button type="button" role="menuitem" data-ctx="what">${icon('question')}Что здесь?</button>
      <div class="ctx-coords">${fmtCoord(lat, lon)}</div>`;
    this.el.hidden = false;
    const r = $('#map').getBoundingClientRect();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    this.el.style.left = `${clamp(r.left + point[0] + 4, 8, window.innerWidth - w - 8)}px`;
    this.el.style.top = `${clamp(r.top + point[1] + 4, 8, window.innerHeight - h - 8)}px`;
    if (!isMobile()) $('button', this.el).focus({ preventScroll: true });
  },

  close() { if (this.el) this.el.hidden = true; },

  act(kind) {
    const pt = this.pt;
    this.close();
    if (pt && this.onAction) this.onAction(kind, pt);
  }
};
