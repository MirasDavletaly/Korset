// Объекты справочника: тип по-русски, название, адрес, рубрика по запросу.
import { TYPE_RU, CATEGORIES } from '../config.js';
import { norm } from '../core/text.js';

export function typeLabel(tag) {
  if (!tag) return 'Объект';
  const [k] = tag.split('=');
  return TYPE_RU[tag] || TYPE_RU[`${k}=*`] || 'Объект';
}

export function poiTitle(p) { return p.name || typeLabel(p.tag); }

export function poiAddress(p) {
  const ad = p.extra && p.extra.ad;
  if (!ad) return null;
  const [street, hn] = ad;
  if (street && hn) return `${street}, ${hn}`;
  return street || (hn ? `д. ${hn}` : null);
}

const STOP_WORDS = new Set(['рядом', 'поблизости', 'около', 'возле', 'близко', 'ближаишая', 'ближаишии', 'ближаишие', 'ближаишее',
  'в', 'на', 'у', 'и', 'астана', 'астане', 'астаны', 'круглосуточно', 'круглосуточная', 'круглосуточныи', 'круглосуточные',
  '24', 'часа', 'где', 'наити', 'мне', 'хорошая', 'хорошии', 'хорошие', 'недорого', 'дешево', 'открытые', 'открытая', 'сеичас']);

/** Запрос совпадает с рубрикой? exact — запрос целиком про рубрику («аптеки рядом»). */
export function matchCategory(raw) {
  const q = norm(raw);
  if (q.length < 3) return null;
  const toks = q.split(' ').filter(Boolean);
  for (const cat of CATEGORIES) {
    const words = cat.words.map(norm);
    const hit = (t) => words.some(w => t.startsWith(w) || (t.length >= 3 && w.startsWith(t)));
    if (!toks.some(hit)) continue;
    return { cat, exact: toks.every(t => hit(t) || STOP_WORDS.has(t)) };
  }
  return null;
}
