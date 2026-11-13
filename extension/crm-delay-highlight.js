// ==== Индикатор "Было опоздание" ====
(function () {
  'use strict';

  if (window.__CRM_DELAY_HIGHLIGHT_INIT__) return;
  window.__CRM_DELAY_HIGHLIGHT_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[DELAY-HL]', ...a);
  };

  const STYLE_ID = 'crm-delay-hl-style';
  const KEYWORDS = [
    'опозд', 'опазд', 'опоз', 'опаз', 'позд', 'позж', 'опзд', 'опз',
    'задерж', 'здерж', 'здрж', 'пзд', 'нввр', 'delay', 'late', 'l8',
    'пробк', 'затор', 'прбк', 'опаздание', 'опоздание'
  ];
  const PATTERNS = [
    /опозд(ал|ала|али|ание|ания|ает|ают|ывает|ывают|ан)?/giu,
    /опазд(ыва|ал|ала|али|ание|ания|ает|ают)?/giu,
    /опоз(дал|дала|дали|дание|дания)?/giu,
    /задерж(ка|ки|ку|кой|ал|ала|али|ивает|ивают|ан)?/giu,
    /позд(но|нее|ний|няя|нее|же|няк)?/giu,
    /delay(ed)?/giu,
    /late/giu,
    /later/giu,
    /пробк(а|и|е|ой)?/giu,
    /затор(ы|ов)?/giu
  ];

  let lastText = '';
  let alertElement = null;
  let removeTimer = null;
  let isDelayDetected = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .crm-indicator-delay {
        display: inline-flex !important;
        align-items: center !important;
        padding: 4px 16px !important;
        height: 34px !important;
        border-radius: 20px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        border: 1px solid #f1c40f !important;
        margin-left: 15px !important;
        cursor: help !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
        background: linear-gradient(135deg, #f1c40f, #f39c12) !important;
        color: #2c3e50 !important;
        animation: pulse-yellow 2s infinite !important;
        vertical-align: middle !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }

      @keyframes pulse-yellow {
        0% { box-shadow: 0 0 0 0 rgba(241, 196, 15, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(241, 196, 15, 0); }
        100% { box-shadow: 0 0 0 0 rgba(241, 196, 15, 0); }
      }

      .d-flex.justify-content-between.align-items-center:has(> label[for="customerrequest-comments_service"]) {
        margin-bottom: 8px !important;
      }
    `;
    document.head.appendChild(style);
  }

  function checkText(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    if (KEYWORDS.some((k) => lower.includes(k))) return true;
    return PATTERNS.some((p) => p.test(text));
  }

  function createAlert() {
    const el = document.createElement('span');
    el.className = 'crm-indicator crm-indicator-delay';
    el.innerHTML = '⏰ Было опоздание';
    el.title = 'В служебном комментарии есть упоминание об опоздании';
    return el;
  }

  function checkForDelay() {
    const field = document.getElementById('customerrequest-comments_service');
    if (!field) return;

    const text = field.value || '';
    if (text === lastText) return;
    lastText = text;

    const hasDelay = checkText(text);
    const container = document.querySelector('.d-flex.justify-content-between.align-items-center');
    if (!container) return;

    const label = container.querySelector('label[for="customerrequest-comments_service"]');
    if (!label) return;

    if (hasDelay === isDelayDetected) return;

    if (hasDelay) {
      if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }
      if (alertElement && alertElement.parentNode) { isDelayDetected = true; return; }

      const existing = container.querySelector('.crm-indicator-delay');
      if (existing) existing.remove();

      alertElement = createAlert();
      label.parentNode.insertBefore(alertElement, label.nextSibling);
      isDelayDetected = true;
      log('Индикатор добавлен');
    } else {
      if (alertElement && alertElement.parentNode) {
        if (removeTimer) clearTimeout(removeTimer);
        removeTimer = setTimeout(() => {
          if (alertElement && alertElement.parentNode) {
            alertElement.remove();
            alertElement = null;
            log('Индикатор убран');
          }
          isDelayDetected = false;
          removeTimer = null;
        }, 2000);
      } else {
        isDelayDetected = false;
      }
    }
  }

  function init() {
    ensureStyles();
    const field = document.getElementById('customerrequest-comments_service');
    if (field && !field.dataset.delayHlAttached) {
      field.dataset.delayHlAttached = 'true';
      field.addEventListener('input', () => setTimeout(checkForDelay, 150));
      field.addEventListener('change', () => setTimeout(checkForDelay, 150));
      field.addEventListener('paste', () => setTimeout(checkForDelay, 200));
      field.addEventListener('blur', checkForDelay);
    }
    setTimeout(checkForDelay, 500);

    const observer = new MutationObserver(() => {
      const f = document.getElementById('customerrequest-comments_service');
      if (f && !f.dataset.delayHlAttached) {
        f.dataset.delayHlAttached = 'true';
        f.addEventListener('input', () => setTimeout(checkForDelay, 150));
        f.addEventListener('change', () => setTimeout(checkForDelay, 150));
        f.addEventListener('paste', () => setTimeout(checkForDelay, 200));
        f.addEventListener('blur', checkForDelay);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();