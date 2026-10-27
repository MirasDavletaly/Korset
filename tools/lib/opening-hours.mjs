// Разбор opening_hours в недельное расписание. Поддерживаются частые в Астане формы:
// "24/7", "Mo-Fr 09:00-18:00; Sa 10:00-16:00", "09:00-21:00", "Mo-Su 10:00-14:00,15:00-22:00",
// "Su off", ночные интервалы "22:00-02:00". Всё сложнее (месяцы, sunrise, "+") — null, показываем сырую строку.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)';
const DAYSPEC_RE = new RegExp(`^(${DAY_RE}(?:\\s*-\\s*${DAY_RE})?(?:\\s*,\\s*${DAY_RE}(?:\\s*-\\s*${DAY_RE})?)*)?\\s*(.*)$`);
const TIME_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

/**
 * @returns {number[][][] | null} 7 дней (Пн..Вс), в каждом — интервалы [начало, конец] в минутах от полуночи;
 * конец может быть > 1440 для ночных интервалов.
 */
const RU_DAYS = { 'пн': 'Mo', 'вт': 'Tu', 'ср': 'We', 'чт': 'Th', 'пт': 'Fr', 'сб': 'Sa', 'вс': 'Su' };

export function parseOpeningHours(raw) {
  let v = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!v) return null;
  if (/^круглосуточно$/i.test(v)) v = '24/7';
  v = v.replace(/(^|[^а-яё])(пн|вт|ср|чт|пт|сб|вс)(?=[^а-яё]|$)/gi, (m, pre, d) => pre + RU_DAYS[d.toLowerCase()]);
  if (v === '24/7' || /^mo-su 00:00-24:00$/i.test(v)) return DAYS.map(() => [[0, 1440]]);
  v = v.replace(/"[^"]*"/g, '').replace(/\s+open\b/g, '').trim();
  // правила разделяют «;», а на практике ещё «,» или просто пробел перед днями недели
  const rules = v.split(/\s*;\s*/).flatMap(r => r.split(new RegExp(`(?:,\\s*|(?<=\\d)\\s+)(?=${DAY_RE}\\b)`)));
  const week = DAYS.map(() => null);
  let any = false;
  for (let rule of rules) {
    rule = rule.trim();
    if (!rule) continue;
    const m = rule.match(DAYSPEC_RE);
    if (!m) return null;
    const daySpec = m[1];
    const rest = m[2].trim();
    let days = [0, 1, 2, 3, 4, 5, 6];
    if (daySpec) {
      days = [];
      for (const part of daySpec.split(/\s*,\s*/)) {
        if (part === 'PH') continue; // праздники не моделируем
        const [a, b] = part.split(/\s*-\s*/);
        const ia = DAYS.indexOf(a), ib = b ? DAYS.indexOf(b) : ia;
        if (ia < 0 || ib < 0) return null;
        for (let d = ia; ; d = (d + 1) % 7) { days.push(d); if (d === ib) break; }
      }
      if (!days.length) continue; // правило только для праздников
    }
    let ranges;
    if (rest === '' || rest === '24/7') ranges = [[0, 1440]];
    else if (/^(off|closed)$/i.test(rest)) ranges = [];
    else {
      ranges = [];
      for (const part of rest.split(/\s*,\s*/)) {
        const t = part.match(TIME_RE);
        if (!t) return null;
        const s = +t[1] * 60 + +t[2];
        let e = +t[3] * 60 + +t[4];
        if (s > 1440 || e > 1440 || +t[2] > 59 || +t[4] > 59) return null;
        if (e <= s) e += 1440;
        ranges.push([s, e]);
      }
    }
    for (const d of days) week[d] = ranges;
    any = true;
  }
  if (!any) return null;
  return week.map(d => d || []);
}

/** Компактная запись для клиента: [день, начало, конец, день, начало, конец, ...]. */
export function packSchedule(week) {
  if (!week) return null;
  const out = [];
  week.forEach((ranges, d) => ranges.forEach(([s, e]) => out.push(d, s, e)));
  return out;
}
