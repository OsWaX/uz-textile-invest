'use strict';
/**
 * Стартовый каталог Jayron Kids: категории, товары, регионы доставки, промокоды.
 * Цены — в сумах. Фотографии товаров добавляются через панель управления;
 * пока их нет, приложение рисует иллюстрацию вещи в цвете варианта.
 */

// Цвета бренда из брендбука и базовые нейтральные цвета
const COLORS = {
  teal:    { hex: '#00B3A4', uz: 'Firuzarang',     ru: 'Бирюзовый' },
  sky:     { hex: '#4FB6F2', uz: 'Osmon rang',     ru: 'Небесно-голубой' },
  sunny:   { hex: '#FFC629', uz: 'Quyosh sarig‘i', ru: 'Солнечный жёлтый' },
  coral:   { hex: '#FF6F61', uz: 'Marjon',         ru: 'Коралловый' },
  leaf:    { hex: '#8BC34A', uz: 'Barg yashili',   ru: 'Салатовый' },
  cream:   { hex: '#F6E7C8', uz: 'Qaymoqrang',     ru: 'Кремовый' },
  white:   { hex: '#FFFFFF', uz: 'Oq',             ru: 'Белый' },
  melange: { hex: '#C9CDD2', uz: 'Kulrang melanj', ru: 'Серый меланж' },
  navy:    { hex: '#2C4A7A', uz: 'To‘q ko‘k',      ru: 'Тёмно-синий' },
  pink:    { hex: '#F7A8C4', uz: 'Pushti',         ru: 'Розовый' },
  denim:   { hex: '#4A6FA5', uz: 'Jinsi ko‘k',     ru: 'Деним' },
};

const BABY = ['56', '62', '68', '74', '80', '86'];
const KIDS = ['92', '98', '104', '110', '116', '122', '128', '134', '140'];
const sizes = (from, to) => {
  const all = [...BABY, ...KIDS];
  return all.slice(all.indexOf(from), all.indexOf(to) + 1);
};

const MATERIALS = {
  penye:  { uz: '100% paxta (penye), O‘zbekiston paxtasi', ru: '100% хлопок (пенье), узбекский хлопок' },
  interlok: { uz: '100% paxta (interlok) — chaqaloq terisi uchun yumshoq', ru: '100% хлопок (интерлок) — мягкий для кожи малыша' },
  futer:  { uz: 'Futer 3 ip: 80% paxta, 20% poliester', ru: 'Футер 3-нитка: 80% хлопок, 20% полиэстер' },
  futer2: { uz: 'Futer 2 ip: 95% paxta, 5% elastan', ru: 'Футер 2-нитка: 95% хлопок, 5% эластан' },
  muslin: { uz: 'Muslin: 100% paxta, ikki qavatli', ru: 'Муслин: 100% хлопок, двухслойный' },
  denim:  { uz: 'Yumshoq jinsi: 98% paxta, 2% elastan', ru: 'Мягкий деним: 98% хлопок, 2% эластан' },
  jacket: { uz: 'Ustki qatlam: suv o‘tkazmaydigan neylon; astar: 100% paxta', ru: 'Верх: водоотталкивающий нейлон; подкладка: 100% хлопок' },
};

const CATEGORIES = [
  { slug: 'chaqaloqlar', uz: 'Chaqaloqlar uchun', ru: 'Для малышей',      color: '#FFC629', kind: 'bodysuit' },
  { slug: 'futbolkalar', uz: 'Futbolkalar',       ru: 'Футболки',         color: '#FF6F61', kind: 'tshirt' },
  { slug: 'svitshotlar', uz: 'Svitshot va xudi',  ru: 'Свитшоты и худи',  color: '#4FB6F2', kind: 'hoodie' },
  { slug: 'kostyumlar',  uz: 'Kostyumlar',        ru: 'Костюмы',          color: '#00B3A4', kind: 'set' },
  { slug: 'shimlar',     uz: 'Shim va shortilar', ru: 'Брюки и шорты',    color: '#8BC34A', kind: 'pants' },
  { slug: 'koylaklar',   uz: 'Ko‘ylaklar',        ru: 'Платья',           color: '#FF6F61', kind: 'dress' },
  { slug: 'pijamalar',   uz: 'Pijamalar',         ru: 'Пижамы',           color: '#4FB6F2', kind: 'pajama' },
  { slug: 'ustki-kiyim', uz: 'Ustki kiyim',       ru: 'Верхняя одежда',   color: '#00B3A4', kind: 'jacket' },
  { slug: 'aksessuarlar', uz: 'Aksessuarlar',     ru: 'Аксессуары',       color: '#8BC34A', kind: 'cap' },
];

const PRODUCTS = [
  {
    slug: 'bodi-quyoshcha', category: 'chaqaloqlar', kind: 'bodysuit', gender: 'unisex',
    uz: 'Bodi «Quyoshcha»', ru: 'Боди «Солнышко»',
    price: 69000, isNew: true, material: 'interlok',
    colors: ['sunny', 'cream'], sizes: sizes('56', '86'),
    descUz: 'Yelkadagi kengaytirilgan yoqa va pastki qismdagi tugmachalar kiyintirishni osonlashtiradi. Choklar tashqi tomonda — chaqaloq terisini ishqalamaydi.',
    descRu: 'Широкий ворот-запах и кнопки снизу — переодевать легко и быстро. Швы наружу, чтобы не натирать нежную кожу малыша.',
  },
  {
    slug: 'bodi-jayron-3', category: 'chaqaloqlar', kind: 'bodysuit', gender: 'unisex',
    uz: 'Bodi to‘plami, 3 dona', ru: 'Набор боди, 3 шт.',
    price: 149000, oldPrice: 179000, isHit: true, material: 'interlok',
    colors: ['sky', 'white'], sizes: sizes('56', '80'),
    descUz: 'Har kungi uchta bodi: bir xil rangli, jayroncha naqshli va chiziqli. Tug‘ruqxonaga va sovg‘aga ajoyib tanlov.',
    descRu: 'Три боди на каждый день: однотонное, с джейранчиком Jayron и в полоску. Отличный выбор на выписку и в подарок.',
  },
  {
    slug: 'slip-yulduz', category: 'chaqaloqlar', kind: 'romper', gender: 'unisex',
    uz: 'Kombinezon «Yulduzcha»', ru: 'Слип «Звёздочка»',
    price: 119000, material: 'interlok',
    colors: ['sky', 'pink'], sizes: sizes('56', '86'),
    descUz: 'Old tomondan butun uzunligi bo‘ylab tugmachali kombinezon. Oyoqchalari yopiq — tunda ham iliq.',
    descRu: 'Слип на кнопках по всей длине. Закрытые ножки — тепло и уютно даже ночью.',
  },
  {
    slug: 'futbolka-jayron', category: 'futbolkalar', kind: 'tshirt', gender: 'unisex',
    uz: 'Futbolka «Jayron»', ru: 'Футболка «Jayron»',
    price: 89000, isHit: true, material: 'penye',
    colors: ['white', 'sunny', 'sky', 'coral'], sizes: sizes('92', '140'),
    descUz: 'Ko‘krakda kashta tikilgan jayroncha — brendimiz ramzi. Ko‘p yuvilgandan keyin ham shakli va rangi saqlanadi.',
    descRu: 'Вышитый джейранчик Jayron на груди — символ нашего бренда. Сохраняет форму и цвет после многих стирок.',
  },
  {
    slug: 'futbolka-kamalak', category: 'futbolkalar', kind: 'tshirt', gender: 'girl',
    uz: 'Futbolka «Kamalak»', ru: 'Футболка «Радуга»',
    price: 95000, isNew: true, material: 'penye',
    colors: ['pink', 'cream'], sizes: sizes('92', '128'),
    descUz: 'Kamalak rasmli yengil futbolka — yozgi sayrlar va bog‘cha uchun.',
    descRu: 'Лёгкая футболка с радугой — для летних прогулок и садика.',
  },
  {
    slug: 'svitshot-osmon', category: 'svitshotlar', kind: 'sweatshirt', gender: 'unisex',
    uz: 'Svitshot «Osmon»', ru: 'Свитшот «Небо»',
    price: 189000, isHit: true, material: 'futer',
    colors: ['sky', 'cream', 'melange'], sizes: sizes('92', '140'),
    descUz: 'Ichki tomoni yumshoq tukli iliq svitshot. Yeng uchlari va pastki qismi elastik manjetli.',
    descRu: 'Тёплый свитшот с мягким начёсом внутри. Эластичные манжеты на рукавах и по низу.',
  },
  {
    slug: 'xudi-barg', category: 'svitshotlar', kind: 'hoodie', gender: 'boy',
    uz: 'Xudi «Barg»', ru: 'Худи «Листик»',
    price: 229000, oldPrice: 259000, material: 'futer',
    colors: ['leaf', 'navy'], sizes: sizes('98', '140'),
    descUz: 'Kapyushonli va kenguru cho‘ntakli xudi. Kapyushon bog‘ichsiz — bolalar uchun xavfsiz.',
    descRu: 'Худи с капюшоном и карманом-кенгуру. Капюшон без шнурков — безопасно для детей.',
  },
  {
    slug: 'kostyum-sarguzasht', category: 'kostyumlar', kind: 'set', gender: 'unisex',
    uz: 'Sport kostyumi «Sarguzasht»', ru: 'Спортивный костюм «Приключение»',
    price: 349000, isHit: true, isNew: true, material: 'futer',
    colors: ['sky', 'coral', 'melange'], sizes: sizes('92', '134'),
    descUz: 'Svitshot va jogger shimdan iborat kostyum. Bog‘cha, sayr va o‘yinlar uchun — harakatni cheklamaydi.',
    descRu: 'Костюм из свитшота и джоггеров. Для садика, прогулок и игр — не сковывает движений.',
  },
  {
    slug: 'shim-jogger', category: 'shimlar', kind: 'pants', gender: 'unisex',
    uz: 'Jogger shim', ru: 'Брюки-джоггеры',
    price: 139000, material: 'futer2',
    colors: ['melange', 'navy', 'sky'], sizes: sizes('92', '140'),
    descUz: 'Belida keng rezina, pastida manjetlar. Tizzalari mustahkamlangan — faol bolalar uchun.',
    descRu: 'Широкая резинка на поясе и манжеты внизу. Усиленные колени — для самых активных.',
  },
  {
    slug: 'shim-jinsi', category: 'shimlar', kind: 'pants', gender: 'boy',
    uz: 'Yumshoq jinsi shim', ru: 'Мягкие джинсы',
    price: 169000, material: 'denim',
    colors: ['denim'], sizes: sizes('98', '140'),
    descUz: 'Cho‘ziluvchan yumshoq jinsi, belida ichki rezina bilan sozlanadi.',
    descRu: 'Мягкий тянущийся деним, регулировка внутренней резинкой на поясе.',
  },
  {
    slug: 'shorti-yoz', category: 'shimlar', kind: 'shorts', gender: 'unisex',
    uz: 'Shorti «Yoz»', ru: 'Шорты «Лето»',
    price: 79000, material: 'penye',
    colors: ['leaf', 'sunny', 'sky'], sizes: sizes('92', '134'),
    descUz: 'Issiq kunlar uchun yengil paxta shorti, ikki yon cho‘ntakli.',
    descRu: 'Лёгкие хлопковые шорты для жарких дней, два боковых кармана.',
  },
  {
    slug: 'koylak-gulcha', category: 'koylaklar', kind: 'dress', gender: 'girl',
    uz: 'Ko‘ylak «Gulcha»', ru: 'Платье «Гульча»',
    price: 199000, isNew: true, material: 'penye',
    colors: ['coral', 'sunny'], sizes: sizes('92', '128'),
    descUz: 'Keng etakli, qisqa yengli bayramona ko‘ylak. Orqa tomonda yashirin tugma.',
    descRu: 'Нарядное платье с пышной юбкой и коротким рукавом. Потайная пуговица на спинке.',
  },
  {
    slug: 'koylak-muslin', category: 'koylaklar', kind: 'dress', gender: 'girl',
    uz: 'Muslin ko‘ylak', ru: 'Муслиновое платье',
    price: 219000, material: 'muslin',
    colors: ['cream', 'pink'], sizes: sizes('86', '122'),
    descUz: 'Havo o‘tkazuvchan ikki qavatli muslin — yozning eng issiq kunlarida ham qulay.',
    descRu: 'Дышащий двухслойный муслин — комфортно даже в самую жару.',
  },
  {
    slug: 'pijama-oy', category: 'pijamalar', kind: 'pajama', gender: 'unisex',
    uz: 'Pijama «Oydin tun»', ru: 'Пижама «Лунная ночь»',
    price: 159000, material: 'interlok',
    colors: ['navy', 'sky'], sizes: sizes('92', '140'),
    descUz: 'Uzun yengli pijama: yumshoq, cho‘ziluvchan va tanaga yoqimli.',
    descRu: 'Пижама с длинным рукавом: мягкая, тянущаяся и приятная к телу.',
  },
  {
    slug: 'kurtka-shamol', category: 'ustki-kiyim', kind: 'jacket', gender: 'unisex',
    uz: 'Yengil kurtka «Shamol»', ru: 'Ветровка «Ветерок»',
    price: 299000, oldPrice: 349000, material: 'jacket',
    colors: ['coral', 'teal'], sizes: sizes('98', '140'),
    descUz: 'Bahor va kuz uchun kapyushonli yengil kurtka. Yorug‘lik qaytaruvchi elementlar — kechqurun xavfsiz.',
    descRu: 'Лёгкая куртка с капюшоном на весну и осень. Светоотражающие элементы — безопасно вечером.',
  },
  {
    slug: 'kepka-jayron', category: 'aksessuarlar', kind: 'cap', gender: 'unisex',
    uz: 'Kepka «Jayron»', ru: 'Кепка «Jayron»',
    price: 59000, material: 'penye',
    colors: ['sunny', 'teal', 'coral'], sizes: ['48', '50', '52', '54'],
    descUz: 'Quyoshdan himoya qiluvchi paxta kepka, orqasida o‘lchamni sozlagich.',
    descRu: 'Хлопковая кепка для защиты от солнца, регулировка размера сзади.',
  },
];

// 12 областей, Республика Каракалпакстан и город Ташкент; цены доставки — в сумах
const REGIONS = [
  { code: 'tashkent_city',   uz: 'Toshkent shahri',               ru: 'город Ташкент',               courier: 25000, post: 20000, days: '1' },
  { code: 'tashkent_region', uz: 'Toshkent viloyati',             ru: 'Ташкентская область',         courier: 35000, post: 25000, days: '1-2' },
  { code: 'andijan',         uz: 'Andijon viloyati',              ru: 'Андижанская область',         courier: null,  post: 35000, days: '2-3' },
  { code: 'bukhara',         uz: 'Buxoro viloyati',               ru: 'Бухарская область',           courier: null,  post: 35000, days: '2-3' },
  { code: 'fergana',         uz: 'Farg‘ona viloyati',             ru: 'Ферганская область',          courier: null,  post: 35000, days: '2-3' },
  { code: 'jizzakh',         uz: 'Jizzax viloyati',               ru: 'Джизакская область',          courier: null,  post: 30000, days: '1-2' },
  { code: 'kashkadarya',     uz: 'Qashqadaryo viloyati',          ru: 'Кашкадарьинская область',     courier: null,  post: 35000, days: '2-3' },
  { code: 'khorezm',         uz: 'Xorazm viloyati',               ru: 'Хорезмская область',          courier: null,  post: 40000, days: '3-4' },
  { code: 'namangan',        uz: 'Namangan viloyati',             ru: 'Наманганская область',        courier: null,  post: 35000, days: '2-3' },
  { code: 'navoiy',          uz: 'Navoiy viloyati',               ru: 'Навоийская область',          courier: null,  post: 35000, days: '2-3' },
  { code: 'samarkand',       uz: 'Samarqand viloyati',            ru: 'Самаркандская область',       courier: null,  post: 30000, days: '1-2' },
  { code: 'surkhandarya',    uz: 'Surxondaryo viloyati',          ru: 'Сурхандарьинская область',    courier: null,  post: 40000, days: '3-4' },
  { code: 'syrdarya',        uz: 'Sirdaryo viloyati',             ru: 'Сырдарьинская область',       courier: null,  post: 30000, days: '1-2' },
  { code: 'karakalpakstan',  uz: 'Qoraqalpog‘iston Respublikasi', ru: 'Республика Каракалпакстан',   courier: null,  post: 40000, days: '3-5' },
];

const PROMO_CODES = [
  { code: 'SALOM10', kind: 'percent', value: 10, minTotal: 200000 },
  { code: 'JAYRON30', kind: 'fixed', value: 30000, minTotal: 300000 },
];

module.exports = { COLORS, CATEGORIES, PRODUCTS, MATERIALS, REGIONS, PROMO_CODES };
