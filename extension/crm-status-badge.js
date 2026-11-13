// ==== Бейдж статуса с копированием по клику ====
(function () {
  'use strict';

  if (window.__CRM_STATUS_BADGE_INIT__) return;
  window.__CRM_STATUS_BADGE_INIT__ = true;

  const STATUS_STYLES = {
    'В работе СД':     { cls: 'crm-sb-v-rabote-sd', copy: 'sd' },
    'Отмена Филиала':  { cls: 'crm-sb-otmena',      copy: 'cancel' },
    'Отмена КЦ':       { cls: 'crm-sb-otmena',      copy: 'cancel' },
    'Отмена Регионал': { cls: 'crm-sb-otmena',      copy: 'cancel' },
    'В пути':          { cls: 'crm-sb-v-puti',      copy: 'whereMs' },
    'Ожидает':         { cls: 'crm-sb-ozhidaet',    copy: 'whereMs' },
    'В работе':        { cls: 'crm-sb-v-rabote',    copy: 'zpc' },
    'Отказ':           { cls: 'crm-sb-otkaz',       copy: null },
    'Модерация':       { cls: 'crm-sb-otkaz',       copy: null },
    'Не оформлена':    { cls: 'crm-sb-ne-oform',    copy: null },
    'Склад':           { cls: 'crm-sb-sklad',       copy: null },
    'На уточнении':    { cls: 'crm-sb-utochn',      copy: null },
    'Готов ОФ':        { cls: 'crm-sb-gotov',       copy: null },
    'Готов':           { cls: 'crm-sb-gotov',       copy: null },
    'Не создана':      { cls: 'crm-sb-ne-sozd',     copy: null }
  };

  const STATUS_ORDER = [
    'В работе СД',
    'Отмена Филиала',
    'Отмена КЦ',
    'Отмена Регионал',
    'Готов ОФ',
    'Не оформлена',
    'На уточнении',
    'Не создана',
    'Модерация',
    'В работе',
    'В пути',
    'Ожидает',
    'Отказ',
    'Склад',
    'Готов'
  ];

  const STYLE_ID = 'crm-sb-style';
  const BADGE_CLASS = 'crm-sb-badge';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .crm-sb-wrap {
        display: inline-flex !important;
        align-items: center !important;
        gap: 10px !important;
      }
      .crm-sb-label {
        color: #495057 !important;
        font-weight: 700 !important;
        font-size: 16px !important;
        white-space: nowrap !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }
      .${BADGE_CLASS} {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-weight: 600 !important;
        padding: 10px 20px !important;
        border-radius: 12px !important;
        display: inline-block !important;
        color: #fff !important;
        text-align: center !important;
        min-width: 140px !important;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3) !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
        border: none !important;
        font-size: 14px !important;
        letter-spacing: 0.5px !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        cursor: default !important;
      }
      .${BADGE_CLASS}.crm-sb-clickable { cursor: pointer !important; }
      .${BADGE_CLASS}.crm-sb-clickable:focus-visible { outline:2px solid currentColor; outline-offset:3px; }

      .crm-sb-ozhidaet,
      .crm-sb-v-puti {
        background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%) !important;
        box-shadow: 0 4px 15px rgba(46,204,113,0.4) !important;
      }
      .crm-sb-v-rabote {
        background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%) !important;
        color: #2c3e50 !important;
        text-shadow: 0 1px 1px rgba(255,255,255,0.3) !important;
      }
      .crm-sb-v-rabote-sd {
        background: linear-gradient(135deg, #8b4513 0%, #a0522d 100%) !important;
        box-shadow: 0 4px 15px rgba(139,69,19,0.4) !important;
      }
      .crm-sb-otmena {
        background: linear-gradient(135deg, #008080 0%, #006666 100%) !important;
        box-shadow: 0 4px 15px rgba(0,128,128,0.4) !important;
      }
      .crm-sb-otkaz {
        background: linear-gradient(135deg, #ff0000 0%, #cc0000 100%) !important;
        box-shadow: 0 4px 15px rgba(255,0,0,0.5) !important;
        font-weight: 700 !important;
      }
      .crm-sb-ne-oform,
      .crm-sb-sklad,
      .crm-sb-utochn,
      .crm-sb-gotov,
      .crm-sb-ne-sozd {
        background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%) !important;
      }
    `;
    document.head.appendChild(s);
  }

  function copy(text) {
    const v = String(text || '').trim();
    if (!v) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).catch(() => fallbackCopy(v));
      return;
    }
    fallbackCopy(v);
  }

  function fallbackCopy(v) {
    const active = document.activeElement;
    const start = active && active.selectionStart;
    const end = active && active.selectionEnd;
    const ta = document.createElement('textarea');
    try {
      ta.value = v;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
    } catch (e) {}
    finally {
      ta.remove();
      if (active && active.isConnected) {
        active.focus({ preventScroll: true });
        if (typeof start === 'number' && typeof active.setSelectionRange === 'function') {
          try { active.setSelectionRange(start, end); } catch (_) {}
        }
      }
    }
  }

  function getRequestId() {
    try {
      const u = new URL(window.location.href);
      const id = u.searchParams.get('id');
      if (id) return id;
      const m = window.location.href.match(/[?&]id=(\d+)/);
      if (m) return m[1];
      const h1 = document.querySelector('h1');
      if (h1) {
        const mm = h1.textContent.match(/№\s*(\d+)/);
        if (mm) return mm[1];
      }
    } catch (e) {}
    return '';
  }

  function getPhone() {
    const ci = document.querySelector('#customerInfo');
    if (ci) {
      const txt = ci.textContent || '';
      const m = txt.match(/(?:\+7|8|7)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
      if (m) return m[0].trim();
    }
    const phoneSelectors = [
      '#customer-phone',
      'input[name="CustomerRequest[phone]"]',
      'input[name="Customer[phone]"]',
      'input[name*="phone"]',
      'input[type="tel"]'
    ];
    for (const sel of phoneSelectors) {
      const el = document.querySelector(sel);
      if (el && el.value && el.value.trim()) return el.value.trim();
    }
    const callLink = document.querySelector('a[href^="callto:"], a[href^="tel:"]');
    if (callLink) {
      const href = callLink.getAttribute('href') || '';
      const phone = href.replace(/^callto:|^tel:/i, '').replace(/;sip_id=.*$/i, '').trim();
      if (phone) return phone;
    }
    return '';
  }

  function detectStatus() {
    const containers = [
      document.querySelector('form#customerRequestForm h1'),
      document.querySelector('.card-header h1'),
      document.querySelector('h1')
    ].filter(Boolean);

    for (const container of containers) {
      const text = (container.textContent || '').replace(/\s+/g, ' ').trim();
      for (const key of STATUS_ORDER) {
        const re = new RegExp('Статус:\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'i');
        if (re.test(text)) return key;
      }
    }
    const bodyText = (document.body.textContent || '').replace(/\s+/g, ' ');
    for (const key of STATUS_ORDER) {
      const re = new RegExp('Статус:\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'i');
      if (re.test(bodyText)) return key;
    }
    return null;
  }

  function handleClick(statusKey) {
    const cfg = STATUS_STYLES[statusKey];
    if (!cfg || !cfg.copy) return;

    const id = getRequestId();
    if (!id) return;

    let text = '';
    if (cfg.copy === 'zpc') {
      const phone = getPhone().replace(/\s+/g, ' ').trim();
      if (!phone) return;
      text = `${id} (${phone}) по зпч`;
    } else if (cfg.copy === 'sd') {
      const phone = getPhone();
      text = phone ? `${id}  Тел: ${phone} по сд` : `${id} по сд`;
    } else if (cfg.copy === 'whereMs') {
      text = `${id} Где мс ?`;
    } else if (cfg.copy === 'cancel') {
      text = `${id} отмена`;
    }

    if (text) copy(text);
  }

  function findStatusHost() {
    return (
      document.querySelector('form#customerRequestForm h1 .ml-auto') ||
      document.querySelector('.card-header h1 .ml-auto') ||
      document.querySelector('h1 .ml-auto') ||
      document.querySelector('form#customerRequestForm h1') ||
      document.querySelector('.card-header h1') ||
      document.querySelector('h1')
    );
  }

  function applyBadge() {
    const statusKey = detectStatus();
    if (!statusKey) return false;

    const cfg = STATUS_STYLES[statusKey];
    if (!cfg) return false;

    const host = findStatusHost();
    if (!host) return false;

    const existing = host.querySelector('.crm-sb-wrap');
    if (existing && existing.dataset.status === statusKey) return true;

    ensureStyles();

    const wrap = document.createElement('div');
    wrap.className = 'crm-sb-wrap';
    wrap.dataset.status = statusKey;

    const label = document.createElement('span');
    label.className = 'crm-sb-label';
    label.textContent = 'Статус:';

    const badge = document.createElement('span');
    badge.className = `${BADGE_CLASS} ${cfg.cls}`;
    badge.textContent = statusKey;

    if (cfg.copy) {
      badge.classList.add('crm-sb-clickable');
      badge.setAttribute('role', 'button');
      badge.tabIndex = 0;
      badge.title = cfg.copy === 'zpc' ? 'Копировать ID и телефон клиента по ЗПЧ' : 'Нажмите, чтобы скопировать';
      badge.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleClick(statusKey);
      });
      badge.addEventListener('keydown', function (e) {
        if (!['Enter', ' '].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        handleClick(statusKey);
      });
    }

    wrap.appendChild(label);
    wrap.appendChild(badge);

    host.innerHTML = '';
    host.appendChild(wrap);
    return true;
  }

  function start() {
    applyBadge();

    // Основное обновление идёт по MutationObserver. Редкий таймер — только страховка,
    // чтобы не опрашивать DOM почти каждую секунду на каждой открытой карточке.
    setInterval(() => {
      if (!document.hidden) applyBadge();
    }, 5000);

    const h1 = document.querySelector('h1');
    if (h1) {
      let timer = null;
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(applyBadge, 80);
      });
      obs.observe(h1, { childList: true, subtree: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
