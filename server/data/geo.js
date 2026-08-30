'use strict';
/** Регионы мира по числу проектных менеджеров офиса (9 регионов) и справочник стран. */

const REGIONS = [
  { code: 'europe',        name_ru: 'Европа',                       name_uz: 'Yevropa',                       name_en: 'Europe',                  sort: 1 },
  { code: 'cis',           name_ru: 'СНГ и Центральная Азия',       name_uz: 'MDH va Markaziy Osiyo',         name_en: 'CIS & Central Asia',      sort: 2 },
  { code: 'middle_east',   name_ru: 'Ближний Восток',               name_uz: 'Yaqin Sharq',                   name_en: 'Middle East',             sort: 3 },
  { code: 'south_asia',    name_ru: 'Южная Азия',                   name_uz: 'Janubiy Osiyo',                 name_en: 'South Asia',              sort: 4 },
  { code: 'east_asia',     name_ru: 'Восточная Азия',               name_uz: 'Sharqiy Osiyo',                 name_en: 'East Asia',               sort: 5 },
  { code: 'asia_pacific',  name_ru: 'ЮВА и Океания',                name_uz: 'JSHO va Okeaniya',              name_en: 'Asia-Pacific',            sort: 6 },
  { code: 'north_america', name_ru: 'Северная Америка',             name_uz: 'Shimoliy Amerika',              name_en: 'North America',           sort: 7 },
  { code: 'latin_america', name_ru: 'Латинская Америка',            name_uz: 'Lotin Amerikasi',               name_en: 'Latin America',           sort: 8 },
  { code: 'africa',        name_ru: 'Африка',                       name_uz: 'Afrika',                        name_en: 'Africa',                  sort: 9 },
];

// [ISO2, Русское название, Uzbek, English]
const COUNTRIES = {
  europe: [
    ['DE', 'Германия', 'Germaniya', 'Germany'], ['FR', 'Франция', 'Fransiya', 'France'],
    ['IT', 'Италия', 'Italiya', 'Italy'], ['ES', 'Испания', 'Ispaniya', 'Spain'],
    ['PL', 'Польша', 'Polsha', 'Poland'], ['NL', 'Нидерланды', 'Niderlandiya', 'Netherlands'],
    ['BE', 'Бельгия', 'Belgiya', 'Belgium'], ['AT', 'Австрия', 'Avstriya', 'Austria'],
    ['CZ', 'Чехия', 'Chexiya', 'Czechia'], ['SK', 'Словакия', 'Slovakiya', 'Slovakia'],
    ['HU', 'Венгрия', 'Vengriya', 'Hungary'], ['RO', 'Румыния', 'Ruminiya', 'Romania'],
    ['BG', 'Болгария', 'Bolgariya', 'Bulgaria'], ['GR', 'Греция', 'Gretsiya', 'Greece'],
    ['PT', 'Португалия', 'Portugaliya', 'Portugal'], ['SE', 'Швеция', 'Shvetsiya', 'Sweden'],
    ['NO', 'Норвегия', 'Norvegiya', 'Norway'], ['FI', 'Финляндия', 'Finlyandiya', 'Finland'],
    ['DK', 'Дания', 'Daniya', 'Denmark'], ['IE', 'Ирландия', 'Irlandiya', 'Ireland'],
    ['CH', 'Швейцария', 'Shveytsariya', 'Switzerland'], ['GB', 'Великобритания', 'Buyuk Britaniya', 'United Kingdom'],
    ['LT', 'Литва', 'Litva', 'Lithuania'], ['LV', 'Латвия', 'Latviya', 'Latvia'],
    ['EE', 'Эстония', 'Estoniya', 'Estonia'], ['SI', 'Словения', 'Sloveniya', 'Slovenia'],
    ['HR', 'Хорватия', 'Xorvatiya', 'Croatia'], ['RS', 'Сербия', 'Serbiya', 'Serbia'],
    ['TR', 'Турция', 'Turkiya', 'Turkiye'],
  ],
  cis: [
    ['RU', 'Россия', 'Rossiya', 'Russia'], ['KZ', 'Казахстан', 'Qozogiston', 'Kazakhstan'],
    ['KG', 'Кыргызстан', 'Qirgiziston', 'Kyrgyzstan'], ['TJ', 'Таджикистан', 'Tojikiston', 'Tajikistan'],
    ['TM', 'Туркменистан', 'Turkmaniston', 'Turkmenistan'], ['AZ', 'Азербайджан', 'Ozarbayjon', 'Azerbaijan'],
    ['AM', 'Армения', 'Armaniston', 'Armenia'], ['GE', 'Грузия', 'Gruziya', 'Georgia'],
    ['BY', 'Беларусь', 'Belarus', 'Belarus'], ['MD', 'Молдова', 'Moldova', 'Moldova'],
    ['UA', 'Украина', 'Ukraina', 'Ukraine'], ['UZ', 'Узбекистан', 'Ozbekiston', 'Uzbekistan'],
  ],
  middle_east: [
    ['AE', 'ОАЭ', 'BAA', 'United Arab Emirates'], ['SA', 'Саудовская Аравия', 'Saudiya Arabistoni', 'Saudi Arabia'],
    ['QA', 'Катар', 'Qatar', 'Qatar'], ['KW', 'Кувейт', 'Quvayt', 'Kuwait'],
    ['OM', 'Оман', 'Ummon', 'Oman'], ['BH', 'Бахрейн', 'Bahrayn', 'Bahrain'],
    ['IL', 'Израиль', 'Isroil', 'Israel'], ['JO', 'Иордания', 'Iordaniya', 'Jordan'],
    ['LB', 'Ливан', 'Livan', 'Lebanon'], ['IQ', 'Ирак', 'Iroq', 'Iraq'],
    ['IR', 'Иран', 'Eron', 'Iran'], ['EG', 'Египет', 'Misr', 'Egypt'],
  ],
  south_asia: [
    ['IN', 'Индия', 'Hindiston', 'India'], ['PK', 'Пакистан', 'Pokiston', 'Pakistan'],
    ['BD', 'Бангладеш', 'Bangladesh', 'Bangladesh'], ['LK', 'Шри-Ланка', 'Shri-Lanka', 'Sri Lanka'],
    ['NP', 'Непал', 'Nepal', 'Nepal'], ['AF', 'Афганистан', 'Afgoniston', 'Afghanistan'],
    ['MV', 'Мальдивы', 'Maldiv', 'Maldives'],
  ],
  east_asia: [
    ['CN', 'Китай', 'Xitoy', 'China'], ['JP', 'Япония', 'Yaponiya', 'Japan'],
    ['KR', 'Республика Корея', 'Koreya Respublikasi', 'South Korea'], ['MN', 'Монголия', 'Mongoliya', 'Mongolia'],
    ['HK', 'Гонконг', 'Gonkong', 'Hong Kong'], ['TW', 'Тайвань', 'Tayvan', 'Taiwan'],
  ],
  asia_pacific: [
    ['VN', 'Вьетнам', 'Vyetnam', 'Vietnam'], ['TH', 'Таиланд', 'Tailand', 'Thailand'],
    ['ID', 'Индонезия', 'Indoneziya', 'Indonesia'], ['MY', 'Малайзия', 'Malayziya', 'Malaysia'],
    ['SG', 'Сингапур', 'Singapur', 'Singapore'], ['PH', 'Филиппины', 'Filippin', 'Philippines'],
    ['AU', 'Австралия', 'Avstraliya', 'Australia'], ['NZ', 'Новая Зеландия', 'Yangi Zelandiya', 'New Zealand'],
    ['MM', 'Мьянма', 'Myanma', 'Myanmar'], ['KH', 'Камбоджа', 'Kambodja', 'Cambodia'],
  ],
  north_america: [
    ['US', 'США', 'AQSh', 'United States'], ['CA', 'Канада', 'Kanada', 'Canada'],
    ['MX', 'Мексика', 'Meksika', 'Mexico'],
  ],
  latin_america: [
    ['BR', 'Бразилия', 'Braziliya', 'Brazil'], ['AR', 'Аргентина', 'Argentina', 'Argentina'],
    ['CL', 'Чили', 'Chili', 'Chile'], ['CO', 'Колумбия', 'Kolumbiya', 'Colombia'],
    ['PE', 'Перу', 'Peru', 'Peru'], ['UY', 'Уругвай', 'Urugvay', 'Uruguay'],
    ['EC', 'Эквадор', 'Ekvador', 'Ecuador'], ['CR', 'Коста-Рика', 'Kosta-Rika', 'Costa Rica'],
  ],
  africa: [
    ['MA', 'Марокко', 'Marokash', 'Morocco'], ['TN', 'Тунис', 'Tunis', 'Tunisia'],
    ['DZ', 'Алжир', 'Jazoir', 'Algeria'], ['ZA', 'ЮАР', 'JAR', 'South Africa'],
    ['NG', 'Нигерия', 'Nigeriya', 'Nigeria'], ['KE', 'Кения', 'Keniya', 'Kenya'],
    ['ET', 'Эфиопия', 'Efiopiya', 'Ethiopia'], ['GH', 'Гана', 'Gana', 'Ghana'],
    ['TZ', 'Танзания', 'Tanzaniya', 'Tanzania'], ['UG', 'Уганда', 'Uganda', 'Uganda'],
    ['SN', 'Сенегал', 'Senegal', 'Senegal'], ['CI', 'Кот-д’Ивуар', 'Kot-d Ivuar', 'Cote d Ivoire'],
  ],
};

module.exports = { REGIONS, COUNTRIES };
