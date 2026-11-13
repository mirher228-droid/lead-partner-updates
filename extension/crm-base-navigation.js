// MAIN/document_start: только явное переключение базы кнопками расширения.
// Обычный выход со страницы и подтверждения других действий CRM не меняются.
(() => {
  'use strict';
  if (window.__CRM_BASE_NAVIGATION_INIT__) return;
  window.__CRM_BASE_NAVIGATION_INIT__ = true;
  const bases = { kp: 'kp-lead-centre.ru', mnc: 'mnc-lead-centre.ru', bt: 'bt-lead-centre.ru' };
  if (!Object.values(bases).includes(location.hostname) || !location.pathname.startsWith('/admin/domain')) return;
  let switching = false;
  let saving = false;

  window.addEventListener('beforeunload', event => {
    if (!switching) return;
    switching = false;
    // Зарегистрирован до обработчиков формы: не вызываем её dirty-form prompt.
    event.stopImmediatePropagation();
    event.returnValue = '';
  }, true);

  window.addEventListener('click', async event => {
    const button = event.target instanceof Element ? event.target.closest('#crm-base-switcher-container button[data-crm-base-switch="1"]') : null;
    const hostname = button && bases[button.dataset.base];
    if (!hostname) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (hostname === location.hostname || saving) return;
    const creating = /^\/admin\/domain\/customer-request\/create\/?$/.test(location.pathname);
    const target = creating ? new URL('/admin/domain/customer-request/create', 'https://' + hostname) : new URL(location.href);
    target.hostname = hostname;
    target.searchParams.delete('crm_map_source');
    target.searchParams.delete('crm_map_origin');
    try {
      if (creating && document.getElementById('customerRequestForm')) {
        saving = true;
        button.setAttribute('aria-busy', 'true');
        const transfer = window.__CRM_CREATE_TRANSFER__;
        if (!transfer) throw new Error('Перезагрузите страницу после обновления расширения.');
        const saved = await transfer.save(transfer.capture(), hostname);
        target.searchParams.set('lp_transfer', saved.token);
      }
      switching = true;
      location.assign(target.toString());
    } catch (error) {
      switching = false;
      if (window.__CRM_CREATE_TRANSFER__) window.__CRM_CREATE_TRANSFER__.notice(error.message, true);
      else alert(error.message);
    } finally { saving = false; button.removeAttribute('aria-busy'); }
  }, true);
})();
