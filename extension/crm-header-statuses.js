// ==== Бейджи статусов в шапке заявки ====
(function () {
  'use strict';

  if (window.__CRM_HEADER_STATUSES_INIT__) return;
  window.__CRM_HEADER_STATUSES_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[HEADER-STATUSES]', ...a);
  };

  const STYLE_ID = 'crm-header-statuses-style';
  const CONTAINER_CLASS = 'crm-header-statuses';

  const STATUS_CONFIG = {
    URGENT: {
      id: 'customerrequest-is_urgent',
      name: 'CustomerRequest[is_urgent]',
      label: 'Срочная',
      className: 'crm-header-badge-urgent',
      text: 'Срочная'
    },
    PROZVON: {
      id: 'customerrequest-is_need_call_check',
      name: 'CustomerRequest[is_need_call_check]',
      label: 'Прозвон',
      className: 'crm-header-badge-call',
      text: 'Прозвон'
    },
    PROZVON_BEFORE: {
      id: 'customerrequest-is_need_call_before_visit',
      name: 'CustomerRequest[is_need_call_before_visit]',
      label: 'Прозвон перед выездом',
      className: 'crm-header-badge-call-before',
      text: 'Прозвон перед выездом'
    },
    ZAKREP: {
      id: 'customerrequest-is_zakrep',
      name: 'CustomerRequest[is_zakrep]',
      label: 'Закреп',
      className: 'crm-header-badge-zakrep',
      text: 'Закреп'
    }
  };

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${CONTAINER_CLASS} {
        display: inline-flex !important;
        align-items: center !important;
        gap: 8px !important;
        margin-left: 15px !important;
        vertical-align: middle !important;
        flex-wrap: wrap !important;
      }

      .crm-header-badge {
        display: inline-flex !important;
        align-items: center !important;
        padding: 4px 12px !important;
        height: 30px !important;
        border-radius: 20px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        color: white !important;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
        cursor: default !important;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3) !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      }

      .crm-header-badge-urgent {
        background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%) !important;
      }
      .crm-header-badge-call {
        background: linear-gradient(135deg, #3498db 0%, #2980b9 100%) !important;
      }
      .crm-header-badge-call-before {
        background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%) !important;
      }
      .crm-header-badge-zakrep {
        background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%) !important;
      }
    `;
    document.head.appendChild(style);
  }

  let container = null;
  let lastStates = { urgent: false, prozvon: false, prozvonBefore: false, zakrep: false };

  function getCheckboxState(config) {
    const byId = document.getElementById(config.id);
    if (byId && byId.type === 'checkbox') return byId.checked;

    const byName = document.querySelector(`input[name="${config.name}"]`);
    if (byName && byName.type === 'checkbox') return byName.checked;

    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if ((label.textContent || '').trim().includes(config.label)) {
        const inputId = label.htmlFor;
        if (inputId) {
          const input = document.getElementById(inputId);
          if (input && input.type === 'checkbox') return input.checked;
        }
      }
    }
    return false;
  }

  function checkAndRemoveProzvonBeforeComment() {
    const cb = document.getElementById(STATUS_CONFIG.PROZVON_BEFORE.id) ||
               document.querySelector(`input[name="${STATUS_CONFIG.PROZVON_BEFORE.name}"]`);
    if (!cb || cb.checked) return;

    const commentField = document.getElementById('customerrequest-comments');
    if (!commentField) return;

    const original = commentField.value || '';
    const patterns = [
      /позвонить\s+перед\s+выездом\s*\.?\s*/gi,
      /позвонить\s*перед\s*выездом\s*\.?\s*/gi,
      /^\s*позвонить\s+перед\s+выездом\s*\.?\s*$/gim,
      /прозвон\s+перед\s+выездом\s*\.?\s*/gi,
      /прозвон\s*перед\s*выездом\s*\.?\s*/gi,
      /^\s*прозвон\s+перед\s+выездом\s*\.?\s*$/gim
    ];

    let newComment = original;
    let changed = false;
    for (const p of patterns) {
      if (p.test(newComment)) {
        newComment = newComment.replace(p, '');
        changed = true;
      }
    }

    newComment = newComment.replace(/\s+/g, ' ').replace(/^[,\s.]+|[,\s.]+$/g, '').replace(/,,+/g, ',').trim();
    if (newComment === '.' || newComment === '..') newComment = '';

    if (changed && newComment !== original) {
      commentField.value = newComment;
      commentField.dispatchEvent(new Event('input', { bubbles: true }));
      commentField.dispatchEvent(new Event('change', { bubbles: true }));
      log('Удалена фраза о прозвоне перед выездом');
    }
  }

  function createContainer() {
    const h1 = document.querySelector('h1');
    if (!h1) return false;

    if (h1.querySelector('.' + CONTAINER_CLASS)) {
      container = h1.querySelector('.' + CONTAINER_CLASS);
      return true;
    }

    const nameSpan = h1.querySelector('span');
    container = document.createElement('span');
    container.className = CONTAINER_CLASS;

    if (nameSpan) {
      nameSpan.after(container);
    } else {
      const first = h1.firstChild;
      if (first && first.nodeType === Node.TEXT_NODE) {
        h1.insertBefore(container, first.nextSibling);
      } else {
        h1.insertBefore(container, h1.firstChild);
      }
    }
    return true;
  }

  function updateStatuses() {
    if (!container && !createContainer()) return;

    const newStates = {
      urgent: getCheckboxState(STATUS_CONFIG.URGENT),
      prozvon: getCheckboxState(STATUS_CONFIG.PROZVON),
      prozvonBefore: getCheckboxState(STATUS_CONFIG.PROZVON_BEFORE),
      zakrep: getCheckboxState(STATUS_CONFIG.ZAKREP)
    };

    if (newStates.prozvon && newStates.prozvonBefore) {
      const cb = document.getElementById(STATUS_CONFIG.PROZVON_BEFORE.id) ||
                 document.querySelector(`input[name="${STATUS_CONFIG.PROZVON_BEFORE.name}"]`);
      if (cb) {
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        newStates.prozvonBefore = false;
      }
    }

    checkAndRemoveProzvonBeforeComment();

    const changed = Object.keys(newStates).some((k) => newStates[k] !== lastStates[k]);
    if (!changed) return;
    lastStates = { ...newStates };

    container.innerHTML = '';
    if (newStates.urgent) appendBadge(STATUS_CONFIG.URGENT);
    if (newStates.prozvon) appendBadge(STATUS_CONFIG.PROZVON);
    if (newStates.prozvonBefore) appendBadge(STATUS_CONFIG.PROZVON_BEFORE);
    if (newStates.zakrep) appendBadge(STATUS_CONFIG.ZAKREP);
  }

  function appendBadge(config) {
    const badge = document.createElement('span');
    badge.className = 'crm-header-badge ' + config.className;
    badge.textContent = config.text;
    badge.title = config.label;
    container.appendChild(badge);
  }

  function setupCheckboxListeners() {
    const selectors = [
      '#' + STATUS_CONFIG.URGENT.id, `input[name="${STATUS_CONFIG.URGENT.name}"]`,
      '#' + STATUS_CONFIG.PROZVON.id, `input[name="${STATUS_CONFIG.PROZVON.name}"]`,
      '#' + STATUS_CONFIG.PROZVON_BEFORE.id, `input[name="${STATUS_CONFIG.PROZVON_BEFORE.name}"]`,
      '#' + STATUS_CONFIG.ZAKREP.id, `input[name="${STATUS_CONFIG.ZAKREP.name}"]`
    ];
    selectors.forEach((sel) => {
      const cb = document.querySelector(sel);
      if (cb && !cb.dataset.headerStatusListener) {
        cb.dataset.headerStatusListener = 'true';
        cb.addEventListener('change', updateStatuses);
      }
    });
  }

  function setupCommentObserver() {
    const field = document.getElementById('customerrequest-comments');
    if (field && !field.dataset.headerStatusObserver) {
      field.dataset.headerStatusObserver = 'true';
      field.addEventListener('input', checkAndRemoveProzvonBeforeComment);
      field.addEventListener('change', checkAndRemoveProzvonBeforeComment);
      field.addEventListener('blur', checkAndRemoveProzvonBeforeComment);
    }
  }

  function init() {
    ensureStyles();
    if (!createContainer()) {
      setTimeout(init, 500);
      return;
    }
    updateStatuses();
    setupCheckboxListeners();
    setupCommentObserver();

    let t = null;
    const observer = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        updateStatuses();
        setupCheckboxListeners();
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(checkAndRemoveProzvonBeforeComment, 5000);
    log('Инициализировано');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();