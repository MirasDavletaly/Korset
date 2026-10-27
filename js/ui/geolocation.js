// «Моё местоположение»: геолокация браузера (работает только по HTTPS или на localhost).
import { $ } from '../core/dom.js';
import { S, app } from '../app.js';
import { toast } from './toast.js';
import { Panel } from './panel.js';

const ME_HTML = '<span></span>';

export const Geo = {
  pending: null,

  inCity(p = S.user) {
    if (!p) return false;
    const [x0, y0, x1, y1] = app.store.bbox;
    return p.x > x0 - 3000 && p.x < x1 + 3000 && p.y > y0 - 3000 && p.y < y1 + 3000;
  },

  locate({ fly = true } = {}) {
    if (this.pending) return this.pending;
    if (!window.isSecureContext) {
      toast('Геолокация работает только по HTTPS или на localhost. Откройте демо по защищённой ссылке.', { type: 'error', timeout: 6000 });
      return Promise.reject(new Error('insecure'));
    }
    if (!('geolocation' in navigator)) {
      toast('Этот браузер не умеет определять местоположение.', { type: 'error' });
      return Promise.reject(new Error('unsupported'));
    }
    const btn = $('#locateBtn');
    btn.classList.add('busy');
    this.pending = new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos.coords),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    }).then((c) => {
      const [x, y] = app.store.proj.toXY(c.longitude, c.latitude);
      S.user = { x, y, acc: c.accuracy };
      app.map.setMarker('me', x, y, { html: ME_HTML, className: 'me', title: 'Вы здесь' });
      if (this.inCity()) {
        if (fly) app.map.flyTo({ x, y, zoom: Math.max(app.map.camera.zoom, 15.5), offset: Panel.offset() });
      } else {
        const km = Math.round(Math.hypot(x, y) / 1000);
        toast(`Вы в ${km} км от Астаны — расстояния считаем от центра карты.`, { timeout: 6500 });
      }
      return S.user;
    }, (err) => {
      const code = err && err.code;
      const msg = code === 1 ? 'Доступ к местоположению запрещён. Разрешите его в настройках браузера для этого сайта.'
        : code === 3 ? 'Не удалось определить местоположение за отведённое время. Попробуйте ещё раз.'
          : 'Местоположение сейчас недоступно. Проверьте, включена ли геолокация на устройстве.';
      toast(msg, { type: 'error', timeout: 6000 });
      throw err;
    }).finally(() => {
      this.pending = null;
      btn.classList.remove('busy');
    });
    return this.pending;
  }
};
