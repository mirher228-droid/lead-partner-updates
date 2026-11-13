const CRM_PAGE_SOURCE = '__crmExtensionPageBridge';
const CRM_BRIDGE_SOURCE = '__crmExtensionContentBridge';
const CRM_HELLO_INTERVAL_MS = 50;
const CRM_HELLO_TIMEOUT_MS = 5000;

function crmCreateBridgeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `crm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const crmBridgeState = {
  pageId: crmCreateBridgeId(),
  bridgeReady: false,
  cache: {},
  listeners: new Map(),
  nextListenerId: 1,
  pendingMessages: [],
  pendingRequests: new Map(),
  helloTimerId: null,
  helloStartedAt: 0
};

function crmHasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function crmPostToBridge(message) {
  window.postMessage(
    {
      source: CRM_PAGE_SOURCE,
      pageId: crmBridgeState.pageId,
      ...message
    },
    '*'
  );
}

function crmStartHelloLoop() {
  if (crmBridgeState.helloTimerId) return;

  const sendHello = () => crmPostToBridge({ type: 'CRM_BRIDGE_HELLO' });

  crmBridgeState.helloStartedAt = Date.now();
  sendHello();

  crmBridgeState.helloTimerId = window.setInterval(() => {
    if (crmBridgeState.bridgeReady) {
      window.clearInterval(crmBridgeState.helloTimerId);
      crmBridgeState.helloTimerId = null;
      return;
    }

    if (Date.now() - crmBridgeState.helloStartedAt > CRM_HELLO_TIMEOUT_MS) {
      window.clearInterval(crmBridgeState.helloTimerId);
      crmBridgeState.helloTimerId = null;
      return;
    }

    sendHello();
  }, CRM_HELLO_INTERVAL_MS);
}

function crmQueueBridgeMessage(message) {
  if (crmBridgeState.bridgeReady) {
    crmPostToBridge(message);
    return;
  }
  crmBridgeState.pendingMessages.push(message);
}

function crmFlushBridgeQueue() {
  if (!crmBridgeState.bridgeReady || !crmBridgeState.pendingMessages.length) return;

  const queuedMessages = crmBridgeState.pendingMessages.splice(0, crmBridgeState.pendingMessages.length);
  queuedMessages.forEach((message) => crmPostToBridge(message));
}

function crmMergeInitialState(initialState) {
  if (!initialState || typeof initialState !== 'object') return;
  crmBridgeState.cache = { ...initialState, ...crmBridgeState.cache };
}

function crmNotifyValueListeners(key, oldValue, newValue, remote) {
  crmBridgeState.listeners.forEach((listener) => {
    if (listener.key !== key) return;
    try {
      listener.callback(key, oldValue, newValue, remote);
    } catch (error) {
      console.error('CRM bridge listener error:', error);
    }
  });
}

function crmEnsureStylesParent() {
  return document.head || document.documentElement || document.body;
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.source !== CRM_BRIDGE_SOURCE || typeof data.type !== 'string') return;

  if (data.type === 'CRM_BRIDGE_READY') {
    crmBridgeState.bridgeReady = true;
    crmMergeInitialState(data.state);

    if (crmBridgeState.helloTimerId) {
      window.clearInterval(crmBridgeState.helloTimerId);
      crmBridgeState.helloTimerId = null;
    }

    crmFlushBridgeQueue();
    return;
  }

  if (data.type === 'CRM_BRIDGE_VALUE_CHANGED') {
    const hadValue = crmHasOwn(crmBridgeState.cache, data.key);
    const oldValue = hadValue ? crmBridgeState.cache[data.key] : data.oldValue;

    if (typeof data.newValue === 'undefined') {
      delete crmBridgeState.cache[data.key];
    } else {
      crmBridgeState.cache[data.key] = data.newValue;
    }

    crmNotifyValueListeners(data.key, oldValue, data.newValue, Boolean(data.remote));
    return;
  }

  if (data.type === 'CRM_BRIDGE_XMLHTTP_RESPONSE') {
    const pendingRequest = crmBridgeState.pendingRequests.get(data.requestId);
    if (!pendingRequest || pendingRequest.aborted) {
      crmBridgeState.pendingRequests.delete(data.requestId);
      return;
    }

    crmBridgeState.pendingRequests.delete(data.requestId);

    const response = {
      status: data.status || 0,
      readyState: 4,
      responseHeaders: data.headers || '',
      responseText: data.responseText || '',
      finalUrl: data.finalUrl || pendingRequest.details.url
    };

    if (data.ok) {
      pendingRequest.details.onload?.(response);
      return;
    }

    if (data.timedOut) {
      pendingRequest.details.ontimeout?.(response);
      return;
    }

    pendingRequest.details.onerror?.({
      ...response,
      error: data.error || 'Request failed'
    });
  }
});

function GM_addStyle(css) {
  const parent = crmEnsureStylesParent();
  if (!parent) return null;

  const style = document.createElement('style');
  style.textContent = String(css || '');
  parent.appendChild(style);
  return style;
}

function GM_setClipboard(text) {
  crmQueueBridgeMessage({
    type: 'CRM_BRIDGE_SET_CLIPBOARD',
    text: String(text ?? '')
  });
}

function GM_openMapTab(url) {
  crmQueueBridgeMessage({
    type: 'CRM_BRIDGE_OPEN_MAP_TAB',
    url: String(url ?? '')
  });
}

function GM_setValue(key, value) {
  const storageKey = String(key || '');
  const hadValue = crmHasOwn(crmBridgeState.cache, storageKey);
  const oldValue = hadValue ? crmBridgeState.cache[storageKey] : undefined;

  crmBridgeState.cache[storageKey] = value;
  crmNotifyValueListeners(storageKey, oldValue, value, false);
  crmQueueBridgeMessage({ type: 'CRM_BRIDGE_SET_VALUE', key: storageKey, value });
}

function GM_getValue(key, defaultValue) {
  const storageKey = String(key || '');
  if (crmHasOwn(crmBridgeState.cache, storageKey)) {
    return crmBridgeState.cache[storageKey];
  }
  return defaultValue;
}

function GM_addValueChangeListener(key, callback) {
  const listenerId = crmBridgeState.nextListenerId;
  crmBridgeState.nextListenerId += 1;

  crmBridgeState.listeners.set(listenerId, {
    key: String(key || ''),
    callback
  });

  return listenerId;
}

function GM_xmlhttpRequest(details) {
  const requestDetails = details || {};

  if (!requestDetails.url) {
    requestDetails.onerror?.({ status: 0, error: 'Missing URL', responseText: '' });
    return { abort() {} };
  }

  const requestId = crmCreateBridgeId();
  crmBridgeState.pendingRequests.set(requestId, {
    details: requestDetails,
    aborted: false
  });

  crmQueueBridgeMessage({
    type: 'CRM_BRIDGE_XMLHTTP_REQUEST',
    requestId,
    request: {
      url: String(requestDetails.url),
      method: String(requestDetails.method || 'GET').toUpperCase(),
      headers: requestDetails.headers || {},
      body: typeof requestDetails.data === 'undefined' ? null : requestDetails.data,
      timeout: Number(requestDetails.timeout) || 0,
      credentials: requestDetails.withCredentials ? 'include' : 'omit'
    }
  });

  return {
    abort() {
      const pendingRequest = crmBridgeState.pendingRequests.get(requestId);
      if (pendingRequest) pendingRequest.aborted = true;

      crmBridgeState.pendingRequests.delete(requestId);
      crmBridgeState.pendingMessages = crmBridgeState.pendingMessages.filter(
        (message) => message.requestId !== requestId
      );
    }
  };
}

window.GM_addStyle = GM_addStyle;
window.GM_setClipboard = GM_setClipboard;
window.GM_openMapTab = GM_openMapTab;
window.GM_setValue = GM_setValue;
window.GM_getValue = GM_getValue;
window.GM_addValueChangeListener = GM_addValueChangeListener;
window.GM_xmlhttpRequest = GM_xmlhttpRequest;
var unsafeWindow = window;
window.unsafeWindow = unsafeWindow;
window.__CRM_PAGE_BRIDGE__ = crmBridgeState;

crmStartHelloLoop();