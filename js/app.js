// Общее состояние приложения и ссылки на основные объекты (карта, данные, поиск, маршрутизатор).

export const S = {
  theme: 'light',
  is3D: false,
  view: 'home',
  cat: null,        // { id, all, visible, origin }
  openOnly: false,
  sort: 'auto',     // auto | center | user
  hoverId: null,
  place: null,      // открытая карточка
  user: null,       // { x, y, acc } — геопозиция в метрах
  route: { a: null, b: null, mode: 'car', routes: [], active: 0, status: 'idle', error: '', stepIdx: -1 }
};

export const app = {
  store: null,
  map: null,
  search: null,
  router: null
};
