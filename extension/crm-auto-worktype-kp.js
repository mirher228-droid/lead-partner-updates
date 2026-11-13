// ==== Автовыбор вида работ по первому слову комментария (КП, только /create) ====
(function () {
    'use strict';

    if (window.__CRM_AUTO_WORKTYPE_KP_INIT__) return;
    window.__CRM_AUTO_WORKTYPE_KP_INIT__ = true;

    const log = (...a) => {
        if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[AUTO-WORKTYPE-KP]', ...a);
    };

    if (!window.location.hostname.includes('kp-lead-centre.ru')) return;
    if (!window.location.pathname.includes('/admin/domain/customer-request/create')) return;

    const FIELD_COMMENT = '#customerrequest-comments';
    const FIELD_WORK    = '#customerrequest-appliance_type_id';

    const MAP = [
        { keys: ['тв', 'телевизор', 'телик', 'tv', 'жк', 'плазма', 'кинескоп'], value: '259' },
        {
            keys: [
                'ноутбук', 'ноут', 'пк', 'компьютер', 'комп', 'винду', 'винда', 'виндовс',
                'виндоус', 'windows', 'ос', 'моноблок', 'программа', 'програму', 'программу',
                'макбук', 'macbook', 'imac', 'аймак', 'мак', 'mac'
            ],
            value: '257'
        },
        { keys: ['принтер', 'мфу'], value: '258' },
        { keys: ['роутер', 'роутар', 'router'], value: '262' },
        { keys: ['монитор', 'видеокарта', 'видик'], value: '261' },
        { keys: ['ps', 'ps3', 'ps4', 'ps5', 'пс', 'пс3', 'пс4', 'пс5', 'xbox', 'иксбокс', 'nintendo', 'нинтендо', 'стимдек', 'steamdeck'], value: '264' },
        { keys: ['восстановление', 'восстановить', 'вд'], value: '263' },
        { keys: ['обжать', 'обжим'], value: '437' },
        { keys: ['тлф', 'айфон', 'iphone', 'айпад', 'ipad', 'телефон', 'планшет', 'смартфон'], value: '260' }
    ];

    function normalizeWord(w) {
        return String(w || '').toLowerCase().replace(/ё/g, 'е').trim();
    }

    function getFirstWord(text) {
        if (!text) return '';
        const m = String(text).trim().match(/^[^\s]+/);
        return m ? m[0] : '';
    }

    function findByFirstWord(text) {
        const word = normalizeWord(getFirstWord(text)).replace(/[.,!?;:]+$/g, '');
        if (!word) return null;

        for (const item of MAP) {
            for (const key of item.keys) {
                const k = normalizeWord(key);
                if (word === k || word.startsWith(k)) return item.value;
            }
        }
        return null;
    }

    function setWorkType(value) {
        const select = document.querySelector(FIELD_WORK);
        if (!select) return false;
        if (String(select.value) === String(value)) return true;

        let found = false;
        for (let i = 0; i < select.options.length; i++) {
            if (String(select.options[i].value) === String(value)) { found = true; break; }
        }
        if (!found) return false;

        select.value = value;
        select.dispatchEvent(new Event('input',  { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.classList.remove('is-invalid');

        try {
            if (typeof window.changeApplianceTypeHint === 'function') {
                window.changeApplianceTypeHint(select);
            }
        } catch (e) {}

        log('Вид работ выставлен:', value);
        return true;
    }

    function processComment() {
        const field = document.querySelector(FIELD_COMMENT);
        if (!field) return;
        const value = findByFirstWord(field.value);
        if (!value) return;
        setWorkType(value);
    }

    function init() {
        processComment();

        let attached = false;
        const tryAttach = () => {
            const comment = document.querySelector(FIELD_COMMENT);
            const work    = document.querySelector(FIELD_WORK);
            if (comment && work && !attached) {
                attached = true;

                let t = null;
                comment.addEventListener('input', () => {
                    clearTimeout(t);
                    t = setTimeout(processComment, 250);
                });
                comment.addEventListener('change', processComment);
                comment.addEventListener('blur',  processComment);
                comment.addEventListener('paste', () => setTimeout(processComment, 100));

                log('Слушатели навешены');
                return true;
            }
            return false;
        };

        if (!tryAttach()) {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                if (tryAttach() || attempts >= 40) clearInterval(timer);
            }, 250);
        }

        const observer = new MutationObserver(() => { if (!attached) tryAttach(); });
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();