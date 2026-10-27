// Нижняя шторка на телефоне: три положения (свёрнута / половина / весь экран), тянется пальцем.
import { $, clamp, debounce, isMobile } from '../core/dom.js';
import { S } from '../app.js';

export const Sheet = {
  state: 'collapsed', visible: 0, touch: null, mouse: null,
  panel: null, body: null, onChange: null,

  heights() {
    const H = window.innerHeight;
    const grab = $('#sheetGrab').offsetHeight || 22;
    const peekEl = S.view === 'route' ? $('#routeTop') : $('#panelHead');
    const peek = Math.round(grab + (peekEl ? peekEl.offsetHeight : 120) + (S.view === 'route' ? 2 : 0));
    const full = Math.max(peek + 120, H - 58);
    const half = clamp(Math.round(H * 0.5), peek + 80, full - 60);
    return { collapsed: Math.min(peek, full), half, full };
  },
  apply(vis, animate) {
    const h = this.heights();
    this.visible = clamp(vis, h.collapsed, h.full);
    this.panel.style.height = `${h.full}px`;
    this.panel.classList.toggle('dragging', !animate);
    this.panel.style.transform = `translateY(${h.full - this.visible}px)`;
  },
  set(state) {
    this.state = state;
    if (!isMobile()) return;
    const h = this.heights();
    this.apply(h[state], true);
    this.body.style.paddingBottom = `${h.full - this.visible}px`;
    if (this.onChange) this.onChange();
  },
  layout() {
    if (!isMobile()) {
      this.panel.style.height = ''; this.panel.style.transform = ''; this.body.style.paddingBottom = '';
      this.panel.classList.remove('dragging');
      this.visible = 0;
      return;
    }
    this.set(this.state);
  },
  snap(velocity) {
    const h = this.heights();
    const order = ['collapsed', 'half', 'full'];
    let target;
    if (Math.abs(velocity) > 0.45) {
      target = velocity < 0
        ? (order.find(k => h[k] > this.visible + 10) || 'full')
        : (order.slice().reverse().find(k => h[k] < this.visible - 10) || 'collapsed');
    } else {
      target = order.reduce((best, k) => (Math.abs(h[k] - this.visible) < Math.abs(h[best] - this.visible) ? k : best), 'collapsed');
    }
    this.set(target);
  },
  init(panel, body) {
    this.panel = panel; this.body = body;
    panel.addEventListener('touchstart', (e) => {
      if (!isMobile() || e.touches.length !== 1 || e.target.closest('.suggest')) { this.touch = null; return; }
      const t = e.touches[0];
      this.touch = { x0: t.clientX, y0: t.clientY, vis0: this.visible, inBody: body.contains(e.target), decided: false, drag: false, samples: [[performance.now(), t.clientY]] };
    }, { passive: true });
    panel.addEventListener('touchmove', (e) => {
      const s = this.touch;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x0, dy = t.clientY - s.y0;
      if (!s.decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        s.decided = true;
        if (Math.abs(dx) > Math.abs(dy)) s.drag = false;
        else if (s.inBody) s.drag = (dy > 0 && body.scrollTop <= 0) || (dy < 0 && this.state !== 'full');
        else s.drag = true;
        if (s.drag) { s.y0 = t.clientY; s.vis0 = this.visible; }
      }
      if (!s.drag) return;
      if (e.cancelable) e.preventDefault();
      this.apply(s.vis0 - (t.clientY - s.y0), false);
      s.samples.push([performance.now(), t.clientY]);
      if (s.samples.length > 6) s.samples.shift();
    }, { passive: false });
    const end = () => {
      const s = this.touch;
      this.touch = null;
      if (!s || !s.drag) return;
      const a = s.samples[0], b = s.samples[s.samples.length - 1];
      this.snap(b[0] - a[0] > 0 ? (b[1] - a[1]) / (b[0] - a[0]) : 0);
    };
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);
    const grab = $('#sheetGrab');
    grab.addEventListener('pointerdown', (e) => {
      if (!isMobile() || e.pointerType === 'touch') return;
      this.mouse = { y0: e.clientY, vis0: this.visible, moved: false, t0: performance.now() };
      grab.setPointerCapture(e.pointerId);
    });
    grab.addEventListener('pointermove', (e) => {
      const s = this.mouse;
      if (!s) return;
      if (Math.abs(e.clientY - s.y0) > 3) s.moved = true;
      if (s.moved) this.apply(s.vis0 - (e.clientY - s.y0), false);
    });
    grab.addEventListener('pointerup', (e) => {
      const s = this.mouse;
      this.mouse = null;
      if (!s) return;
      if (!s.moved) { this.set(this.state === 'collapsed' ? 'half' : this.state === 'half' ? 'full' : 'collapsed'); return; }
      this.snap((e.clientY - s.y0) / Math.max(1, performance.now() - s.t0));
    });
    window.addEventListener('resize', debounce(() => this.layout(), 120));
  }
};
