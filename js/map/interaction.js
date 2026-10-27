// Управление картой мышью, пальцами и колесом.
//   мышь: перетаскивание — сдвиг (с инерцией), колесо — масштаб у курсора, правая кнопка — поворот/наклон,
//         правый клик без движения — контекстное меню, двойной клик — приблизить;
//   пальцы: один — сдвиг, два — масштаб и поворот, два вверх/вниз — наклон (в 3D), долгое нажатие — меню.

const TAP_MOVE = 6, LONG_PRESS = 550;

export class Interaction {
  constructor(el, view) {
    this.el = el; this.view = view;
    this.pointers = new Map();
    this.mode = null;
    this.suppressClickUntil = 0;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => {
      const p = this.local(e);
      this.view.zoomAround(this.view.camera.zoom + 1, p[0], p[1], 300);
    });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.pointers.size) this.view.emit('hover', { point: null }); });
  }

  local(e) { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  down(e) {
    if (e.target.closest('.mk')) return;
    const p = this.local(e);
    this.view.stopAnimation();
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    this.pointers.set(e.pointerId, { x: p[0], y: p[1], x0: p[0], y0: p[1], t0: performance.now(), type: e.pointerType, button: e.button });
    this.view.emit('gesturestart');
    if (this.pointers.size === 1) {
      this.mode = e.pointerType === 'mouse' && (e.button === 2 || e.ctrlKey) ? 'rotate' : 'pan';
      this.moved = false;
      this.samples = [[performance.now(), p[0], p[1]]];
      this.cam0 = { bearing: this.view.camera.bearing, pitch: this.view.camera.pitch };
      clearTimeout(this.lpTimer);
      if (e.pointerType !== 'mouse') {
        this.lpTimer = setTimeout(() => {
          if (!this.moved && this.pointers.size === 1) {
            this.suppressClickUntil = performance.now() + 700;
            this.view.emit('contextmenu', { point: p, ground: this.view.camera.unproject(p[0], p[1]) });
          }
        }, LONG_PRESS);
      }
    } else if (this.pointers.size === 2) {
      clearTimeout(this.lpTimer);
      this.startTwo();
    }
  }

  startTwo() {
    const [a, b] = [...this.pointers.values()];
    const cam = this.view.camera;
    this.mode = 'two';
    this.two = {
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      ang: Math.atan2(b.y - a.y, b.x - a.x),
      zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch,
      ground: cam.unproject((a.x + b.x) / 2, (a.y + b.y) / 2),
      sub: null
    };
    this.moved = true;
  }

  move(e) {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === 'mouse') this.view.emit('hover', { point: p });
      return;
    }
    const px = ptr.x, py = ptr.y;
    ptr.x = p[0]; ptr.y = p[1];
    if (!this.moved && Math.hypot(p[0] - ptr.x0, p[1] - ptr.y0) > TAP_MOVE) { this.moved = true; clearTimeout(this.lpTimer); }
    if (!this.moved) return;
    const cam = this.view.camera;
    if (this.mode === 'pan') {
      const g = cam.unproject(px, py);
      if (g) cam.setAround(g[0], g[1], p[0], p[1]);
      this.samples.push([performance.now(), p[0], p[1]]);
      if (this.samples.length > 8) this.samples.shift();
      this.view.changed();
    } else if (this.mode === 'rotate') {
      const dx = p[0] - ptr.x0, dy = p[1] - ptr.y0;
      cam.set({ bearing: this.cam0.bearing - dx * 0.007, pitch: this.view.is3D ? this.cam0.pitch - dy * 0.006 : cam.pitch });
      this.view.changed();
    } else if (this.mode === 'two' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const t = this.two;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (!t.sub) {
        const dyA = a.y - a.y0, dyB = b.y - b.y0;
        const vertical = this.view.is3D && Math.abs(d / t.d - 1) < 0.08 && Math.sign(dyA) === Math.sign(dyB) && Math.abs(dyA) > 10 && Math.abs(dyB) > 10;
        if (vertical) t.sub = 'pitch';
        else if (Math.abs(d / t.d - 1) > 0.04 || Math.abs(ang - t.ang) > 0.06 || Math.hypot(cx - t.cx, cy - t.cy) > 8) t.sub = 'pinch';
        else return;
      }
      if (t.sub === 'pitch') {
        cam.set({ pitch: t.pitch - (cy - t.cy) * 0.006 });
      } else {
        let dAng = ang - t.ang;
        if (dAng > Math.PI) dAng -= 2 * Math.PI; else if (dAng < -Math.PI) dAng += 2 * Math.PI;
        cam.set({ zoom: t.zoom + Math.log2(d / t.d), bearing: Math.abs(dAng) > 0.12 ? t.bearing - dAng : t.bearing });
        if (t.ground) cam.setAround(t.ground[0], t.ground[1], cx, cy);
      }
      this.view.changed();
    }
  }

  up(e) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    clearTimeout(this.lpTimer);
    const p = [ptr.x, ptr.y];
    if (this.pointers.size === 1 && this.mode === 'two') {
      // остался один палец — продолжаем сдвиг с него
      const rest = [...this.pointers.values()][0];
      rest.x0 = rest.x; rest.y0 = rest.y;
      this.mode = 'pan';
      this.samples = [[performance.now(), rest.x, rest.y]];
      return;
    }
    if (this.pointers.size) return;
    const dt = performance.now() - ptr.t0;
    if (!this.moved) {
      if (performance.now() < this.suppressClickUntil) { this.mode = null; return; }
      if (ptr.type === 'mouse' && (ptr.button === 2 || this.mode === 'rotate')) {
        this.view.emit('contextmenu', { point: p, ground: this.view.camera.unproject(p[0], p[1]) });
      } else if (dt < 600) {
        this.view.emit('click', { point: p, ground: this.view.camera.unproject(p[0], p[1]) });
      }
      this.mode = null;
      this.view.emit('gestureend');
      return;
    }
    if (this.mode === 'pan' && this.samples && this.samples.length > 1) {
      const now = performance.now();
      const recent = this.samples.filter(s => now - s[0] < 90);
      if (recent.length > 1) {
        const a = recent[0], b = recent[recent.length - 1];
        const vx = (b[1] - a[1]) / Math.max(1, b[0] - a[0]), vy = (b[2] - a[2]) / Math.max(1, b[0] - a[0]);
        if (Math.hypot(vx, vy) > 0.25) { this.mode = null; this.view.inertia(vx, vy, p); return; }
      }
    }
    this.mode = null;
    this.view.emit('gestureend');
    this.view.moveEnd();
  }

  cancel(e) {
    this.pointers.delete(e.pointerId);
    clearTimeout(this.lpTimer);
    if (!this.pointers.size) { this.mode = null; this.view.moveEnd(); }
  }

  wheel(e) {
    e.preventDefault();
    this.view.stopAnimation();
    const p = this.local(e);
    let dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1);
    const k = e.ctrlKey ? 0.012 : 0.0024; // щипок на тачпаде приходит как колесо с ctrlKey
    const cam = this.view.camera;
    const g = cam.unproject(p[0], p[1]);
    cam.set({ zoom: cam.zoom - dy * k });
    if (g) cam.setAround(g[0], g[1], p[0], p[1]);
    this.view.changed();
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.view.moveEnd(), 220);
  }
}
