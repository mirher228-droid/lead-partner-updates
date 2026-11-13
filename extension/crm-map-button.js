// ==== Кнопка "Карта" на заявке + переключатель конструктора КП/МНЧ/БТ на Яндекс.Картах ====
(function () {
  'use strict';

  if (window.__CRM_MAP_BUTTON_INIT__) return;
  window.__CRM_MAP_BUTTON_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[MAP]', ...a);
  };

  const MAP_CONSTRUCTOR_ID_BY_SOURCE = {
    mnc: 'constructor:5334b1eac64665e4dbf0b1a57d801a0db433c7da380733a4932291434303d388',
    bt: 'constructor:1d14f05bb28add9e89923b4a5ed00d06247b78aa8bc0bed89ac0a934bc07403f',
    kp: 'constructor:3a441478bf388f1b547feea234423b58044ed891044d8420a95175a4f37d3d71'
  };
  const MAP_SOURCE_META = {
    kp: { key: 'kp', label: 'КП' },
    mnc: { key: 'mnc', label: 'МНЧ' },
    bt: { key: 'bt', label: 'БТ' }
  };
  const DEFAULT_MAP_SOURCE_KEY = 'kp';
  const MAP_SOURCE_QUERY_PARAM = 'crm_map_source';
  const MAP_ORIGIN_SOURCE_QUERY_PARAM = 'crm_map_origin';
  const SOURCE_KEY_BY_CONSTRUCTOR_ID = Object.entries(MAP_CONSTRUCTOR_ID_BY_SOURCE).reduce((acc, [k, id]) => {
    acc[id] = k;
    return acc;
  }, {});

  function normalizeSourceKey(key, fallback = DEFAULT_MAP_SOURCE_KEY) {
    const k = String(key || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MAP_CONSTRUCTOR_ID_BY_SOURCE, k)) return k;
    const f = String(fallback || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MAP_CONSTRUCTOR_ID_BY_SOURCE, f)) return f;
    return '';
  }

  function parseUrl(raw) {
    try { return new URL(raw, window.location.origin); } catch (e) { return null; }
  }

  function getSourceKeyFromUrl(raw) {
    const url = parseUrl(raw);
    if (!url) return '';
    const fromQuery = normalizeSourceKey(url.searchParams.get(MAP_SOURCE_QUERY_PARAM), '');
    if (fromQuery) return fromQuery;
    return SOURCE_KEY_BY_CONSTRUCTOR_ID[url.searchParams.get('um')] || '';
  }

  function getOriginSourceKeyFromUrl(raw) {
    const url = parseUrl(raw);
    if (!url) return '';
    const fromQuery = normalizeSourceKey(url.searchParams.get(MAP_ORIGIN_SOURCE_QUERY_PARAM), '');
    return fromQuery || getSourceKeyFromUrl(raw);
  }

  function applySourceToUrl(raw, sourceKey, originSourceKey) {
    const url = parseUrl(raw);
    if (!url) return String(raw || '');
    const s = normalizeSourceKey(sourceKey, DEFAULT_MAP_SOURCE_KEY);
    const o = normalizeSourceKey(originSourceKey, s);
    url.searchParams.set('um', MAP_CONSTRUCTOR_ID_BY_SOURCE[s]);
    url.searchParams.set('source', 'constructorLink');
    url.searchParams.set(MAP_SOURCE_QUERY_PARAM, s);
    url.searchParams.set(MAP_ORIGIN_SOURCE_QUERY_PARAM, o);
    return url.toString();
  }

  function getHostSourceKey() {
    const host = window.location.hostname;
    if (host.includes('mnc-lead-centre.ru')) return 'mnc';
    if (host.includes('bt-lead-centre.ru')) return 'bt';
    if (host.includes('kp-lead-centre.ru')) return 'kp';
    return DEFAULT_MAP_SOURCE_KEY;
  }

  // ==== Яндекс.Карты ====
  if (window.location.hostname.includes('yandex.ru') || window.location.hostname.includes('yandex.com')) {
    window.name = 'yandex_crm_map';

    function ensureMapSwitcherStyles() {
      if (document.getElementById('crm-map-switcher-style')) return;
      const style = document.createElement('style');
      style.id = 'crm-map-switcher-style';
      style.textContent = `
        #crm-map-switcher {
          position: fixed; top: 88px; right: 16px; z-index: 999999;
          width: min(320px, calc(100vw - 24px)); padding: 14px;
          border-radius: 18px;
          background: linear-gradient(145deg, rgba(255,255,255,0.98), rgba(242,247,251,0.96));
          border: 1px solid rgba(24,54,84,0.12);
          box-shadow: 0 18px 40px rgba(9,35,61,0.16);
          backdrop-filter: blur(14px);
          color: #183654;
          font-family: "Segoe UI", sans-serif;
        }
        #crm-map-switcher .cms-eyebrow {
          margin-bottom: 4px; font-size: 11px; font-weight: 700;
          letter-spacing: 0.08em; text-transform: uppercase; color: #64819b;
        }
        #crm-map-switcher .cms-title {
          margin-bottom: 8px; font-size: 18px; font-weight: 700; line-height: 1.2;
        }
        #crm-map-switcher .cms-status {
          margin-bottom: 10px; font-size: 13px; line-height: 1.4; color: #36526b;
        }
        #crm-map-switcher .cms-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
        #crm-map-switcher .cms-btn {
          min-width: 64px; padding: 8px 14px;
          border: 1px solid rgba(24,54,84,0.14); border-radius: 999px;
          background: rgba(255,255,255,0.86); color: #183654;
          font-size: 13px; font-weight: 700; cursor: pointer;
          transition: all 0.16s ease;
        }
        #crm-map-switcher .cms-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 18px rgba(9,35,61,0.12); }
        #crm-map-switcher .cms-btn.is-active {
          border-color: #183654; background: #183654; color: #fff;
          box-shadow: 0 12px 22px rgba(24,54,84,0.24);
        }
        #crm-map-switcher .cms-hint { margin-top: 10px; font-size: 12px; line-height: 1.4; color: #6b7f92; }
        @media (max-width: 900px) {
          #crm-map-switcher { top: auto; right: 12px; bottom: 16px; left: 12px; width: auto; }
        }
      `;
      document.head.appendChild(style);
    }

    function getSelectionState() {
      const req = normalizeSourceKey(getSourceKeyFromUrl(window.location.href), DEFAULT_MAP_SOURCE_KEY);
      const orig = normalizeSourceKey(getOriginSourceKeyFromUrl(window.location.href), req);
      return { requested: req, origin: orig, isAuto: req === orig };
    }

    function navigateToSource(sourceKey, originSourceKey) {
      const next = applySourceToUrl(window.location.href, sourceKey, originSourceKey);
      if (next === window.location.href) return;
      try { window.focus(); } catch (e) {}
      window.location.replace(next);
    }

    function renderSwitcher() {
      if (!document.body) return false;
      ensureMapSwitcherStyles();

      let c = document.getElementById('crm-map-switcher');
      if (!c) {
        c = document.createElement('div');
        c.id = 'crm-map-switcher';
        document.body.appendChild(c);
      }

      const state = getSelectionState();
      const meta = MAP_SOURCE_META[state.requested] || MAP_SOURCE_META[DEFAULT_MAP_SOURCE_KEY];
      const status = state.isAuto
        ? `Авто: ${meta.label} по текущей заявке`
        : `Выбрано вручную: ${meta.label}`;

      c.innerHTML = `
        <div class="cms-eyebrow">CRM × Яндекс Карты</div>
        <div class="cms-title">Конструктор базы</div>
        <div class="cms-status">${status}</div>
        <div class="cms-buttons">
          ${Object.values(MAP_SOURCE_META).map((m) => {
            const active = m.key === state.requested;
            return `<button type="button" class="cms-btn ${active ? 'is-active' : ''}" data-src="${m.key}">${m.label}</button>`;
          }).join('')}
        </div>
        <div class="cms-hint">Выберите базу, чтобы открыть карту с её конструктором.</div>
      `;

      c.querySelectorAll('.cms-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const next = b.dataset.src;
          const s = getSelectionState();
          const norm = normalizeSourceKey(next, '');
          if (!norm || s.requested === norm) return;
          navigateToSource(norm, s.origin);
        });
      });

      return true;
    }

    function initSwitcher() {
      let lastHref = window.location.href;
      const r = () => { if (!renderSwitcher()) requestAnimationFrame(r); };
      r();
      setInterval(() => {
        if (lastHref !== window.location.href) {
          lastHref = window.location.href;
          renderSwitcher();
          return;
        }
        if (document.body && !document.getElementById('crm-map-switcher')) renderSwitcher();
      }, 700);
    }

    initSwitcher();
    return;
  }

  // ==== CRM — кнопка "Карта" ====
  const STYLE_ID = 'crm-map-button-style';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #crm-open-map-btn {
        position: fixed; top: 60px; right: 10px; z-index: 99999;
        opacity: 0.9;
        padding: 8px 12px; height: 36px;
        font-size: 13px; font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 0.5px;
        color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
        border: none; border-radius: 12px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        cursor: pointer;
        transition: box-shadow 0.2s ease, opacity 0.2s ease;
      }
      #crm-open-map-btn:hover {
        opacity: 1;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 6px 2px rgba(52,152,219,0.35);
      }
    `;
    document.head.appendChild(style);
  }

  function isRequestPage() {
    const url = window.location.href;
    return url.includes('/customer-request/update') || url.includes('/customer-request/create');
  }

  function readFieldValueByIds(ids) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.tagName === 'SELECT') {
        const s = el.options[el.selectedIndex];
        const v = (s?.textContent || '').trim();
        if (v && v !== 'Выберите') return v;
      } else {
        const v = (el.value || el.textContent || '').trim();
        if (v) return v;
      }
    }
    return '';
  }

  function readCustomerInfoValueByLabel(labelText) {
    const info = document.getElementById('customerInfo');
    if (!info) return '';
    const spans = info.querySelectorAll('span');
    const target = String(labelText || '').toLowerCase().trim();
    for (const s of spans) {
      const t = (s.textContent || '').toLowerCase().trim().replace(/:$/, '');
      if (t === target) {
        const parentText = (s.parentElement?.textContent || '').trim();
        const cleaned = parentText.replace(s.textContent || '', '').trim();
        if (cleaned) return cleaned;
      }
    }
    return '';
  }

  function buildMapSearchText() {
    const city = readFieldValueByIds(['customerrequest-city_id', 'customerrequest-city', 'customer-city_id', 'customer-city']);
    const settlement = readCustomerInfoValueByLabel('Нас.пункт');
    const street = readCustomerInfoValueByLabel('Улица');
    const house = readCustomerInfoValueByLabel('Дом');
    const locality = settlement || city;
    return [locality, street, house].filter(Boolean).join(', ').trim();
  }

  function buildMapUrl(searchText, sourceKey, originSourceKey) {
    const s = normalizeSourceKey(sourceKey, DEFAULT_MAP_SOURCE_KEY);
    const o = normalizeSourceKey(originSourceKey, s);
    const url = new URL('https://yandex.ru/maps/');
    url.searchParams.set('text', searchText);
    url.searchParams.set('um', MAP_CONSTRUCTOR_ID_BY_SOURCE[s]);
    url.searchParams.set('source', 'constructorLink');
    url.searchParams.set(MAP_SOURCE_QUERY_PARAM, s);
    url.searchParams.set(MAP_ORIGIN_SOURCE_QUERY_PARAM, o);
    return url.toString();
  }

  function openMap() {
    const text = buildMapSearchText();
    if (!text) { alert('Адрес не найден'); return; }
    const origin = normalizeSourceKey(getHostSourceKey(), DEFAULT_MAP_SOURCE_KEY);
    const url = buildMapUrl(text, origin, origin);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'OPEN_OR_FOCUS_MAP_TAB', url }, () => {
        if (chrome.runtime.lastError) window.open(url, 'yandex_crm_map');
      });
    } else {
      window.open(url, 'yandex_crm_map');
    }
  }

  function createMapButton() {
    if (!isRequestPage()) return;
    if (document.getElementById('crm-open-map-btn')) return;

    const select = document.querySelector('select[name="CustomerRequest[status_change_type]"]');
    if (select) return;

    const btn = document.createElement('button');
    btn.id = 'crm-open-map-btn';
    btn.type = 'button';
    btn.innerHTML = '🗺️ Карта';
    btn.title = 'Открыть адрес на карте Яндекс';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMap();
    });
    document.body.appendChild(btn);
    log('Кнопка карты создана');
  }

  function init() {
    ensureStyles();
    setTimeout(createMapButton, 500);
    const observer = new MutationObserver(createMapButton);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();