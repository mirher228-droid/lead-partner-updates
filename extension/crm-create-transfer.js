// MAIN: читаем только переносимые поля, открываем карточку клиента и восстанавливаем черновик.
(() => {
  'use strict';
  if (window.__CRM_CREATE_TRANSFER__) return;
  if (!/^\/admin\/domain\/customer-request\/create\/?$/.test(location.pathname)) return;
  const fieldIds = [
    'customer-phone', 'customer-phone_extra_1', 'customer-phone_extra_2', 'customer-phone_extra_3',
    'customer-first_name', 'customer-age', 'customer-address_locality', 'customer-address_street',
    'customer-address_building', 'customer-address_office', 'customer-address_entrance', 'customer-address_floor',
    'customer-address_has_intercom', 'customer-address_fias', 'customer-location',
    'customerrequest-address_locality', 'customerrequest-comments', 'customerrequest-comments_service',
    'customerrequest-date_changes', 'customerrequest-type', 'customerrequest-opened_at',
    'customerrequest-is_need_call_before_visit', 'customerrequest-is_need_call_check',
    'customerrequest-is_urgent', 'customerrequest-is_req_fback', 'customerrequest-is_zakrep',
  ];
  const pending = new Map();
  const byId = id => document.getElementById(id);
  function rpc(operation, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Не удалось связаться с расширением. Перезагрузите страницу.')); }, 8000);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ ...payload, channel: 'lp-create-transfer-v1', kind: 'request', id, operation }, location.origin);
    });
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || !message
        || message.channel !== 'lp-create-transfer-v1' || message.kind !== 'response') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer); pending.delete(message.id);
    if (message.result && message.result.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.result && message.result.error || 'Ошибка переноса формы'));
  });
  function notice(text, error = false) {
    let box = byId('lp-create-transfer-notice');
    if (!box) {
      box = document.createElement('div'); box.id = 'lp-create-transfer-notice';
      box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:440px;padding:14px 18px;border-radius:12px;background:#12251e;color:#e7fff1;border:1px solid #64b996;box-shadow:0 4px 20px #0004;font:14px/1.5 system-ui;';
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent = text;
    box.setAttribute('role', error ? 'alert' : 'status');
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Закрыть');
    close.style.cssText = 'margin-left:12px;background:transparent;color:inherit;border:0;font-size:20px;cursor:pointer;';
    close.addEventListener('click', () => box.remove()); box.appendChild(close);
    if (!error) setTimeout(() => { if (box.isConnected) box.remove(); }, 8000);
  }
  function selected(id) {
    const el = byId(id);
    const option = el && Array.from(el.options).find(item => item.value && item.value === el.value);
    return option ? { label: option.textContent.trim() } : null;
  }
  function capture() {
    const draft = { fields: {}, city: selected('customerrequest-city_id'), partner: selected('customerrequest-partner_id') };
    for (const id of fieldIds) {
      const el = byId(id); if (el) draft.fields[id] = el.type === 'checkbox' ? Boolean(el.checked) : String(el.value || '');
    }
    if (draft.city) draft.city.region = (window.citiesWithRegions || {})[byId('customerrequest-city_id').value] || '';
    // Клиент, выбранный через поиск, может хранить заполненные поля в Select2.
    try {
      const client = byId('customerrequest-customer_id');
      if (client && client.value && !window.newCustomerEnabled && typeof window.jQuery === 'function') {
        const data = window.jQuery(client).select2('data')[0] || {};
        for (const id of fieldIds.filter(item => item.startsWith('customer-'))) {
          const key = id.slice('customer-'.length);
          if (!draft.fields[id] && data[key] != null) draft.fields[id] = String(data[key]);
        }
        if (!draft.fields['customer-first_name'] && data.full_name) draft.fields['customer-first_name'] = String(data.full_name);
      }
    } catch (_) { /* Карточка нового клиента не использует Select2. */ }
    return draft;
  }
  const normalize = text => String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s‐‑–—-]+/g, ' ').trim();
  function cityName(text) {
    let bare = String(text || '');
    // В справочнике встречаются вложенные подписи «Коммунарка (Подольск (МСК))».
    for (let i = 0; i < 10 && /\([^()]*\)/.test(bare); i++) bare = bare.replace(/\([^()]*\)/g, '');
    const name = normalize(bare).replace(/^(?:г\.?|город)\s+/u, '').replace(/\s+\d+$/, '').trim();
    return ({ 'спб': 'санкт петербург', 'питер': 'санкт петербург', 'с петербург': 'санкт петербург', 'мск': 'москва' })[name] || name;
  }
  function sameCity(a, b) {
    const first = cityName(a), second = cityName(b);
    if (first === second) return true;
    // В КП есть объединённый пункт, соответствующий двум географическим городам.
    const group = ['керчь', 'феодосия', 'керчь феодосия'];
    return group.includes(first) && group.includes(second) && (first === 'керчь феодосия' || second === 'керчь феодосия');
  }
  function matchCity(select, city, regions = window.citiesWithRegions || {}) {
    if (!select || !city || !city.label) return null;
    const all = Array.from(select.options).filter(option => option.value && !option.disabled);
    let matches = all.filter(option => normalize(option.textContent) === normalize(city.label));
    if (!matches.length) matches = all.filter(option => sameCity(option.textContent, city.label));
    if (matches.length > 1 && city.region) {
      const narrowed = matches.filter(option => normalize(regions[option.value]) === normalize(city.region));
      if (narrowed.length) matches = narrowed;
    }
    return matches.length === 1 ? matches[0] : null;
  }
  function matchLabel(select, item) {
    if (!select || !item) return null;
    const matches = Array.from(select.options).filter(option => option.value && !option.disabled && normalize(option.textContent) === normalize(item.label));
    return matches.length === 1 ? matches[0] : null;
  }
  function setField(el, value) {
    if (!el || el.disabled) return false;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else if (el.tagName === 'SELECT') {
      if (!Array.from(el.options).some(option => option.value === String(value) && !option.disabled)) return false;
      el.value = String(value);
    } else if (el.inputmask && typeof el.inputmask.setValue === 'function') el.inputmask.setValue(String(value));
    else {
      el.value = String(value);
      if (el.inputmask && typeof window.jQuery === 'function') window.jQuery(el).trigger('setvalue');
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function applyDraft(draft) {
    const warnings = [];
    window.__CRM_CREATE_TRANSFER_APPLYING__ = true;
    const form = byId('customerRequestForm');
    if (form) form.dataset.lpTransferApplying = '1';
    try {
      const card = byId('newCustomer');
      const hasCustomer = Object.entries(draft.fields).some(([key, value]) => key.startsWith('customer-') && value !== '');
      if (card && hasCustomer) {
        const jq = window.jQuery;
        if (typeof jq === 'function' && jq.fn && typeof jq.fn.collapse === 'function') jq(card).collapse('show');
        else { card.classList.add('show'); window.newCustomerEnabled = true; }
        // Внутренний ID клиента принадлежит исходной базе и не переносится.
        setField(byId('customerrequest-customer_id'), '');
        window.newCustomerEnabled = true;
        window.newCustomerExists = false;
      }
      if (draft.city) {
        const city = byId('customerrequest-city_id'); const option = matchCity(city, draft.city);
        if (option) setField(city, option.value);
        else { setField(city, ''); warnings.push('Выберите город: «' + draft.city.label + '» — в этой базе нет однозначного совпадения.'); }
      }
      const entries = Object.entries(draft.fields).sort(([a], [b]) =>
        Number(b === 'customer-address_building') - Number(a === 'customer-address_building'));
      for (const [id, value] of entries) {
        // Другие модули видят dataset и в ISOLATED world: комментарий переносится дословно.
        const el = byId(id);
        if (id === 'customerrequest-comments' && el) el.dataset.lpTransferValue = String(value);
        if (fieldIds.includes(id) && !setField(byId(id), value) && value !== '' && value !== false) warnings.push('Проверьте поле «' + id.replace(/^customer(?:request)?-/, '') + '».');
      }
      for (const [id, item] of [['customerrequest-partner_id', draft.partner]]) {
        const el = byId(id), option = matchLabel(el, item);
        if (option) setField(el, option.value);
      }
      window.app_formIsChanged = true;
    } finally {
      if (form) delete form.dataset.lpTransferApplying;
      window.__CRM_CREATE_TRANSFER_APPLYING__ = false;
      document.dispatchEvent(new Event('crm-create-transfer-applied'));
    }
    return warnings;
  }
  let restoring = false;
  async function restore() {
    if (restoring) return;
    restoring = true;
    const token = new URL(location.href).searchParams.get('lp_transfer') || '';
    try {
      const saved = await rpc('get', { token });
      if (!saved.draft) { if (token) notice('Черновик переноса не найден или истёк. Вернитесь в исходную базу и повторите перенос.', true); return; }
      let attempts = 0;
      const waitForForm = () => {
        if (!byId('customerRequestForm') || !byId('customerrequest-comments') || !byId('customer-phone') || !byId('customerrequest-city_id')) {
          if (++attempts < 60) return setTimeout(waitForForm, 250);
          notice('Форма ещё не загрузилась. Черновик сохранён — перезагрузите страницу.', true); return;
        }
        try {
          const warnings = applyDraft(saved.draft);
          rpc('ack', { token: saved.token }).then(() => {
            const clean = new URL(location.href); clean.searchParams.delete('lp_transfer');
            history.replaceState(history.state, '', clean.toString());
          }).catch(() => notice('Не удалось удалить временный черновик; обновите расширение.', true));
          if (warnings.length) notice(warnings.join(' '), true);
        } catch (_) { notice('Не удалось полностью заполнить форму. Черновик сохранён — перезагрузите страницу.', true); }
      };
      // Нативные collapse/Inputmask и обработчики CRM подключаются в ready + setTimeout.
      setTimeout(waitForForm, 800);
    } catch (error) { if (token) notice(error.message, true); }
  }
  window.__CRM_CREATE_TRANSFER__ = { capture, save: (draft, targetHost) => rpc('save', { draft, targetHost }), notice };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore, { once: true });
  else restore();
})();
