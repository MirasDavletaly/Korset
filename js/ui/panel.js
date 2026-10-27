// Панель слева (на телефоне — шторка): стек экранов «главная → рубрика → маршрут → карточка».
import { $$, isMobile } from '../core/dom.js';
import { S } from '../app.js';
import { Sheet } from './sheet.js';

const hooks = { onLeave: {}, onShow: {} };

export const Panel = {
  el: null, body: null,
  stack: ['home'],

  /** Что сделать при уходе с экрана (закрыть карточку, сбросить маршрут) и при показе. */
  onLeave(view, fn) { hooks.onLeave[view] = fn; },
  onShow(view, fn) { hooks.onShow[view] = fn; },
  alive: null, // (view) → есть ли ещё данные для экрана

  current() { return this.stack[this.stack.length - 1]; },
  previous() { return this.stack[this.stack.length - 2]; },

  show(view) {
    if (view === 'home') this.stack = ['home'];
    else if (this.current() !== view) {
      const i = this.stack.indexOf(view);
      if (i >= 0) this.stack = this.stack.slice(0, i);
      this.stack.push(view);
    }
    this.apply();
  },

  apply() {
    const view = this.current();
    const changed = S.view !== view;
    S.view = view;
    this.el.dataset.view = view;
    for (const sec of $$('.view', this.body)) sec.hidden = sec.dataset.view !== view;
    this.el.classList.toggle('tall', view === 'results' || view === 'route');
    if (changed) this.body.scrollTop = 0;
    if (hooks.onShow[view]) hooks.onShow[view]();
    if (isMobile()) {
      const target = view === 'home' ? 'collapsed' : 'half';
      if (changed || Sheet.state === 'collapsed' || view === 'home') Sheet.set(target);
      else Sheet.layout();
    }
  },

  back() {
    const leaving = this.current();
    if (hooks.onLeave[leaving]) hooks.onLeave[leaving]();
    this.stack.pop();
    while (this.stack.length > 1 && this.alive && !this.alive(this.current())) this.stack.pop();
    if (!this.stack.length) this.stack = ['home'];
    this.apply();
  },

  /** Видимая часть карты (без панели/шторки) в пикселях — для «центра» и списка рубрики. */
  visibleRect(width, height) {
    if (isMobile()) return { x0: 0, y0: 0, x1: width, y1: Math.max(120, height - Math.min(Sheet.visible, height * 0.6)) };
    const right = this.el.getBoundingClientRect().right;
    return { x0: Math.min(width - 120, right + 8), y0: 0, x1: width, y1: height };
  },

  /** Отступы для «вписать в экран» с учётом панели. */
  padding(extra = 48) {
    if (isMobile()) return { top: 70, left: 28, right: 64, bottom: Math.min(Sheet.visible, window.innerHeight * 0.6) + 24 };
    return { top: extra, bottom: extra, right: 80, left: this.el.getBoundingClientRect().right + extra };
  },

  /** Смещение точки от центра экрана, чтобы она оказалась в центре видимой части карты. */
  offset() {
    if (isMobile()) return [0, -Math.min(Sheet.visible, window.innerHeight * 0.6) / 2];
    return [Math.round(this.el.getBoundingClientRect().right / 2), 0];
  }
};
