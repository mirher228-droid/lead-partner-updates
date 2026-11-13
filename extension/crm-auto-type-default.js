// ==== Автовыбор "Впервые" в поле Тип на странице создания заявки ====
(function () {
    'use strict';

    if (window.__CRM_AUTO_TYPE_DEFAULT_INIT__) return;
    window.__CRM_AUTO_TYPE_DEFAULT_INIT__ = true;

    const log = (...a) => {
        if (localStorage.getItem('CRM_DEBUG') === 'true') console.log('[AUTO-TYPE-DEFAULT]', ...a);
    };

    if (!window.location.pathname.includes('/admin/domain/customer-request/create')) return;

    const DEFAULT_TYPE_VALUE = '10';

    function applyDefaultType() {
        const select = document.querySelector('#customerrequest-type')
            || document.querySelector('select[name="CustomerRequest[type]"]');

        if (!select) return false;
        if (select.value && select.value !== '') return true;

        select.value = DEFAULT_TYPE_VALUE;
        select.dispatchEvent(new Event('input',  { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));

        select.classList.remove('is-invalid');
        select.classList.remove('invalid');
        select.removeAttribute('aria-invalid');

        const parent = select.closest('.form-group') || select.parentElement;
        if (parent) {
            const err = parent.querySelector('.invalid-feedback, .help-block, .error-message');
            if (err) err.style.display = 'none';
        }

        try {
            if (typeof window.crForm_updateCrTypeState === 'function') {
                window.crForm_updateCrTypeState();
            }
        } catch (e) {}

        log('Тип автоматически выставлен на "Впервые"');
        return true;
    }

    function init() {
        if (!applyDefaultType()) {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                if (applyDefaultType() || attempts >= 40) clearInterval(timer);
            }, 250);
        }

        const observer = new MutationObserver(() => { applyDefaultType(); });
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();