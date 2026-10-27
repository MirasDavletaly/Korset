// Камера карты: центр (метры), масштаб (как в веб-картах), поворот и наклон. Перспективная проекция.
import * as mat4 from '../core/mat4.js';
import { clamp } from '../core/dom.js';

const FOV = 0.6435011087932844; // 36.87°: расстояние до центра = 1.5 × высота экрана

export class Camera {
  /** mpp0 — метров на пиксель при zoom = 0 на широте города. */
  constructor(mpp0, { x = 0, y = 0, zoom = 12, bearing = 0, pitch = 0, minZoom = 9, maxZoom = 19.5, bounds = null } = {}) {
    this.mpp0 = mpp0;
    this.x = x; this.y = y; this.zoom = zoom; this.bearing = bearing; this.pitch = pitch;
    this.minZoom = minZoom; this.maxZoom = maxZoom; this.maxPitch = 60 * Math.PI / 180;
    this.bounds = bounds;  // [x0, y0, x1, y1] — центр не уходит за пределы города
    this.width = 1; this.height = 1;
    this.update();
  }
  get mpp() { return this.mpp0 / 2 ** this.zoom; }

  resize(w, h) { this.width = Math.max(1, w); this.height = Math.max(1, h); this.update(); }

  set({ x = this.x, y = this.y, zoom = this.zoom, bearing = this.bearing, pitch = this.pitch } = {}) {
    this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.pitch = clamp(pitch, 0, this.maxPitch);
    this.bearing = ((bearing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (this.bounds) {
      const [x0, y0, x1, y1] = this.bounds;
      x = clamp(x, x0, x1); y = clamp(y, y0, y1);
    }
    this.x = x; this.y = y;
    this.update();
  }

  update() {
    const w = this.width, h = this.height;
    const halfFov = FOV / 2;
    this.D = (0.5 * h) / Math.tan(halfFov);
    const groundAngle = Math.PI / 2 + this.pitch;
    const topHalf = (Math.sin(halfFov) * this.D) / Math.sin(clamp(Math.PI - groundAngle - halfFov, 0.01, Math.PI - 0.01));
    const far = (Math.cos(Math.PI / 2 - this.pitch) * topHalf + this.D) * 1.05;
    const near = h / 50;
    const s = 1 / this.mpp;
    let m = mat4.perspective(FOV, w / h, near, far);
    m = mat4.multiply(m, mat4.translation(0, 0, -this.D));
    m = mat4.multiply(m, mat4.rotationX(-this.pitch));
    m = mat4.multiply(m, mat4.rotationZ(this.bearing));
    m = mat4.multiply(m, mat4.scaling(s, s, s));
    m = mat4.multiply(m, mat4.translation(-this.x, -this.y, 0));
    this.matrix = m;                                  // мир (метры) → clip space
    const toScreen = mat4.create();
    toScreen[0] = w / 2; toScreen[5] = -h / 2; toScreen[12] = w / 2; toScreen[13] = h / 2;
    this.pixelMatrix = mat4.multiply(toScreen, m);    // мир → пиксели экрана
    this.invPixel = mat4.invert(this.pixelMatrix);
    this.matrix32 = new Float32Array(m);
  }

  /** Мир → экран: [sx, sy, w]; w <= 0 — точка за камерой. */
  project(x, y, z = 0) {
    const m = this.pixelMatrix;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, w];
  }

  /** Экран → точка на земле (z = 0) или null, если луч не пересекает землю. */
  unproject(sx, sy) {
    const inv = this.invPixel;
    const a = mat4.transform(inv, sx, sy, 0), b = mat4.transform(inv, sx, sy, 1);
    const ax = a[0] / a[3], ay = a[1] / a[3], az = a[2] / a[3];
    const bx = b[0] / b[3], by = b[1] / b[3], bz = b[2] / b[3];
    if (az === bz) return null;
    const t = az / (az - bz);
    if (t < 0) return null;
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  }

  /** Видимая часть земли (для отсечения): углы экрана, верх ограничен при сильном наклоне. */
  groundBBox(pad = 0) {
    const w = this.width, h = this.height;
    let top = -pad;
    if (this.pitch > 0.6) top = h * (this.pitch > 0.9 ? 0.18 : 0.08);
    const pts = [[-pad, top], [w + pad, top], [w + pad, h + pad], [-pad, h + pad]].map(([sx, sy]) => this.unproject(sx, sy)).filter(Boolean);
    if (!pts.length) return [this.x - 1000, this.y - 1000, this.x + 1000, this.y + 1000];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const lim = 25000;
    return [Math.max(x0, this.x - lim), Math.max(y0, this.y - lim), Math.min(x1, this.x + lim), Math.min(y1, this.y + lim)];
  }

  /** Сдвигает центр так, чтобы точка земли (gx, gy) оказалась под экранной точкой (sx, sy). */
  setAround(gx, gy, sx, sy) {
    for (let i = 0; i < 2; i++) {
      const cur = this.unproject(sx, sy);
      if (!cur) return;
      this.set({ x: this.x + gx - cur[0], y: this.y + gy - cur[1] });
    }
  }

  /** Смещение экранной точки (dx, dy от центра) в метрах на земле — для «центра в видимой части». */
  screenOffsetToGround(dx, dy, zoom = this.zoom) {
    const mpp = this.mpp0 / 2 ** zoom;
    const c = Math.cos(this.bearing), s = Math.sin(this.bearing);
    const ry = -dy / Math.max(0.35, Math.cos(this.pitch));
    return [(dx * c + ry * s) * mpp, (-dx * s + ry * c) * mpp];
  }
}
