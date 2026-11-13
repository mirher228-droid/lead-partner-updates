// ISOLATED: единственный доступ формы к временному хранилищу расширения.
(() => {
  'use strict';
  if (window.__LP_CREATE_TRANSFER_BRIDGE__) return;
  window.__LP_CREATE_TRANSFER_BRIDGE__ = true;
  if (!/^\/admin\/domain\/customer-request\/create\/?$/.test(location.pathname)) return;
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || !message
        || message.channel !== 'lp-create-transfer-v1' || message.kind !== 'request'
        || typeof message.id !== 'string' || message.id.length > 100
        || !['save', 'get', 'ack'].includes(message.operation)) return;
    const respond = result => window.postMessage({ channel: message.channel, kind: 'response', id: message.id, result }, location.origin);
    try {
      chrome.runtime.sendMessage({ action: 'lpCreateTransfer', operation: message.operation,
        targetHost: message.targetHost, token: message.token, draft: message.draft }, result => {
        const error = chrome.runtime.lastError;
        respond(error ? { ok: false, error: 'Перезагрузите страницу после обновления расширения' } : result || { ok: false, error: 'Нет ответа от расширения' });
      });
    } catch (_) { respond({ ok: false, error: 'Перезагрузите страницу после обновления расширения' }); }
  });
})();
