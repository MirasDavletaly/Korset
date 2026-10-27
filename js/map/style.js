// Стиль карты Korset: палитры светлой и тёмной темы, ширины дорог по масштабу.
import { ROAD } from '../config.js';

export const PALETTES = {
  light: {
    land: '#F3F1EC',
    areas: {
      residential: '#EFECE6', industrial: '#ECE8E4', farm: '#EEF0E2', edu: '#F2EDDD', hospital: '#F6E9E8',
      grass: '#DDEBCB', forest: '#C8E1B2', park: '#CDE6B8', cemetery: '#D8E1CF', sport: '#D2EAD0',
      sand: '#F1E7C8', parking: '#E7E7EC', plaza: '#EBE8E2', water: '#A9D4F1'
    },
    water: '#A9D4F1',
    rail: '#ABA6A0', railDash: '#F3F1EC',
    roads: {
      fill: ['#FFD27A', '#FFDE8E', '#FFEDB5', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#E6DCCB', '#FFFFFF', '#EBDDD6', '#BFE0F6', '#F8F5EF'],
      casing: ['#DDA23A', '#E0B04F', '#DCC27E', '#D3CDC3', '#D7D2C9', '#DCD7CF', '#E0DBD3', '#CDBFA6', '#C8C1B5', '#C9AE9F', '#7EB6E0', '#DAD3C8']
    },
    building: '#E2DDD5', buildingRoof: '#ECE7DF', buildingWall: '#D3CCC0', buildingOutline: '#CDC5B9',
    route: '#0A7EA4', routeCasing: '#FFFFFF', routeAlt: '#9AA4B0', routeAltCasing: '#FFFFFF',
    label: '#33373D', labelHalo: '#FFFFFF', street: '#4B5059', district: '#6A7280', house: '#8D9198', water_label: '#3C7DB0',
    poiText: '#3E434A'
  },
  dark: {
    land: '#16191E',
    areas: {
      residential: '#1A1D22', industrial: '#1C1E23', farm: '#1A1F1B', edu: '#1E1E1D', hospital: '#211C1E',
      grass: '#1B261F', forest: '#1A2B20', park: '#1C2B21', cemetery: '#1D241F', sport: '#1B2822',
      sand: '#24221C', parking: '#1E2026', plaza: '#1F2125', water: '#0F2A40'
    },
    water: '#0F2A40',
    rail: '#4A4F57', railDash: '#16191E',
    roads: {
      fill: ['#6E5B37', '#64563A', '#575043', '#3A3F47', '#383D45', '#33373F', '#2E3239', '#3A352C', '#3B4049', '#4A3F3B', '#24485F', '#2C3037'],
      casing: ['#3F3420', '#3B3324', '#36312A', '#24282E', '#23272D', '#22252B', '#202328', '#25221D', '#16191E', '#2A2422', '#16191E', '#202328']
    },
    building: '#272B32', buildingRoof: '#30353D', buildingWall: '#23272E', buildingOutline: '#1E2228',
    route: '#3BB4DA', routeCasing: '#0B1418', routeAlt: '#5E6773', routeAltCasing: '#0B1418',
    label: '#D3D9DF', labelHalo: '#101215', street: '#B6BEC8', district: '#8D97A3', house: '#7C858F', water_label: '#6FA9D6',
    poiText: '#C9D0D8'
  }
};

// Ширина дорожного полотна в пикселях: опорные точки [масштаб, ширина]; между ними — экспонента.
const ROAD_WIDTH = {
  [ROAD.MOTORWAY]: [[9, 1.4], [12, 3], [15, 9], [18, 30], [20, 70]],
  [ROAD.TRUNK]: [[9, 1.2], [12, 2.8], [15, 8.5], [18, 28], [20, 64]],
  [ROAD.PRIMARY]: [[10, 1], [12, 2.4], [15, 8], [18, 26], [20, 58]],
  [ROAD.SECONDARY]: [[11, 0.8], [13, 2.2], [15, 6.5], [18, 22], [20, 50]],
  [ROAD.TERTIARY]: [[11.5, 0.6], [13, 1.8], [15, 5.5], [18, 19], [20, 44]],
  [ROAD.MINOR]: [[12.5, 0.5], [14, 1.4], [16, 4.5], [18, 13], [20, 32]],
  [ROAD.SERVICE]: [[14, 0.5], [15, 1], [16, 2.4], [18, 8], [20, 20]],
  [ROAD.TRACK]: [[14, 0.5], [16, 1.4], [18, 3.5], [20, 8]],
  [ROAD.PATH]: [[14.5, 0.6], [16, 1.2], [18, 2.6], [20, 6]],
  [ROAD.STEPS]: [[15, 0.8], [16, 1.5], [18, 3.5], [20, 8]],
  [ROAD.CYCLEWAY]: [[14, 0.6], [16, 1.4], [18, 3], [20, 7]],
  [ROAD.PEDESTRIAN]: [[13.5, 0.8], [15, 2.4], [17, 7], [20, 28]]
};

export function roadWidth(cls, zoom) {
  const stops = ROAD_WIDTH[cls];
  if (zoom < stops[0][0]) return 0;
  for (let i = 1; i < stops.length; i++) {
    const [z1, w1] = stops[i];
    if (zoom <= z1) {
      const [z0, w0] = stops[i - 1];
      const t = (zoom - z0) / (z1 - z0);
      return w0 * (w1 / w0) ** t;
    }
  }
  return stops[stops.length - 1][1];
}

/** Обводка: у крупных дорог заметнее, у тропинок нет. */
export function casingWidth(cls, fill) {
  if (cls === ROAD.PATH || cls === ROAD.STEPS || cls === ROAD.CYCLEWAY || cls === ROAD.TRACK) return 0;
  return Math.max(0.6, Math.min(2.2, fill * 0.12));
}

export const DASHED = new Set([ROAD.PATH, ROAD.STEPS, ROAD.TRACK]);

// Порядок отрисовки: от мелких к крупным, крупные сверху.
export const ROAD_ORDER = [ROAD.PATH, ROAD.STEPS, ROAD.CYCLEWAY, ROAD.TRACK, ROAD.SERVICE, ROAD.PEDESTRIAN, ROAD.MINOR, ROAD.TERTIARY, ROAD.SECONDARY, ROAD.PRIMARY, ROAD.TRUNK, ROAD.MOTORWAY];

export const AREA_ORDER = ['residential', 'industrial', 'farm', 'edu', 'hospital', 'grass', 'forest', 'park', 'cemetery', 'sport', 'sand', 'parking', 'plaza', 'water'];

export const WATERWAY_WIDTH = { river: [[10, 2], [14, 6], [17, 18], [20, 40]], canal: [[12, 1], [15, 3], [18, 8]], stream: [[13, 0.6], [16, 1.6], [19, 3]], ditch: [[15, 0.5], [18, 1.5]] };

export function stopWidth(stops, zoom) {
  if (zoom < stops[0][0]) return 0;
  for (let i = 1; i < stops.length; i++) {
    const [z1, w1] = stops[i];
    if (zoom <= z1) { const [z0, w0] = stops[i - 1]; return w0 + (w1 - w0) * (zoom - z0) / (z1 - z0); }
  }
  return stops[stops.length - 1][1];
}
