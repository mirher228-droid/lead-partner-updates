// ==== Автоперенос номера дома из поля "Улица" в поле "Дом" ====
(function () {
  'use strict';

  if (window.__CRM_AUTO_HOUSE_INIT__) return;
  window.__CRM_AUTO_HOUSE_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[AUTO-HOUSE]', ...a);
  };

  let isProcessing = false;
  let pasteDetected = false;

  function findStreetField() {
    const selectors = [
      'input[name="Customer[address_street]"]',
      'input[name="CustomerRequest[address_street]"]',
      'input[name="Customer[street]"]',
      'input#customer-address_street',
      'input#customerrequest-address_street'
    ];
    for (const sel of selectors) {
      const f = document.querySelector(sel);
      if (f) return f;
    }
    return null;
  }

  function findHouseField() {
    const selectors = [
      'input[name="Customer[address_building]"]',
      'input[name="CustomerRequest[address_building]"]',
      'input#customer-address_building',
      'input#customerrequest-address_building'
    ];
    for (const sel of selectors) {
      const f = document.querySelector(sel);
      if (f) return f;
    }
    return null;
  }

  function extractHouseNumber(text) {
    if (!text) return { street: '', house: '' };
    text = String(text).trim();

    const patterns = [
      /^(.*?)[,\s]+(?:д\.?\s*)?(\d+[а-яА-Я]?(?:[\/\-]\d+[а-яА-Я]?)?(?:\s*к\.?\s*\d+)?)$/i,
      /^(.*?)[,\s]+(\d+)$/
    ];

    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m && m[1] && m[2]) {
        const street = m[1].trim().replace(/[,\s]+$/, '');
        const house = m[2].trim();
        if (street && house) return { street, house };
      }
    }
    return { street: text, house: '' };
  }

  function transferHouseNumber() {
    const streetField = findStreetField();
    const houseField = findHouseField();
    if (!streetField || !houseField || isProcessing) return false;

    const value = streetField.value.trim();
    if (!value) return false;
    if (houseField.value.trim()) return false;

    isProcessing = true;
    try {
      const { street, house } = extractHouseNumber(value);
      if (house && house !== '' && street !== value) {
        streetField.value = street;
        houseField.value = house;
        ['input', 'change'].forEach(ev => {
          streetField.dispatchEvent(new Event(ev, { bubbles: true }));
          houseField.dispatchEvent(new Event(ev, { bubbles: true }));
        });
        log(`Перенос: "${value}" → улица="${street}", дом="${house}"`);
        return true;
      }
      return false;
    } finally {
      setTimeout(() => { isProcessing = false; }, 50);
    }
  }

  function init() {
    function monitorFields() {
      const streetField = findStreetField();
      const houseField = findHouseField();
      if (!streetField || !houseField) return false;
      if (streetField.dataset.autoHouseAttached === 'true') return true;
      streetField.dataset.autoHouseAttached = 'true';

      streetField.addEventListener('paste', () => {
        pasteDetected = true;
        setTimeout(() => {
          if (pasteDetected) { transferHouseNumber(); pasteDetected = false; }
        }, 10);
      });

      let inputTimer;
      streetField.addEventListener('input', () => {
        clearTimeout(inputTimer);
        if (!pasteDetected) inputTimer = setTimeout(transferHouseNumber, 600);
      });

      streetField.addEventListener('blur', () => { if (!pasteDetected) transferHouseNumber(); });

      streetField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          clearTimeout(inputTimer);
          transferHouseNumber();
        }
      });

      log('Поля найдены, слушатели навешены');
      return true;
    }

    if (!monitorFields()) {
      setTimeout(monitorFields, 500);
      const observer = new MutationObserver(() => monitorFields());
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();