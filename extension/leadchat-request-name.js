/* Imported by the extension worker only. The worker must validate a saved CRM
 * journal proof before injecting this function into the proven LeadChat tab.
 * No page message can invoke this operation. All helpers stay inside the function
 * so chrome.scripting.executeScript can serialize it without external bindings. */
(function (root) {
  'use strict';
  async function appendVerifiedCreatedId(input) {
    const fail = (code, error, extra = {}) => ({ ok: false, changed: false, code, error, ...extra });
    const ID = /^[A-Za-z0-9_-]{1,100}$/;
    const valid = value => typeof value === 'string' && ID.test(value);
    const expected = input?.expected, requestId = input?.requestId;
    if (!expected || !valid(expected.operatorId) || !valid(expected.accountId) || !valid(expected.clientId) || !valid(expected.conversationId) || typeof requestId !== 'string' || !/^[1-9]\d{0,11}$/.test(requestId) || requestId !== expected.requestId) return fail('context', 'Нет подтверждённого контекста созданной заявки.');
    let expectedUrl;
    try {
      expectedUrl = new URL(input.conversationUrl);
      if (!['http:', 'https:'].includes(expectedUrl.protocol) || !['188-225-34-82.sslip.io', '72-56-68-159.sslip.io', 'chat.partner-lead-centre.ru'].includes(expectedUrl.hostname) || expectedUrl.username || expectedUrl.password || expectedUrl.port || expectedUrl.pathname !== '/chats/' + expected.conversationId || expectedUrl.search || expectedUrl.hash) throw Error();
    } catch (_) { return fail('route', 'Не подтверждён адрес диалога LeadChat.'); }
    const routeMatches = () => location.origin === expectedUrl.origin && /^\/chats\/([A-Za-z0-9_-]{1,100})\/?$/.exec(location.pathname)?.[1] === expected.conversationId;
    if (!routeMatches()) return fail('route', 'Открыт другой диалог. Номер к имени не добавлен.');
    let client, keys, stores, api, writeStarted = false;
    // HTTP LeadChat has no Web Locks API. This page-local queue still protects
    // concurrent injections; the worker also serializes injections across tabs.
    const queueSlot = '__LP_VERIFIED_CLIENT_NAME_QUEUE_V1__';
    if (!(globalThis[queueSlot] instanceof Map)) globalThis[queueSlot] = new Map();
    const queues = globalThis[queueSlot], queueKey = expectedUrl.origin + '|' + expected.clientId;
    let queue = queues.get(queueKey);
    if (!queue) { queue = { tail: Promise.resolve(), uncertainId: '' }; queues.set(queueKey, queue); }
    const safeName = value => typeof value === 'string' && value.trim() && value.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
    function scope() {
      if (!routeMatches()) return null;
      const operators = new Set();
      for (const store of stores) {
        try { const state = store.getState(); if (Array.isArray(state?.permissions) && valid(state?.user?.id)) operators.add(state.user.id); } catch (_) { /* Ignore unrelated stores. */ }
      }
      if (operators.size !== 1 || !operators.has(expected.operatorId)) return null;
      const row = client.getQueryData(keys.conversations.detail(expected.conversationId));
      return row?.id === expected.conversationId && row.account?.id === expected.accountId && row.client?.id === expected.clientId ? row : null;
    }
    async function deadline(start, writing = false) {
      let timer, timedOut = false; const controller = new AbortController();
      try {
        return await Promise.race([start(controller.signal), new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; const error = new Error('deadline'); error.timedOut = true; error.writing = writing; controller.abort(); reject(error); }, 12000); })]);
      } catch (error) { if (timedOut) { const timeout = new Error('deadline'); timeout.timedOut = true; timeout.writing = writing; throw timeout; } throw error;
      } finally { clearTimeout(timer); }
    }
    function identityName(value) {
      if (!value || (value.id !== undefined && value.id !== expected.clientId) || (value.client_id !== undefined && value.client_id !== expected.clientId)) return '';
      return safeName(value.name);
    }
    function wholePhone(value) {
      // Keep the native context's complete-phone grammar local: injected
      // functions cannot depend on the extension's context module.
      let text = value.normalize('NFKC').trim();
      if (!text || text.length > 120 || /[^\d+().\-\u2010-\u2015 \t]/u.test(text)) return false;
      const calendar = text.replace(/[ \t]*([.-])[ \t]*/g, '$1');
      if (/^(?:0?[1-9]|[12]\d|3[01])[.-](?:0?[1-9]|1[0-2])[.-](?:(?:19|20)\d{2}|\d{2})(?=$|[^\d])/u.test(calendar)) return false;
      text = text.replace(/[\u2010-\u2015]/g, '-').replace(/[ \t]/g, '');
      if (/^\(\d{10,11}\)$/.test(text)) text = text.slice(1, -1);
      if (!/^\+?[\d(][\d().-]*\d$/.test(text) || /[.-]{2}/.test(text) || text.startsWith('+') && !text.startsWith('+7')) return false;
      if (/[()]/.test(text) && !/^([^()]*)\(\d{3}\)([^()]*)$/.test(text)) return false;
      const digits = text.replace(/\D/g, '');
      const national = /^[78]\d{10}$/.test(digits) ? digits.slice(1) : /^\d{10}$/.test(digits) && !text.startsWith('+') ? digits : '';
      return /^[3489]\d{9}$/.test(national);
    }
    function nameParts(name) {
      // Only a trailing chain of ordinary CRM IDs belongs to this suffix.
      // Short numbers, full phone numbers and digits inside a name remain
      // untouched. Keep all previous IDs in their existing relative order.
      const tail = /(?:^|\s)((?:№\s*)?[1-9]\d{4,8}(?:(?:\s*\/\s*|\s+)(?:№\s*)?[1-9]\d{4,8})*)\s*$/u.exec(name);
      if (!tail) return { prefix: name, ids: [] };
      const tokens = [...tail[1].matchAll(/[1-9]\d{4,8}/gu)];
      let prefix = name.slice(0, tail.index).trimEnd(), phoneIds = [];
      // A phone may overlap one or several leading numeric tokens, e.g.
      // "999 1234567" or "99912 34567". Preserve the complete phone,
      // including when actual CRM IDs follow it. № and / are not phone text.
      const phonePrefix = prefix.match(/[+(\d][\d\s().\-–—]*$/u)?.[0] || '';
      for (let count = 1; count <= tokens.length; count++) {
        const last = tokens[count - 1], phoneTail = tail[1].slice(0, last.index + last[0].length);
        if (!wholePhone(phonePrefix + phoneTail)) continue;
        const chainStart = tail.index + tail[0].indexOf(tail[1]);
        prefix = name.slice(0, chainStart + last.index + last[0].length);
        phoneIds = tokens.splice(0, count).map(token => token[0]);
        break;
      }
      return { prefix, ids: [...new Set(tokens.map(token => token[0]))], phoneIds };
    }
    const hasId = (name, wantedId = requestId) => {
      if (!new RegExp('(?:^|[\\s/])(?:№\\s*)?' + wantedId + '(?=$|[\\s/])').test(name)) return false;
      const parts = nameParts(name);
      return !parts.phoneIds?.includes(wantedId) || parts.ids.includes(wantedId);
    };
    function withNewestId(name) {
      const parts = nameParts(name);
      return [parts.prefix, [requestId, ...parts.ids].join(' / ')].filter(Boolean).join(' ');
    }
    function reflectName(name, cachedName, previousName = cachedName) {
      if (typeof client.setQueryData !== 'function') return;
      try {
        // A verified server save remains successful even if refreshing the
        // app's in-memory display fails. Never overwrite a newer native edit.
        const previous = new Set([cachedName, previousName]);
        const rename = row => row?.client?.id === expected.clientId && previous.has(safeName(row.client.name)) ? { ...row, client: { ...row.client, name } } : row;
        const renameItems = items => { const changed = items.map(rename); return changed.some((row, i) => row !== items[i]) ? changed : items; };
        const candidates = [keys.conversations.detail(expected.conversationId), ['clients', 'identity', expected.clientId]];
        for (const query of client.getQueryCache().getAll?.() || []) {
          const prefix = keys.conversations.root, key = query.queryKey;
          if (Array.isArray(prefix) && Array.isArray(key) && prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]))) candidates.push(key);
        }
        const seen = new Set();
        for (const key of candidates) {
          const signature = JSON.stringify(key); if (seen.has(signature)) continue; seen.add(signature);
          client.setQueryData(key, old => {
            if (!old || typeof old !== 'object') return old;
            if (key[0] === 'clients') return (old.id === undefined || old.id === expected.clientId) && (old.client_id === undefined || old.client_id === expected.clientId) && previous.has(safeName(old.name)) ? { ...old, name } : old;
            if (old.id) return rename(old);
            if (Array.isArray(old.pages)) { const pages = old.pages.map(page => { if (!Array.isArray(page?.items)) return page; const items = renameItems(page.items); return items === page.items ? page : { ...page, items }; }); return pages.some((page, i) => page !== old.pages[i]) ? { ...old, pages } : old; }
            if (Array.isArray(old.items)) { const items = renameItems(old.items); return items === old.items ? old : { ...old, items }; }
            return old;
          });
        }
      } catch (_) { /* The native display can refresh on its next normal read. */ }
    }
    async function perform() { try {
      const entry = [...document.querySelectorAll('script[type="module"][src]')].find(node => { try { const u = new URL(node.src, location.href); return u.origin === location.origin && /^\/assets\/(?:[\w.-]+\/)*index-[\w-]+\.js$/.test(u.pathname); } catch (_) { return false; } });
      if (!entry) return fail('unavailable', 'Интерфейс LeadChat ещё не загружен. Номер к имени не добавлен.');
      const values = Object.values(await deadline(() => import(entry.src)));
      client = values.find(value => value && typeof value.getQueryData === 'function' && typeof value.getQueryCache === 'function');
      keys = values.find(value => typeof value?.conversations?.detail === 'function');
      stores = values.filter(value => typeof value?.getState === 'function');
      api = values.find(value => value && ['get', 'patch', 'post', 'del'].every(method => typeof value[method] === 'function'));
      // The site's known API exposes get/patch/post/del. PUT is used only when
      // the currently loaded client explicitly provides it; no guessed signature,
      // copied bearer token, alternate method, or authentication refresh is used.
      if (!client || !keys || !api || (input.verifyOnly !== true && typeof api.put !== 'function')) return fail('unsupported', 'Текущий интерфейс LeadChat не предоставляет подтверждённый способ сохранить имя. Добавьте номер вручную.');
      const row = scope();
      if (!row) return fail('scope', 'Диалог, канал или сотрудник изменились. Номер к имени не добавлен.');
      const cachedName = safeName(row.client.name);
      if (!cachedName) return fail('name', 'Не удалось прочитать имя клиента. Номер к имени не добавлен.');
      const path = '/clients/' + encodeURIComponent(expected.clientId);
      const latest = identityName(await deadline(signal => api.get(path + '/identity', { signal })));
      const beforeWrite = scope();
      if (!beforeWrite || safeName(beforeWrite.client.name) !== cachedName) return fail('scope', 'Контекст или имя клиента изменились во время проверки. Номер к имени не добавлен.');
      if (!latest) return fail('name', 'LeadChat не подтвердил текущее имя клиента. Номер к имени не добавлен.');
      if (input.verifyOnly === true) {
        if (!hasId(latest)) return fail('verification', 'Номер заявки пока не подтверждён в имени клиента. Проверьте имя вручную.', { unknown: true });
        if (queue.uncertainId === requestId) queue.uncertainId = '';
        reflectName(latest, cachedName); return { ok: true, changed: false, verified: true, name: latest };
      }
      if (queue.uncertainId && !hasId(latest, queue.uncertainId)) return fail('previous_unknown', 'Предыдущее изменение имени ещё не подтверждено. Проверьте имя клиента перед новым добавлением номера.', { unknown: true });
      queue.uncertainId = '';
      if (hasId(latest)) { reflectName(latest, cachedName); return { ok: true, changed: false, verified: true, name: latest }; }
      const desired = withNewestId(latest);
      if (desired.length > 1000) return fail('name', 'Имя клиента слишком длинное. Добавьте номер вручную.');
      writeStarted = true;
      await deadline(signal => api.put(path + '/name', { name: desired }, { signal }), true);
      // CRM creation is already complete. Any failure from here reports only
      // this name update and must never trigger another CRM creation or PUT.
      if (!scope()) { queue.uncertainId = requestId; return fail('scope', 'LeadChat принял запрос имени, но сотрудник или диалог изменились. Проверьте имя клиента.', { changed: true, unknown: true }); }
      const savedName = identityName(await deadline(signal => api.get(path + '/identity', { signal })));
      if (savedName !== desired) { queue.uncertainId = requestId; return fail('verification', 'Номер отправлен в LeadChat, но новое имя не подтверждено. Проверьте имя клиента.', { changed: true, unknown: true }); }
      if (!scope()) return fail('scope', 'Имя сохранено, но контекст диалога изменился во время проверки.', { changed: true, unknown: true });
      reflectName(savedName, cachedName, latest);
      return { ok: true, changed: true, verified: true, name: savedName };
    } catch (error) {
      if (writeStarted) queue.uncertainId = requestId;
      return fail(error?.timedOut ? 'timeout' : 'unavailable', writeStarted ? 'Нет подтверждения изменения имени в LeadChat. Проверьте имя клиента перед повтором.' : 'Не удалось проверить имя клиента в LeadChat. Номер не добавлен.', writeStarted ? { unknown: true } : {});
    } }
    let expired = false, waitTimer;
    const previous = queue.tail;
    const job = previous.catch(() => {}).then(() => {
      clearTimeout(waitTimer);
      if (expired) return fail('busy', 'Обновление имени клиента уже выполняется. Проверьте его результат.');
      return perform();
    });
    queue.tail = job.then(() => {}, () => {});
    return Promise.race([job, new Promise(resolve => { waitTimer = setTimeout(() => { expired = true; resolve(fail('busy', 'Обновление имени клиента уже выполняется. Проверьте его результат.')); }, 12000); })]);
  }
  const workerQueues = new Map();
  async function withClientLock(clientKey, task) {
    const previous = workerQueues.get(clientKey) || Promise.resolve();
    const job = previous.catch(() => {}).then(task);
    const tail = job.then(() => {}, () => {}); workerQueues.set(clientKey, tail);
    try { return await job; } finally { if (workerQueues.get(clientKey) === tail) workerQueues.delete(clientKey); }
  }
  const api = Object.freeze({ appendVerifiedCreatedId, withClientLock });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (!root.LeadChatRequestName) root.LeadChatRequestName = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
