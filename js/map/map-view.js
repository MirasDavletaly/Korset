// MapView: камера + WebGL-рендер + подписи + маркеры + жесты. Рисует только когда что-то изменилось.
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { Overlay } from './overlay.js';
import { Markers } from './markers.js';
import { Interaction } from './interaction.js';
import { PALETTES } from './style.js';
import { CITY } from '../config.js';
import { clamp } from '../core/dom.js';

class Emitter {
  constructor() { this.handlers = {}; }
  on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); return this; }
  emit(type, data) { for (const fn of this.handlers[type] || []) fn(data); }
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class MapView extends Emitter {
  constructor(container, store, { theme = 'light', camera = {}, is3D = false } = {}) {
    super();
    this.container = container;
    this.store = store;
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.className = 'map-gl';
    this.ovCanvas = document.createElement('canvas');
    this.ovCanvas.className = 'map-overlay';
    this.markerLayer = document.createElement('div');
    this.markerLayer.className = 'map-markers';
    container.append(this.glCanvas, this.ovCanvas, this.markerLayer);

    const mpp0 = 156543.03392804097 * Math.cos(store.proj.lat0 * Math.PI / 180);
    const [bx0, by0, bx1, by1] = store.bbox;
    this.camera = new Camera(mpp0, { ...camera, minZoom: CITY.minZoom, maxZoom: CITY.maxZoom, bounds: [bx0 - 2000, by0 - 2000, bx1 + 2000, by1 + 2000] });
    this.renderer = new Renderer(this.glCanvas);
    this.renderer.setBase(store);
    this.overlay = new Overlay(this.ovCanvas, store);
    this.markers = new Markers(this.markerLayer, this);
    this.interaction = new Interaction(container, this);
    this.palette = PALETTES[theme];
    this.is3D = is3D;
    this.hscale = is3D ? 1 : 0;
    this.anim = null;
    this.raf = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  // ---------- Данные ----------
  setBuildings() { this.renderer.setBuildings(this.store); this.requestRender(); }
  setPlaces() { this.overlay.setPlaces(); this.requestRender(); }
  setTheme(theme) { this.palette = PALETTES[theme]; this.requestRender(); }
  setRubric(items, color) { this.overlay.setRubric(items, color); this.requestRender(); }
  setHighlight(id) { if (this.overlay.highlightId !== id) { this.overlay.highlightId = id; this.requestRender(); } }
  setStep(pt) { this.overlay.step = pt; this.requestRender(); }
  setRoute(routes) { this.renderer.setRoute(routes); this.routeLines = routes; this.requestRender(); }
  setSelectedBuilding(b) { this.renderer.setSelectedBuilding(b); this.requestRender(); }
  setMarker(id, x, y, opts) { this.markers.set(id, x, y, opts); }
  removeMarker(id) { this.markers.remove(id); }

  // ---------- Отрисовка ----------
  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.resize(w, h);
    this.renderer.resize(w, h, this.dpr);
    this.ovCanvas.width = Math.round(w * this.dpr);
    this.ovCanvas.height = Math.round(h * this.dpr);
    this.renderNow();
  }
  requestRender() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.frame(); }); }
  renderNow() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } this.frame(); }
  /** Камеру изменили жестом: перерисовать и сообщить. */
  changed() { this.requestRender(); this.emit('move'); }
  moveEnd() { this.emit('moveend'); }

  frame() {
    if (this.anim) {
      const a = this.anim;
      const t = a.duration ? clamp((performance.now() - a.start) / a.duration, 0, 1) : 1;
      a.step(t);
      if (t >= 1) { this.anim = null; if (a.done) a.done(); this.emit('moveend'); }
      else this.requestRender();
      this.emit('move');
    }
    const cam = this.camera;
    this.renderer.render(cam, this.palette, { hscale: this.hscale, is3D: this.hscale > 0.02 });
    this.overlay.render(cam, this.palette, this.dpr);
    this.markers.updateAll();
  }

  // ---------- Анимации камеры ----------
  stopAnimation() {
    if (this.anim) { const a = this.anim; this.anim = null; if (a.done) a.done(); this.emit('moveend'); }
  }
  animate(duration, step, done) {
    this.stopAnimation();
    if (reducedMotion()) duration = 0;
    this.anim = { start: performance.now(), duration, step, done };
    this.requestRender();
  }

  /** Плавный переход камеры. offset — где на экране должен оказаться центр (пиксели от центра экрана). */
  easeTo({ x, y, zoom, bearing, pitch, offset = [0, 0], duration = 800, flight = false } = {}) {
    const cam = this.camera;
    const from = { x: cam.x, y: cam.y, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch };
    const to = {
      zoom: zoom ?? cam.zoom,
      bearing: bearing ?? cam.bearing,
      pitch: pitch ?? cam.pitch
    };
    let tx = x ?? cam.x, ty = y ?? cam.y;
    if (offset[0] || offset[1]) {
      const [ox, oy] = cam.screenOffsetToGround(-offset[0], -offset[1], to.zoom);
      tx += ox; ty += oy;
    }
    let dB = to.bearing - from.bearing;
    if (dB > Math.PI) dB -= 2 * Math.PI; else if (dB < -Math.PI) dB += 2 * Math.PI;
    // «перелёт»: на дальних расстояниях по пути немного отдаляемся
    let bump = 0;
    if (flight) {
      const dPx = Math.hypot(tx - from.x, ty - from.y) / (cam.mpp0 / 2 ** Math.min(from.zoom, to.zoom));
      if (dPx > cam.width * 0.8) bump = Math.min(4, Math.log2(dPx / (cam.width * 0.8)) + 0.5);
    }
    this.animate(duration, (t) => {
      const e = easeInOut(t);
      cam.set({
        x: from.x + (tx - from.x) * e,
        y: from.y + (ty - from.y) * e,
        zoom: from.zoom + (to.zoom - from.zoom) * e - bump * 4 * e * (1 - e),
        bearing: from.bearing + dB * e,
        pitch: from.pitch + (to.pitch - from.pitch) * e
      });
    });
  }
  flyTo(opts) { this.easeTo({ duration: 1200, ...opts, flight: true }); }

  jumpTo({ x, y, zoom, bearing, pitch }) {
    this.stopAnimation();
    this.camera.set({ x, y, zoom, bearing, pitch });
    this.requestRender();
    this.emit('move'); this.emit('moveend');
  }

  zoomAround(zoom, sx, sy, duration = 250) {
    const cam = this.camera;
    const g = cam.unproject(sx, sy);
    const z0 = cam.zoom;
    this.animate(duration, (t) => {
      cam.set({ zoom: z0 + (zoom - z0) * easeOut(t) });
      if (g) cam.setAround(g[0], g[1], sx, sy);
    });
  }
  zoomBy(dz) { this.zoomAround(this.camera.zoom + dz, this.camera.width / 2, this.camera.height / 2, 260); }

  inertia(vx, vy, from) {
    const cam = this.camera;
    const total = [vx * 260, vy * 260];
    let last = 0;
    this.animate(600, (t) => {
      const e = easeOut(t);
      const dx = total[0] * (e - last), dy = total[1] * (e - last);
      last = e;
      const g = cam.unproject(from[0], from[1]);
      if (g) cam.setAround(g[0], g[1], from[0] + dx, from[1] + dy);
    });
  }

  /** Вписать прямоугольник [x0, y0, x1, y1] (метры) с отступами {top,right,bottom,left} в пикселях. */
  fitBounds([x0, y0, x1, y1], pad, maxZoom = 17, duration = 900) {
    const cam = this.camera;
    const w = Math.max(40, cam.width - pad.left - pad.right), h = Math.max(40, cam.height - pad.top - pad.bottom);
    const c = Math.abs(Math.cos(cam.bearing)), s = Math.abs(Math.sin(cam.bearing));
    const bw = (x1 - x0) * c + (y1 - y0) * s, bh = (x1 - x0) * s + (y1 - y0) * c;
    const mpp = Math.max(bw / w, bh / h / Math.max(0.5, Math.cos(cam.pitch)), 0.05);
    const zoom = clamp(Math.log2(cam.mpp0 / mpp), cam.minZoom, maxZoom);
    const offset = [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2];
    this.easeTo({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom, offset, duration });
  }

  set3D(on, animate = true) {
    this.is3D = on;
    const cam = this.camera;
    const h0 = this.hscale, p0 = cam.pitch, z0 = cam.zoom, b0 = cam.bearing;
    const p1 = on ? 55 * Math.PI / 180 : 0;
    const z1 = on ? Math.max(z0, 15.3) : z0;
    let b1 = on ? (b0 || -0.3) : 0;
    let dB = b1 - b0;
    if (dB > Math.PI) dB -= 2 * Math.PI; else if (dB < -Math.PI) dB += 2 * Math.PI;
    const step = (t) => {
      const e = easeInOut(t);
      this.hscale = h0 + ((on ? 1 : 0) - h0) * e;
      cam.set({ pitch: p0 + (p1 - p0) * e, zoom: z0 + (z1 - z0) * e, bearing: b0 + dB * e });
    };
    if (!animate) { step(1); this.requestRender(); return; }
    this.animate(1100, step);
  }

  /** Пользователь наклонил карту жестом — включаем объём; вернул в плоскость — выключаем. */
  syncPitch() {
    const p = this.camera.pitch;
    if (p > 0.2 && !this.is3D) { this.is3D = true; this.hscale = 1; this.emit('mode3d', true); }
    else if (p < 0.05 && this.is3D && !this.anim) { this.is3D = false; this.hscale = 0; this.emit('mode3d', false); }
    this.requestRender();
  }

  // ---------- Координаты ----------
  project(x, y) { return this.camera.project(x, y); }
  unproject(sx, sy) { return this.camera.unproject(sx, sy); }
  toLonLat(x, y) { return this.store.proj.toLonLat(x, y); }
  toXY(lon, lat) { return this.store.proj.toXY(lon, lat); }

  /** Видимая область земли в метрах, без панели слева или шторки снизу. */
  visibleBBox(visibleRect) {
    const cam = this.camera;
    const { x0, y0, x1, y1 } = visibleRect;
    const top = cam.pitch > 0.6 ? Math.max(y0, cam.height * 0.15) : y0;
    const pts = [[x0, top], [x1, top], [x1, y1], [x0, y1]].map(([sx, sy]) => cam.unproject(sx, sy)).filter(Boolean);
    if (!pts.length) return cam.groundBBox();
    return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
  }
}
