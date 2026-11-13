// ==== Индикатор "Перенос директора" ====
(function () {
  'use strict';

  if (window.__CRM_TRANSFER_HIGHLIGHT_INIT__) return;
  window.__CRM_TRANSFER_HIGHLIGHT_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[TRANSFER-HL]', ...a);
  };

  const STYLE_ID = 'crm-transfer-hl-style';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .crm-indicator {
        display: inline-flex !important;
        align-items: center !important;
        padding: 4px 16px !important;
        height: 34px !important;
        border-radius: 20px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        border: 1px solid !important;
        margin-left: 15px !important;
        cursor: help !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;
        transition: all 0.3s ease !important;
        vertical-align: middle !important;
      }

      @keyframes pulse-red {
        0% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(231, 76, 60, 0); }
        100% { box-shadow: 0 0 0 0 rgba(231, 76, 60, 0); }
      }

      .crm-indicator-director {
        background: linear-gradient(135deg, #e74c3c, #c0392b) !important;
        color: white !important;
        border-color: #e74c3c !important;
        animation: pulse-red 2s infinite !important;
      }

      .date-changes-header-wrapper {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        flex-wrap: wrap !important;
      }
    `;
    document.head.appendChild(style);
  }

  function hasDirectorMention(text) {
    if (!text) return false;
    const patterns = [
      /директор/iu,
      /\bдир\b/iu,
      /^дир$/iu,
      /^дир\s+/iu,
      /\s+дир\s+/iu,
      /\s+дир$/iu,
      /\(дир\)/iu,
      /\[дир\]/iu,
      /дир\./iu,
      /дир[,\s]/iu,
      /директор\s+(сказал|попросил|велел|просит|хочет|решил|сообщил|написал|звонил)/iu,
      /(сказал|попросил|велел|просит|хочет|решил|сообщил|написал|звонил)\s+директор/iu
    ];
    return patterns.some((p) => p.test(text));
  }

  function extractTransferReason(fullText) {
    if (!fullText) return '';
    const lines = fullText.split('\n');
    const reasons = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let match = line.match(/на\s+"[^"]+"\s+(.+)$/i);
      if (!match) match = line.match(/на\s+[^\s]+\s+(.+)$/i);
      if (!match) match = line.match(/^[─➜\->]\s*(.+)$/i);

      if (match && match[1]) {
        const r = match[1].trim();
        if (r && !/^(диспетчер|клиент|кл|дисп|админ|менеджер|система)$/iu.test(r)) {
          reasons.push(r);
        }
      } else {
        const lower = trimmed.toLowerCase();
        const isJustActor = /^(диспетчер|клиент|кл|дисп|админ|менеджер|система|перенос)$/iu.test(lower);
        const hasDates = /"\d{2}\.\d{2}\.\d{4}\/\d{2}:\d{2}"/.test(line);
        if (!isJustActor && !hasDates && trimmed.length > 2) reasons.push(trimmed);
      }
    }
    return reasons.join(' ');
  }

  function checkForDirectorTransfer() {
    const field = document.getElementById('customerrequest-date_changes');
    const wrapper = document.querySelector('.date-changes-header-wrapper');
    if (!field || !wrapper) return false;

    const text = field.value || '';
    const reason = extractTransferReason(text);
    const hasDirector = hasDirectorMention(reason);
    const existing = wrapper.querySelector('.crm-indicator-director');

    if (hasDirector && !existing) {
      const badge = document.createElement('span');
      badge.className = 'crm-indicator crm-indicator-director';
      badge.innerHTML = '👤 Перенос директора';
      badge.title = 'Обнаружен перенос, инициированный директором';

      const label = wrapper.querySelector('label');
      if (label) label.insertAdjacentElement('afterend', badge);
      else wrapper.appendChild(badge);
      log('Индикатор добавлен');
      return true;
    } else if (!hasDirector && existing) {
      existing.remove();
      log('Индикатор убран');
      return true;
    }
    return false;
  }

  function init() {
    ensureStyles();

    const transferField = document.getElementById('customerrequest-date_changes');
    if (transferField && !transferField.dataset.transferHlAttached) {
      transferField.dataset.transferHlAttached = 'true';
      transferField.addEventListener('input', checkForDirectorTransfer);
      transferField.addEventListener('change', checkForDirectorTransfer);
      transferField.addEventListener('paste', () => setTimeout(checkForDirectorTransfer, 100));
    }

    checkForDirectorTransfer();

    let observerTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        if (document.getElementById('customerrequest-date_changes') &&
            document.querySelector('.date-changes-header-wrapper')) {
          checkForDirectorTransfer();
        }
      }, 120);
    });
    const observerRoot = document.querySelector('#customerRequestForm') || document.body;
    observer.observe(observerRoot, { childList: true, subtree: true });

    setInterval(() => {
      if (!document.hidden && document.getElementById('customerrequest-date_changes')) {
        checkForDirectorTransfer();
      }
    }, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();