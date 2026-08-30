'use strict';
/**
 * Административно-территориальные единицы Республики Узбекистан:
 * 12 областей, Республика Каракалпакстан и город Ташкент.
 * Используются как места реализации инвестиционных проектов (поле P-17).
 */
const UZ_REGIONS = [
  { code: 'karakalpakstan', name_ru: 'Республика Каракалпакстан', name_uz: 'Qoraqalpogiston Respublikasi', name_en: 'Republic of Karakalpakstan' },
  { code: 'andijan',        name_ru: 'Андижанская область',       name_uz: 'Andijon viloyati',    name_en: 'Andijan Region' },
  { code: 'bukhara',        name_ru: 'Бухарская область',         name_uz: 'Buxoro viloyati',     name_en: 'Bukhara Region' },
  { code: 'jizzakh',        name_ru: 'Джизакская область',        name_uz: 'Jizzax viloyati',     name_en: 'Jizzakh Region' },
  { code: 'kashkadarya',    name_ru: 'Кашкадарьинская область',   name_uz: 'Qashqadaryo viloyati', name_en: 'Kashkadarya Region' },
  { code: 'navoiy',         name_ru: 'Навоийская область',        name_uz: 'Navoiy viloyati',     name_en: 'Navoiy Region' },
  { code: 'namangan',       name_ru: 'Наманганская область',      name_uz: 'Namangan viloyati',   name_en: 'Namangan Region' },
  { code: 'samarkand',      name_ru: 'Самаркандская область',     name_uz: 'Samarqand viloyati',  name_en: 'Samarkand Region' },
  { code: 'surkhandarya',   name_ru: 'Сурхандарьинская область',  name_uz: 'Surxondaryo viloyati', name_en: 'Surkhandarya Region' },
  { code: 'syrdarya',       name_ru: 'Сырдарьинская область',     name_uz: 'Sirdaryo viloyati',   name_en: 'Syrdarya Region' },
  { code: 'tashkent_region', name_ru: 'Ташкентская область',      name_uz: 'Toshkent viloyati',   name_en: 'Tashkent Region' },
  { code: 'fergana',        name_ru: 'Ферганская область',        name_uz: 'Fargona viloyati',    name_en: 'Fergana Region' },
  { code: 'khorezm',        name_ru: 'Хорезмская область',        name_uz: 'Xorazm viloyati',     name_en: 'Khorezm Region' },
  { code: 'tashkent_city',  name_ru: 'город Ташкент',             name_uz: 'Toshkent shahri',     name_en: 'Tashkent City' },
];

module.exports = { UZ_REGIONS };
