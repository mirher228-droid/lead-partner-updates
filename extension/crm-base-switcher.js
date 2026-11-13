// ==== Переключение между базами КП / МНЧ / БТ на всех страницах CRM ====
(function() {
    'use strict';

    const BASES = [
        { key: 'kp', label: 'КП', url: 'https://kp-lead-centre.ru', color: '#9f1239' },
        { key: 'mnc', label: 'МНЧ', url: 'https://mnc-lead-centre.ru', color: '#2563eb' },
        { key: 'bt', label: 'БТ', url: 'https://bt-lead-centre.ru', color: '#0f766e' }
    ];

    function getCurrentBaseKey() {
        const host = window.location.hostname;
        if (host.includes('kp-lead-centre.ru')) return 'kp';
        if (host.includes('mnc-lead-centre.ru')) return 'mnc';
        if (host.includes('bt-lead-centre.ru')) return 'bt';
        return 'kp';
    }

    function addBaseSwitcher() {
        const header = document.querySelector('.content-header.d-flex.align-items-center');
        if (!header) {
            return;
        }

        if (document.getElementById('crm-base-switcher-container')) return;

        const container = document.createElement('div');
        container.id = 'crm-base-switcher-container';
        container.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            flex: 1 1 auto;
            margin: 0 20px;
            gap: 8px;
        `;

        const currentBase = getCurrentBaseKey();

        for (const base of BASES) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.crmBaseSwitch = '1';
            btn.textContent = base.label;
            btn.setAttribute('data-base', base.key);
            btn.title = /^\/admin\/domain\/customer-request\/create\/?$/.test(location.pathname)
                ? 'Перенести заполненную форму в ' + base.label : 'Открыть базу ' + base.label;
            btn.style.cssText = `
                margin: 0;
                padding: 6px 20px;
                border-radius: 30px;
                border: none;
                font-weight: 700;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s ease;
                background: ${currentBase === base.key ? base.color : '#f1f5f9'};
                color: ${currentBase === base.key ? '#ffffff' : '#1e293b'};
                box-shadow: ${currentBase === base.key ? `0 2px 8px ${base.color}60` : '0 1px 3px rgba(0,0,0,0.1)'};
                font-family: inherit;
                letter-spacing: 0.3px;
            `;
            btn.onmouseenter = () => {
                if (currentBase !== base.key) {
                    btn.style.background = '#e2e8f0';
                    btn.style.transform = 'translateY(-2px)';
                } else {
                    btn.style.transform = 'translateY(-2px)';
                    btn.style.boxShadow = `0 4px 12px ${base.color}80`;
                }
            };
            btn.onmouseleave = () => {
                if (currentBase !== base.key) {
                    btn.style.background = '#f1f5f9';
                    btn.style.transform = 'translateY(0)';
                } else {
                    btn.style.transform = 'translateY(0)';
                    btn.style.boxShadow = `0 2px 8px ${base.color}60`;
                }
            };
            // Навигацию выполняет crm-base-navigation.js в MAIN world.
            // Здесь только UI: один переход, без второго onclick и submit формы.
            container.appendChild(btn);
        }

        const rightBlock = header.querySelector('.d-flex.flex-nowrap.align-items-center.flex-fill');
        if (rightBlock) {
            header.insertBefore(container, rightBlock);
        } else {
            header.appendChild(container);
        }
        console.log('✅ Кнопки переключения баз добавлены');
    }

    if (!window.location.hostname.includes('yandex.ru') && window.location.pathname.includes('/admin/domain')) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', addBaseSwitcher);
        } else {
            addBaseSwitcher();
        }
        const observer = new MutationObserver(() => {
            if (!document.getElementById('crm-base-switcher-container')) {
                addBaseSwitcher();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
