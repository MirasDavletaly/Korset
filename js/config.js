// Настройки города, рубрик и справочники названий.

export const CITY = {
  name: 'Астана',
  center: { lon: 71.4304, lat: 51.1282 },   // Байтерек
  zoom: 12.3,
  minZoom: 10,
  maxZoom: 19,
  utcOffsetMin: 300                         // UTC+5: «Открыто сейчас» по времени Астаны
};

export const DATA_FILES = {
  base: 'data/base.json',
  buildings: 'data/buildings.json',
  places: 'data/places.json'
};

export const MODES = [
  { id: 'car', label: 'Авто', icon: 'car' },
  { id: 'foot', label: 'Пешком', icon: 'walk' },
  { id: 'bike', label: 'Велосипед', icon: 'bike' }
];

export const CATEGORIES = [
  { id: 'pharmacy', label: 'Аптеки', color: '#E5484D', icon: 'cross', words: ['аптек', 'аптеч', 'лекарств', 'pharmacy'] },
  { id: 'food', label: 'Кафе и рестораны', color: '#EE6A12', icon: 'coffee', words: ['кафе', 'ресторан', 'кофе', 'кофейн', 'фастфуд', 'фаст-фуд', 'поесть', 'еда', 'столов', 'пицц', 'бургер', 'cafe', 'restaurant'] },
  { id: 'grocery', label: 'Продукты', color: '#2E9E5B', icon: 'cart', words: ['продукт', 'супермаркет', 'гипермаркет', 'минимаркет', 'магазин', 'гастроном', 'supermarket'] },
  { id: 'atm', label: 'Банкоматы и банки', color: '#0D74CE', icon: 'card', words: ['банкомат', 'банк', 'atm', 'bank', 'наличн'] },
  { id: 'fuel', label: 'АЗС', color: '#7C3AED', icon: 'fuel', words: ['азс', 'заправк', 'бензин', 'топлив', 'бензоколон', 'fuel'] },
  { id: 'medical', label: 'Медицина', color: '#D6409F', icon: 'medical', words: ['больниц', 'поликлиник', 'клиник', 'врач', 'медицин', 'госпитал', 'травмпункт', 'медцентр', 'hospital', 'clinic'] },
  { id: 'school', label: 'Школы и детсады', color: '#B7791F', icon: 'school', words: ['школ', 'детсад', 'детский', 'садик', 'гимнази', 'лицей', 'school', 'kindergarten'] },
  { id: 'parking', label: 'Парковки', color: '#3E63DD', icon: 'parking', words: ['парковк', 'стоянк', 'паркинг', 'parking'] }
];
export const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export const TYPE_RU = {
  'amenity=pharmacy': 'Аптека', 'amenity=cafe': 'Кафе', 'amenity=restaurant': 'Ресторан', 'amenity=fast_food': 'Фастфуд',
  'amenity=bar': 'Бар', 'amenity=pub': 'Паб', 'amenity=food_court': 'Фуд-корт', 'amenity=ice_cream': 'Мороженое',
  'shop=supermarket': 'Супермаркет', 'shop=convenience': 'Продуктовый магазин', 'amenity=atm': 'Банкомат', 'amenity=bank': 'Банк',
  'amenity=bureau_de_change': 'Обмен валюты', 'amenity=fuel': 'АЗС', 'amenity=charging_station': 'Зарядная станция',
  'amenity=hospital': 'Больница', 'amenity=clinic': 'Клиника', 'amenity=doctors': 'Врач', 'amenity=dentist': 'Стоматология',
  'amenity=school': 'Школа', 'amenity=kindergarten': 'Детский сад', 'amenity=university': 'Университет', 'amenity=college': 'Колледж',
  'amenity=parking': 'Парковка', 'amenity=police': 'Полиция', 'amenity=post_office': 'Почта', 'amenity=library': 'Библиотека',
  'amenity=theatre': 'Театр', 'amenity=cinema': 'Кинотеатр', 'amenity=place_of_worship': 'Место поклонения',
  'amenity=townhall': 'Администрация', 'amenity=marketplace': 'Рынок', 'amenity=bus_station': 'Автовокзал',
  'amenity=car_wash': 'Автомойка', 'amenity=toilets': 'Туалет', 'amenity=fountain': 'Фонтан', 'amenity=community_centre': 'Общественный центр',
  'amenity=arts_centre': 'Арт-центр', 'amenity=nightclub': 'Ночной клуб', 'amenity=veterinary': 'Ветклиника', 'amenity=courthouse': 'Суд',
  'amenity=embassy': 'Посольство', 'amenity=car_rental': 'Прокат авто', 'amenity=driving_school': 'Автошкола', 'amenity=*': 'Учреждение',
  'shop=mall': 'Торговый центр', 'shop=department_store': 'Универмаг', 'shop=clothes': 'Одежда', 'shop=shoes': 'Обувь',
  'shop=bakery': 'Пекарня', 'shop=beauty': 'Салон красоты', 'shop=hairdresser': 'Парикмахерская', 'shop=electronics': 'Электроника',
  'shop=mobile_phone': 'Салон связи', 'shop=car_repair': 'Автосервис', 'shop=books': 'Книги', 'shop=florist': 'Цветы',
  'shop=butcher': 'Мясной магазин', 'shop=alcohol': 'Алкоголь', 'shop=hardware': 'Хозтовары', 'shop=furniture': 'Мебель',
  'shop=cosmetics': 'Косметика', 'shop=optician': 'Оптика', 'shop=car': 'Автосалон', 'shop=car_parts': 'Автозапчасти',
  'shop=jewelry': 'Ювелирный', 'shop=toys': 'Игрушки', 'shop=sports': 'Спорттовары', 'shop=pet': 'Зоотовары', 'shop=*': 'Магазин',
  'tourism=hotel': 'Гостиница', 'tourism=hostel': 'Хостел', 'tourism=apartment': 'Апартаменты', 'tourism=museum': 'Музей',
  'tourism=attraction': 'Достопримечательность', 'tourism=viewpoint': 'Смотровая площадка', 'tourism=artwork': 'Арт-объект',
  'tourism=gallery': 'Галерея', 'tourism=information': 'Информация', 'tourism=*': 'Туризм',
  'leisure=park': 'Парк', 'leisure=garden': 'Сад', 'leisure=fitness_centre': 'Фитнес-центр', 'leisure=stadium': 'Стадион',
  'leisure=sports_centre': 'Спорткомплекс', 'leisure=playground': 'Детская площадка', 'leisure=water_park': 'Аквапарк',
  'leisure=swimming_pool': 'Бассейн', 'leisure=ice_rink': 'Каток', 'leisure=*': 'Отдых',
  'office=government': 'Госучреждение', 'office=company': 'Компания', 'office=*': 'Офис',
  'healthcare=*': 'Медицина', 'craft=*': 'Мастерская', 'historic=*': 'Исторический объект',
  'railway=station': 'Ж/д вокзал', 'railway=halt': 'Ж/д платформа', 'railway=tram_stop': 'Остановка', 'aeroway=aerodrome': 'Аэропорт',
  'aeroway=terminal': 'Терминал аэропорта', 'highway=bus_stop': 'Остановка', 'public_transport=station': 'Вокзал',
  'man_made=tower': 'Башня', 'man_made=*': 'Сооружение',
  'building=apartments': 'Жилой дом', 'building=residential': 'Жилой дом', 'building=house': 'Частный дом',
  'building=commercial': 'Коммерческое здание', 'building=retail': 'Торговое здание', 'building=office': 'Бизнес-центр',
  'building=*': 'Здание'
};

export const CUISINE_RU = {
  coffee_shop: 'кофейня', coffee: 'кофе', tea: 'чай', bubble_tea: 'бабл-ти', pizza: 'пицца', burger: 'бургеры', sushi: 'суши',
  kazakh: 'казахская', russian: 'русская', italian: 'итальянская', japanese: 'японская', chinese: 'китайская', korean: 'корейская',
  asian: 'азиатская', uzbek: 'узбекская', georgian: 'грузинская', turkish: 'турецкая', american: 'американская',
  european: 'европейская', international: 'интернациональная', regional: 'местная', local: 'местная', french: 'французская',
  indian: 'индийская', thai: 'тайская', vietnamese: 'вьетнамская', mexican: 'мексиканская', arab: 'арабская', lebanese: 'ливанская',
  caucasian: 'кавказская', oriental: 'восточная', chicken: 'курица', kebab: 'кебаб', shawarma: 'шаурма', doner: 'донер',
  steak_house: 'стейки', grill: 'гриль', barbecue: 'барбекю', seafood: 'морепродукты', fish: 'рыба', noodle: 'лапша',
  ramen: 'рамен', sandwich: 'сэндвичи', breakfast: 'завтраки', cake: 'торты', dessert: 'десерты', pastry: 'выпечка',
  ice_cream: 'мороженое', donut: 'пончики', hot_dog: 'хот-доги', pancake: 'блины', salad: 'салаты', vegetarian: 'вегетарианская',
  vegan: 'веганская', soup: 'супы', bakery: 'выпечка', crepe: 'блины', plov: 'плов', fast_food: 'фастфуд'
};

export const WEEKDAYS_IN = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
export const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

// Дороги: классы и флаги совпадают с tools/build-data.mjs
export const ROAD = { MOTORWAY: 0, TRUNK: 1, PRIMARY: 2, SECONDARY: 3, TERTIARY: 4, MINOR: 5, SERVICE: 6, TRACK: 7, PATH: 8, STEPS: 9, CYCLEWAY: 10, PEDESTRIAN: 11 };
export const ROAD_FLAG = { FWD: 1, BACK: 2, ROUNDABOUT: 4, BRIDGE: 8, TUNNEL: 16, NOCAR: 32, NOFOOT: 64, NOBIKE: 128, LINK: 256 };
