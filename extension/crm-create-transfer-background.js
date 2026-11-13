// Черновик создания заявки: только текущая вкладка, память сессии браузера, 15 минут.
(() => {
  'use strict';
  const hosts = ['kp-lead-centre.ru', 'mnc-lead-centre.ru', 'bt-lead-centre.ru'];
  const prefix = 'lpCreateTransfer:';
  const ttl = 15 * 60 * 1000;
  const fields = new Set([
    'customer-phone', 'customer-phone_extra_1', 'customer-phone_extra_2', 'customer-phone_extra_3',
    'customer-first_name', 'customer-age', 'customer-address_locality', 'customer-address_street',
    'customer-address_building', 'customer-address_office', 'customer-address_entrance', 'customer-address_floor',
    'customer-address_has_intercom', 'customer-address_fias', 'customer-location',
    'customerrequest-address_locality', 'customerrequest-comments', 'customerrequest-comments_service',
    'customerrequest-date_changes', 'customerrequest-type', 'customerrequest-opened_at',
    'customerrequest-is_need_call_before_visit', 'customerrequest-is_need_call_check',
    'customerrequest-is_urgent', 'customerrequest-is_req_fback', 'customerrequest-is_zakrep',
  ]);
  function cleanDraft(draft) {
    if (!draft || typeof draft !== 'object' || !draft.fields || typeof draft.fields !== 'object') throw new Error('Некорректные данные формы');
    const result = { fields: {} };
    for (const [key, value] of Object.entries(draft.fields)) {
      if (!fields.has(key)) continue;
      if (typeof value === 'boolean') result.fields[key] = value;
      else if (typeof value === 'string' && value.length <= (key.includes('comments') || key.includes('date_changes') ? 30000 : 2000)) result.fields[key] = value;
      else throw new Error('Слишком большое или некорректное значение поля');
    }
    for (const key of ['city', 'partner']) {
      if (!draft[key]) continue;
      const label = draft[key].label;
      const region = draft[key].region || '';
      if (typeof label !== 'string' || label.length > 500 || typeof region !== 'string' || region.length > 500) throw new Error('Некорректный пункт справочника');
      result[key] = { label, region };
    }
    return result;
  }
  async function handle(request, sender) {
    let url;
    try { url = new URL(sender.url); } catch (_) { throw new Error('Неизвестная страница'); }
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname)
        || !/^\/admin\/domain\/customer-request\/create\/?$/.test(url.pathname)
        || !Number.isInteger(sender.tab && sender.tab.id) || (sender.frameId || 0) !== 0) throw new Error('Перенос доступен на странице создания заявки');
    const key = prefix + sender.tab.id;
    if (request.operation === 'save') {
      if (!hosts.includes(request.targetHost) || request.targetHost === url.hostname) throw new Error('Неизвестная база назначения');
      const token = crypto.randomUUID();
      const record = { token, targetHost: request.targetHost, savedAt: Date.now(), draft: cleanDraft(request.draft) };
      await chrome.storage.session.set({ [key]: record });
      return { ok: true, token };
    }
    const record = (await chrome.storage.session.get(key))[key];
    if (!record) return { ok: true, draft: null };
    if (Date.now() - record.savedAt > ttl) { await chrome.storage.session.remove(key); return { ok: true, draft: null }; }
    if (record.targetHost !== url.hostname || (request.token && request.token !== record.token)) return { ok: true, draft: null };
    if (request.operation === 'get') return { ok: true, token: record.token, draft: record.draft };
    if (request.operation === 'ack' && request.token === record.token) {
      await chrome.storage.session.remove(key);
      return { ok: true };
    }
    throw new Error('Неизвестная операция');
  }
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (!request || request.action !== 'lpCreateTransfer' || !['save', 'get', 'ack'].includes(request.operation)) return;
    handle(request, sender).then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove(prefix + tabId).catch(() => {}); });
})();
