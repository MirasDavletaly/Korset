// Форматирование чисел, расстояний, времени — по-русски.
import { CITY } from '../config.js';

export function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

export function fmtDist(m) {
  if (m < 100) return `${Math.max(1, Math.round(m))} м`;
  if (m < 1000) return `${Math.round(m / 10) * 10} м`;
  if (m < 100000) return `${(m / 1000).toFixed(1).replace('.', ',').replace(/,0$/, '')} км`;
  return `${Math.round(m / 1000)} км`;
}

export function fmtDuration(sec) {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${h} ч`;
}

export const fmtCoord = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

/** «Настенные часы» Астаны: Date, у которого локальные поля равны времени в городе. */
export function cityNow() {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + CITY.utcOffsetMin) * 60000);
}

export const hhmm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

export function arrivalText(sec) {
  const d = cityNow();
  d.setSeconds(d.getSeconds() + sec);
  return `прибытие в ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
