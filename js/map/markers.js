// DOM-маркеры над картой: выбранное место, точки А и Б, «вы здесь». А и Б можно перетаскивать.

export class Markers {
  constructor(layer, view) { this.layer = layer; this.view = view; this.items = new Map(); }

  set(id, x, y, { html = '', className = '', anchor = 'center', title = '', draggable = false, onDragEnd = null } = {}) {
    let m = this.items.get(id);
    if (!m) {
      const el = document.createElement('div');
      el.className = `mk ${className}`;
      el.innerHTML = html;
      if (title) el.title = title;
      this.layer.appendChild(el);
      m = { el, x, y, anchor, dragging: false };
      this.items.set(id, m);
      if (draggable) this.makeDraggable(m, onDragEnd);
    }
    m.x = x; m.y = y; m.anchor = anchor;
    this.place(m);
  }

  remove(id) {
    const m = this.items.get(id);
    if (m) { m.el.remove(); this.items.delete(id); }
  }

  has(id) { return this.items.has(id); }

  updateAll() { for (const m of this.items.values()) this.place(m); }

  place(m) {
    const cam = this.view.camera;
    const [sx, sy, w] = cam.project(m.x, m.y);
    if (w <= 0 || sx < -60 || sy < -60 || sx > cam.width + 60 || sy > cam.height + 60) { m.el.style.display = 'none'; return; }
    m.el.style.display = '';
    m.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, ${m.anchor === 'bottom' ? '-100%' : '-50%'})`;
  }

  makeDraggable(m, onDragEnd) {
    const el = m.el;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      m.dragging = true;
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!m.dragging) return;
      const r = this.layer.getBoundingClientRect();
      const g = this.view.camera.unproject(e.clientX - r.left, e.clientY - r.top);
      if (!g) return;
      m.x = g[0]; m.y = g[1];
      this.place(m);
    });
    const end = (e) => {
      if (!m.dragging) return;
      m.dragging = false;
      el.classList.remove('dragging');
      try { el.releasePointerCapture(e.pointerId); } catch (err) { /* уже отпущен */ }
      if (onDragEnd) onDragEnd(m.x, m.y);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
