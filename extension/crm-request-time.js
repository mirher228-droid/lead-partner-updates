// Срок заявки: сравнение с живыми часами города из CRM (legacy loadTimeSync).
// Не создаёт кнопки времени, не меняет поля формы и не использует часы компьютера.
(() => {
  'use strict';
  if (window.__CRM_REQUEST_TIME_INIT__) return;
  window.__CRM_REQUEST_TIME_INIT__ = true;
  if (!/\/customer-request\/(?:create|update)(?:\/|$)/.test(location.pathname)) return;

  let source = null;
  let display = null;
  let signature = '';
  let scheduled = false;

  function readDate(text) {
    const match = String(text || '').match(/\b(\d{2})[.\-](\d{2})[.\-](\d{4}|\d{2})\b/);
    if (!match) return null;
    const day = Number(match[1]), month = Number(match[2]);
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { stamp: date.getTime(), text: `${match[1]}.${match[2]}.${String(year).slice(-2)}` };
  }

  function readTime(text) {
    const match = String(text || '').match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return { text: match[1].padStart(2, '0') + ':' + match[2], minutes: Number(match[1]) * 60 + Number(match[2]), index: match.index, raw: match[0] };
  }

  function ensureDisplay(nextSource) {
    let node = document.getElementById('crm-request-time-display');
    if (!node) {
      node = document.createElement('span');
      node.id = 'crm-request-time-display';
      node.className = 'crm-request-time-display';
    }
    if (node.previousSibling !== nextSource) nextSource.after(node);
    if (source !== nextSource || display !== node) signature = '';
    source = nextSource;
    display = node;
    source.classList.add('crm-native-time-source');
    source.setAttribute('aria-hidden', 'true');
  }

  function update() {
    scheduled = false;
    const exact = document.getElementById('crOpenedTime');
    if (!exact) {
      display?.remove();
      display = null;
      source = null;
      signature = '';
      return;
    }
    ensureDisplay(exact);
    const cityText = document.getElementById('cityTime')?.textContent || '';
    const requestText = exact.textContent || '';
    const dateValue = document.querySelector('input[name="CustomerRequest[opened_at]"], #customerrequest-opened_at')?.value || '';
    const fallbackValue = document.getElementById('__tOpenedAt')?.value || '';
    const nextSignature = JSON.stringify([cityText, requestText, dateValue, fallbackValue]);
    if (nextSignature === signature) return;
    signature = nextSignature;

    const cityDate = readDate(cityText), cityTime = readTime(cityText);
    const requestDate = readDate(dateValue) || readDate(fallbackValue) || readDate(requestText);
    const requestTime = readTime(requestText) || readTime(fallbackValue);
    const comparable = !!(cityDate && cityTime && requestDate && requestTime);
    const overdue = comparable && cityDate.stamp + cityTime.minutes * 60000 > requestDate.stamp + requestTime.minutes * 60000;

    const value = document.createElement('span');
    value.className = 'crm-request-time-value';
    value.textContent = requestTime?.text || '--:--';
    value.classList.toggle('is-overdue', overdue);
    if (overdue) value.title = `Опоздание: время города ${cityTime.text} (${cityDate.text}) позже срока заявки ${requestTime.text} (${requestDate.text})`;
    const nativeTime = readTime(requestText);
    const prefix = nativeTime ? requestText.slice(0, nativeTime.index) : 'Точное время заявки: ';
    let suffix = nativeTime ? requestText.slice(nativeTime.index + nativeTime.raw.length) : '';
    if (requestDate && !readDate(suffix)) suffix += ` (${requestDate.text})`;
    display.replaceChildren(document.createTextNode(prefix), value, document.createTextNode(suffix));
    display.dataset.overdue = String(overdue);
    display.dataset.timeState = comparable ? 'ready' : 'unknown';
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }

  function start() {
    if (!document.getElementById('crm-request-time-style')) {
      const style = document.createElement('style');
      style.id = 'crm-request-time-style';
      style.textContent = `
        .crm-native-time-source { position: absolute !important; opacity: 0 !important; pointer-events: none !important; }
        .crm-request-time-display { display: inline; }
        .crm-request-time-value { font-variant-numeric: tabular-nums; }
        .crm-request-time-value.is-overdue { color: #dc3545 !important; font-weight: 700; }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    const observer = new MutationObserver(records => {
      const cityClock = document.getElementById('cityTime');
      const relevant = node => node && (node === source || node === cityClock || source?.contains(node) || cityClock?.contains(node));
      if (records.some(record => !display?.contains(record.target) && (relevant(record.target) || [...(record.addedNodes || [])].some(node =>
        relevant(node) || node.nodeType === 1 && (node.matches?.('#crOpenedTime,#cityTime') || node.querySelector?.('#crOpenedTime,#cityTime')))))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    update();
    // CRM иногда меняет .value без события. Проверяем и такой случай.
    const timer = setInterval(() => { if (!document.hidden) schedule(); }, 5000);
    window.addEventListener('pagehide',event=>{if(!event.persisted){observer.disconnect();clearInterval(timer);}}, {once:true});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
