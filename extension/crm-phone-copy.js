// ==== Кликабельный "Тел:" для копирования ====
(function () {
  'use strict';

  if (window.__CRM_PHONE_COPY_INIT__) return;
  window.__CRM_PHONE_COPY_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[PHONE-COPY]', ...a);
  };

  const STYLE_ID = 'crm-phone-copy-style';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a.phone-clickable {
        cursor: pointer !important;
        text-decoration: none !important;
        color: #2c3e50 !important;
        font-weight: 500 !important;
        transition: background-color 0.2s !important;
        padding: 2px 4px !important;
        border-radius: 4px !important;
        display: inline-block !important;
      }
      a.phone-clickable:hover { background-color: #e8f5e9 !important; }

      .crm-phone-toast {
        position: fixed;
        top: 20px;
        right: 20px;
        color: white;
        padding: 8px 14px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        z-index: 99999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        opacity: 0;
        transition: opacity 0.25s;
      }
      .crm-phone-toast.show { opacity: 1; }
      .crm-phone-toast.success { background: #4CAF50; }
      .crm-phone-toast.error { background: #f44336; }
    `;
    document.head.appendChild(style);
  }

  function showToast(message, type) {
    let toast = document.querySelector('.crm-phone-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'crm-phone-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'crm-phone-toast ' + (type || 'success');
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function copyToClipboard(text) {
    const value = String(text || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    document.execCommand('copy');
    ta.remove();
    return Promise.resolve();
  }

  function getRequestId() {
    const idFromUrl = new URL(window.location.href).searchParams.get('id');
    if (idFromUrl) return idFromUrl;
    const match = window.location.href.match(/id=(\d+)/);
    if (match) return match[1];
    const h1 = document.querySelector('h1');
    if (h1) {
      const m = h1.textContent.match(/№\s*(\d+)/);
      if (m) return m[1];
    }
    return '';
  }

  function getPhoneNumber() {
    const reqInfo = document.getElementById('reqInfo');
    if (reqInfo) {
      const m = (reqInfo.value || '').match(/\+?\d[\d\s\-()]{8,}\d/);
      if (m) return m[0];
    }

    const customerInfo = document.querySelector('#customerInfo');
    if (customerInfo) {
      const text = customerInfo.textContent || '';
      const m = text.match(/Тел:?\s*([+8]?[\d\s\-()]{9,})/);
      if (m) return m[1].trim();
    }

    const phoneInput = document.querySelector('#customer-phone, input[name*="phone"], input[type="tel"]');
    if (phoneInput && phoneInput.value) return phoneInput.value.trim();

    return '';
  }

  function getRequestType() {
    const sel = document.querySelector('select[name="CustomerRequest[type]"]');
    if (!sel) return null;
    const opt = sel.options[sel.selectedIndex];
    if (!opt) return null;
    const text = opt.textContent.trim();
    if (sel.value === '30' || text.includes('Гарантия')) return 'Гарантия';
    if (sel.value === '20' || text.includes('Повтор')) return 'Повтор';
    if (sel.value === '10' || text.includes('Впервые')) return 'Впервые';
    return null;
  }

  function getRequestStatus() {
    const statusEl = document.querySelector('form#customerRequestForm > div > div > h1 > div.ml-auto .crm-status-badge')
      || document.querySelector('.crm-status-badge, .badge, [class*="status"]');
    if (!statusEl) return null;
    const text = statusEl.textContent || '';
    if (text.includes('В работе СД')) return 'В работе СД';
    if (text.includes('В пути')) return 'В пути';
    if (text.includes('Ожидает')) return 'Ожидает';
    if (text.includes('В работе')) return 'В работе';
    return null;
  }

  function formatPhoneForCopy() {
    const id = getRequestId();
    const phone = getPhoneNumber();
    const type = getRequestType();
    const status = getRequestStatus();
    const cleanPhone = phone.replace(/\s+/g, ' ').trim();

    if (!id || !phone) return null;

    if (status === 'В работе СД' && type === 'Гарантия') return `${id}   Тел: ${cleanPhone} CД`;
    if (type === 'Гарантия') return `${id} Тел: ${cleanPhone} Стык/Дист`;

    switch (status) {
      case 'Ожидает':
      case 'В пути': return `${id}  Тел: ${cleanPhone} Стык с обраткой`;
      case 'В работе СД': return `${id}   Тел: ${cleanPhone} CД`;
      case 'В работе': return `${id} Тел: ${cleanPhone} Стык/ЗПЧ`;
      default: return `${id} Тел: ${cleanPhone}`;
    }
  }

  function makePhoneClickable() {
    const customerInfo = document.querySelector('#customerInfo');
    if (!customerInfo) return false;

    const spans = customerInfo.querySelectorAll('span');
    let telSpan = null;
    for (const s of spans) {
      if ((s.textContent || '').trim() === 'Тел:') { telSpan = s; break; }
    }
    if (!telSpan || telSpan.tagName === 'A') return false;

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'phone-clickable';
    link.title = 'Копировать ID и телефон с пометкой по статусу';
    link.textContent = 'Тел:';
    telSpan.parentNode.replaceChild(link, telSpan);

    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = formatPhoneForCopy();
      if (!text) { showToast('Не удалось получить ID или телефон', 'error'); return; }
      copyToClipboard(text).then(() => {
        showToast('Скопировано: ' + (text.length > 50 ? text.slice(0, 50) + '...' : text), 'success');
        link.style.backgroundColor = '#e8f5e9';
        setTimeout(() => { link.style.backgroundColor = ''; }, 200);
      }).catch(() => showToast('Ошибка копирования', 'error'));
    });

    log('Кликабельный "Тел:" создан');
    return true;
  }

  function init() {
    ensureStyles();
    setTimeout(() => {
      if (!makePhoneClickable()) {
        const observer = new MutationObserver(() => {
          if (!document.querySelector('a.phone-clickable')) makePhoneClickable();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();