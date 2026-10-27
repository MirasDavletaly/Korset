// Часы работы: статус «открыто/закрыто» по расписанию, разобранному при сборке данных.
// Расписание: [день(0=Пн), начало, конец, ...] в минутах; конец > 1440 — ночной интервал.
import { cityNow, hhmm } from '../core/format.js';
import { WEEKDAYS_IN, WEEKDAYS_SHORT } from '../config.js';

const WEEK = 7 * 1440;

function dayDiff(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}

function intervals(s) {
  const list = [];
  for (let i = 0; i < s.length; i += 3) {
    const base = s[i] * 1440;
    for (const w of [-WEEK, 0, WEEK]) list.push([w + base + s[i + 1], w + base + s[i + 2]]);
  }
  list.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of list) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push(iv.slice());
  }
  return merged;
}

/** { kind: open|closing|closed|raw|none, text, open: true|false|null } */
export function hoursStatus(extra) {
  const raw = extra && extra.oh;
  if (!raw) return { kind: 'none', text: '', open: null };
  const s = extra.s;
  if (!s) return { kind: 'raw', text: raw, open: null };
  if (!s.length) return { kind: 'closed', text: 'Закрыто', open: false };
  const now = cityNow();
  const t = ((now.getDay() + 6) % 7) * 1440 + now.getHours() * 60 + now.getMinutes();
  const list = intervals(s);
  const cur = list.find(([a, b]) => a <= t && t < b);
  if (cur) {
    if (cur[1] - cur[0] >= WEEK) return { kind: 'open', text: 'Открыто круглосуточно', open: true };
    const mins = cur[1] - t;
    if (mins <= 60) return { kind: 'closing', text: `Закроется через ${Math.max(1, mins)} мин`, open: true };
    const until = new Date(now.getTime() + mins * 60000);
    const dd = dayDiff(now, until);
    const when = dd === 0 || (dd === 1 && until.getHours() < 6) ? hhmm(until) : `${WEEKDAYS_SHORT[until.getDay()]} ${hhmm(until)}`;
    return { kind: 'open', text: `Открыто до ${when}`, open: true };
  }
  const next = list.find(([a]) => a > t);
  if (!next) return { kind: 'closed', text: 'Закрыто', open: false };
  const at = new Date(now.getTime() + (next[0] - t) * 60000);
  const dd = dayDiff(now, at);
  const when = dd === 0 ? `в ${hhmm(at)}` : dd === 1 ? `завтра в ${hhmm(at)}` : `${WEEKDAYS_IN[at.getDay()]} в ${hhmm(at)}`;
  return { kind: 'closed', text: `Закрыто, откроется ${when}`, open: false };
}

export const isOpenNow = (extra) => hoursStatus(extra).open === true;

/** Человекочитаемое расписание по строкам. */
export function prettyHours(raw) {
  const v = String(raw).trim();
  if (v === '24/7' || /^круглосуточно$/i.test(v)) return ['Круглосуточно'];
  const map = { Mo: 'Пн', Tu: 'Вт', We: 'Ср', Th: 'Чт', Fr: 'Пт', Sa: 'Сб', Su: 'Вс', PH: 'праздники', SH: 'каникулы', off: 'выходной', closed: 'выходной' };
  return v.split(/\s*;\s*/).filter(Boolean).map(rule => rule
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH|off|closed)\b/g, m => map[m])
    .replace(/24\/7/g, 'круглосуточно')
    .replace(/,(?=\S)/g, ', ')
    .replace(/(\d)-(\d)/g, '$1–$2')
    .replace(/([А-Яа-я])-([А-Яа-я])/g, '$1–$2'));
}
