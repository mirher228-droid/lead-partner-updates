// ==== Функции «База + Авито» из софт.txt, адаптированные для расширения ====
(function () {
    'use strict';

    if (location.protocol !== 'https:' || !/^(kp|mnc|bt)-lead-centre\.ru$/i.test(location.hostname)) return;
    const pageMatch = location.pathname.match(/^\/admin\/domain\/customer-request\/(create|update)\/?$/);
    if (!pageMatch || window.__CRM_AVITO_TOOLS_INIT__) return;
    window.__CRM_AVITO_TOOLS_INIT__ = true;

    const isCreate = pageMatch[1] === 'create';
    const CANCEL_TEXT = 'Отмена через Авито';
    const PARTNER_FIELD = '#customerrequest-partner_id, select[name="CustomerRequest[partner_id]"], select[name="partner"], select[name="partner_id"], select#partner, select#partner_id';
    const SERVICE_FIELD = '#customerrequest-comments_service, textarea[name="CustomerRequest[comments_service]"]';
    const COMMENT_FIELD = '#customerrequest-comments, textarea[name="CustomerRequest[comments]"]';
    const PARTNER_COMMENT_FIELD = '#customerrequest-partner_comment, textarea[name="CustomerRequest[partner_comment]"], input[name="CustomerRequest[partner_comment]"]';
    let scanTimer = null;
    let toastTimer = null;
    let cancelState = null;
    const watchedPartners = new WeakSet();

    function log(...args) {
        try {
            if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[CRM-AVITO-TOOLS]', ...args);
        } catch (_) {}
    }

    function ensureStyles() {
        if (document.getElementById('crm-avito-tools-style')) return;
        const style = document.createElement('style');
        style.id = 'crm-avito-tools-style';
        style.textContent = `
            .crm-avito-partners { display:inline-flex; gap:6px; margin-left:10px; vertical-align:middle; }
            .crm-avito-partners .partner-quick-btn { min-width:40px; height:30px; padding:0 10px;
                border:1px solid transparent; border-radius:15px; font:600 13px/28px system-ui,sans-serif;
                cursor:pointer; transition:transform .16s,box-shadow .16s; }
            .crm-avito-partners .partner-quick-btn:hover { transform:translateY(-1px); }
            .crm-avito-partners .partner-quick-btn[data-partner="007"] { color:#fff; background:#27854a; border-color:#206d3d; }
            .crm-avito-partners .partner-quick-btn[data-partner="723"] { color:#3e3200; background:#f4d258; border-color:#c8aa3e; }
            .crm-avito-partners .partner-quick-btn[aria-pressed="true"] { box-shadow:0 0 0 3px rgba(59,130,246,.22); }
            .partner-quick-btn[data-lp-neon] { font-weight:700!important; text-shadow:none!important;
                position:relative!important; top:-2px!important; transition:box-shadow .18s,filter .18s!important; }
            .partner-quick-btn[data-lp-neon="7"] { color:#edfff4!important;
                background:linear-gradient(145deg,#174a32,#20623f)!important; border:1px solid #6ae59a!important;
                box-shadow:inset 0 0 7px #6ae59a20,0 0 9px #59df8638!important; }
            .partner-quick-btn[data-lp-neon="723"] { color:#fff4ca!important;
                background:linear-gradient(145deg,#55401b,#6a5122)!important; border:1px solid #efd078!important;
                box-shadow:inset 0 0 7px #efd07820,0 0 9px #efc95b38!important; }
            .partner-quick-btn[data-lp-neon]:hover { filter:brightness(1.10); }
            .partner-quick-btn[data-lp-neon="7"][aria-pressed="true"] { box-shadow:inset 0 0 8px #6ae59a30,0 0 12px #59df8650!important; }
            .partner-quick-btn[data-lp-neon="723"][aria-pressed="true"] { box-shadow:inset 0 0 8px #efd07830,0 0 12px #efc95b50!important; }
            .partner-quick-btn[data-lp-neon]:focus-visible { outline:2px solid currentColor!important; outline-offset:3px; }
            .crm-avito-partners .partner-quick-btn:focus-visible,.crm-avito-request-id:focus-visible,
            .crm-avito-cancel-btn:focus-visible { outline:2px solid #2563eb; outline-offset:3px; }
            .crm-avito-request-id { cursor:pointer; border-radius:4px; color:inherit; }
            .crm-avito-request-id:hover { background:rgba(59,130,246,.09); }
            .crm-avito-cancel-btn { display:inline-block; width:18px; height:18px; padding:0;
                margin-left:7px; border:2px solid #1e7e34; border-radius:50%; background:#28a745;
                vertical-align:middle; cursor:pointer; transition:background .16s,box-shadow .16s; }
            .crm-avito-cancel-btn[aria-pressed="true"] { background:#dc3545; border-color:#a71d2a; }
            .crm-avito-cancel-btn:disabled { opacity:.55; cursor:progress; }
            .crm-avito-save-state { margin-left:8px; font:12px/1.4 system-ui,sans-serif; color:#64748b; }
            .crm-avito-save-state[data-error="true"] { color:#b91c1c; }
            .crm-avito-toast { position:fixed; right:20px; top:20px; max-width:min(420px,calc(100vw - 40px));
                padding:10px 16px; border-radius:10px; color:#fff; background:#27854a;
                box-shadow:0 8px 24px rgba(0,0,0,.2); font:500 13px/1.5 system-ui,sans-serif; z-index:2147483647; }
            .crm-avito-toast[data-error="true"] { background:#b91c1c; }
            @media(prefers-reduced-motion:reduce) { .crm-avito-partners .partner-quick-btn,.crm-avito-cancel-btn { transition:none; } }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showToast(message, error) {
        let toast = document.getElementById('crm-avito-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'crm-avito-toast';
            toast.className = 'crm-avito-toast';
            toast.setAttribute('role', 'status');
            (document.body || document.documentElement).appendChild(toast);
        }
        toast.textContent = message;
        toast.dataset.error = String(Boolean(error));
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.remove(), error ? 5000 : 1800);
    }

    function fallbackCopy(text) {
        const active = document.activeElement;
        const start = active && active.selectionStart;
        const end = active && active.selectionEnd;
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        (document.body || document.documentElement).appendChild(textarea);
        try {
            textarea.focus();
            textarea.select();
            if (!document.execCommand('copy')) throw new Error('Буфер обмена недоступен');
        } finally {
            textarea.remove();
            if (active && active.isConnected) {
                active.focus({ preventScroll: true });
                if (typeof start === 'number' && typeof active.setSelectionRange === 'function') {
                    try { active.setSelectionRange(start, end); } catch (_) {}
                }
            }
        }
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try { await navigator.clipboard.writeText(text); return; } catch (_) {}
        }
        fallbackCopy(text);
    }

    function normalizeLabel(value) {
        return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s:*]+$/g, '').trim();
    }

    function getPartnerSelect() {
        const direct = document.querySelector(PARTNER_FIELD);
        if (direct) return direct;
        for (const label of document.querySelectorAll('label, .control-label')) {
            if (normalizeLabel(label.textContent) !== 'партнер') continue;
            if (label.control && label.control.tagName === 'SELECT') return label.control;
            const parent = label.closest('.form-group, td, li') || label.parentElement;
            const select = parent && parent.querySelector('select');
            if (select) return select;
        }
        return null;
    }

    function findPartnerOption(select, partnerCode) {
        if (!select) return null;
        const codes = partnerCode === '007' ? ['007', '7'] : [partnerCode];
        const options = Array.from(select.options).filter(option => option.value && !option.disabled);
        for (const code of codes) {
            const exact = options.find(option => String(option.textContent || '').trim() === code);
            if (exact) return exact;
        }
        for (const code of codes) {
            const token = new RegExp('(^|\\D)' + code + '(?=\\D|$)');
            const named = options.find(option => token.test(option.textContent || ''));
            if (named) return named;
        }
        return options.find(option => codes.includes(String(option.value))) || null;
    }

    function updatePartnerButtons() {
        const select = getPartnerSelect();
        document.querySelectorAll('.partner-quick-btn').forEach(button => {
            const code = String(button.textContent || '').trim();
            if (!['7', '007', '723'].includes(code)) return;
            button.dataset.lpNeon = code === '007' ? '7' : code;
            const option = findPartnerOption(select, code === '7' ? '007' : code);
            const pressed = Boolean(option && select.value === option.value);
            if (button.getAttribute('aria-pressed') !== String(pressed)) button.setAttribute('aria-pressed', String(pressed));
        });
    }

    function selectPartner(partnerCode) {
        const select = getPartnerSelect();
        const option = findPartnerOption(select, partnerCode);
        if (!select || select.disabled || !option) {
            showToast('Партнёр ' + partnerCode + ' пока недоступен в списке CRM', true);
            return;
        }
        if (select.value !== option.value) {
            select.value = option.value;
            // Один input и один change: Select2, отзывы и белая заявка получают обычное изменение.
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        updatePartnerButtons();
        log('Выбран партнёр:', partnerCode, option.value);
    }

    function addPartnerButtons() {
        const select = getPartnerSelect();
        if (!select) return;
        if (!watchedPartners.has(select)) {
            watchedPartners.add(select);
            select.addEventListener('input', updatePartnerButtons);
            select.addEventListener('change', updatePartnerButtons);
            if (typeof window.jQuery === 'function') window.jQuery(select).on('change.crmAvitoTools', updatePartnerButtons);
        }
        // На странице могут уже быть вторые (светящиеся) кнопки из «База + Авито».
        // Оставляем их вместе с исходными обработчиками, убираем нашу первую пару.
        // Проверяем и после поздней загрузки стороннего скрипта через общий observer.
        const existingButtons = Array.from(document.querySelectorAll('.partner-quick-btn'))
            .filter(button => !button.closest('.crm-avito-partners'));
        const codes = existingButtons.map(button => String(button.textContent || '').trim());
        if ((codes.includes('7') || codes.includes('007')) && codes.includes('723')) {
            document.querySelectorAll('.crm-avito-partners').forEach(container => container.remove());
            updatePartnerButtons();
            return;
        }
        if (!document.querySelector('.crm-avito-partners')) {
            const container = document.createElement('span');
            container.className = 'crm-avito-partners';
            for (const code of ['007', '723']) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'partner-quick-btn';
                button.dataset.partner = code;
                button.textContent = code === '007' ? '7' : code;
                button.title = 'Выбрать партнёра ' + code;
                button.setAttribute('aria-label', button.title);
                button.setAttribute('aria-pressed', 'false');
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    selectPartner(code);
                });
                container.appendChild(button);
            }
            const label = Array.from(document.querySelectorAll('label')).find(item => item.control === select || (item.htmlFor && item.htmlFor === select.id));
            if (label) label.after(container);
            else select.before(container);
        }
        updatePartnerButtons();
    }

    function getPartnerComment() {
        // value textarea содержит актуальный текст; textContent содержит старое HTML-значение.
        const field = document.querySelector(PARTNER_COMMENT_FIELD);
        if (field) return String(field.value || '').trim();
        for (const label of document.querySelectorAll('label, th, dt, .control-label, .field-label')) {
            if (normalizeLabel(label.textContent) !== 'комментарий партнера') continue;
            if (label.control) return String(label.control.value || label.control.textContent || '').trim();
            const next = label.nextElementSibling;
            if (next) {
                const input = next.matches('textarea, input') ? next : next.querySelector('textarea, input');
                return String(input ? input.value : next.textContent || '').trim();
            }
        }
        return '';
    }

    function getRequestId() {
        const id = new URL(location.href).searchParams.get('id');
        if (/^\d+$/.test(id || '')) return id;
        for (const heading of document.querySelectorAll('h1, h2, .request-title, .card-title')) {
            const match = String(heading.textContent || '').match(/(?:№|N°?)\s*(\d{6,8})(?!\d)/i);
            if (match) return match[1];
        }
        return '';
    }

    function attachToIdElements() {
        const id = getRequestId();
        if (!id) return;
        // Оборачиваем только текст с номером текущей заявки, а не всю шапку.
        // Клики по статусу, телефону, времени и другим кнопкам сохраняют прежний смысл.
        const seen = new Set();
        for (const heading of document.querySelectorAll('h1, h2, .request-title, .card-title')) {
            const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            for (const node of nodes) {
                if (seen.has(node)) continue;
                seen.add(node);
                const parent = node.parentElement;
                if (!parent || parent.closest('.crm-avito-request-id, button, textarea, select, [contenteditable], .crm-sb-wrap, .crm-header-statuses')) continue;
                const text = node.nodeValue || '';
                let match = text.match(/(?:Заявка\s*)?(?:№|N°?)\s*(\d{6,8})(?!\d)/i);
                if (!match && text.trim() === id) match = { 0: id, 1: id, index: text.indexOf(id) };
                if (!match || match[1] !== id) continue;
                const selected = node.splitText(match.index);
                selected.splitText(match[0].length);
                const span = document.createElement('span');
                span.className = 'crm-avito-request-id';
                span.dataset.requestId = id;
                span.setAttribute('role', 'button');
                span.tabIndex = 0;
                span.title = 'Клик: ID и комментарий партнёра. Ctrl + клик / средняя кнопка: только комментарий.';
                ['click', 'auxclick', 'keydown'].forEach(type => span.addEventListener(type, handleIdClick));
                selected.replaceWith(span);
                span.appendChild(selected);
            }
        }
    }

    async function handleIdClick(event) {
        const element = event.target && event.target.closest && event.target.closest('.crm-avito-request-id');
        if (!element) return;
        if (event.type === 'auxclick' && event.button !== 1) return;
        if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        if (event.type === 'click' && event.button !== 0) return;
        if (event.target.closest('input, textarea, select, [contenteditable]')) return;
        event.preventDefault();
        event.stopPropagation();
        const comment = getPartnerComment();
        const commentOnly = event.ctrlKey || event.metaKey || event.button === 1;
        if (commentOnly && !comment) { showToast('Комментарий партнёра пуст', true); return; }
        const text = commentOnly ? comment : element.dataset.requestId + (comment ? ' ' + comment : '');
        try {
            await copyToClipboard(text);
        } catch (error) { log(error); showToast('Не удалось скопировать в буфер обмена', true); }
    }

    function toggleCancelText(text) {
        const value = String(text || '');
        if (!value.includes(CANCEL_TEXT)) return value.trimEnd() + (value.trimEnd() ? '\n' : '') + CANCEL_TEXT;
        return value.split(/\r?\n/).filter(line => line.trim() !== CANCEL_TEXT)
            .map(line => line.replace(/Отмена через Авито/g, '').replace(/[ \t]+$/g, '')).join('\n');
    }

    function getCsrf(field) {
        const yii = window.yii;
        let param = '';
        let token = '';
        if (yii && typeof yii.getCsrfParam === 'function' && typeof yii.getCsrfToken === 'function') {
            param = yii.getCsrfParam();
            token = yii.getCsrfToken();
        }
        param = param || (document.querySelector('meta[name="csrf-param"]') || {}).content || '';
        token = token || (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
        const form = field.closest('form') || document;
        const hidden = Array.from(form.querySelectorAll('input[type="hidden"]')).find(input => param ? input.name === param : /^_csrf(?:-|$)/.test(input.name));
        if (hidden) { param = param || hidden.name; token = token || hidden.value; }
        if (!param || !token) throw new Error('Не найден CSRF-токен. Сохраните комментарий обычной кнопкой CRM.');
        return { param, token };
    }

    async function saveServiceComment(field) {
        const { param, token } = getCsrf(field);
        const body = new URLSearchParams();
        body.set(param, token);
        body.set('_comments_only', 'true');
        body.set('comments', (document.querySelector(COMMENT_FIELD) || {}).value || '');
        body.set('comments_service', field.value);
        body.set('date_changes', (document.querySelector('#customerrequest-date_changes, textarea[name="CustomerRequest[date_changes]"]') || {}).value || '');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            // Только текущая update-страница и контракт из софт.txt; create не отправляем.
            const response = await fetch(location.pathname + location.search, {
                method: 'POST', credentials: 'same-origin', signal: controller.signal,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/html;q=0.9' },
                body: body.toString()
            });
            if (!response.ok) throw new Error('CRM ответила с кодом ' + response.status);
            if (response.redirected && /\/(login|sign-in)(?:[/?]|$)/i.test(response.url)) throw new Error('Сессия CRM закончилась. Войдите снова.');
            const text = await response.text();
            if (/^\s*[{[]/.test(text) || /json/i.test(response.headers.get('content-type') || '')) {
                const result = JSON.parse(text);
                if (result === false || (result && (result.success === false || result.saved === false || result.ok === false || result.error || result.status === 'error'
                    || (result.errors && Object.keys(result.errors).length)))) throw new Error('CRM не сохранила комментарий. Используйте обычную кнопку сохранения.');
            } else if (/type=["']password["']|<form[^>]*(?:login|sign-in)/i.test(text) || text.trim() === 'false') {
                throw new Error('CRM не подтвердила сохранение. Проверьте сессию и сохраните комментарий вручную.');
            }
        } finally { clearTimeout(timer); }
    }

    function updateCancelButton(state) {
        const active = state.field.value.includes(CANCEL_TEXT);
        state.button.setAttribute('aria-pressed', String(active));
        state.button.title = active ? 'Убрать пометку «Отмена через Авито» и сохранить комментарий' : 'Добавить пометку «Отмена через Авито» и сохранить комментарий';
        state.button.setAttribute('aria-label', state.button.title);
    }

    function initAvitoCancelButton() {
        const field = document.querySelector(SERVICE_FIELD);
        if (!field) return;
        const label = Array.from(document.querySelectorAll('label')).find(item => item.control === field || (item.htmlFor && item.htmlFor === field.id));
        if (cancelState && cancelState.field === field && cancelState.button.isConnected) return;
        if (cancelState) { cancelState.button.remove(); cancelState.status.remove(); }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'avito-cancel-btn crm-avito-cancel-btn';
        const status = document.createElement('span');
        status.className = 'crm-avito-save-state';
        status.setAttribute('role', 'status');
        const state = { field, button, status, saving: false };
        cancelState = state;
        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            if (state.saving || field.disabled || field.readOnly) return;
            field.value = toggleCancelText(field.value);
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
            updateCancelButton(state);
            state.saving = true;
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            status.dataset.error = 'false';
            status.textContent = 'Сохранение…';
            const snapshot = field.value;
            try {
                await saveServiceComment(field);
                status.textContent = field.value === snapshot ? 'Сохранено' : 'Новые изменения ещё не сохранены';
            } catch (error) {
                log('Не удалось сохранить:', error);
                status.dataset.error = 'true';
                status.textContent = 'Не сохранено — нажмите «Сохранить» в CRM';
                showToast(error.name === 'AbortError' ? 'CRM не ответила вовремя. Сохраните комментарий обычной кнопкой.' : String(error.message || error), true);
            } finally {
                state.saving = false;
                button.disabled = false;
                button.setAttribute('aria-busy', 'false');
                updateCancelButton(state);
            }
        });
        const update = () => { if (cancelState === state) updateCancelButton(state); };
        field.addEventListener('input', update);
        field.addEventListener('change', update);
        updateCancelButton(state);
        if (label) { label.appendChild(button); label.after(status); }
        else { field.before(button); button.after(status); }
    }

    function ensureTools() {
        scanTimer = null;
        ensureStyles();
        if (isCreate) addPartnerButtons();
        else { attachToIdElements(); initAvitoCancelButton(); }
    }

    function init() {
        ensureTools();
        const observer = new MutationObserver(() => {
            if (scanTimer === null) scanTimer = setTimeout(ensureTools, 80);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(scanTimer); clearTimeout(toastTimer); scanTimer = null; });
        window.addEventListener('pageshow', event => {
            if (!event.persisted) return;
            observer.observe(document.documentElement, { childList: true, subtree: true });
            ensureTools();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
