// ==== Автовыбор вида работ по первому слову комментария ====
(function () {
  'use strict';

  if (window.__CRM_AUTO_TYPE_INIT__) return;
  window.__CRM_AUTO_TYPE_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[AUTO-TYPE]', ...a);
  };

  const FIELD_SELECTORS = {
    comment: 'textarea[name="CustomerRequest[comments]"]',
    applianceType: 'select[name="CustomerRequest[appliance_type_id]"]'
  };

  const MAP = {
    'пк': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'ноут': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'ноутбук': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'моноблок': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'компьютер': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'мак': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'аймак': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'mac': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'imac': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'macbook': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'макбук': 'Компьютер/Ноутбук/Моноблок/Отдельные комплектующие от ПК',
    'пс3': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'пс4': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'пс5': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'ps3': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'ps4': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'ps5': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'xbox': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'иксбокс': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'ps': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'пс': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'nintendo': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'нинтендо': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'стимдек': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'steamdeck': 'PlayStation/XBOX/Nintendo switch/Steam deck',
    'восстановление': 'Восстановление информации с любого носителя устройства',
    'восстановить': 'Восстановление информации с любого носителя устройства',
    'вд': 'Восстановление информации с любого носителя устройства',
    'тв': 'ЖК ТВ/Плазменные ТВ/Кинескопные ТВ',
    'телевизор': 'ЖК ТВ/Плазменные ТВ/Кинескопные ТВ',
    'монитор': 'Мониторы/Видеокарты (Отдельно от ПК)',
    'видеокарта': 'Мониторы/Видеокарты (Отдельно от ПК)',
    'обжать': 'Обжим интернет кабеля',
    'обжим': 'Обжим интернет кабеля',
    'принтер': 'Принтер/МФУ',
    'мфу': 'Принтер/МФУ',
    'роутер': 'Роутер',
    'тлф': 'Смартфоны/Планшеты',
    'айфон': 'Смартфоны/Планшеты',
    'iphone': 'Смартфоны/Планшеты',
    'айпад': 'Смартфоны/Планшеты',
    'ipad': 'Смартфоны/Планшеты',
    'телефон': 'Смартфоны/Планшеты',
    'планшет': 'Смартфоны/Планшеты',
    '-': 'Прочая'
  };

  function getFirstWord(text) {
    if (!text) return '';
    const words = String(text).trim().split(/\s+/);
    return words[0] ? words[0].toLowerCase() : '';
  }

  function findAndSetType(targetType) {
    const field = document.querySelector(FIELD_SELECTORS.applianceType);
    if (!field) return false;

    for (let i = 0; i < field.options.length; i++) {
      const opt = field.options[i];
      const text = opt.text.trim();
      if (text === targetType || text.toLowerCase().includes(targetType.toLowerCase())) {
        if (field.value !== opt.value) {
          field.value = opt.value;
          field.dispatchEvent(new Event('change', { bubbles: true }));
          log('Установлен тип:', text);
        }
        return true;
      }
    }
    return false;
  }

  function processComment() {
    const field = document.querySelector(FIELD_SELECTORS.comment);
    if (!field) return;
    const firstWord = getFirstWord(field.value);
    if (!firstWord) return;
    const target = MAP[firstWord];
    if (target) findAndSetType(target);
  }

  function init() {
    const check = setInterval(() => {
      const comment = document.querySelector(FIELD_SELECTORS.comment);
      const type = document.querySelector(FIELD_SELECTORS.applianceType);
      if (comment && type) {
        clearInterval(check);
        let timer;
        comment.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(processComment, 300);
        });
        comment.addEventListener('click', processComment);
        comment.addEventListener('focus', processComment);
        log('Готов к работе');
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();