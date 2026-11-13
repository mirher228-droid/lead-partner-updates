importScripts('employees-config.js', 'employees-client.js');
importScripts('leadpartner-rules.js', 'crm-avito-core.js', 'crm-avito-owner-sources.js', 'avito-source-catalog.js', 'shared-sources-background.js', 'crm-create-transfer-background.js', 'leadchat-request-name.js', 'leadchat-request-background.js');

// =============================================
// ОБРАБОТЧИК СООБЩЕНИЙ
// =============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== 'object') return;
    const actions = new Set(['fetchCRM','fetchRequestPage','postRequest','saveRequest','reloadExtension','clearAllCache']);
    const types = new Set(['PROXY_FETCH','CRM_PROXY_FETCH','FETCH_HTML','OPEN_OR_FOCUS_MAP_TAB']);
    if (!actions.has(request.action) && !types.has(request.type)) return;
    const crmHost = host => ['kp-lead-centre.ru','mnc-lead-centre.ru','bt-lead-centre.ru'].includes(host);
    let origin, internal = false, trusted = false;
    try {
        origin = new URL(sender.url);
        internal = sender.id === chrome.runtime.id && origin.protocol === 'chrome-extension:' && origin.hostname === chrome.runtime.id;
        trusted = internal || (sender.id === chrome.runtime.id && origin.protocol === 'https:' && crmHost(origin.hostname) && origin.pathname.startsWith('/admin/'));
    } catch (_) {}
    const denied = () => {sendResponse({ok:false,success:false,status:0,error:'Запрос не разрешён для этой страницы или адреса.'});return true;};
    if (!trusted) return denied();
    if (['reloadExtension','clearAllCache','postRequest','saveRequest'].includes(request.action) && !internal) return denied();
    if (actions.has(request.action) && request.url || ['PROXY_FETCH','CRM_PROXY_FETCH','FETCH_HTML'].includes(request.type)) {
        let raw = request.type === 'CRM_PROXY_FETCH' ? request.request?.url : request.url;
        try {
            const url = new URL(raw), method = String(request.type === 'CRM_PROXY_FETCH' ? request.request?.method || 'GET' : request.method || 'GET').toUpperCase();
            const isCRM = url.protocol === 'https:' && crmHost(url.hostname) && /^\/admin(?:\/|$)/.test(url.pathname);
            if (actions.has(request.action) && !isCRM) return denied();
            const readService = ['GET','HEAD'].includes(method) && ['http:','https:'].includes(url.protocol) && url.hostname === 'num.voxlink.ru';
            if (url.username || url.password || url.port || (!isCRM && !readService)) return denied();
            if (!internal && !['GET','HEAD'].includes(method)) return denied();
        } catch (_) {return denied();}
    }

    if (request.action === 'fetchCRM') {
        fetch(request.url, {
            credentials: 'include',
            headers: { 'Accept': 'text/html', 'Cache-Control': 'no-cache' }
        })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(html => sendResponse({ success: true, html }))
        .catch(error => sendResponse({ success: false, error: /^HTTP \d{3}$/.test(error?.message || '') ? error.message : 'CRM временно недоступна. Проверьте подключение и вход.' }));
        return true;
    }

    if (request.action === 'fetchRequestPage') {
        let fetchUrl = request.url;
        if (fetchUrl.startsWith('chrome-extension://')) {
            try {
                const urlObj = new URL(fetchUrl);
                const originalUrl = urlObj.searchParams.get('url');
                if (originalUrl) fetchUrl = originalUrl;
                else throw new Error('Не найден параметр url');
            } catch (e) {
                sendResponse({ success: false, error: 'Неверный URL' });
                return true;
            }
        }

        fetch(fetchUrl, {
            credentials: 'include',
            headers: { 'Accept': 'text/html', 'Cache-Control': 'no-cache' }
        })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(html => sendResponse({ success: true, html }))
        .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'postRequest') {
        const formData = new URLSearchParams();
        for (const key in request.data) {
            if (Object.prototype.hasOwnProperty.call(request.data, key)) {
                formData.append(key, request.data[key]);
            }
        }
        fetch(request.url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: formData.toString()
        })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(html => sendResponse({ success: true, html }))
        .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    // Built-in create form: preserve the response and relay a saved-server hint.
    if (request.action === 'saveRequest') {
        const formData = new URLSearchParams();
        for (const key in request.data) {
            if (Object.prototype.hasOwnProperty.call(request.data, key)) {
                formData.append(key, request.data[key]);
            }
        }
        fetch(request.url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: formData.toString()
        })
        .then(async r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return { html: await r.text(), finalUrl: r.url || request.url }; })
        .then(({ html, finalUrl }) => {
            sendResponse({ success: true, html });
        })
        .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.type === 'PROXY_FETCH') {
        const { url, method = 'GET', headers = {}, body = null } = request;
        if (!url) { sendResponse({ ok: false, status: 0, text: '', error: 'Missing URL' }); return true; }

        const upperMethod = String(method).toUpperCase();
        const hasBody = upperMethod !== 'GET' && upperMethod !== 'HEAD' && body !== null && typeof body !== 'undefined';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        fetch(url, {
            method: upperMethod,
            headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...headers },
            credentials: 'include',
            body: hasBody ? body : undefined,
            signal: controller.signal,
            redirect: 'follow'
        })
        .then(async (res) => {
            const text = await res.text();
            sendResponse({ ok: res.ok, status: res.status, text, finalUrl: res.url || url });
        })
        .catch((err) => {
            sendResponse({ ok: false, status: 0, text: '', error: err?.message || String(err) });
        })
        .finally(() => clearTimeout(timeoutId));
        return true;
    }

    if (request.type === 'FETCH_HTML' && request.url) {
        fetch(request.url, { credentials: 'include' })
            .then(res => res.ok ? res.text() : Promise.reject(`HTTP ${res.status}`))
            .then(text => sendResponse({ ok: true, text }))
            .catch(error => sendResponse({ ok: false, error: error.toString() }));
        return true;
    }

    if (request.type === 'CRM_PROXY_FETCH' && request.request) {
        const req = request.request || {};
        const url = String(req.url || '');
        if (!url) { sendResponse({ ok: false, status: 0, responseText: '', error: 'Missing URL' }); return true; }

        const method = String(req.method || 'GET').toUpperCase();
        const hasBody = method !== 'GET' && method !== 'HEAD' && typeof req.body !== 'undefined' && req.body !== null;
        const credentials = req.credentials === 'omit' ? 'omit' : 'include';
        const timeoutMs = Number(req.timeout) > 0 ? Math.min(Number(req.timeout),30000) : 30000;

        const controller = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

        fetch(url, {
            method,
            headers: req.headers || {},
            body: hasBody ? req.body : undefined,
            credentials,
            signal: controller.signal
        })
        .then(async (res) => {
            const text = await res.text();
            let responseHeaders = '';
            try { res.headers.forEach((value, key) => { responseHeaders += `${key}: ${value}\r\n`; }); } catch (e) {}
            sendResponse({
                ok: res.ok,
                status: res.status,
                responseText: text,
                headers: responseHeaders,
                finalUrl: res.url || url
            });
        })
        .catch((err) => {
            sendResponse({
                ok: false, status: 0, responseText: '',
                error: err?.message || String(err), timedOut
            });
        })
        .finally(() => clearTimeout(timeoutId));
        return true;
    }

    if (request.type === 'OPEN_OR_FOCUS_MAP_TAB' && request.url) {
        const MAP_TAB_STORAGE_KEY = 'managedMapTabId';

        function isYandexMapsUrl(url) {
            return /^https:\/\/yandex\.(ru|com)\/maps\//i.test(String(url || ''));
        }

        (async () => {
            const targetUrl = String(request.url);
            if (!isYandexMapsUrl(targetUrl)) {
                sendResponse({ ok: false, error: 'Invalid Yandex Maps URL' });
                return;
            }

            try {
                const stored = await chrome.storage.local.get(MAP_TAB_STORAGE_KEY);
                const tabId = stored?.[MAP_TAB_STORAGE_KEY];

                if (Number.isInteger(tabId)) {
                    try {
                        const tab = await chrome.tabs.get(tabId);
                        const currentUrl = tab?.pendingUrl || tab?.url || '';
                        if (tab && isYandexMapsUrl(currentUrl)) {
                            const updated = await chrome.tabs.update(tabId, { url: targetUrl, active: true });
                            if (updated?.windowId) {
                                try { await chrome.windows.update(updated.windowId, { focused: true }); } catch (e) {}
                            }
                            sendResponse({ ok: true, action: 'updated', tabId });
                            return;
                        }
                        await chrome.storage.local.remove(MAP_TAB_STORAGE_KEY);
                    } catch (e) {
                        await chrome.storage.local.remove(MAP_TAB_STORAGE_KEY);
                    }
                }

                const created = await chrome.tabs.create({ url: targetUrl, active: true });
                await chrome.storage.local.set({ [MAP_TAB_STORAGE_KEY]: created.id });
                if (created?.windowId) {
                    try { await chrome.windows.update(created.windowId, { focused: true }); } catch (e) {}
                }
                sendResponse({ ok: true, action: 'created', tabId: created.id });
            } catch (error) {
                sendResponse({ ok: false, error: error.message });
            }
        })();
        return true;
    }

    if (request.action === 'reloadExtension') {
        chrome.runtime.reload();
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'clearAllCache') {
        (async () => {
            const protectedKeys = ['partnerLinksCache', 'crmSourceLinksConfig'];
            const saved = await chrome.storage.local.get(null);
            const cacheKeys = Object.keys(saved).filter(key => !protectedKeys.includes(key) && /^(cachedCRMList|crmReportsCache|crmRequestCache|crmUserOptionsCache)$/.test(key));
            if (cacheKeys.length) await chrome.storage.local.remove(cacheKeys);
            sendResponse({ success: true });
        })().catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});


// =============================================
// СЛУЖЕБНОЕ
// =============================================
chrome.tabs.onRemoved.addListener(async (tabId) => {
    try {
        const stored = await chrome.storage.local.get('managedMapTabId');
        if (stored?.managedMapTabId === tabId) {
            await chrome.storage.local.remove('managedMapTabId');
        }
    } catch (e) {}
});

// CRM helpers use the same fixed catalogue; the panel itself reads it directly.
const publishSources = async () => { await LeadPartnerSourceCatalog.ready(); return chrome.storage.local.set({
  partnerLinksCache: LeadPartnerSourceCatalog.entries,
  leadPartnerLocalSourceRevision: LeadPartnerSourceCatalog.revision
}); };
chrome.runtime.onInstalled.addListener(() => { void publishSources().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void publishSources().catch(() => {}); });
void publishSources().catch(() => {});

importScripts('leadchat-crm-service.js', 'leadchat-found-request.js');
