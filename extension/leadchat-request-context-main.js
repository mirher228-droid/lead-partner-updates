/* MAIN world. Reads native own session/presence and the current conversation cache.
 * Never refreshes authentication, fetches a conversation, or accepts write RPCs. */
(function (root, factory) {
  'use strict';
  const helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else if (root.window && root.document && !root.__LeadPartnerRequestContextMain) {
    root.__LeadPartnerRequestContextMain = helpers.install(root.window, root.document);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CHANNEL = 'leadpartner-request-context-v1', ID = /^[A-Za-z0-9_-]{1,100}$/;
  const id = value => typeof value === 'string' && ID.test(value) ? value : '';
  const itemId = value => id(value) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : '');
  const text = (value, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';
  const rows = data => Array.isArray(data?.pages) ? data.pages.flatMap(page => Array.isArray(page?.items) ? page.items : []) : Array.isArray(data?.items) ? data.items : [];
  function projectConversation(row, conversationId) {
    if (row?.id !== conversationId) return null;
    const c = row.client || {}, a = row.account || {}, item = row.item || {}, adId = itemId(item.id);
    return { conversationId, client: { id: id(c.id), name: typeof c.name === 'string' && c.name.length <= 1000 ? c.name : '', phone: typeof c.phone === 'string' && c.phone.length <= 120 ? c.phone : '', link_phone_conflict: c.link_phone_conflict === true },
      account: { id: id(a.id), title: text(a.title), lead_partner_number: typeof a.lead_partner_number === 'number' ? String(a.lead_partner_number) : text(a.lead_partner_number, 30), lead_origin: text(a.lead_origin, 200) },
      item: { url: typeof item.url === 'string' && item.url.length <= 4096 ? item.url : '', ...(adId ? {id:adId} : {}), ...(typeof item.title === 'string' ? { title: text(item.title, 400) } : {}), city_name: text(item.city_name, 120), city_slug: text(item.city_slug, 120), city_tz: text(item.city_tz, 80) } };
  }
  function cachedConversation(adapter, conversationId) {
    const detail = projectConversation(adapter.client.getQueryData(adapter.keys.conversations.detail(conversationId)), conversationId);
    if (detail) return detail;
    const prefix = adapter.keys.conversations.root;
    if (!Array.isArray(prefix) || !prefix.length) return null;
    const candidates = new Map();
    for (const query of adapter.client.getQueryCache().getAll?.() || []) {
      const key = query.queryKey;
      if (!Array.isArray(key) || key.length <= prefix.length || !prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]))) continue;
      for (const row of rows(query.state?.data)) {
        const projected = projectConversation(row, conversationId);
        if (projected) candidates.set(JSON.stringify(projected), projected);
      }
    }
    return candidates.size === 1 ? [...candidates.values()][0] : null;
  }
  function cachedMessages(adapter, conversationId) {
    if (typeof adapter.keys.messages?.list !== 'function') return { messages: [], messagesIncomplete: true };
    const data = adapter.client.getQueryData(adapter.keys.messages.list(conversationId));
    const all = rows(data), messages = all.slice(-500).filter(message => message && (!message.conversation_id || message.conversation_id === conversationId)).map(message => ({
      id: id(message.id), direction: text(message.direction, 16), sender_type: text(message.sender_type, 24), body: text(message.body, 8000), created_at: text(message.created_at, 40),
      author_id: id(message.sender?.id) || id(message.author?.id) || id(message.sender_user_id) || id(message.author_id) || id(message.sender_id),
      is_internal: message.is_internal === true || message.internal === true || ['note', 'internal'].includes(message.type || message.message_type),
      voice_transcript: text(message.voice_transcript, 8000), voice_transcript_status: text(message.voice_transcript_status, 24) }));
    const pages = Array.isArray(data?.pages) ? data.pages : data ? [data] : [];
    // Native fetchPreviousPage prepends older pages. Only the oldest loaded
    // boundary says whether history is missing; newer page cursors stay historical.
    return { messages, messagesIncomplete: !data || !pages.length || all.length > 500 || pages[0]?.page?.has_more_before === true };
  }
  function operatorIdentityOf(stores) {
    // This is the session user shown in LeadChat's own profile menu. Never
    // substitute a conversation participant, customer or message author.
    const users = new Map();
    for (const store of stores) {
      try {
        const state = store.getState(), user = state?.user;
        if (!Array.isArray(state?.permissions) || !id(user?.id)) continue;
        if (!users.has(user.id)) users.set(user.id, new Set());
        const name = typeof user.full_name === 'string' ? user.full_name.trim() : '';
        if (name && name.length <= 120 && !/[\u0000-\u001f\u007f]/.test(user.full_name) && !/[\ud800-\udfff]/u.test(name)) users.get(user.id).add(name);
      } catch (_) { /* An unrelated store may not be readable. */ }
    }
    if (users.size !== 1) return {id:'',displayName:''};
    const [operatorId, names] = [...users][0];
    return {id:operatorId,displayName:names.size === 1 ? [...names][0] : ''};
  }
  function operatorOf(stores) { return operatorIdentityOf(stores).id; }
  function identityAdapterOf(values, stores) {
    const named = key => [...new Set(values.map(value => value?.[key]).filter(value => typeof value?.getState === 'function' && typeof value?.subscribe === 'function'))];
    const sessions = named('useSessionStore'), presences = named('usePresenceStore');
    return { sessionNamed: values.some(value => value && Object.prototype.hasOwnProperty.call(value, 'useSessionStore')),
      session: sessions.length === 1 ? sessions[0] : null, presence: presences.length === 1 ? presences[0] : null, stores };
  }
  function ownIdentityOf(adapter) {
    const unavailable = { ok: false, code: 'unavailable' };
    try {
      if (!adapter.sessionNamed) {
        const operator = operatorIdentityOf(adapter.stores);
        return operator.id ? { ok: true, operatorId: operator.id, displayName: operator.displayName, presence: '' } : unavailable;
      }
      if (!adapter.session) return unavailable;
      const state = adapter.session.getState();
      // An unbootstrapped app is still loading. Only explicit signed-out state
      // can clear a previously captured account.
      if (state?.user === null) return state.bootstrapped === true ? { ok: true, operatorId: '', displayName: '', presence: '' } : unavailable;
      const operator = operatorIdentityOf([{ getState: () => state }]);
      if (!operator.id) return unavailable;
      let presence = '';
      try { const status = adapter.presence?.getState()?.status; if (status === 'online' || status === 'away') presence = status; } catch (_) {}
      return { ok: true, operatorId: operator.id, displayName: operator.displayName, presence };
    } catch (_) { return unavailable; }
  }
  function install(win, doc) {
    if (!['188-225-34-82.sslip.io', '72-56-68-159.sslip.io', 'chat.partner-lead-centre.ru'].includes(win.location.hostname)) return { version: '1.0.0', enabled: false };
    let adapter = null, loading = null, revision = 0, notification = null, identityNotification = null;
    const current = () => /^\/chats\/([A-Za-z0-9_-]{1,100})\/?$/.exec(win.location.pathname)?.[1] || '';
    const emit = data => win.postMessage({ channel: CHANNEL, ...data }, win.location.origin);
    const changed = () => { revision++; if (notification !== null) return; notification = win.setTimeout(() => { notification = null; emit({ kind: 'changed', conversationId: current(), revision }); }, 40); };
    const identityChanged = () => { if (identityNotification !== null) return; identityNotification = win.setTimeout(() => { identityNotification = null; emit({ kind: 'identity-changed' }); }, 40); };
    async function load() {
      if (adapter) return adapter;
      if (loading) return loading;
      loading = (async () => {
        const entry = [...doc.querySelectorAll('script[type="module"][src]')].find(node => { try { const url = new URL(node.src, win.location.href); return url.origin === win.location.origin && /^\/assets\/(?:[\w.-]+\/)*index-[\w-]+\.js$/.test(url.pathname); } catch (_) { return false; } });
        if (!entry) throw new Error('Дождитесь загрузки интерфейса LeadChat.');
        // Import the same already-loaded app entry. Only its query cache and
        // projected own session ID/name/presence are read; credentials never cross worlds.
        const values = Object.values(await import(entry.src));
        const client = values.find(value => value && typeof value.getQueryData === 'function' && typeof value.getQueryCache === 'function');
        const keys = values.find(value => typeof value?.conversations?.detail === 'function');
        const stores = values.filter(value => typeof value?.getState === 'function');
        const identity = identityAdapterOf(values, stores);
        adapter = { client, keys, stores, identity };
        client?.getQueryCache().subscribe?.(changed);
        const identityStores = identity.sessionNamed ? [identity.session, identity.presence].filter(Boolean) : stores;
        for (const store of new Set([...stores, ...identityStores])) store.subscribe?.(() => {
          if (stores.includes(store)) changed();
          if (identityStores.includes(store)) identityChanged();
        });
        return adapter;
      })();
      try { return await loading; } finally { loading = null; }
    }
    win.addEventListener('message', async event => {
      const message = event.data;
      if (event.source !== win || event.origin !== win.location.origin || message?.channel !== CHANNEL || message.kind !== 'request' || !['read','read-identity'].includes(message.action) || !id(message.id)) return;
      let result;
      try {
        if (message.action === 'read-identity') {
          result = ownIdentityOf((await load()).identity);
          emit({ kind: 'response', id: message.id, result });
          return;
        }
        if (!id(message.conversationId) || current() !== message.conversationId) throw new Error('Диалог изменился.');
        const a = await load();
        if (current() !== message.conversationId) throw new Error('Диалог изменился.');
        if (!a.client || !a.keys) throw new Error('Интерфейс LeadChat изменился. Контекст недоступен.');
        const conversation = cachedConversation(a, message.conversationId);
        if (!conversation) throw new Error('Данные открытого диалога ещё не загружены.');
        const operator = operatorIdentityOf(a.stores);
        result = { ok: true, ...conversation, operatorId: operator.id, operatorName: operator.displayName, ...cachedMessages(a, message.conversationId), revision };
      } catch (error) { result = { ok: false, code: 'unavailable', error: error.message || 'Контекст недоступен.' }; }
      emit({ kind: 'response', id: message.id, result });
    });
    return Object.freeze({ version: '1.0.0', enabled: true });
  }
  return Object.freeze({ projectConversation, cachedConversation, cachedMessages, operatorIdentityOf, operatorOf, install });
});
