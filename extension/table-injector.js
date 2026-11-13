const SOURCES = {
  mnc: {
    key: 'mnc',
    title: 'MNC',
    label: 'МНЧ',
    hostname: 'mnc-lead-centre.ru',
    base: 'https://mnc-lead-centre.ru'
  },
  bt: {
    key: 'bt',
    title: 'BT',
    label: 'БТ',
    hostname: 'bt-lead-centre.ru',
    base: 'https://bt-lead-centre.ru'
  },
  kp: {
    key: 'kp',
    title: 'KP',
    label: 'КП',
    hostname: 'kp-lead-centre.ru',
    base: 'https://kp-lead-centre.ru'
  }
};

const CALLTO_BIND_FLAG = '__extCalltoSipRewriteStarted';
const SOURCE_BADGE_FLAG = '__extSourceBadgeStarted';
const SOURCE_BADGE_ID = 'ext-request-source-badge';
const AUDIT_SOURCE_BADGE_FLAG = '__extAuditSourceBadgeStarted';
const AUDIT_SOURCE_BADGE_ID = 'ext-audit-source-badge';
const AUDIT_STATUS_UI_FLAG = '__extAuditStatusUiStarted';
const AUDIT_FOOTER_UI_FLAG = '__extAuditFooterUiStarted';
const CLAIM_BADGE_ID = 'ext-request-claim-badge';
const REQUEST_SOURCE_INFO_BADGE_ID = 'ext-request-source-info-badge';
const REQUEST_HEADER_BADGE_STYLE_ID = 'ext-request-header-badge-style';
const REQUEST_HEADER_BADGE_GROUP_ID = 'ext-request-header-badge-group';
const AUDIT_STATUS_STYLE_ID = 'ext-audit-status-style';
const AUDIT_STATUS_GROUP_ID = 'ext-audit-status-group';
const AUDIT_STATUS_BOUND_SELECTS = new WeakSet();
const AUDIT_STATUS_SELECT_BY_GROUP = new WeakMap();

const SIP_ID_BY_SOURCE = {
  KP: '001',
  MNC: '004',
  BT: '003'
};

const IS_CREATE_PAGE = window.location.pathname.includes('/admin/domain/customer-request/create');
const IS_UPDATE_PAGE = window.location.pathname.includes('/admin/domain/customer-request/update');
const IS_EDIT_PAGE = IS_UPDATE_PAGE || IS_CREATE_PAGE;
const IS_AUDIT_UPDATE_PAGE = window.location.pathname.includes('/admin/domain/request-audit/update');

function getSourceKeyByHost(host = window.location.hostname) {
  return Object.entries(SOURCES).find(([, source]) => host.includes(source.hostname))?.[0];
}

function getCurrentSourceConfig() {
  const sourceKey = getSourceKeyByHost();
  return sourceKey ? SOURCES[sourceKey] : null;
}

function getSipIdForCurrentHost() {
  const currentSource = getCurrentSourceConfig();
  return currentSource ? SIP_ID_BY_SOURCE[currentSource.title] : undefined;
}

function getSourceLabelForCurrentHost() {
  const currentSource = getCurrentSourceConfig();
  return currentSource?.label || '—';
}

function getStatusWrapperElement() {
  return (
    document.querySelector('.card-header h1 .ml-auto') ||
    document.querySelector('.ml-auto .crm-status-wrapper') ||
    document.querySelector('.crm-status-wrapper') ||
    document.querySelector('.card-header h1') ||
    document.querySelector('h1')
  );
}

function getRequestHeaderBadgeHost() {
  return document.querySelector('.card-header h1') || document.querySelector('h1') || null;
}

function getRequestHeaderBadgeAnchor(host = getRequestHeaderBadgeHost()) {
  if (!host) return null;

  return (
    host.querySelector('sup.badge') ||
    host.querySelector('.crm-header-statuses') ||
    host.querySelector('.crm-white-badge-container') ||
    null
  );
}

function ensureRequestHeaderBadgeStyles() {
  if (document.getElementById(REQUEST_HEADER_BADGE_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = REQUEST_HEADER_BADGE_STYLE_ID;
  document.head.appendChild(style);

  style.textContent = `
    #${REQUEST_HEADER_BADGE_GROUP_ID} {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-start;
      gap: 10px;
      flex: 0 1 auto;
      margin-left: 14px;
      vertical-align: middle;
    }

    #${REQUEST_HEADER_BADGE_GROUP_ID} .ext-request-header-badge {
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 10px 18px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: 0.35px;
      color: #ffffff;
      text-align: center;
      white-space: nowrap;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
    }

    #${REQUEST_HEADER_BADGE_GROUP_ID} .ext-request-header-badge:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.2);
      filter: brightness(1.02);
    }

    #${REQUEST_HEADER_BADGE_GROUP_ID} .ext-request-header-badge--source {
      background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
      box-shadow: 0 4px 15px rgba(52, 152, 219, 0.4);
    }

    #${REQUEST_HEADER_BADGE_GROUP_ID} .ext-request-header-badge--claim {
      background: linear-gradient(135deg, #ff4d4f 0%, #d9363e 100%);
      box-shadow: 0 4px 15px rgba(217, 54, 62, 0.38);
    }

    #${REQUEST_HEADER_BADGE_GROUP_ID} .ext-request-header-badge--source-info {
      max-width: 420px;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #6b3f00;
      text-shadow: 0 1px 1px rgba(255, 255, 255, 0.35);
      background: linear-gradient(135deg, #fff2b8 0%, #ffd36e 100%);
      box-shadow: 0 4px 15px rgba(209, 139, 0, 0.28);
    }
  `;
}

function ensureRequestHeaderBadgeGroup() {
  const host = getRequestHeaderBadgeHost();
  if (!host) return null;

  ensureRequestHeaderBadgeStyles();
  document.querySelectorAll('.ext-request-header-badge-host').forEach((element) => {
    element.classList.remove('ext-request-header-badge-host');
  });

  let group = document.getElementById(REQUEST_HEADER_BADGE_GROUP_ID);
  if (!group) {
    group = document.createElement('div');
    group.id = REQUEST_HEADER_BADGE_GROUP_ID;
  }

  const anchor = getRequestHeaderBadgeAnchor(host);
  const statusHost = Array.from(host.children).find((child) => child.classList?.contains('ml-auto')) || null;

  if (anchor && anchor.parentElement === host) {
    if (anchor.nextElementSibling !== group) {
      anchor.insertAdjacentElement('afterend', group);
    }
  } else if (statusHost && statusHost.parentElement === host) {
    if (statusHost.previousElementSibling !== group) {
      statusHost.insertAdjacentElement('beforebegin', group);
    }
  } else if (group.parentElement !== host) {
    host.appendChild(group);
  }

  return group;
}

function hasClaimFlagOnPage() {
  if (document.querySelector('.bg-has_claim')) return true;

  const candidates = document.querySelectorAll('.bg-has_claim .col__id, .col__id, [style*="e83b3b"], [style*="232, 59, 59"]');

  const isNearClaimRed = (color) => {
    const match = String(color || '').match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!match) return false;
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    return r >= 185 && g <= 95 && b <= 95;
  };

  for (const element of candidates) {
    const bg = window.getComputedStyle(element).backgroundColor || '';
    if (isNearClaimRed(bg)) return true;
  }
  return false;
}

function attachSourceBadgeNearStatus() {
  const badgeGroup = ensureRequestHeaderBadgeGroup();
  if (!badgeGroup) return;

  let badge = document.getElementById(SOURCE_BADGE_ID);
  if (!badge) {
    badge = document.createElement('span');
    badge.id = SOURCE_BADGE_ID;
    badge.className = 'ext-request-header-badge ext-request-header-badge--source crm-status-animated';
    badgeGroup.appendChild(badge);
  }

  if (badge.parentElement !== badgeGroup) badgeGroup.appendChild(badge);

  const sourceLabel = getSourceLabelForCurrentHost();
  const text = `Источник: ${sourceLabel}`;
  const title = `Текущая база: ${sourceLabel}`;
  if (badge.textContent !== text) badge.textContent = text;
  if (badge.title !== title) badge.title = title;
}

function formatRequestSourceInfoBadgeText(sourceInfo) {
  if (!sourceInfo?.text) return '';
  if (sourceInfo.kind === 'partner') return `Партнер: ${sourceInfo.text}`;
  if (String(sourceInfo.text).toLowerCase().includes('листовк')) return `Листовка: ${sourceInfo.text}`;
  return `Источник заявки: ${sourceInfo.text}`;
}

function attachRequestSourceInfoBadge() {
  const badgeGroup = ensureRequestHeaderBadgeGroup();
  if (!badgeGroup) return;

  const sourceInfo = readRequestSourceFromDocument(document);
  let badge = document.getElementById(REQUEST_SOURCE_INFO_BADGE_ID);

  if (!sourceInfo?.text) {
    badge?.remove();
    return;
  }

  if (!badge) {
    badge = document.createElement('span');
    badge.id = REQUEST_SOURCE_INFO_BADGE_ID;
    badge.className = 'ext-request-header-badge ext-request-header-badge--source-info crm-status-animated';
  }

  const claimBadge = document.getElementById(CLAIM_BADGE_ID);
  if (claimBadge?.parentElement === badgeGroup) {
    if (badge.parentElement !== badgeGroup || badge.nextElementSibling !== claimBadge) {
      claimBadge.insertAdjacentElement('beforebegin', badge);
    }
  } else if (badge.parentElement !== badgeGroup) {
    badgeGroup.appendChild(badge);
  }

  const text = formatRequestSourceInfoBadgeText(sourceInfo);
  const title = sourceInfo.tooltip || sourceInfo.text;
  if (badge.textContent !== text) badge.textContent = text;
  if (badge.title !== title) badge.title = title;
}

function attachAuditSourceBadge(sourceText, tooltip = '') {
  const statusWrapper = getStatusWrapperElement();
  if (!statusWrapper) return;

  let badge = document.getElementById(AUDIT_SOURCE_BADGE_ID);
  if (!badge) {
    badge = document.createElement('span');
    badge.id = AUDIT_SOURCE_BADGE_ID;
    badge.style.marginLeft = '10px';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.fontWeight = '800';
    badge.style.fontSize = '14px';
    badge.style.lineHeight = '1.2';
    badge.style.padding = '5px 12px';
    badge.style.borderRadius = '12px';
    badge.style.background = 'linear-gradient(135deg, #fff2b8 0%, #ffd36e 100%)';
    badge.style.border = '2px solid #d18b00';
    badge.style.boxShadow = '0 3px 10px rgba(209, 139, 0, 0.28)';
    badge.style.color = '#6b3f00';
    badge.style.marginRight = '8px';
    badge.style.verticalAlign = 'middle';
    statusWrapper.appendChild(badge);
  }

  badge.textContent = `Источник заявки: ${sourceText}`;
  badge.title = tooltip || sourceText;
}

function removeAuditSourceBadge() {
  document.getElementById(AUDIT_SOURCE_BADGE_ID)?.remove();
}

async function fetchHtmlViaBackground(url) {
  const response = await chrome.runtime.sendMessage({ type: 'FETCH_HTML', url });
  if (!response?.ok) {
    if (response?.status) throw new Error(`HTTP ${response.status}`);
    throw new Error(response?.error || 'Fetch failed');
  }
  return response.text;
}

function resolveCustomerRequestUrlFromAuditPage() {
  const requestLink = document.querySelector('a[href*="/admin/domain/customer-request/update?id="]');
  const href = requestLink?.getAttribute('href');
  if (href) return new URL(href, window.location.origin).toString();

  const candidateSelectors = [
    'input[name="RequestAudit[customer_request_id]"]',
    '#requestaudit-customer_request_id',
    'input[name="RequestAudit[request_id]"]',
    '#requestaudit-request_id',
    'input[name="customer_request_id"]',
    'input[name="request_id"]'
  ];

  for (const selector of candidateSelectors) {
    const element = document.querySelector(selector);
    const value = String(element?.value || element?.getAttribute?.('value') || '').trim();
    if (/^\d+$/.test(value)) {
      return new URL(`/admin/domain/customer-request/update?id=${value}`, window.location.origin).toString();
    }
  }

  const html = document.documentElement?.innerHTML || '';
  const match = html.match(/\/admin\/domain\/customer-request\/update\?id=(\d+)/i);
  if (match) {
    return new URL(`/admin/domain/customer-request/update?id=${match[1]}`, window.location.origin).toString();
  }

  return '';
}

function getAdvertSourceLabel(advertText) {
  const cleaned = String(advertText || '').trim().replace(/\s+/g, ' ');
  const normalized = cleaned.toLowerCase();
  if (normalized.includes('листовк')) return cleaned;
  if (normalized.includes('визитк')) return cleaned;
  if (normalized.includes('расклейк')) return cleaned;
  if (normalized.includes('газет')) return cleaned;
  return cleaned;
}

function isPlaceholderPartnerText(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    !normalized ||
    normalized === 'выберите партнера' ||
    normalized === 'без партнера' ||
    normalized === 'без партнёра' ||
    normalized === 'не выбран' ||
    normalized === 'не выбрано'
  );
}

function readRequestSourceFromDocument(doc) {
  const rendered = doc.querySelector('#select2-customerrequest-partner_id-container');
  const renderedText = String(rendered?.textContent || '').trim();
  const renderedTitle = String(rendered?.getAttribute('title') || '').trim();

  if (!isPlaceholderPartnerText(renderedText)) {
    return { kind: 'partner', text: renderedText, tooltip: renderedTitle || renderedText };
  }

  if (!isPlaceholderPartnerText(renderedTitle)) {
    return { kind: 'partner', text: renderedTitle, tooltip: renderedTitle };
  }

  const partnerSelect = doc.querySelector('select[name="CustomerRequest[partner_id]"]');
  if (partnerSelect) {
    const selectedOption = partnerSelect.options[partnerSelect.selectedIndex];
    const selectedText = String(selectedOption?.textContent || '').trim();
    const selectedValue = String(partnerSelect.value || '').trim();

    if (!isPlaceholderPartnerText(selectedText)) {
      return { kind: 'partner', text: selectedText, tooltip: selectedText };
    }

    if (selectedValue && selectedValue !== '0') {
      return { kind: 'partner', text: selectedValue, tooltip: selectedValue };
    }
  }

  const advertSelect = doc.querySelector('#customerrequest-advert_id, select[name="CustomerRequest[advert_id]"]');
  if (!advertSelect) return null;

  const advertOption = advertSelect.options[advertSelect.selectedIndex];
  const advertText = String(advertOption?.textContent || '').trim();
  const advertValue = String(advertSelect.value || '').trim();

  if (advertText && !/^выберите$/i.test(advertText)) {
    const sourceLabel = getAdvertSourceLabel(advertText);
    return { kind: 'advert', text: sourceLabel, tooltip: `Рекламная кампания: ${advertText}` };
  }

  if (advertValue) {
    return { kind: 'advert', text: 'Рекламная кампания', tooltip: `advert_id: ${advertValue}` };
  }

  return null;
}

async function loadAuditSourceBadge() {
  const customerRequestUrl = resolveCustomerRequestUrlFromAuditPage();
  if (!customerRequestUrl) { removeAuditSourceBadge(); return false; }

  attachAuditSourceBadge('...', 'Загрузка источника заявки');

  try {
    const html = await fetchHtmlViaBackground(customerRequestUrl);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const partnerSource = readRequestSourceFromDocument(doc);

    if (!partnerSource?.text) { removeAuditSourceBadge(); return false; }

    attachAuditSourceBadge(partnerSource.text, partnerSource.tooltip);
    return true;
  } catch (error) {
    removeAuditSourceBadge();
    return false;
  }
}

function initAuditSourceBadge() {
  if (window[AUDIT_SOURCE_BADGE_FLAG]) return;
  window[AUDIT_SOURCE_BADGE_FLAG] = true;

  let attempts = 0;
  let isLoading = false;
  const maxAttempts = 12;

  const tryLoad = async () => {
    if (isLoading) return;
    isLoading = true;
    const loaded = await loadAuditSourceBadge();
    isLoading = false;
    attempts += 1;
    if (loaded || attempts >= maxAttempts) clearInterval(timerId);
  };

  const timerId = setInterval(() => { void tryLoad(); }, 500);
  void tryLoad();
}

function ensureAuditStatusStyles() {
  if (document.getElementById(AUDIT_STATUS_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = AUDIT_STATUS_STYLE_ID;
  style.textContent = `
    .ext-audit-status-select-hidden {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }

    #${AUDIT_STATUS_GROUP_ID} {
      display: flex;
      flex-wrap: nowrap;
      gap: 8px;
      overflow-x: auto;
      padding: 6px 2px 10px;
      scrollbar-width: thin;
    }

    #${AUDIT_STATUS_GROUP_ID}::-webkit-scrollbar { height: 8px; }

    #${AUDIT_STATUS_GROUP_ID}::-webkit-scrollbar-thumb {
      background: rgba(90, 105, 130, 0.35);
      border-radius: 999px;
    }

    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn {
      border: 1px solid #cfd7e6;
      border-radius: 14px;
      min-height: 42px;
      padding: 8px 14px;
      background: linear-gradient(180deg, #ffffff 0%, #eef3fb 100%);
      color: #1f2d3d;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.1;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(37, 59, 96, 0.08);
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, filter 0.15s ease;
      flex: 0 0 auto;
    }

    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 7px 18px rgba(37, 59, 96, 0.14);
      filter: brightness(1.01);
    }

    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn.is-active {
      color: #ffffff;
      border-color: transparent;
      box-shadow: 0 10px 22px rgba(34, 57, 94, 0.2);
      transform: translateY(-1px);
    }

    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn[data-value="0"].is-active { background: linear-gradient(135deg, #6b7280 0%, #374151 100%); }
    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn[data-value="1"].is-active { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); }
    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn[data-value="2"].is-active { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); }
    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn[data-value="3"].is-active { background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); }
    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn[data-value="4"].is-active { background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); }
    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn[data-value="5"].is-active { background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%); }
    #${AUDIT_STATUS_GROUP_ID} .ext-audit-status-btn[data-value="6"].is-active { background: linear-gradient(135deg, #10b981 0%, #059669 100%); }

    .ext-audit-footer-actions {
      display: flex !important;
      flex-wrap: wrap;
      align-items: stretch;
      justify-content: flex-start !important;
      gap: 10px;
      padding: 14px;
      margin-top: 8px;
      border-radius: 18px;
      background: linear-gradient(180deg, #fbfdff 0%, #eef4fb 100%);
      border: 1px solid #dae5f2;
      box-shadow: 0 10px 24px rgba(47, 72, 115, 0.08);
    }

    .ext-audit-footer-actions > .btn {
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      flex: 1 1 180px;
      min-height: 46px;
      margin: 0 !important;
      padding: 10px 18px;
      border-radius: 14px;
      border: none !important;
      text-decoration: none !important;
      font-size: 14px;
      font-weight: 800;
      line-height: 1.1;
      white-space: nowrap;
      box-shadow: 0 8px 20px rgba(41, 61, 96, 0.14);
      transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
    }

    .ext-audit-footer-actions > .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 12px 24px rgba(41, 61, 96, 0.18);
      filter: brightness(1.02);
    }

    .ext-audit-footer-actions > .btn:focus {
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2), 0 12px 24px rgba(41, 61, 96, 0.18);
    }

    .ext-audit-footer-actions > .ext-audit-footer-save {
      background: linear-gradient(135deg, #22c55e 0%, #15803d 100%) !important;
      color: #ffffff !important;
    }

    .ext-audit-footer-actions > .ext-audit-footer-approve {
      background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%) !important;
      color: #ffffff !important;
    }

    .ext-audit-footer-actions > .ext-audit-footer-back {
      background: linear-gradient(135deg, #64748b 0%, #475569 100%) !important;
      color: #ffffff !important;
    }

    .ext-audit-footer-actions > .ext-audit-footer-remove {
      background: linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%) !important;
      color: #9a3412 !important;
      border: 1px solid #fdba74 !important;
      box-shadow: 0 8px 20px rgba(194, 65, 12, 0.12);
    }

    @media (max-width: 920px) {
      .ext-audit-footer-actions > .btn { flex-basis: calc(50% - 5px); }
    }

    @media (max-width: 640px) {
      .ext-audit-footer-actions > .btn { flex-basis: 100%; }
    }
  `;

  document.head.appendChild(style);
}

function syncAuditStatusButtons(select, group) {
  if (!select || !group) return;
  const currentValue = String(select.value || '');
  group.querySelectorAll('.ext-audit-status-btn').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.value === currentValue);
    button.setAttribute('aria-pressed', button.dataset.value === currentValue ? 'true' : 'false');
  });
}

function ensureAuditStatusButtons() {
  if (!IS_AUDIT_UPDATE_PAGE) return;

  const select = document.querySelector('select[name="CustomerRequest[audit_status]"]');
  if (!(select instanceof HTMLSelectElement)) return;

  const field = select.closest('.field-customerrequest-audit_status, .form-group');
  if (!field) return;

  ensureAuditStatusStyles();

  let group = document.getElementById(AUDIT_STATUS_GROUP_ID);
  if (!group) {
    group = document.createElement('div');
    group.id = AUDIT_STATUS_GROUP_ID;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Быстрый выбор статуса прозвона');
    select.insertAdjacentElement('afterend', group);
  }

  const options = Array.from(select.options).filter((option) => String(option.value || '').trim() !== '');
  const serialized = JSON.stringify(options.map((option) => ({
    value: option.value,
    text: (option.textContent || '').trim()
  })));

  if (group.dataset.options !== serialized || AUDIT_STATUS_SELECT_BY_GROUP.get(group) !== select) {
    AUDIT_STATUS_SELECT_BY_GROUP.set(group, select);
    group.dataset.options = serialized;
    group.replaceChildren();

    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ext-audit-status-btn';
      button.dataset.value = String(option.value);
      button.textContent = (option.textContent || '').trim();
      button.title = `Установить статус: ${(option.textContent || '').trim()}`;
      button.addEventListener('click', () => {
        if (select.value === option.value) {
          syncAuditStatusButtons(select, group);
          return;
        }
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncAuditStatusButtons(select, group);
      });
      group.appendChild(button);
    });

  }

  if (!AUDIT_STATUS_BOUND_SELECTS.has(select)) {
    const syncCurrentGroup = () => {
      const currentGroup = document.getElementById(AUDIT_STATUS_GROUP_ID);
      if (AUDIT_STATUS_SELECT_BY_GROUP.get(currentGroup) === select) {
        syncAuditStatusButtons(select, currentGroup);
      }
    };
    select.addEventListener('change', syncCurrentGroup);
    select.addEventListener('input', syncCurrentGroup);
    AUDIT_STATUS_BOUND_SELECTS.add(select);
  }

  select.classList.add('ext-audit-status-select-hidden');
  syncAuditStatusButtons(select, group);
}

function initAuditStatusButtons() {
  if (window[AUDIT_STATUS_UI_FLAG]) return;
  window[AUDIT_STATUS_UI_FLAG] = true;
  ensureAuditStatusButtons();

  const observer = new MutationObserver(() => {
    ensureAuditStatusButtons();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function resolveAuditFooterButtonVariant(control) {
  const onclick = String(control.getAttribute('onclick') || '');
  const href = String(control.getAttribute('href') || '');
  const text = String(control.textContent || '').trim().toLowerCase();

  if (onclick.includes('saveAndClose') || text === 'сохранить') return 'ext-audit-footer-save';
  if (onclick.includes('approveAndClose') || text === 'провести') return 'ext-audit-footer-approve';
  if (onclick.includes('removeAndClose') || text.includes('убрать из прозвона')) return 'ext-audit-footer-remove';
  if (href.includes('/request-audit/index') || text === 'назад') return 'ext-audit-footer-back';
  return '';
}

function ensureAuditFooterActions() {
  if (!IS_AUDIT_UPDATE_PAGE) return;
  const submitGroup = document.querySelector('.card-footer .submit-group');
  if (!(submitGroup instanceof HTMLElement)) return;

  ensureAuditStatusStyles();
  submitGroup.classList.add('ext-audit-footer-actions');

  const controls = Array.from(submitGroup.querySelectorAll('button.btn, a.btn'));
  controls.forEach((control) => {
    control.classList.remove('mr-2', 'mr-auto', 'ml-auto');
    control.classList.remove('ext-audit-footer-save', 'ext-audit-footer-approve', 'ext-audit-footer-back', 'ext-audit-footer-remove');
    const variant = resolveAuditFooterButtonVariant(control);
    if (variant) control.classList.add(variant);
  });
}

function initAuditFooterActions() {
  if (window[AUDIT_FOOTER_UI_FLAG]) return;
  window[AUDIT_FOOTER_UI_FLAG] = true;
  ensureAuditFooterActions();

  const observer = new MutationObserver(() => {
    ensureAuditFooterActions();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function attachClaimBadgeNearStatus() {
  const badgeGroup = ensureRequestHeaderBadgeGroup();
  if (!badgeGroup) return;

  const hasClaim = hasClaimFlagOnPage();
  let badge = document.getElementById(CLAIM_BADGE_ID);

  if (!hasClaim) {
    if (badge) badge.remove();
    return;
  }

  if (!badge) {
    badge = document.createElement('span');
    badge.id = CLAIM_BADGE_ID;
    badge.className = 'ext-request-header-badge ext-request-header-badge--claim crm-status-animated';
    badgeGroup.appendChild(badge);
  }

  if (badge.parentElement !== badgeGroup) badgeGroup.appendChild(badge);

  if (badge.textContent !== 'Претензия') badge.textContent = 'Претензия';
  if (badge.title !== 'В заявке отмечена претензия') badge.title = 'В заявке отмечена претензия';
}

function initRequestSourceBadge() {
  if (window[SOURCE_BADGE_FLAG]) return;
  window[SOURCE_BADGE_FLAG] = true;
  attachSourceBadgeNearStatus();
  attachRequestSourceInfoBadge();
  attachClaimBadgeNearStatus();

  let attempts = 0;
  const timerId = setInterval(() => {
    attempts += 1;
    attachSourceBadgeNearStatus();
    attachRequestSourceInfoBadge();
    attachClaimBadgeNearStatus();
    if (attempts >= 12) clearInterval(timerId);
  }, 500);
}

function setSipIdOnCalltoAnchor(anchor, sipId) {
  const href = anchor.getAttribute('href') || anchor.href || '';
  if (!href) return;

  const hrefLower = href.toLowerCase();
  if (!hrefLower.startsWith('callto:') && !hrefLower.startsWith('tel:')) return;

  let normalizedHref = href;
  if (hrefLower.startsWith('tel:')) normalizedHref = `callto:${href.slice(4)}`;

  const hrefWithoutSip = normalizedHref.replace(/;sip_id=[^;]+/i, '');
  anchor.setAttribute('href', `${hrefWithoutSip};sip_id=${sipId}`);
}

function applySipIdToCalltoLinks(container, sourceTitle) {
  const sipId = sourceTitle ? SIP_ID_BY_SOURCE[sourceTitle] : getSipIdForCurrentHost();
  if (!sipId) return;

  const anchors = container.querySelectorAll('a[href]');
  anchors.forEach((anchor) => {
    setSipIdOnCalltoAnchor(anchor, sipId);
  });
}

function initCalltoSipRewrite() {
  if (window[CALLTO_BIND_FLAG]) return;

  const sipId = getSipIdForCurrentHost();
  if (!sipId) return;

  window[CALLTO_BIND_FLAG] = true;

  applySipIdToCalltoLinks(document, null);

  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    setSipIdOnCalltoAnchor(anchor, sipId);
  }, true);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('a[href^="callto:"], a[href^="tel:"]')) {
          setSipIdOnCalltoAnchor(node, sipId);
        }
        node.querySelectorAll?.('a[href^="callto:"], a[href^="tel:"]').forEach((anchor) => {
          setSipIdOnCalltoAnchor(anchor, sipId);
        });
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (IS_EDIT_PAGE) {
  initRequestSourceBadge();
}

if (IS_AUDIT_UPDATE_PAGE) {
  initAuditSourceBadge();
  initAuditStatusButtons();
  initAuditFooterActions();
}

initCalltoSipRewrite();
