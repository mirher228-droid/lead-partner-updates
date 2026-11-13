// ==UserScript==
// @name         БАЗА
// @namespace    http://tampermonkey.net/
// @version      11.9-FORCED-FEEDBACK
// @description  ПОЛНАЯ ВЕРСИЯ с радужной темой + принудительный отзыв для партнёров 007/7/723
// @author       Оригинал + исправления
// @match        https://kp-lead-centre.ru/admin/domain/customer-request/update*
// @match        https://kp-lead-centre.ru/admin/domain/customer-request/create*
// @match        https://kp-lead-centre.ru/admin/domain/customer/update*
// @match        https://kp-lead-centre.ru/admin/domain*
// @match        https://mnc-lead-centre.ru/admin/domain/customer-request/update*
// @match        https://mnc-lead-centre.ru/admin/domain/customer-request/create*
// @match        https://mnc-lead-centre.ru/admin/domain/customer/update*
// @match        https://mnc-lead-centre.ru/admin/domain*
// @match        https://bt-lead-centre.ru/admin/domain/customer-request/update*
// @match        https://bt-lead-centre.ru/admin/domain/customer-request/create*
// @match        https://bt-lead-centre.ru/admin/domain/customer/update*
// @match        https://bt-lead-centre.ru/admin/domain*
// @match        https://yandex.ru/maps/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    if (window._CRM_SCRIPT_INITIALIZED) {
        console.log('🛑 Скрипт уже инициализирован, пропускаем');
        return;
    }
    window._CRM_SCRIPT_INITIALIZED = true;
    window._CRM_LOADED_SCRIPTS = window._CRM_LOADED_SCRIPTS || {};

    console.log('🌈 СКРИПТ ЗАПУЩЕН (v11.9 - FORCED-FEEDBACK)');
    console.log('URL:', window.location.href);

    const originalAddStyle = GM_addStyle;
    GM_addStyle = function(css) {
        if (localStorage.getItem('CRM_DEBUG') === 'true') {
            console.log('📝 GM_addStyle вызван, длина CSS:', css.length);
        }
        return originalAddStyle(css);
    };

    const isKpHost = window.location.hostname.includes('kp-lead-centre.ru');
    const isCrmLeadCentreHost = /^(kp|mnc|bt)-lead-centre\.ru$/i.test(window.location.hostname);
    const autoConfirmPatterns = [
        /вернуть\s+эту\s+заявку/i,
        /взять\+заявку/i,
        /вернуть.*заявк/i,
        /взять.*заявк/i
    ];

    const MAP_SOURCE_META = {
        kp: { key: 'kp', label: 'КП', title: 'KP' },
        mnc: { key: 'mnc', label: 'МНЧ', title: 'MNC' },
        bt: { key: 'bt', label: 'БТ', title: 'BT' }
    };
    const DEFAULT_MAP_SOURCE_KEY = 'kp';
    const MAP_SOURCE_QUERY_PARAM = 'crm_map_source';
    const MAP_ORIGIN_SOURCE_QUERY_PARAM = 'crm_map_origin';
    const MAP_CONSTRUCTOR_ID_BY_SOURCE = {
        mnc: 'constructor:5334b1eac64665e4dbf0b1a57d801a0db433c7da380733a4932291434303d388',
        bt: 'constructor:1d14f05bb28add9e89923b4a5ed00d06247b78aa8bc0bed89ac0a934bc07403f',
        kp: 'constructor:3a441478bf388f1b547feea234423b58044ed891044d8420a95175a4f37d3d71'
    };
    const MAP_SOURCE_KEY_BY_CONSTRUCTOR_ID = Object.entries(MAP_CONSTRUCTOR_ID_BY_SOURCE).reduce((acc, [key, id]) => { acc[id] = key; return acc; }, {});

    function normalizeSourceKey(sourceKey, fallback = DEFAULT_MAP_SOURCE_KEY) {
        const k = String(sourceKey || '').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(MAP_CONSTRUCTOR_ID_BY_SOURCE, k)) return k;
        const f = String(fallback || '').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(MAP_CONSTRUCTOR_ID_BY_SOURCE, f)) return f;
        return '';
    }
    function normalizeMapSourceKey(sourceKey, fallback = DEFAULT_MAP_SOURCE_KEY) {
        return normalizeSourceKey(sourceKey, fallback);
    }
    function getMapSourceMeta(sourceKey) {
        const normalized = normalizeMapSourceKey(sourceKey, DEFAULT_MAP_SOURCE_KEY);
        return MAP_SOURCE_META[normalized] || MAP_SOURCE_META[DEFAULT_MAP_SOURCE_KEY];
    }
    function getSourceByHost(hostname = window.location.hostname) {
        const h = String(hostname || '').toLowerCase();
        if (h.includes('mnc-lead-centre.ru')) return MAP_SOURCE_META.mnc;
        if (h.includes('bt-lead-centre.ru')) return MAP_SOURCE_META.bt;
        if (h.includes('kp-lead-centre.ru')) return MAP_SOURCE_META.kp;
        return null;
    }
    function getHostMapSourceKey(hostname = window.location.hostname) {
        const src = getSourceByHost(hostname);
        return src ? src.key : DEFAULT_MAP_SOURCE_KEY;
    }
    function getMapConstructorIdBySourceKey(sourceKey) {
        return MAP_CONSTRUCTOR_ID_BY_SOURCE[normalizeMapSourceKey(sourceKey, DEFAULT_MAP_SOURCE_KEY)] || MAP_CONSTRUCTOR_ID_BY_SOURCE[DEFAULT_MAP_SOURCE_KEY];
    }
    function getMapSourceKeyByConstructorId(constructorId) {
        return MAP_SOURCE_KEY_BY_CONSTRUCTOR_ID[String(constructorId || '')] || '';
    }
    function parseMapUrl(rawUrl = window.location.href) {
        try { return new URL(rawUrl, window.location.origin); } catch(e) { return null; }
    }
    function getMapSourceKeyFromUrl(rawUrl = window.location.href) {
        const url = parseMapUrl(rawUrl);
        if (!url) return '';
        const sourceFromQuery = normalizeMapSourceKey(url.searchParams.get(MAP_SOURCE_QUERY_PARAM), '');
        if (sourceFromQuery) return sourceFromQuery;
        return getMapSourceKeyByConstructorId(url.searchParams.get('um'));
    }
    function getMapOriginSourceKeyFromUrl(rawUrl = window.location.href) {
        const url = parseMapUrl(rawUrl);
        if (!url) return '';
        const sourceFromQuery = normalizeMapSourceKey(url.searchParams.get(MAP_ORIGIN_SOURCE_QUERY_PARAM), '');
        return sourceFromQuery || getMapSourceKeyFromUrl(rawUrl);
    }
    function applyMapSourceToUrl(rawUrl, sourceKey, originSourceKey) {
        const url = parseMapUrl(rawUrl);
        if (!url) return String(rawUrl || '');
        const normalizedSourceKey = normalizeMapSourceKey(sourceKey, DEFAULT_MAP_SOURCE_KEY);
        const normalizedOriginSourceKey = normalizeMapSourceKey(originSourceKey, normalizedSourceKey);
        url.searchParams.set('um', getMapConstructorIdBySourceKey(normalizedSourceKey));
        url.searchParams.set('source', 'constructorLink');
        url.searchParams.set(MAP_SOURCE_QUERY_PARAM, normalizedSourceKey);
        url.searchParams.set(MAP_ORIGIN_SOURCE_QUERY_PARAM, normalizedOriginSourceKey);
        return url.toString();
    }

    function shouldAutoConfirm(message) {
        if (isKpHost) return true;
        const text = typeof message === 'string' ? message.trim() : '';
        return autoConfirmPatterns.some((pattern) => pattern.test(text));
    }

    if (isCrmLeadCentreHost) {
        console.log('🛡️ Устанавливаем перехват confirm');
        const originalWindowConfirm = typeof window.confirm === 'function' ? window.confirm.bind(window) : null;
        window.confirm = function(message) {
            if (shouldAutoConfirm(message)) return true;
            return originalWindowConfirm ? originalWindowConfirm(message) : true;
        };
        if (typeof unsafeWindow !== 'undefined') {
            const originalUnsafeConfirm = typeof unsafeWindow.confirm === 'function' ? unsafeWindow.confirm.bind(unsafeWindow) : originalWindowConfirm;
            unsafeWindow.confirm = function(message) {
                if (shouldAutoConfirm(message)) return true;
                return originalUnsafeConfirm ? originalUnsafeConfirm(message) : true;
            };
        }
    }

    if (isKpHost) {
        const originalSetTimeout = window.setTimeout;
        window.setTimeout = function(callback, delay, ...args) {
            if (typeof callback === 'string' && callback.includes('confirm')) return 0;
            return originalSetTimeout(callback, delay, ...args);
        };
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1 && node.tagName === 'SCRIPT' && node.textContent && node.textContent.includes('confirm')) {
                            node.textContent = node.textContent.replace(/confirm\(/g, 'true && confirm(');
                        }
                    });
                }
            });
        });
        if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    // ==================== Код для Яндекс.Карт ====================
    if (/yandex\.(ru|com)/.test(window.location.hostname)) {
        console.log('🗺️ Режим Яндекс.Карт активирован');
        window.name = 'yandex_crm_map';
        let heartbeatCounter = 0;
        let preventSleepInterval;
        function sendHeartbeat() {
            heartbeatCounter++;
            GM_setValue('map_tab_heartbeat', Date.now());
            GM_setValue('map_tab_counter', heartbeatCounter);
            GM_setValue('map_tab_last_url', window.location.href);
        }
        function getMapSourceSelectionState(rawUrl = window.location.href) {
            const requestedSourceKey = normalizeMapSourceKey(getMapSourceKeyFromUrl(rawUrl), DEFAULT_MAP_SOURCE_KEY);
            const originSourceKey = normalizeMapSourceKey(getMapOriginSourceKeyFromUrl(rawUrl), requestedSourceKey);
            return { requestedSourceKey, originSourceKey, isAuto: requestedSourceKey === originSourceKey };
        }
        function ensureMapSourceSwitcherStyles() {
            if (document.getElementById('crm-map-source-switcher-style')) return;
            GM_addStyle(`
                @keyframes crm-map-rainbow { 0% { background-position: 0% 50%; } 100% { background-position: 300% 50%; } }
                #crm-map-source-switcher { position: fixed; top: 88px; right: 16px; z-index: 9999; width: min(320px, calc(100vw - 24px)); padding: 14px; border-radius: 18px; background: linear-gradient(145deg, rgba(255,255,255,0.96), rgba(242,247,251,0.94)); box-shadow: 0 18px 40px rgba(9,35,61,0.16); color: #183654; font-family: "Segoe UI", sans-serif; }
                #crm-map-source-switcher::before { content: ""; position: absolute; inset: -2px; border-radius: 20px; background: linear-gradient(90deg, #ff0000, #ff8a00, #ffe600, #38d430, #00c2ff, #3b5bff, #a020f0, #ff0000); background-size: 300% 300%; animation: crm-map-rainbow 6s linear infinite; z-index: -1; }
                #crm-map-source-switcher .crm-map-source-switcher__title { margin-bottom: 8px; font-size: 18px; font-weight: 700; }
                #crm-map-source-switcher .crm-map-source-switcher__status { margin-bottom: 10px; font-size: 13px; color: #36526b; }
                #crm-map-source-switcher .crm-map-source-switcher__buttons { display: flex; flex-wrap: wrap; gap: 8px; }
                #crm-map-source-switcher .crm-map-source-switcher__button { min-width: 64px; padding: 8px 12px; border: 1px solid rgba(24,54,84,0.14); border-radius: 999px; background: rgba(255,255,255,0.86); color: #183654; font-size: 13px; font-weight: 700; cursor: pointer; }
                #crm-map-source-switcher .crm-map-source-switcher__button.is-active { background: #183654; color: #fff; }
            `);
        }
        function navigateMapToSource(sourceKey, originSourceKey) {
            const nextUrl = applyMapSourceToUrl(window.location.href,
                normalizeMapSourceKey(sourceKey, DEFAULT_MAP_SOURCE_KEY),
                normalizeMapSourceKey(originSourceKey, sourceKey));
            if (nextUrl === window.location.href) return;
            sendHeartbeat();
            try { window.focus(); } catch(e) {}
            window.location.replace(nextUrl);
        }
        function renderMapSourceSwitcher() {
            if (!document.body) return false;
            ensureMapSourceSwitcherStyles();
            let container = document.getElementById('crm-map-source-switcher');
            if (!container) {
                container = document.createElement('div');
                container.id = 'crm-map-source-switcher';
                document.body.appendChild(container);
            }
            const state = getMapSourceSelectionState();
            const activeMeta = getMapSourceMeta(state.requestedSourceKey);
            const statusText = state.isAuto ? `Авто: ${activeMeta.label} по текущей заявке` : `Разово: ${activeMeta.label} только для текущей карты`;
            container.innerHTML = `
                <div class="crm-map-source-switcher__title">Конструктор базы 🌈</div>
                <div class="crm-map-source-switcher__status">${statusText}</div>
                <div class="crm-map-source-switcher__buttons">
                    ${Object.keys(MAP_SOURCE_META).map((sourceKey) => {
                        const sourceMeta = MAP_SOURCE_META[sourceKey];
                        const isActive = sourceKey === state.requestedSourceKey;
                        return `<button type="button" class="crm-map-source-switcher__button ${isActive ? 'is-active' : ''}" data-source="${sourceKey}">${sourceMeta.label}</button>`;
                    }).join('')}
                </div>
            `;
            container.querySelectorAll('button[data-source]').forEach((button) => {
                button.addEventListener('click', () => {
                    const nextSource = button.getAttribute('data-source');
                    const currentState = getMapSourceSelectionState();
                    const normalized = normalizeMapSourceKey(nextSource, '');
                    if (!normalized || currentState.requestedSourceKey === normalized) return;
                    navigateMapToSource(normalized, currentState.originSourceKey);
                });
            });
            return true;
        }
        function initMapSourceSwitcher() {
            if (window._crmMapSourceSwitcherInitialized) return;
            window._crmMapSourceSwitcherInitialized = true;
            const renderWhenReady = () => { if (!renderMapSourceSwitcher()) window.requestAnimationFrame(renderWhenReady); };
            renderWhenReady();
            setInterval(() => { if (document.body && !document.getElementById('crm-map-source-switcher')) renderMapSourceSwitcher(); }, 700);
        }
        function preventTabSleep() { sendHeartbeat(); }
        initMapSourceSwitcher();
        sendHeartbeat();
        preventSleepInterval = setInterval(preventTabSleep, 250);
        ['mousemove', 'click', 'keydown', 'scroll', 'touchstart', 'mousedown'].forEach(event => {
            window.addEventListener(event, () => setTimeout(sendHeartbeat, 10), { passive: true });
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) for (let i = 0; i < 5; i++) setTimeout(sendHeartbeat, i * 100);
        });
        window.addEventListener('beforeunload', () => {
            clearInterval(preventSleepInterval);
            GM_setValue('map_tab_heartbeat', 0);
            GM_setValue('map_tab_counter', 0);
        });
        GM_addValueChangeListener('map_action_close', function(name, oldVal, newVal, remote) { if (remote) window.close(); });
        GM_addValueChangeListener('map_request_url', function(name, oldUrl, newUrl, remote) {
            if (remote && newUrl) {
                const requestedSourceKey = normalizeMapSourceKey(getMapSourceKeyFromUrl(newUrl), DEFAULT_MAP_SOURCE_KEY);
                const originSourceKey = normalizeMapSourceKey(getMapOriginSourceKeyFromUrl(newUrl), requestedSourceKey);
                const nextUrl = applyMapSourceToUrl(newUrl, requestedSourceKey, originSourceKey);
                for (let i = 0; i < 3; i++) setTimeout(sendHeartbeat, i * 50);
                try { window.focus(); setTimeout(() => window.focus(), 100); } catch(e) {}
                window.location.href = nextUrl;
            }
        });
        return;
    }

    // ==================== ScriptManager ====================
    const ScriptManager = {
        loaded: {},
        queue: [],
        isPageReady: false,
        observers: [],
        initialized: false,
        _stylesInjected: false,
        _processing: false,

        cleanup: function() {
            this.observers.forEach(observer => { try { observer.disconnect(); } catch(e) {} });
            this.observers = [];
            this.queue = [];
        },

        injectBaseStyles: function() {
            if (this._stylesInjected) return;
            this._stylesInjected = true;

            GM_addStyle(`
                .justify-content-between { -ms-flex-pack: justify !important; justify-content: end; }
                a.phone-clickable { cursor: pointer !important; text-decoration: none !important; color: #2c3e50 !important; font-weight: 500 !important; padding: 2px 4px !important; border-radius: 4px !important; display: inline-block !important; }
                a.phone-clickable:hover { background-color: #e8f5e9 !important; }
                .crm-indicator { display: inline-flex !important; align-items: center !important; padding: 4px 16px !important; height: 34px !important; border-radius: 20px !important; font-size: 13px !important; font-weight: 600 !important; border: 1px solid !important; margin-left: 15px !important; cursor: help !important; vertical-align: middle !important; }
                .crm-header-statuses { display: inline-flex !important; align-items: center !important; gap: 8px !important; margin-left: 15px !important; vertical-align: middle !important; }
                .crm-header-badge { display: inline-flex !important; align-items: center !important; padding: 4px 12px !important; height: 30px !important; border-radius: 20px !important; font-size: 12px !important; font-weight: 600 !important; color: white !important; }
                .date-changes-header-wrapper { display: flex !important; align-items: center !important; gap: 8px !important; flex-wrap: wrap !important; }
                .crm-status-wrapper { display: flex !important; align-items: center !important; gap: 10px !important; }
                .crm-status-label { color: #495057 !important; font-weight: 700 !important; font-size: 16px !important; white-space: nowrap !important; }
                .crm-status-badge { font-weight: 600 !important; padding: 10px 20px !important; border-radius: 12px !important; display: inline-block !important; color: white !important; text-align: center !important; min-width: 140px !important; cursor: pointer !important; }
                .crm-time-btn-2h, .crm-time-btn-1h { padding: 8px 12px !important; height: 36px !important; font-size: 13px !important; font-weight: 600 !important; border: none !important; border-radius: 12px !important; cursor: pointer !important; }
                .crm-temp-message { position: fixed; top: 107px; right: 10px; color: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; font-weight: bold; z-index: 99999; opacity: 0; transition: opacity 0.3s; }
                .crm-gray-btn { flex: 1; padding: 6px 4px; height: 36px; min-width: 110px; max-width: 110px; font-size: 11.5px; font-weight: 600; color: white; border: none; border-radius: 12px; cursor: pointer; }
                .crm-four-buttons { display: flex; gap: 8px; margin-top: 10px; margin-bottom: 10px; align-items: center; }
            `);

            GM_addStyle(`
                @keyframes crm-rainbow-shift { 0% { background-position: 0% 50%; } 100% { background-position: 300% 50%; } }
                .crm-btn-blue, .crm-btn-green, .crm-time-btn-1h, .crm-time-btn-2h, .crm-gray-btn, .crm-status-badge, .crm-indicator-director, .crm-indicator-delay, .crm-header-badge-urgent, .crm-header-badge-call, .crm-header-badge-call-before, .crm-header-badge-zakrep {
                    background: linear-gradient(90deg, #ff0000, #ff8a00, #ffe600, #38d430, #00c2ff, #3b5bff, #a020f0, #ff0000) !important;
                    background-size: 300% 300% !important;
                    animation: crm-rainbow-shift 6s linear infinite !important;
                    color: #ffffff !important;
                    text-shadow: 0 1px 3px rgba(0,0,0,0.55) !important;
                }
            `);
        },

        log: function(scriptName, ...args) {
            if (localStorage.getItem('CRM_DEBUG') === 'true') console.log(`[${scriptName}]`, ...args);
        },

        utils: {
            getInputValue: function(input) {
                if (!input) return '';
                if (input.tagName === 'SELECT') {
                    const selected = input.options[input.selectedIndex];
                    return selected ? selected.text.trim() : '';
                } else if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
                    return input.value ? input.value.trim() : '';
                }
                return input.textContent ? input.textContent.trim() : '';
            },
            findValueNearLabel: function(label) {
                if (!label) return '';
                if (label.htmlFor) {
                    const input = document.getElementById(label.htmlFor);
                    if (input) return ScriptManager.utils.getInputValue(input);
                }
                let current = label;
                for (let i = 0; i < 3; i++) {
                    current = current.nextElementSibling;
                    if (!current) break;
                    if (current.tagName === 'INPUT' || current.tagName === 'SELECT' || current.tagName === 'TEXTAREA') {
                        return ScriptManager.utils.getInputValue(current);
                    }
                }
                return '';
            },
            showMessage: function(message, type = 'success', duration = 1500) {
                const oldMsg = document.querySelector('.crm-temp-message');
                if (oldMsg) oldMsg.remove();
                const msg = document.createElement('div');
                msg.textContent = message;
                msg.className = 'crm-temp-message';
                msg.style.background = 'linear-gradient(90deg, #ff0000, #ff8a00, #ffe600, #38d430, #00c2ff, #3b5bff, #a020f0, #ff0000)';
                msg.style.backgroundSize = '300% 300%';
                msg.style.animation = 'crm-rainbow-shift 6s linear infinite';
                document.body.appendChild(msg);
                setTimeout(() => msg.style.opacity = '1', 10);
                setTimeout(() => { msg.style.opacity = '0'; setTimeout(() => msg.remove(), 300); }, duration);
            },
            cleanText: function(text) { return text ? text.replace(/\s+/g, ' ').trim() : ''; },
            extractPhoneNumber: function(text) {
                const sourceText = String(text || '').replace(/\u00a0/g, ' ').replace(/[–—−]/g, '-');
                const phonePattern = /(?:\+7|8|7)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/;
                const match = sourceText.match(phonePattern);
                return match ? match[0].trim() : '';
            },
            normalizePhoneForRegion: function(phone) {
                const digits = String(phone || '').replace(/\D/g, '');
                if (digits.length === 10) return `7${digits}`;
                if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
                if (digits.length === 11 && digits.startsWith('7')) return digits;
                return '';
            },
            findPhoneContainer: function() {
                const selectors = '#customerInfo .col-lg-3, #customerInfo .col-md-3, #customerInfo .col-sm-12, #customerInfo .col-sm-6, #customerInfo .col-12';
                const infoBlocks = document.querySelectorAll(selectors);
                for (const block of infoBlocks) {
                    const text = block.textContent || '';
                    if ((/тел/i.test(text) || /phone/i.test(text)) && ScriptManager.utils.extractPhoneNumber(text)) return block;
                }
                return null;
            },
            getPhoneInput: function() {
                const selectors = ['#customer-phone', 'input[name="Customer[phone]"]', 'input[name="CustomerRequest[phone]"]', 'input[name="CustomerRequest[customer_phone]"]', 'input[name*="phone"]', 'input[id*="phone"]', 'input[type="tel"]'];
                for (const selector of selectors) {
                    const input = document.querySelector(selector);
                    if (input) return input;
                }
                return null;
            },
            copyToClipboard: function(text) {
                if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
                return new Promise((resolve, reject) => {
                    const textArea = document.createElement("textarea");
                    textArea.value = text;
                    textArea.style.position = "fixed";
                    document.body.appendChild(textArea);
                    textArea.focus(); textArea.select();
                    try { const ok = document.execCommand('copy'); document.body.removeChild(textArea); if (ok) resolve(); else reject('Unable to copy'); }
                    catch (err) { document.body.removeChild(textArea); reject(err); }
                });
            },
            shouldHideButtons: function() {
                const statusChangeSelect = document.querySelector('select[name="CustomerRequest[status_change_type]"]');
                return !!statusChangeSelect;
            },
            getRequestId: function() {
                const urlParams = new URLSearchParams(window.location.search);
                const id = urlParams.get('id');
                if (id) return id;
                const match = window.location.href.match(/id=(\d+)/);
                if (match) return match[1];
                const h1 = document.querySelector('h1');
                if (h1) { const match = h1.textContent.match(/№\s*(\d+)/); if (match) return match[1]; }
                return '';
            },
            hideSystemTimeButtons: function() {
                const systemButtons = document.querySelectorAll('.setTimeNextHourBtn');
                systemButtons.forEach(btn => { if (!btn.closest('#crm-permanent-buttons')) btn.style.display = 'none'; });
                const allButtons = document.querySelectorAll('button');
                allButtons.forEach(btn => {
                    if (btn.closest('#crm-permanent-buttons')) return;
                    const text = btn.textContent.trim();
                    if (text.includes('+1ч') || text.includes('+2ч') || text.includes('Через час')) btn.style.display = 'none';
                });
            },
            getPhoneNumber: function() {
                const reqInfo = document.getElementById('reqInfo');
                if (reqInfo) { const p = ScriptManager.utils.extractPhoneNumber(reqInfo.value); if (p) return p; }
                const phoneContainer = ScriptManager.utils.findPhoneContainer();
                if (phoneContainer) { const p = ScriptManager.utils.extractPhoneNumber(phoneContainer.textContent || ''); if (p) return p; }
                const allElements = document.querySelectorAll('input[type="hidden"], td, span, div, label');
                for (const el of allElements) {
                    const text = el.value || el.textContent || '';
                    const phone = ScriptManager.utils.extractPhoneNumber(text);
                    if (phone) return phone;
                }
                const bodyText = document.body?.innerText || '';
                const phoneFromBody = ScriptManager.utils.extractPhoneNumber(bodyText);
                if (phoneFromBody) return phoneFromBody;
                return '';
            },
            setDebugMode: function(enabled) {
                if (enabled) { localStorage.setItem('CRM_DEBUG', 'true'); console.log('🐛 Режим отладки ВКЛЮЧЕН'); }
                else { localStorage.removeItem('CRM_DEBUG'); console.log('🐛 Режим отладки ВЫКЛЮЧЕН'); }
            },
            isDebug: function() { return localStorage.getItem('CRM_DEBUG') === 'true'; }
        },

        getScriptPriority: function(name) {
            const priorities = {
                'regionFinder': 200, 'headerStatuses': 195, 'transferHighlight': 190, 'delayHighlight': 185,
                'phoneCopyButton': 180, 'yandexMaps': 175, 'timeSync': 100, 'statusDesigner': 90,
                'timeButtons': 80, 'autoRejectButtons': 55, 'autoType': 50, 'autoHouse': 40,
                'autoFirstTime': 35, 'autoNo': 20, 'autoSelectType': 110, 'copyDateChanges': 10,
                'autoFeedback': 170
            };
            return priorities[name] || 1;
        },

        shouldLoadRequestScripts: function() {
            const url = window.location.href;
            return url.includes('/customer-request/update') || url.includes('/customer-request/create') || url.includes('/customer/update');
        },

        processQueue: function() {
            if (this._processing || this.queue.length === 0) return;
            this._processing = true;
            const processNext = () => {
                if (this.queue.length === 0) { this._processing = false; return; }
                const nextScript = this.queue.shift();
                if (window._CRM_LOADED_SCRIPTS[nextScript.name]) { setTimeout(processNext, 100); return; }
                try { nextScript.loader(); window._CRM_LOADED_SCRIPTS[nextScript.name] = true; this.loaded[nextScript.name] = true; }
                catch (error) { this.log('Loader', `❌ Ошибка загрузки ${nextScript.name}:`, error); }
                setTimeout(processNext, 300);
            };
            setTimeout(processNext, 100);
        }
    };

    // ==================== ФУНКЦИИ ЗАГРУЗКИ ====================

    function loadRegionFinder() {
        if (window._regionFinderInitialized) return;
        window._regionFinderInitialized = true;
        const log = (...args) => ScriptManager.log('АВТОПОИСК РЕГИОНА', ...args);
        const regionCache = new Map();
        function ensureRegionBadgeStyles() {
            if (document.getElementById('crm-region-badge-style')) return;
            const style = GM_addStyle(`
                .region-badge { display: flex; align-items: center; width: fit-content; max-width: 100%; margin-top: 6px; padding: 2px 8px; border-radius: 999px; background: rgba(33,150,243,0.12); border: 1px solid rgba(33,150,243,0.22); color: #185a9d; font-size: 12px; font-weight: 600; line-height: 1.3; }
                .region-badge.region-badge--muted { background: rgba(108,117,125,0.12); border-color: rgba(108,117,125,0.24); color: #59636e; }
            `);
            if (style) style.id = 'crm-region-badge-style';
        }
        window.fetchRegion = function(phone, callback) {
            const cleanPhone = ScriptManager.utils.normalizePhoneForRegion(phone);
            if (!cleanPhone) return callback("Некорректный номер");
            if (regionCache.has(cleanPhone)) { callback(regionCache.get(cleanPhone)); return; }
            const fallbackToHttp = () => {
                GM_xmlhttpRequest({
                    method: "GET", url: `http://num.voxlink.ru/get/?num=${cleanPhone}`,
                    onload: function(r) { try { const d = JSON.parse(r.responseText); const reg = d.region || "Регион не найден"; regionCache.set(cleanPhone, reg); callback(reg); } catch(e) { callback("Ошибка (HTTP)"); } },
                    onerror: function() { callback("Ошибка сети (HTTP)"); }
                });
            };
            GM_xmlhttpRequest({
                method: "GET", url: `https://num.voxlink.ru/get/?num=${cleanPhone}`,
                timeout: 5000,
                onload: function (r) {
                    if (r.status !== 200) { fallbackToHttp(); return; }
                    try { const d = JSON.parse(r.responseText); const reg = d.region || "Регион не найден"; regionCache.set(cleanPhone, reg); callback(reg); }
                    catch (e) { callback("Ошибка запроса"); }
                },
                onerror: fallbackToHttp, ontimeout: fallbackToHttp
            });
        };
        function createRegionBadge(text) {
            const b = document.createElement('span');
            b.className = 'region-badge';
            b.dataset.regionRole = 'phone-region';
            b.textContent = text;
            if (/ошибка|не найден|некоррект/i.test(text)) b.classList.add('region-badge--muted');
            return b;
        }
        function upsertRegionBadge(container, text) {
            if (!container) return;
            document.querySelectorAll('.region-badge[data-region-role="phone-region"]').forEach((b) => { if (!container.contains(b)) b.remove(); });
            let badge = container.querySelector('.region-badge');
            if (!badge) { badge = createRegionBadge(text); container.appendChild(badge); return; }
            badge.textContent = text;
        }
        function insertRegionNextToPhoneBlock() {
            const c = ScriptManager.utils.findPhoneContainer();
            if (!c) return;
            const phone = ScriptManager.utils.extractPhoneNumber(c.textContent || '');
            const np = ScriptManager.utils.normalizePhoneForRegion(phone);
            if (!np) return;
            if (c.dataset.regionPhone === np && c.querySelector('.region-badge')) return;
            c.dataset.regionPhone = np;
            window.fetchRegion(np, region => upsertRegionBadge(c, region));
        }
        function init() { ensureRegionBadgeStyles(); insertRegionNextToPhoneBlock(); }
        const observer = new MutationObserver(() => setTimeout(init, 1000));
        observer.observe(document.body, { childList: true, subtree: true });
        init();
    }

    function loadHeaderStatuses() {
        if (window._headerStatusesInitialized) return;
        window._headerStatusesInitialized = true;
        const log = (...args) => ScriptManager.log('СТАТУСЫ В ЗАГОЛОВКЕ', ...args);
        const STATUS_CONFIG = {
            URGENT: { id: 'customerrequest-is_urgent', label: 'Срочная', className: 'crm-header-badge-urgent', text: 'Срочная' },
            PROZVON: { id: 'customerrequest-is_need_call_check', label: 'Прозвон', className: 'crm-header-badge-call', text: 'Прозвон' },
            PROZVON_BEFORE: { id: 'customerrequest-is_need_call_before_visit', label: 'Прозвон перед выездом', className: 'crm-header-badge-call-before', text: 'Прозвон перед выездом' },
            ZAKREP: { id: 'customerrequest-is_zakrep', label: 'Закреп', className: 'crm-header-badge-zakrep', text: 'Закреп' }
        };
        let container = null;
        let lastStates = { urgent: false, prozvon: false, prozvonBefore: false, zakrep: false };
        function getState(cfg) {
            const byId = document.getElementById(cfg.id);
            if (byId && byId.type === 'checkbox') return byId.checked;
            return false;
        }
        function createContainer() {
            const h1 = document.querySelector('h1');
            if (!h1) return false;
            if (h1.querySelector('.crm-header-statuses')) { container = h1.querySelector('.crm-header-statuses'); return true; }
            const nameSpan = h1.querySelector('span');
            container = document.createElement('span');
            container.className = 'crm-header-statuses';
            if (nameSpan) nameSpan.after(container);
            else h1.insertBefore(container, h1.firstChild);
            return true;
        }
        function createBadge(cfg) {
            const b = document.createElement('span');
            b.className = `crm-header-badge ${cfg.className}`;
            b.textContent = cfg.text;
            b.title = cfg.label;
            return b;
        }
        function updateStatuses() {
            if (!container && !createContainer()) return;
            const newStates = {
                urgent: getState(STATUS_CONFIG.URGENT),
                prozvon: getState(STATUS_CONFIG.PROZVON),
                prozvonBefore: getState(STATUS_CONFIG.PROZVON_BEFORE),
                zakrep: getState(STATUS_CONFIG.ZAKREP)
            };
            const changed = Object.keys(newStates).some(k => newStates[k] !== lastStates[k]);
            if (!changed) return;
            lastStates = { ...newStates };
            container.innerHTML = '';
            if (newStates.urgent) container.appendChild(createBadge(STATUS_CONFIG.URGENT));
            if (newStates.prozvon) container.appendChild(createBadge(STATUS_CONFIG.PROZVON));
            if (newStates.prozvonBefore) container.appendChild(createBadge(STATUS_CONFIG.PROZVON_BEFORE));
            if (newStates.zakrep) container.appendChild(createBadge(STATUS_CONFIG.ZAKREP));
        }
        function init() {
            if (createContainer()) {
                updateStatuses();
                ['#customerrequest-is_urgent', '#customerrequest-is_need_call_check', '#customerrequest-is_need_call_before_visit', '#customerrequest-is_zakrep'].forEach(sel => {
                    const cb = document.querySelector(sel);
                    if (cb && !cb.dataset.hsListener) { cb.dataset.hsListener = 'true'; cb.addEventListener('change', updateStatuses); }
                });
                const observer = new MutationObserver(() => setTimeout(updateStatuses, 300));
                observer.observe(document.body, { childList: true, subtree: true });
            } else setTimeout(init, 500);
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }

    function loadPhoneCopyButton() {
        if (window._phoneCopyButtonInitialized) return;
        window._phoneCopyButtonInitialized = true;
        setTimeout(() => {
            const phoneContainer = ScriptManager.utils.findPhoneContainer();
            if (!phoneContainer) return;
            const telSpan = Array.from(phoneContainer.querySelectorAll('span')).find(s => s.textContent.trim() === 'Тел:');
            if (telSpan && !(telSpan instanceof HTMLAnchorElement)) {
                const link = document.createElement('a');
                link.href = '#'; link.className = 'phone-clickable'; link.textContent = 'Тел:';
                telSpan.parentNode.replaceChild(link, telSpan);
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    const id = ScriptManager.utils.getRequestId();
                    const phone = ScriptManager.utils.getPhoneNumber();
                    if (!id || !phone) return;
                    ScriptManager.utils.copyToClipboard(`${id} Тел: ${phone}`);
                    ScriptManager.utils.showMessage('✅ Скопировано', 'success');
                });
            }
        }, 500);
    }

    function loadYandexMaps() {
        if (window._yandexMapsInitialized) return;
        window._yandexMapsInitialized = true;
        function createMapButton() {
            const url = window.location.href;
            if (!url.includes('/customer-request/update') && !url.includes('/customer-request/create')) return;
            if (document.getElementById('open-map-btn')) return;
            if (ScriptManager.utils.shouldHideButtons()) return;
            const btn = document.createElement('button');
            btn.id = 'open-map-btn';
            btn.textContent = '🗺️ Карта';
            btn.style.cssText = 'position: fixed; top: 60px; right: 10px; z-index: 99999; padding: 8px 12px; background: #3498db; color: white; border: none; border-radius: 12px; cursor: pointer;';
            btn.addEventListener('click', () => {
                const city = document.querySelector('#customerrequest-city_id option:checked')?.textContent.trim() || '';
                const street = document.querySelector('#customer-address_street')?.value || '';
                const house = document.querySelector('#customer-address_building')?.value || '';
                const text = [city, street, house].filter(Boolean).join(', ');
                if (!text) { alert('Адрес не найден'); return; }
                const hostKey = getHostMapSourceKey();
                const url = `https://yandex.ru/maps/?text=${encodeURIComponent(text)}&um=${encodeURIComponent(getMapConstructorIdBySourceKey(hostKey))}&source=constructorLink`;
                window.open(url, 'yandex_crm_map');
            });
            document.body.appendChild(btn);
        }
        setTimeout(createMapButton, 500);
        new MutationObserver(createMapButton).observe(document.body, { childList: true, subtree: true });
    }

    function loadTimeSync() {
        if (window._timeSyncInitialized) return;
        window._timeSyncInitialized = true;
    }

    function loadStatusDesigner() {
        if (window._statusDesignerInitialized) return;
        window._statusDesignerInitialized = true;
        function applyDesign() {
            const el = document.querySelector('form#customerRequestForm > div > div > h1 > div.ml-auto');
            if (!el) return;
            if (el.querySelector('.crm-status-wrapper, .crm-sb-wrap')) return;
            const text = (el.textContent || '').replace('Статус:', '').trim();
            if (!text) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'crm-status-wrapper';
            wrapper.innerHTML = `<span class="crm-status-label">Статус:</span><span class="crm-status-badge">${text}</span>`;
            el.innerHTML = '';
            el.appendChild(wrapper);
        }
        setTimeout(applyDesign, 500);
        new MutationObserver(applyDesign).observe(document.body, { childList: true, subtree: true });
    }

    function loadTimeButtons() {
        if (window._timeButtonsInitialized) return;
        window._timeButtonsInitialized = true;
        const log = (...args) => ScriptManager.log('Кнопки времени', ...args);
        const utils = ScriptManager.utils;
        function getMoscowDate() {
            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
            const msk = new Date(utc + 3 * 60 * 60 * 1000);
            return `${String(msk.getDate()).padStart(2, '0')}-${String(msk.getMonth() + 1).padStart(2, '0')}-${msk.getFullYear()}`;
        }
        function setDateTime(hours) {
            if (window.location.href.includes('/create')) {
                const citySelect = document.querySelector('#customerrequest-city_id');
                if (!citySelect || !citySelect.value || citySelect.value === '0') {
                    utils.showMessage('Сначала выберите город', 'warning', 2000);
                    return;
                }
            }
            const dateField = document.getElementById('customerrequest-opened_at');
            if (dateField) {
                const mskDate = getMoscowDate();
                if (dateField.value !== mskDate) {
                    dateField.value = mskDate;
                    dateField.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            const targetTexts = hours === 1 ? ['Через час', '+1 час', '+1ч'] : ['+2ч', '+2 часа'];
            const systemButtons = document.querySelectorAll('.setTimeNextHourBtn');
            for (const btn of systemButtons) {
                const t = (btn.textContent || '').trim();
                if (targetTexts.some(x => t.includes(x))) { btn.click(); return; }
            }
            const all = document.querySelectorAll('button');
            for (const btn of all) {
                if (btn.closest('#crm-permanent-buttons')) continue;
                const t = (btn.textContent || '').trim();
                if (targetTexts.some(x => t.includes(x))) { btn.click(); return; }
            }
            if (systemButtons.length > 0) systemButtons[0].click();
        }
        function createButton(text, hours) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = text;
            btn.className = hours === 1 ? 'crm-time-btn-1h' : 'crm-time-btn-2h';
            let busy = false;
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (busy) return;
                busy = true;
                setTimeout(() => busy = false, 120);
                setDateTime(hours);
            });
            return btn;
        }
        function addPermanentButtons() {
            const dateField = document.getElementById('customerrequest-opened_at');
            if (!dateField) return false;
            if (document.querySelector('select[name="CustomerRequest[status_change_type]"]')) return false;
            if (document.getElementById('crm-permanent-buttons')) return true;
            const container = document.createElement('div');
            container.id = 'crm-permanent-buttons';
            container.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
            container.appendChild(createButton('+1 час', 1));
            container.appendChild(createButton('+2 часа', 2));
            const parent = dateField.closest('.form-group, .field-customerrequest-opened_at, td, div');
            if (parent && parent.parentNode) parent.parentNode.insertBefore(container, parent.nextSibling);
            else dateField.parentNode.insertBefore(container, dateField.nextSibling);
            return true;
        }
        setTimeout(addPermanentButtons, 200);
        setTimeout(addPermanentButtons, 800);
        new MutationObserver(() => { if (!document.getElementById('crm-permanent-buttons')) addPermanentButtons(); }).observe(document.body, { childList: true, subtree: true });
    }

    function loadAutoRejectButtons() {
        if (window._autoRejectButtonsInitialized) return;
        window._autoRejectButtonsInitialized = true;
    }

    function loadAutoSelectType() {
        if (window._autoSelectTypeInitialized) return;
        window._autoSelectTypeInitialized = true;
    }

    function loadAutoType() {
        if (window._autoTypeInitialized) return;
        window._autoTypeInitialized = true;
        const FIELD_COMMENT = 'textarea[name="CustomerRequest[comments]"]';
        const FIELD_WORK = 'select[name="CustomerRequest[appliance_type_id]"]';
        const MAP = {
            'пк': 'Компьютер/Ноутбук/Моноблок', 'ноут': 'Компьютер/Ноутбук/Моноблок', 'ноутбук': 'Компьютер/Ноутбук/Моноблок',
            'тв': 'ЖК ТВ', 'телевизор': 'ЖК ТВ', 'принтер': 'Принтер/МФУ', 'мфу': 'Принтер/МФУ',
            'роутер': 'Роутер', 'монитор': 'Мониторы/Видеокарты', 'видеокарта': 'Мониторы/Видеокарты'
        };
        function processComment() {
            const c = document.querySelector(FIELD_COMMENT);
            const w = document.querySelector(FIELD_WORK);
            if (!c || !w) return;
            const first = (c.value || '').trim().split(/\s+/)[0]?.toLowerCase();
            if (!first) return;
            const target = MAP[first];
            if (!target) return;
            for (let i = 0; i < w.options.length; i++) {
                if (w.options[i].text.trim().toLowerCase().includes(target.toLowerCase())) {
                    if (w.value !== w.options[i].value) {
                        w.value = w.options[i].value;
                        w.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    return;
                }
            }
        }
        const c = document.querySelector(FIELD_COMMENT);
        if (c) {
            let t; c.addEventListener('input', () => { clearTimeout(t); t = setTimeout(processComment, 300); });
            c.addEventListener('blur', processComment);
        }
    }

    function loadAutoHouse() {
        if (window._autoHouseInitialized) return;
        window._autoHouseInitialized = true;
    }

    function loadAutoNo() {
        if (window._autoNoInitialized) return;
        window._autoNoInitialized = true;
        setTimeout(() => {
            const sel = document.querySelector('select[name="CustomerRequest[is_far_ride]"]');
            if (!sel || sel.value) return;
            const opt = Array.from(sel.options).find(o => o.value === '0');
            if (opt) sel.value = opt.value;
        }, 300);
    }

    function loadCopyDateChanges() {
        if (window._copyDateChangesInitialized) return;
        window._copyDateChangesInitialized = true;
    }

    function loadAutoFirstTime() {
        if (window._autoFirstTimeInitialized) return;
        window._autoFirstTimeInitialized = true;
        if (!window.location.href.includes('/customer-request/create')) return;
        if (window.location.href.includes('customer_id=')) return;
        setTimeout(() => {
            const sel = document.querySelector('select[name="CustomerRequest[type]"]');
            if (!sel || sel.value) return;
            const opt = Array.from(sel.options).find(o => o.value === '10');
            if (opt) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, 500);
    }

    function loadTransferHighlight() {
        if (window._transferHighlightInitialized) return;
        window._transferHighlightInitialized = true;
        function hasDirector(text) { return /директор/iu.test(text) || /\bдир\b/iu.test(text); }
        function check() {
            const field = document.getElementById('customerrequest-date_changes');
            const wrapper = document.querySelector('.date-changes-header-wrapper');
            if (!field || !wrapper) return;
            const text = field.value || '';
            const existing = wrapper.querySelector('.crm-indicator-director');
            if (hasDirector(text) && !existing) {
                const badge = document.createElement('span');
                badge.className = 'crm-indicator crm-indicator-director';
                badge.textContent = '👤 Перенос директора';
                const label = wrapper.querySelector('label');
                if (label) label.insertAdjacentElement('afterend', badge);
            } else if (!hasDirector(text) && existing) {
                existing.remove();
            }
        }
        setTimeout(check, 1000);
        new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    }

    function loadDelayHighlight() {
        if (window._delayHighlightInitialized) return;
        window._delayHighlightInitialized = true;
        const KEYWORDS = ['опозд', 'опазд', 'задерж', 'позд', 'delay', 'late', 'пробк'];
        function check() {
            const field = document.getElementById('customerrequest-comments_service');
            if (!field) return;
            const text = (field.value || '').toLowerCase();
            const hasDelay = KEYWORDS.some(k => text.includes(k));
            const container = document.querySelector('.d-flex.justify-content-between.align-items-center');
            if (!container) return;
            const label = container.querySelector('label[for="customerrequest-comments_service"]');
            if (!label) return;
            const existing = container.querySelector('.crm-indicator-delay');
            if (hasDelay && !existing) {
                const badge = document.createElement('span');
                badge.className = 'crm-indicator crm-indicator-delay';
                badge.textContent = '⏰ Было опоздание';
                label.insertAdjacentElement('afterend', badge);
            } else if (!hasDelay && existing) {
                existing.remove();
            }
        }
        setTimeout(check, 1000);
        new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    }

    // ==================== АВТООТЗЫВ (с принудительным списком) ====================
    function loadAutoFeedback() {
        if (window._autoFeedbackInitialized) return;
        window._autoFeedbackInitialized = true;
        const log = (...args) => ScriptManager.log('АВТООТЗЫВ И ССЫЛКИ', ...args);
        log('Инициализация (улучшенная, с принудительным списком)');

        let currentSourceLinks = {};
        let currentTextToSource = {};
        let autoApproveEnabled = false;
        let autoApprovePartners = ['007', '723', '7', '740', '340'];
        let isRebuilding = false;

        // ⚡️ Партнёры, для которых отзыв ставится ВСЕГДА (независимо от autoApprove)
        const FORCED_FEEDBACK_PARTNERS = ['7', '723'];

        // Нормализация ID: "007" -> "7", "0723" -> "723"
        function normalizePartnerId(id) {
            const s = String(id || '').trim();
            if (!s) return '';
            return s.replace(/^0+/, '') || '0';
        }

        function updateSourceLinks(links) {
            links = links?.__crmBridgeWrapped ? links.value : links;
            const pageBase = {'kp-lead-centre.ru':'kp','mnc-lead-centre.ru':'mnc','bt-lead-centre.ru':'bt'}[location.hostname];
            const selected = links?.version === 4 ? links.global : links?.version === 3 ? links.byBase?.[pageBase] : links;
            currentSourceLinks = {};
            currentTextToSource = {};
            for (const [id,item] of Object.entries(selected || {})) {
                if (!item || typeof item !== 'object' || !item.text) continue;
                let url;
                try {url = new URL(item.url);} catch (_) {continue;}
                if (url.protocol !== 'https:' || url.username || url.password) continue;
                const safe = {text:String(item.text).normalize('NFKC').toUpperCase(),url:url.href};
                const signature = safe.text + '|' + safe.url;
                const same = Object.values(currentSourceLinks).find(value => value && value.signature === signature);
                const record = same || {...safe,signature};currentSourceLinks[id] = record;
                const aliases = [safe.text,...(Array.isArray(item.aliases) ? item.aliases : []),...(Array.isArray(item.externalIds) ? item.externalIds : []),...(/^\d{3,12}$/.test(id) ? [id] : [])];
                for (const alias of aliases) {
                    const text = normalizeSourceText(alias);if (text === '748') continue;
                    if (!(text in currentTextToSource)) currentTextToSource[text] = record;
                    else if (currentTextToSource[text]?.signature !== signature) currentTextToSource[text] = null;
                }
            }
            const blocked = new Set();
            for (const [alias,record] of Object.entries(currentTextToSource)) if (!record && !/^\d{3,12}$/.test(alias)) {
                for (const item of Object.values(currentSourceLinks)) {
                    if (normalizeSourceText(item.text) === alias) blocked.add(item.signature);
                }
            }
            // Aliases shared by different records fail closed for every route.
            const all = Object.entries(selected || {}).filter(([,item]) => item && typeof item === 'object');
            for (const [alias,record] of Object.entries(currentTextToSource)) if (!record && !/^\d{3,12}$/.test(alias)) for (const [id,item] of all) {
                if ([item.text,...(item.aliases || []),...(item.externalIds || []),id].some(value => normalizeSourceText(value) === alias)) {
                    const safe = currentSourceLinks[id];if (safe) blocked.add(safe.signature);
                }
            }
            for (const id of Object.keys(currentSourceLinks)) if (blocked.has(currentSourceLinks[id]?.signature)) currentSourceLinks[id] = null;
            for (const alias of Object.keys(currentTextToSource)) if (blocked.has(currentTextToSource[alias]?.signature)) currentTextToSource[alias] = null;
            log(`Источники обновлены: ${Object.keys(currentSourceLinks).length} записей`);
        }
        function normalizeSourceText(value) {
            return String(value || '').normalize('NFKC').toUpperCase().replace(/ИСТОЧНИК\s*NO\s*3(?!\d)/g,'ИСТОЧНИК NO3').replace(/[^0-9A-ZА-ЯЁ.]+/g,' ').replace(/\s+/g,' ').trim();
        }
        function loadSourceLinksFromStorage() {
            const stored = GM_getValue('crmSourceLinksConfig', null);
            if (stored && typeof stored === 'object' && Object.keys(stored).length) updateSourceLinks(stored);
            else updateSourceLinks({});
        }
        function loadAutoApproveSetting() {
            autoApproveEnabled = GM_getValue('autoApprove', false);
            const storedPartners = GM_getValue('autoApprovePartners', null);
            if (Array.isArray(storedPartners) && storedPartners.length) autoApprovePartners = storedPartners;
            log(`Автоотзыв: ${autoApproveEnabled ? 'ВКЛЮЧЁН' : 'ВЫКЛЮЧЕН'}, партнёры: ${autoApprovePartners.join(', ')}`);
        }

        let lastProcessedPartner = '', lastProcessedAdvert = '', lastProcessedPartnerComment = '';
        let userDisabledFeedbackForPartner = false;

        function getSelectedPartnerId() {
            const container = document.querySelector('#select2-customerrequest-partner_id-container');
            if (container) {
                const title = container.getAttribute('title') || '';
                const idMatch = title.match(/\((\d+)\)$/);
                if (idMatch) return normalizePartnerId(idMatch[1]);
                if (title && title !== 'Выберите партнера') {
                    const m = String(title).match(/^0*(\d+)$/);
                    if (m) return normalizePartnerId(m[1]);
                }
            }
            const select = document.querySelector('select[name="CustomerRequest[partner_id]"]');
            return select && select.value ? normalizePartnerId(select.value) : '';
        }
        function getSelectedAdvertId() {
            const select = document.querySelector('#customerrequest-advert_id, select[name="CustomerRequest[advert_id]"]');
            return select && select.value ? select.value : '';
        }
        function getPartnerCommentText() {
            const field = document.querySelector('#customerrequest-partner_comment, textarea[name="CustomerRequest[partner_comment]"]');
            return field ? field.value.trim() : '';
        }
        function setFeedbackCheckbox(checked, force = false) {
            const cb = document.querySelector('#customerrequest-is_req_fback');
            if (!cb) return false;
            if (cb.checked === checked) return true;
            if (!force && userDisabledFeedbackForPartner && !checked) return false;
            cb.checked = checked;
            ['change', 'input'].forEach(ev => cb.dispatchEvent(new Event(ev, { bubbles: true })));
            log(`${checked ? 'Установлен' : 'Снят'} чекбокс отзыва`);
            ScriptManager.utils.showMessage(`${checked ? '✅ Установлен' : '❌ Снят'} отзыв`, 'info');
            return true;
        }
        function getSourceLinkFromAdvert(advertId, partnerId) {
            if (!advertId && !partnerId) return null;
            if (advertId === '748') return null;
            if (partnerId === '740' && currentSourceLinks['0512']) return currentSourceLinks['0512'];
            if (advertId && currentSourceLinks[advertId]) return currentSourceLinks[advertId];
            return null;
        }
        function extractSourcesFromComment(commentText) {
            if (!commentText) return [];
            const found = new Set();
            const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const sortedKeys = Object.keys(currentTextToSource).sort((a,b)=>b.length-a.length);
            let normalized = normalizeSourceText(commentText);
            const select=document.querySelector('#customerrequest-partner_id, select[name="CustomerRequest[partner_id]"]'),option=select?.options?.[select.selectedIndex];
            const label=option?String(option.textContent || ''):String(document.querySelector('#select2-customerrequest-partner_id-container')?.getAttribute('title') || '');
            const selected748=/^(?:(?:парт|партнер|партнёр)\s+)?748(?:\s+(?:парт|партнер|партнёр))?$/iu.test(label.normalize('NFKC').replace(/\s*\(\d+\)\s*$/,'').trim());
            if(selected748&&['АВИТО','ИСТОЧНИК NO3'].includes(normalized))normalized='748 '+normalized;
            for (const key of sortedKeys) {
                const regex = new RegExp(`(?:^| )${escapeRegex(key)}(?= |$)`);
                if (regex.test(normalized)) {
                    if (!currentTextToSource[key]) return [];
                    found.add(currentTextToSource[key]);
                }
            }
            return found.size === 1 ? Array.from(found) : [];
        }
        function cleanUserComment(rawComment) {
            if (!rawComment) return '';
            const lines = rawComment.split('\n');
            return lines.filter(line => {
                const trimmed = line.trim();
                if (!trimmed) return false;
                if (trimmed.includes('[ext-link]')) return false;
                if (trimmed.includes('БЕЛАЯ ЗАЯВКА')) return false;
                if (trimmed.startsWith('🔴БЕЛАЯ ЗАЯВКА🔴')) return false;
                if (trimmed.startsWith('🟢') && trimmed.endsWith('🟢')) return false;
                return true;
            }).join('\n').trim();
        }
        function getUniqueUrlsFromSources(sources) {
            const urls = new Set();
            for (const src of sources) if (src.url && typeof src.url === 'string' && src.url.trim()) urls.add(src.url.trim());
            return Array.from(urls);
        }
        function buildWhiteRequestLines() { return ['🔴БЕЛАЯ ЗАЯВКА🔴']; }
        function buildSourceLines(urls) { return urls.map(url => `🟢${url}🟢`); }
        function setCommentField(newComment) {
            const field = document.querySelector('textarea[name="CustomerRequest[comments]"]');
            if (!field) return false;
            if (field.dataset.lpTransferValue !== undefined) {
                if (field.value === field.dataset.lpTransferValue) return false;
                delete field.dataset.lpTransferValue;
            }
            if (field.value === newComment) return false;
            field.value = newComment;
            ['input', 'change'].forEach(ev => field.dispatchEvent(new Event(ev, { bubbles: true })));
            return true;
        }
        async function rebuildFullComment() {
            if (isRebuilding) return;
            isRebuilding = true;
            try {
                const commentField = document.querySelector('textarea[name="CustomerRequest[comments]"]');
                if (!commentField) return;
                if (document.getElementById('customerRequestForm')?.dataset.lpTransferApplying === '1' ||
                    (commentField.dataset.lpTransferValue !== undefined && commentField.value === commentField.dataset.lpTransferValue)) return;
                const rawComment = commentField.value || '';
                const userComment = cleanUserComment(rawComment);
                const partnerId = getSelectedPartnerId();
                const advertId = getSelectedAdvertId();
                const partnerComment = getPartnerCommentText();
                // ⚡️ "Белая заявка" всегда по partnerId === '723'
                const isWhite = partnerId === '723';
                const sourceList = [];
                const advertSource = getSourceLinkFromAdvert(advertId, partnerId);
                if (advertSource) sourceList.push(advertSource);
                sourceList.push(...extractSourcesFromComment(partnerComment));
                const urls = getUniqueUrlsFromSources(sourceList), uniqueUrls = urls.length <= 1 ? urls : [];
                const parts = [];
                if (isWhite) parts.push(...buildWhiteRequestLines());
                if (userComment) parts.push(userComment);
                if (uniqueUrls.length) parts.push(...buildSourceLines(uniqueUrls));
                const newComment = parts.join('\n').trim();
                setCommentField(newComment);
                log(`Комментарий пересобран. Белая: ${isWhite}, источников: ${uniqueUrls.length}`);
            } finally { isRebuilding = false; }
        }
        function processPartnerChange() {
            const partnerId = getSelectedPartnerId();
            const advertId = getSelectedAdvertId();
            const partnerComment = getPartnerCommentText();
            log('Обработка:', { partnerId, advertId, partnerComment });

            const normalizedAutoApprove = autoApprovePartners.map(normalizePartnerId);

            // ⚡️ Отзыв ставится ВСЕГДА для FORCED_FEEDBACK_PARTNERS,
            // либо через глобальную настройку autoApprove для остальных
            const needsFeedback =
                FORCED_FEEDBACK_PARTNERS.includes(partnerId) ||
                (autoApproveEnabled && normalizedAutoApprove.includes(partnerId));

            if (needsFeedback) setFeedbackCheckbox(true);

            // ⚡️ "Белая заявка" всегда для 723
            const isWhite = partnerId === '723';
            updateWhiteRequestBadge(isWhite);

            if (partnerId !== lastProcessedPartner || advertId !== lastProcessedAdvert || partnerComment !== lastProcessedPartnerComment) {
                rebuildFullComment();
            }
            lastProcessedPartner = partnerId;
            lastProcessedAdvert = advertId;
            lastProcessedPartnerComment = partnerComment;
        }
        function updateWhiteRequestBadge(isWhite) {
            const h1 = document.querySelector('h1');
            if (!h1) return;
            if (!document.querySelector('#crm-white-badge-styles')) {
                const style = document.createElement('style');
                style.id = 'crm-white-badge-styles';
                style.textContent = `
                    @keyframes crm-white-rainbow {
                        0% { background-position: 0% 50%; }
                        100% { background-position: 300% 50%; }
                    }
                    .crm-white-badge-container { display: inline-flex; margin-left: 15px; vertical-align: middle; }
                    .crm-white-badge { display: inline-flex; align-items: center; padding: 6px 16px; height: 36px; border-radius: 20px; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #fff; background: linear-gradient(90deg, #ff0000, #ff8a00, #ffe600, #38d430, #00c2ff, #3b5bff, #a020f0, #ff0000); background-size: 300% 300%; animation: crm-white-rainbow 4s linear infinite; border: 2px solid #fff; box-shadow: 0 0 20px rgba(255,0,128,0.7); cursor: help; white-space: nowrap; text-shadow: 0 1px 3px rgba(0,0,0,0.55); }
                `;
                document.head.appendChild(style);
            }
            let container = h1.querySelector('.crm-white-badge-container');
            if (!container) {
                container = document.createElement('span');
                container.className = 'crm-white-badge-container';
                const nameSpan = h1.querySelector('span');
                const statuses = h1.querySelector('.crm-header-statuses');
                if (nameSpan) {
                    if (statuses) nameSpan.parentNode.insertBefore(container, statuses);
                    else nameSpan.after(container);
                } else {
                    const first = h1.firstChild;
                    if (first && first.nodeType === Node.TEXT_NODE) h1.insertBefore(container, first.nextSibling);
                    else h1.insertBefore(container, h1.firstChild);
                }
            }
            container.innerHTML = '';
            if (isWhite) {
                const badge = document.createElement('span');
                badge.className = 'crm-white-badge';
                badge.textContent = '⭐ БЕЛАЯ ЗАЯВКА ⭐';
                badge.title = 'Очень важная белая заявка!';
                container.appendChild(badge);
                log('✅ Добавлен badge "Белая заявка" (радужный)');
            }
        }
        function watchPartnerChanges() {
            const partnerContainer = document.querySelector('#select2-customerrequest-partner_id-container');
            if (partnerContainer && !partnerContainer.dataset.feedbackObserver) {
                partnerContainer.dataset.feedbackObserver = 'true';
                new MutationObserver(() => setTimeout(processPartnerChange, 50)).observe(partnerContainer, { attributes: true, attributeFilter: ['title'] });
            }
            const partnerSelect = document.querySelector('select[name="CustomerRequest[partner_id]"]');
            if (partnerSelect && !partnerSelect.dataset.feedbackObserver) {
                partnerSelect.dataset.feedbackObserver = 'true';
                partnerSelect.addEventListener('change', () => setTimeout(processPartnerChange, 50));
                partnerSelect.addEventListener('input', () => setTimeout(processPartnerChange, 50));
            }
            const advertSelect = document.querySelector('#customerrequest-advert_id, select[name="CustomerRequest[advert_id]"]');
            if (advertSelect && !advertSelect.dataset.feedbackObserver) {
                advertSelect.dataset.feedbackObserver = 'true';
                advertSelect.addEventListener('change', () => setTimeout(processPartnerChange, 50));
            }
            const partnerCommentField = document.querySelector('#customerrequest-partner_comment, textarea[name="CustomerRequest[partner_comment]"]');
            if (partnerCommentField && !partnerCommentField.dataset.feedbackObserver) {
                partnerCommentField.dataset.feedbackObserver = 'true';
                partnerCommentField.addEventListener('input', () => setTimeout(processPartnerChange, 100));
                partnerCommentField.addEventListener('change', () => setTimeout(processPartnerChange, 100));
            }
            const feedbackCheckbox = document.querySelector('#customerrequest-is_req_fback');
            if (feedbackCheckbox && !feedbackCheckbox.dataset.feedbackObserver) {
                feedbackCheckbox.dataset.feedbackObserver = 'true';
                feedbackCheckbox.addEventListener('change', function() { userDisabledFeedbackForPartner = !this.checked; });
            }
        }
        function init() {
            log('Запуск...');
            loadSourceLinksFromStorage();
            loadAutoApproveSetting();
            GM_addValueChangeListener('crmSourceLinksConfig', (n,o,nv) => {
                updateSourceLinks(nv && typeof nv === 'object' ? nv : {});
                setTimeout(() => {processPartnerChange();void rebuildFullComment();},100);
            });
            GM_addValueChangeListener('autoApprove', (n,o,nv) => { autoApproveEnabled = !!nv; setTimeout(processPartnerChange,50); });
            GM_addValueChangeListener('autoApprovePartners', (n,o,nv) => { if (Array.isArray(nv)) { autoApprovePartners = nv; setTimeout(processPartnerChange,50); } });
            setTimeout(() => { processPartnerChange(); watchPartnerChanges(); }, 500);
            let lastP='', lastA='', lastC='';
            setInterval(() => {
                const p = getSelectedPartnerId(), a = getSelectedAdvertId(), c = getPartnerCommentText();
                if (p !== lastP || a !== lastA || c !== lastC) { lastP=p; lastA=a; lastC=c; processPartnerChange(); }
            }, 3000);
            log('✅ Скрипт автоотзыва и ссылок инициализирован (радужная версия, с принудительным списком)');
        }
        init();
    }

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            const newState = !localStorage.getItem('CRM_DEBUG');
            ScriptManager.utils.setDebugMode(newState);
            e.preventDefault();
        }
    });

    function observeAndLoad() {
        ScriptManager.log('Observer', '👀 Наблюдатель запущен');
        ScriptManager.injectBaseStyles();

        const immediateFunctions = [
            { name: 'regionFinder', fn: loadRegionFinder, requiredSelector: '#customerInfo, #customer-phone, #customerrequest-city_id' },
            { name: 'headerStatuses', fn: loadHeaderStatuses, requiredSelector: 'h1' },
            { name: 'transferHighlight', fn: loadTransferHighlight, requiredSelector: '#customerrequest-date_changes, .date-changes-header-wrapper' },
            { name: 'delayHighlight', fn: loadDelayHighlight, requiredSelector: '#customerrequest-comments_service' },
            { name: 'phoneCopyButton', fn: loadPhoneCopyButton, requiredSelector: '#customerInfo' },
            { name: 'yandexMaps', fn: loadYandexMaps, requiredSelector: '#customerInfo, #customerrequest-city_id' },
            { name: 'timeSync', fn: loadTimeSync, requiredSelector: 'label[for="customerrequest-opened_at"]' },
            { name: 'statusDesigner', fn: loadStatusDesigner, requiredSelector: 'h1' },
            { name: 'timeButtons', fn: loadTimeButtons, requiredSelector: '#customerrequest-opened_at' },
            { name: 'autoRejectButtons', fn: loadAutoRejectButtons, requiredSelector: 'textarea[name="CustomerRequest[recommendation_comment]"]' },
            { name: 'autoSelectType', fn: loadAutoSelectType, requiredSelector: 'table' },
            { name: 'autoType', fn: loadAutoType, requiredSelector: 'textarea[name="CustomerRequest[comments]"]' },
            { name: 'autoHouse', fn: loadAutoHouse, requiredSelector: 'input[name="Customer[address_street]"]' },
            { name: 'autoFirstTime', fn: loadAutoFirstTime, requiredSelector: 'select[name="CustomerRequest[type]"]' },
            { name: 'autoNo', fn: loadAutoNo, requiredSelector: 'select[name="CustomerRequest[is_far_ride]"]' },
            { name: 'copyDateChanges', fn: loadCopyDateChanges, requiredSelector: '#customerrequest-date_changes' },
            { name: 'autoFeedback', fn: loadAutoFeedback, requiredSelector: 'select[name="CustomerRequest[partner_id]"]' }
        ];

        immediateFunctions.forEach(func => {
            const checkAndLoad = () => {
                if (document.querySelector(func.requiredSelector) && !window._CRM_LOADED_SCRIPTS[func.name]) {
                    try { func.fn(); window._CRM_LOADED_SCRIPTS[func.name] = true; }
                    catch (e) { console.error(`Ошибка загрузки ${func.name}:`, e); }
                }
            };
            checkAndLoad();
            const observer = new MutationObserver(checkAndLoad);
            observer.observe(document.body, { childList: true, subtree: true });
            ScriptManager.observers.push(observer);
        });
    }

    function initialize() {
        console.log('🚀 Запуск основной инициализации');

        if (/yandex\.(ru|com)/.test(window.location.hostname)) {
            window.name = 'yandex_crm_map';
            setInterval(() => { GM_setValue('map_tab_heartbeat', Date.now()); }, 250);
            return;
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', observeAndLoad);
        } else {
            observeAndLoad();
        }

        window.addEventListener('load', () => {
            const allFunctions = [
                { name: 'regionFinder', fn: loadRegionFinder },
                { name: 'headerStatuses', fn: loadHeaderStatuses },
                { name: 'transferHighlight', fn: loadTransferHighlight },
                { name: 'delayHighlight', fn: loadDelayHighlight },
                { name: 'phoneCopyButton', fn: loadPhoneCopyButton },
                { name: 'yandexMaps', fn: loadYandexMaps },
                { name: 'timeSync', fn: loadTimeSync },
                { name: 'statusDesigner', fn: loadStatusDesigner },
                { name: 'timeButtons', fn: loadTimeButtons },
                { name: 'autoRejectButtons', fn: loadAutoRejectButtons },
                { name: 'autoSelectType', fn: loadAutoSelectType },
                { name: 'autoType', fn: loadAutoType },
                { name: 'autoHouse', fn: loadAutoHouse },
                { name: 'autoFirstTime', fn: loadAutoFirstTime },
                { name: 'autoNo', fn: loadAutoNo },
                { name: 'copyDateChanges', fn: loadCopyDateChanges },
                { name: 'autoFeedback', fn: loadAutoFeedback }
            ];
            allFunctions.forEach(func => {
                if (!window._CRM_LOADED_SCRIPTS[func.name]) {
                    try { func.fn(); window._CRM_LOADED_SCRIPTS[func.name] = true; }
                    catch (e) { console.error(`Ошибка финальной загрузки ${func.name}:`, e); }
                }
            });
        });
    }

    initialize();
})();
