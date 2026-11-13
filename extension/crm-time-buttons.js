// ==== Кнопки "+1 час" / "+2 часа" — быстрые, без блокировки ====
(function () {
  'use strict';

  if (window.__CRM_TIME_BUTTONS_INIT__) return;
  window.__CRM_TIME_BUTTONS_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[TIME-BUTTONS]', ...a);
  };

  const STYLE_ID = 'crm-time-buttons-style';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #crm-permanent-buttons {
        display: inline-flex !important;
        gap: 8px;
        margin-top: 6px;
        margin-bottom: 6px;
        position: relative;
        z-index: 100;
        vertical-align: middle;
      }

      .crm-time-btn-1h, .crm-time-btn-2h {
        padding: 8px 16px !important;
        height: 36px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        letter-spacing: 0.5px !important;
        color: #ffffff !important;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3) !important;
        border: none !important;
        border-radius: 12px !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        transition: transform 0.08s ease, box-shadow 0.15s ease !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }
      .crm-time-btn-1h { background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%) !important; }
      .crm-time-btn-1h:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 6px 2px rgba(76,175,80,0.35) !important; }
      .crm-time-btn-2h { background: linear-gradient(135deg, #3498db 0%, #2980b9 100%) !important; }
      .crm-time-btn-2h:hover { box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 6px 2px rgba(52,152,219,0.35) !important; }
      .crm-time-btn-1h:active, .crm-time-btn-2h:active { transform: scale(0.96) !important; }

      .setTimeNextHourBtn:not(#crm-permanent-buttons *) { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  let clientSelectedInCurrentModal = false;

  function selectClientInModal() {
    const modal = document.getElementById('timeChangeReasonModal');
    const sel = document.getElementById('timeChangeReasonModalSelect');
    if (!modal || !sel) return false;
    if (modal.style.display !== 'block' && !modal.classList.contains('show')) return false;
    if (clientSelectedInCurrentModal) return false;

    for (let i = 0; i < sel.options.length; i++) {
      const opt = sel.options[i];
      if (opt.text.trim().toLowerCase() === 'клиент') {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        clientSelectedInCurrentModal = true;
        log('Автовыбор "Клиент"');
        return true;
      }
    }
    return false;
  }

  function setupModalAutoSelect() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          const modal = n.id === 'timeChangeReasonModal' ? n : n.querySelector?.('#timeChangeReasonModal');
          if (modal) {
            clientSelectedInCurrentModal = false;
            setTimeout(selectClientInModal, 30);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', (e) => {
      const t = e.target;
      const text = t.textContent || '';
      const isTimeBtn =
        t.closest('.setTimeNextHourBtn') ||
        t.closest('[onclick*="setTimeNextHour"]') ||
        t.closest('#crm-permanent-buttons button') ||
        text.includes('+1ч') || text.includes('+2ч') || text.includes('Через час');

      if (!isTimeBtn) return;
      clientSelectedInCurrentModal = false;
      const interval = setInterval(() => {
        const modal = document.getElementById('timeChangeReasonModal');
        const sel = document.getElementById('timeChangeReasonModalSelect');
        if (modal && sel && (modal.style.display === 'block' || modal.classList.contains('show'))) {
          clearInterval(interval);
          if (!clientSelectedInCurrentModal) selectClientInModal();
        }
      }, 30);
      setTimeout(() => clearInterval(interval), 3000);
    }, true);
  }

  function findAndPressSystemButton(hours) {
    const targets = hours === 1
      ? ['Через час', '+1 час', '+1ч']
      : ['+2ч', '+2 часа'];

    const sys = document.querySelectorAll('.setTimeNextHourBtn');
    for (const btn of sys) {
      const t = (btn.textContent || '').trim();
      if (targets.some(x => t.includes(x))) { btn.click(); log(`Клик sys: ${t}`); return true; }
    }

    const onclick = document.querySelectorAll('button[onclick*="setTimeNextHour"], a[onclick*="setTimeNextHour"]');
    for (const btn of onclick) {
      const t = (btn.textContent || '').trim();
      if (targets.some(x => t.includes(x))) { btn.click(); return true; }
    }

    const all = document.querySelectorAll('button, a.btn');
    for (const btn of all) {
      if (btn.closest('#crm-permanent-buttons')) continue;
      const t = (btn.textContent || '').trim();
      if (targets.some(x => t.includes(x))) { btn.click(); return true; }
    }

    if (sys.length > 0) { sys[0].click(); return true; }
    log('Кнопки времени не найдены');
    return false;
  }

  function setDateTime(hours) {
    if (window.location.href.includes('/create')) {
      const citySelect = document.querySelector('#customerrequest-city_id');
      if (!citySelect || !citySelect.value || citySelect.value === '0') {
        alert('Сначала выберите город');
        return;
      }
    }

    const dateField = document.getElementById('customerrequest-opened_at');
    if (dateField) {
      const now = new Date();
      const mskOffset = 3 * 60 * 60 * 1000;
      const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
      const msk = new Date(utc + mskOffset);
      const day = String(msk.getDate()).padStart(2, '0');
      const month = String(msk.getMonth() + 1).padStart(2, '0');
      const mskDate = `${day}-${month}-${msk.getFullYear()}`;
      if (dateField.value !== mskDate) {
        dateField.value = mskDate;
        dateField.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    findAndPressSystemButton(hours);
  }

  function createButton(text, hours) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.title = `Сегодня +${hours}ч`;
    btn.className = hours === 1 ? 'crm-time-btn-1h' : 'crm-time-btn-2h';
    let busy = false;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      busy = true;
      setTimeout(() => { busy = false; }, 120);
      setDateTime(hours);
    });
    return btn;
  }

  function addPermanentButtons() {
    const dateField = document.getElementById('customerrequest-opened_at');
    if (!dateField) return false;
    if (document.querySelector('select[name="CustomerRequest[status_change_type]"]')) return false;
    if (document.getElementById('crm-permanent-buttons')) return true;

    const container = document.createElement('div');
    container.id = 'crm-permanent-buttons';
    container.appendChild(createButton('+1 час', 1));
    container.appendChild(createButton('+2 часа', 2));

    const parent = dateField.closest('.form-group, .field-customerrequest-opened_at, .form-control, td, div');
    if (parent && parent.parentNode) parent.parentNode.insertBefore(container, parent.nextSibling);
    else dateField.parentNode.insertBefore(container, dateField.nextSibling);

    log('Кнопки времени добавлены');
    return true;
  }

  function hideSystemTimeButtons() {
    document.querySelectorAll('.setTimeNextHourBtn').forEach(btn => {
      if (!btn.closest('#crm-permanent-buttons')) btn.style.display = 'none';
    });
  }

  function init() {
    ensureStyles();
    setupModalAutoSelect();
    setTimeout(hideSystemTimeButtons, 100);
    setTimeout(addPermanentButtons, 200);
    setTimeout(addPermanentButtons, 800);

    const observer = new MutationObserver(() => {
      if (!document.getElementById('crm-permanent-buttons')) addPermanentButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(hideSystemTimeButtons, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();