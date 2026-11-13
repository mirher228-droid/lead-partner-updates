/* Price and territory helpers. Only confirmed CRM/reference prices may be shown. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeadChatPriceUI = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const txt = value => String(value == null ? '' : value).trim();
  const key = value => txt(value).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[\s\-–—]+/g, ' ').trim();
  const territoryKey=value=>key(value).replace(/([\p{L}])(\d)/gu,'$1 $2').replace(/(\d)([\p{L}])/gu,'$1 $2').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/^(?:спб|санкт петербург) (\d+)$/u,'санкт петербург $1');
  function territoryCityId(territory, cities) {
    const wanted = territoryKey(territory);
    if (!wanted) return '';
    const matches = (Array.isArray(cities) ? cities : []).filter(city => territoryKey(city.label || city.text || city.name) === wanted);
    return matches.length === 1 ? txt(matches[0].id ?? matches[0].value) : '';
  }
  function isMoscowCity(value){return /(?:^|[^\p{L}\p{N}])(?:москва|мск)(?=$|[^\p{L}\p{N}])/iu.test(txt(value));}
  function priceCommentLine(service, price, unit) {
    const title = txt(service).replace(/[\r\n]+/g, ' '), cost = txt(price).replace(/[\r\n]+/g, ' ');
    const measure = txt(unit).replace(/[\r\n]+/g, ' ');
    return title && cost ? `${title} — ${cost}${measure ? ' / ' + measure : ''}` : '';
  }
  function appendPriceComment(existing, line) {
    const before = txt(existing).replace(/\r\n?/g, '\n'), next = txt(line);
    if (!next) return before;
    if (before.split('\n').some(part => part.trim() === next)) return before;
    return before ? `${before}\n${next}` : next;
  }
  // Fixed КП prices supplied by the user on 26.10.2026; identical in all cities.
  const KP_PRICES={
  "printer": [
    ["Подключение/настройка", "1 000 ₽", "Программная настройка принтера с нуля или корректировка работы уже подключённого принтера."],
    ["Обслуживание/профилактика", "4 000 ₽", "Полная очистка механических узлов, техническое обслуживание."],
    ["Чистка печатающей головки", "1 500 ₽", "Чистка дюз печатающей головки при возникновении проблем с цветопередачей при печати."],
    ["Исправление ошибки/сброс счётчика памперса", "2 000 ₽", "Отмывка, очистка, сброс ошибки памперса."]
  ],
  "mobile": [
    ["Установка приложений", "1 000 ₽", "Любые приложения в свободном доступе AppStore/PlayMarket."],
    ["Настройка", "2 500 ₽", "Настройка базовых функций, сброс настроек, синхронизация учётных записей, создание аккаунтов iCloud/Google."],
    ["Перенос данных на другой носитель", "1 500 ₽", "Перенос данных с одного смартфона/планшета на другой смартфон/планшет."]
  ],
  "pc": [
    [
      "Установка ОС Windows (любая версия)",
      "2 000 ₽"
    ],
    [
      "Установка пакета Office (любая версия)",
      "2 000 ₽"
    ],
    [
      "Чистка и/или замена термопасты",
      "2 000 ₽",
      "Чистка от пыли, снятие окислов; замена термопасты на новую."
    ],
    [
      "Установка пакета драйверов",
      "3 000 ₽",
      "Установка всех драйверов после переустановки ОС или недостающих драйверов."
    ],
    [
      "Установка антивируса",
      "1 000 ₽",
      "Dr.Web, Kaspersky, ESET NOD и другие."
    ],
    [
      "Сборка ПК",
      "3 000 ₽",
      "Полная сборка или замена нескольких комплектующих."
    ],
    [
      "Замена одного комплектующего",
      "1 000 ₽",
      "Замена одного конкретного комплектующего, например SSD."
    ],
    [
      "Установка программ",
      "1 000 ₽",
      "Игры, браузеры, PDF, ISO, WinRAR, Zip.",
      "шт."
    ],
    [
      "Перепрошивка BIOS",
      "3 500 ₽",
      "Через программатор или флешку."
    ],
    [
      "Перенос данных на другой носитель (до 10 ГБ)",
      "1 500 ₽",
      "Со старого HDD/SSD на новый HDD/SSD."
    ]
  ],
  "tv": [
    [
      "Настройка каналов",
      "1 500 ₽",
      "Кабельная или комнатная антенна."
    ],
    [
      "Прошивка ПО телевизора",
      "2 500 ₽"
    ],
    [
      "Настройка ТВ-приставки",
      "1 500 ₽",
      "Также для ресиверов и ТВ-тюнеров."
    ]
  ]
};
  function kpRowsForWork(work) {
    const label=key(work),group=/принтер|мфу|многофункциональн/iu.test(label)?'printer':/смартфон|планшет|телефон/iu.test(label)?'mobile':/телевиз|кинескоп|плазмен|(?:^|[^\p{L}\p{N}])(?:жк\s*)?тв(?=$|[^\p{L}\p{N}])/iu.test(label)?'tv':/компьютер|ноутбук|моноблок|(?:^|[^\p{L}\p{N}])пк(?=$|[^\p{L}\p{N}])/iu.test(label)?'pc':'';
    const titles={pc:'ПК / Ноутбуки / Моноблоки',tv:'Телевизоры',printer:'Принтеры',mobile:'Смартфоны / Планшеты'};
    return group?KP_PRICES[group].map(([service,amount,note='',unit=''])=>({service,amount,note,unit,serviceGroup:titles[group]})):[];
  }
  return Object.freeze({kpRowsForWork, territoryCityId, priceCommentLine, appendPriceComment, isMoscowCity});
});
