(() => {
  'use strict';

  const CRM_PAGE_SOURCE = '__crmExtensionPageBridge';
  const CRM_BRIDGE_SOURCE = '__crmExtensionContentBridge';
  const CRM_STORAGE_WRAP_KEY = '__crmBridgeWrapped';
  const privateStorageKey = key => /^(crmTelegram|crmAvito|leadPartner)/i.test(key) || ['managedMapTabId'].includes(key);
  const protectedWriteKey = key => privateStorageKey(key) || ['partnerLinksCache','crmSourceLinksConfig','partnerLinksManualText','partnerLinksLastSyncAt','partnerLinksLastSyncError'].includes(key);
  let currentPageId = null;
  let stateSnapshot = {};
  let stateReady = false;
  let stateInitPromise = null;
  let storageListenerAttached = false;
  let pendingSnapshotChanges = null;

  function unwrapStoredValue(entry) {
    if (entry && typeof entry === 'object' && entry[CRM_STORAGE_WRAP_KEY]) {
      return entry.value;
    }
    return entry;
  }

  function getStoredOriginId(entry) {
    if (entry && typeof entry === 'object' && entry[CRM_STORAGE_WRAP_KEY]) {
      return entry.originId;
    }
    return undefined;
  }

  function wrapStoredValue(value, originId) {
    return {
      [CRM_STORAGE_WRAP_KEY]: true,
      value,
      originId,
      updatedAt: Date.now()
    };
  }

  function postToPage(type, payload = {}) {
    window.postMessage(
      {
        source: CRM_BRIDGE_SOURCE,
        type,
        ...payload
      },
      '*'
    );
  }

  async function refreshStateSnapshot() {
    if (!storageListenerAttached) {
      chrome.storage.onChanged.addListener(handleStorageChanges);
      storageListenerAttached = true;
    }

    pendingSnapshotChanges = new Map();
    try {
      const rawItems = await chrome.storage.local.get(null);
      const nextSnapshot = {};

      Object.entries(rawItems || {}).forEach(([key, value]) => {
        if (privateStorageKey(key)) return;
        nextSnapshot[key] = unwrapStoredValue(value);
      });

      // Changes received during the read are newer than its initial snapshot.
      pendingSnapshotChanges.forEach((change, key) => {
        if (typeof change.newValue === 'undefined') delete nextSnapshot[key];
        else nextSnapshot[key] = unwrapStoredValue(change.newValue);
      });

      stateSnapshot = nextSnapshot;
      stateReady = true;
      postToPage('CRM_BRIDGE_READY', { state: stateSnapshot });
    } finally {
      pendingSnapshotChanges = null;
    }
  }

  async function writeClipboard(text) {
    const value = String(text ?? '');

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = value;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';

    const parent = document.body || document.documentElement;
    parent.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
  }

  async function handleFetchRequest(requestId, request) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CRM_PROXY_FETCH',
        request
      });

      postToPage('CRM_BRIDGE_XMLHTTP_RESPONSE', {
        requestId,
        ...(response || {
          ok: false,
          status: 0,
          error: 'Empty fetch response',
          responseText: ''
        })
      });
    } catch (error) {
      postToPage('CRM_BRIDGE_XMLHTTP_RESPONSE', {
        requestId,
        ok: false,
        status: 0,
        error: error?.message || 'Proxy fetch failed',
        responseText: ''
      });
    }
  }

  function handleStorageChanges(changes, areaName) {
    if (areaName !== 'local') return;

    Object.entries(changes || {}).forEach(([key, change]) => {
      if (privateStorageKey(key)) return;
      if (pendingSnapshotChanges) pendingSnapshotChanges.set(key, change);
      const oldValue = unwrapStoredValue(change.oldValue);
      const hasNewValue = typeof change.newValue !== 'undefined';
      const newValue = hasNewValue ? unwrapStoredValue(change.newValue) : undefined;
      const originId = getStoredOriginId(change.newValue) || getStoredOriginId(change.oldValue);

      if (hasNewValue) {
        stateSnapshot[key] = newValue;
      } else {
        delete stateSnapshot[key];
      }

      const isRemote = originId ? originId !== currentPageId : true;
      if (!isRemote) return;

      postToPage('CRM_BRIDGE_VALUE_CHANGED', {
        key,
        oldValue,
        newValue,
        remote: true
      });
    });
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== CRM_PAGE_SOURCE || typeof data.type !== 'string') return;

    currentPageId = data.pageId || currentPageId;

    if (data.type === 'CRM_BRIDGE_HELLO') {
      if (stateReady) {
        postToPage('CRM_BRIDGE_READY', { state: stateSnapshot });
      } else if (!stateInitPromise) {
        stateInitPromise = refreshStateSnapshot().catch((error) => {
          console.error('CRM bridge init error:', error);
        }).finally(() => {
          stateInitPromise = null;
        });
      }
      return;
    }

    if (data.type === 'CRM_BRIDGE_SET_VALUE') {
      const key = String(data.key || '');
      if (!key || protectedWriteKey(key)) return;

      if (typeof data.value === 'undefined') {
        await chrome.storage.local.remove(key);
        return;
      }

      await chrome.storage.local.set({
        [key]: wrapStoredValue(data.value, currentPageId)
      });
      return;
    }

    if (data.type === 'CRM_BRIDGE_SET_CLIPBOARD') {
      try { await writeClipboard(data.text); }
      catch (error) { console.error('CRM clipboard bridge error:', error); }
      return;
    }

    if (data.type === 'CRM_BRIDGE_OPEN_MAP_TAB') {
      try {
        await chrome.runtime.sendMessage({
          type: 'OPEN_OR_FOCUS_MAP_TAB',
          url: String(data.url || '')
        });
      } catch (error) {
        console.error('CRM open map tab bridge error:', error);
      }
      return;
    }

    if (data.type === 'CRM_BRIDGE_XMLHTTP_REQUEST') {
      handleFetchRequest(data.requestId, data.request || {});
    }
  });

})();
