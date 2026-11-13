// ==== Автовыбор вида работ + услуги по первому слову комментария (МНЧ, только /create) ====
(function () {
    'use strict';

    if (window.__CRM_AUTO_WORKTYPE_MNC_INIT__) return;
    window.__CRM_AUTO_WORKTYPE_MNC_INIT__ = true;

    const log = (...a) => {
        if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[AUTO-WORKTYPE-MNC]', ...a);
    };

    if (!window.location.hostname.includes('mnc-lead-centre.ru')) return;
    if (!window.location.pathname.includes('/admin/domain/customer-request/create')) return;

    const FIELD_COMMENT = '#customerrequest-comments';
    const FIELD_WORK    = '#customerrequest-appliance_type_id';
    const FIELD_SUB     = '#customerrequest-appliance_sub_type_id';

    const RULES = [
        {
            keys: ['повесить', 'полка', 'полку', 'полки', 'гардину', 'гардины',
                   'вешалку', 'вешалки', 'зеркало', 'жалюзи', 'шторы', 'штора'],
            workValue: '459',
            subValue:  '550'
        },
        {
            keys: ['розетка', 'розетки', 'выключатель', 'выключатели'],
            workValue: '457',
            subText:   'розет'
        },
        {
            keys: ['лампа', 'лампы', 'лампочка', 'лампочки', 'светильник', 'люстра', 'люстры'],
            workValue: '457',
            subText:   'ламп'
        }
    ];

    function normalizeWord(w) {
        return String(w || '').toLowerCase().replace(/ё/g, 'е').trim();
    }

    function getFirstWord(text) {
        if (!text) return '';
        const m = String(text).trim().match(/^[^\s]+/);
        return m ? m[0] : '';
    }

    function findRule(text) {
        const word = normalizeWord(getFirstWord(text)).replace(/[.,!?;:]+$/g, '');
        if (!word) return null;

        for (const rule of RULES) {
            for (const key of rule.keys) {
                const k = normalizeWord(key);
                if (word === k || word.startsWith(k)) return rule;
            }
        }
        return null;
    }

    function findOptionByValue(select, value) {
        if (!select) return null;
        for (let i = 0; i < select.options.length; i++) {
            if (String(select.options[i].value) === String(value)) return value;
        }
        return null;
    }

    function findOptionByText(select, textPart) {
        if (!select) return null;
        const needle = normalizeWord(textPart);
        for (let i = 0; i < select.options.length; i++) {
            const t = normalizeWord(select.options[i].textContent);
            if (t.includes(needle)) return select.options[i].value;
        }
        return null;
    }

    function setSelect(select, value, changeFnName) {
        if (!select || !value) return false;
        if (String(select.value) === String(value)) return true;

        select.value = value;
        select.dispatchEvent(new Event('input',  { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.classList.remove('is-invalid');

        if (changeFnName && typeof window[changeFnName] === 'function') {
            try { window[changeFnName](select); } catch (e) {}
        }
        return true;
    }

    function applyRule(rule) {
        const work = document.querySelector(FIELD_WORK);
        if (!work) return false;

        const workVal = findOptionByValue(work, rule.workValue);
        if (!workVal) {
            log('Вид работ не найден:', rule.workValue);
            return false;
        }

        setSelect(work, workVal, 'changeApplianceTypeHint');
        log('Вид работ установлен:', workVal);

        if (!rule.subValue && !rule.subText) return true;

        let attempts = 0;
        const timer = setInterval(() => {
            attempts++;
            const sub = document.querySelector(FIELD_SUB);
            if (sub && sub.options.length > 1) {
                let subVal = null;
                if (rule.subValue) subVal = findOptionByValue(sub, rule.subValue);
                if (!subVal && rule.subText) subVal = findOptionByText(sub, rule.subText);

                if (subVal) {
                    setSelect(sub, subVal, 'changeApplianceSubTypeHint');
                    log('Услуга установлена:', subVal);
                    clearInterval(timer);
                }
            }
            if (attempts >= 20) clearInterval(timer);
        }, 250);

        return true;
    }

    function processComment() {
        const field = document.querySelector(FIELD_COMMENT);
        if (!field) return;
        const rule = findRule(field.value);
        if (!rule) return;
        applyRule(rule);
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