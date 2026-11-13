// ==== Подсветка даты заявки для прозвона ====
(function () {
  'use strict';

  if (window.__CRM_CALL_CHECK_BADGE_INIT__) return;
  window.__CRM_CALL_CHECK_BADGE_INIT__ = true;

  const log = (...a) => {
    if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[CALL-CHECK-BADGE]', ...a);
  };

  const STYLE_ID = 'crm-call-check-badge-style';
  const BADGE_CLASS = 'crm-call-check-badge';
  const STATE_CLASS = {
    ok: 'crm-ccb-ok',
    soon: 'crm-ccb-soon'
  };

  const ONE_HOUR_MS = 60 * 60 * 1000;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .${BADGE_CLASS} {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        padding: 3px 12px !important;
        border-radius: 999px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        letter-spacing: 0.2px !important;
        vertical-align: middle !important;
        margin-left: 6px !important;
        transition: background 0.2s ease, color 0.2s ease;
      }

      .${BADGE_CLASS}.${STATE_CLASS.ok} {
        background: #d1fae5 !important;
        color: #065f46 !important;
        border: 1px solid #6ee7b7 !important;
        animation: crm-ccb-blink-green 1s ease-in-out infinite !important;
      }

      .${BADGE_CLASS}.${STATE_CLASS.soon} {
        background: #fee2e2 !important;
        color: #991b1b !important;
        border: 1px solid #fca5a5 !important;
        animation: crm-ccb-blink-red 1s ease-in-out infinite !important;
      }

      @keyframes crm-ccb-blink-green {
        0%, 100% { background: #d1fae5; box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
        50%      { background: #a7f3d0; box-shadow: 0 0 0 6px rgba(34,197,94,0); }
      }

      @keyframes crm-ccb-blink-red {
        0%, 100% { background: #fee2e2; box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
        50%      { background: #fecaca; box-shadow: 0 0 0 6px rgba(239,68,68,0); }
      }
    `;
    document.head.appendChild(s);
  }

  function isCallCheckEnabled() {
    const byId = document.getElementById('customerrequest-is_need_call_check');
    if (byId && byId.type === 'checkbox') return byId.checked;

    const byName = document.querySelector('input[name="CustomerRequest[is_need_call_check]"][type="checkbox"]');
    if (byName) return byName.checked;

    return false;
  }

  function getRequestDateTime() {
    const dateInput = document.querySelector('input[name="CustomerRequest[opened_at]"]');
    if (!dateInput || !dateInput.value) return null;

    const dateStr = dateInput.value.trim();
    const m = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return null;

    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);

    let hours = 0, minutes = 0;
    const timeInput = document.getElementById('cr_opened_at_time');
    if (timeInput && timeInput.value) {
      const tm = String(timeInput.value).match(/^(\d{1,2}):(\d{2})$/);
      if (tm) {
        hours = parseInt(tm[1], 10);
        minutes = parseInt(tm[2], 10);
      }
    }

    return new Date(year, month, day, hours, minutes, 0, 0);
  }

  function getState(requestDate) {
    const cityText = document.getElementById('cityTime')?.textContent || '';
    const city = cityText.match(/\b(\d{2})[.\-](\d{2})[.\-](\d{4}|\d{2})\b[\s\S]*?\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
    let diff = requestDate.getTime() - Date.now();
    if (city) {
      const year = Number(city[3]) + (city[3].length === 2 ? 2000 : 0), month = Number(city[2]), day = Number(city[1]);
      const hour = Number(city[4]), minute = Number(city[5]), stamp = Date.UTC(year,month-1,day,hour,minute), date = new Date(stamp);
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month-1 && date.getUTCDate() === day && hour < 24 && minute < 60) {
        diff = Date.UTC(requestDate.getFullYear(),requestDate.getMonth(),requestDate.getDate(),requestDate.getHours(),requestDate.getMinutes()) - stamp;
      }
    }
    if (diff > ONE_HOUR_MS) return 'ok';
    return 'soon';
  }

  function removeBadge() {
    document.querySelectorAll('.' + BADGE_CLASS).forEach((el) => el.remove());
  }

  function formatDate(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
  }

  function getTitleForState(state, date) {
    if (state === 'ok') return `До прозвона больше часа — ${formatDate(date)}`;
    return `До прозвона меньше часа (или просрочено) — ${formatDate(date)}`;
  }

  function renderBadge() {
    if (!isCallCheckEnabled()) { removeBadge(); return; }

    const date = getRequestDateTime();
    if (!date) { removeBadge(); return; }

    ensureStyles();
    const state = getState(date);

    const h1 = document.querySelector('form#customerRequestForm .card-header h1')
      || document.querySelector('.card-header h1')
      || document.querySelector('h1');
    if (!h1) return;

    let nameSpan = null;
    h1.querySelectorAll('span').forEach((s) => {
      if (/Заявка\s*№\s*\d+/i.test(s.textContent)) nameSpan = s;
    });
    if (!nameSpan) nameSpan = h1.querySelector('span');
    if (!nameSpan) return;

    const existing = nameSpan.parentElement.querySelector('.' + BADGE_CLASS);
    const text = formatDate(date), title = getTitleForState(state,date);
    if (existing) {
      if (existing.dataset.state !== state) { existing.className = `${BADGE_CLASS} ${STATE_CLASS[state]}`; existing.dataset.state = state; }
      if (existing.textContent !== text) existing.textContent = text;
      if (existing.title !== title) existing.title = title;
      return;
    }

    removeBadge();

    const badge = document.createElement('span');
    badge.className = `${BADGE_CLASS} ${STATE_CLASS[state]}`;
    badge.dataset.state = state;
    badge.textContent = text;
    badge.title = title;

    nameSpan.parentElement.insertBefore(badge, nameSpan.nextSibling);
  }

  function tick() { renderBadge(); }

  function start() {
    tick();
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; tick(); });
    };
    const controls = '#cr_opened_at_time,#customerrequest-opened_at,#customerrequest-is_need_call_check,input[name="CustomerRequest[opened_at]"],input[name="CustomerRequest[is_need_call_check]"]';
    const changed = event => { if (event.target?.matches?.(controls)) schedule(); };
    document.addEventListener('input', changed, true);
    document.addEventListener('change', changed, true);
    const timer = setInterval(() => { if (!document.hidden) schedule(); }, 60 * 1000);
    const relevant = 'h1,#cityTime,' + controls;
    const obs = new MutationObserver(records => {
      if (records.some(record => record.target?.parentElement?.closest?.('h1,#cityTime') || record.target?.matches?.('h1,#cityTime') ||
        [...(record.addedNodes || []),...(record.removedNodes || [])].some(node => node.nodeType === 1 && (node.matches?.(relevant) || node.querySelector?.(relevant))))) schedule();
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('pagehide', event => { if (!event.persisted) { obs.disconnect(); clearInterval(timer); } });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
