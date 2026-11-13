// ==== Автоподстановка ссылки партнёра + белая заявка 723 (v4 FINAL) ====
(function () {
  'use strict';

  if (window.__CRM_PARTNER_AUTOFILL_INITIALIZED_V4) return;
  window.__CRM_PARTNER_AUTOFILL_INITIALIZED_V4 = true;

  const DEBUG = () => localStorage.getItem('CRM_DEBUG') === 'true';
  const log = (...a) => { if (DEBUG()) console.log('[PARTNER-AUTOFILL v4]', ...a); };
  const warn = (...a) => { console.warn('[PARTNER-AUTOFILL v4]', ...a); };

  const STORAGE_KEY = 'partnerLinksCache';
  const ownedObservers = new Set();
  window.addEventListener('pagehide',event=>{if(!event.persisted){clearInterval(window.__partnerAutofillV4Watcher);ownedObservers.forEach(observer=>observer.disconnect());ownedObservers.clear();}}, {once:true});
  const WHITE_LINE = '🔴БЕЛАЯ ЗАЯВКА🔴';
  const ALLOWED_HOST_RE = /(kp|mnc|bt)-lead-centre\.ru$/i;
  const unwrap = value => value?.__crmBridgeWrapped ? value.value : value;

  // ==== НОРМАЛИЗАЦИЯ ====
  function normalizeAlias(value) {
    return String(value || '')
      .normalize('NFKC')
      .toUpperCase()
      .replace(/ИСТОЧНИК\s*NO\s*3(?!\d)/g,'ИСТОЧНИК NO3')
      .replace(/[^0-9A-ZА-ЯЁ.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizePartnerLinksPayload(payload) {
    payload = unwrap(payload);
    if (!Array.isArray(payload)) return [];
    const seen = new Set();
    const result = [];
    for (const entry of payload) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.confirmed === false || ['missing','review','conflict'].includes(entry.status) || entry.manualDeleted) continue;
      const label = String(entry.label || entry.code || '').trim();
      let url;
      try {url = new URL(String(entry.url || '').trim());} catch (_) {continue;}
      if (!label || url.protocol !== 'https:' || url.username || url.password) continue;
      url = url.href;

      const aliases = new Set();
      const pushAlias = (v) => {
        const n = normalizeAlias(v);
        if (n && n!=='748') aliases.add(n);
      };

      pushAlias(label);
      pushAlias(entry.code); pushAlias(entry.externalId);
      if (Array.isArray(entry.externalIds)) entry.externalIds.forEach(pushAlias);
      if (Array.isArray(entry.aliases)) entry.aliases.forEach(pushAlias);

      const key = label + '|' + url;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ label, code:entry.code || '',base:entry.base || '',url,aliases:Array.from(aliases) });
    }
    return result;
  }

  // ==== СОСТОЯНИЕ ====
  let currentPartnerLinks = [];
  let partnerByAlias = new Map();

  function rebuildIndex() {
    const map = new Map(), owners = new Map(), blocked = new Set();
    for (const partner of currentPartnerLinks) for (const alias of partner.aliases) {
      const previous = owners.get(alias);
      if (previous && (previous.url !== partner.url || (previous.code || previous.label) !== (partner.code || partner.label))) {
        if (!/^\d{3,12}$/.test(alias)) {blocked.add((previous.code || previous.label) + '|' + previous.url);blocked.add((partner.code || partner.label) + '|' + partner.url);}
      } else if (!previous) owners.set(alias,partner);
    }
    for (const partner of currentPartnerLinks) {
      for (const alias of partner.aliases) {
        if (!alias) continue;
        if (blocked.has((partner.code || partner.label) + '|' + partner.url)) {map.set(alias,null);continue;}
        if (!map.has(alias)) map.set(alias,partner);
        else {
          const previous = map.get(alias);
          if (!previous || previous.url !== partner.url || (previous.code || previous.label) !== (partner.code || partner.label)) map.set(alias,null);
        }
      }
    }
    partnerByAlias = map;
    log('Индекс перестроен:', map.size, 'алиасов');
  }

  async function loadPartnerLinksFromStorage() {
    try {
      if (!chrome?.storage?.local) {
        warn('chrome.storage.local недоступен');
        return;
      }
      const stored = await chrome.storage.local.get([STORAGE_KEY]);
      currentPartnerLinks = normalizePartnerLinksPayload(stored[STORAGE_KEY]);
      rebuildIndex();
      log('Загружено источников:', currentPartnerLinks.length);
    } catch (e) {
      warn('Ошибка загрузки storage:', e);
    }
  }

  // ==== ПОИСК ПАРТНЁРА В ТЕКСТЕ ====
  function selectedPartner748() {
    const select=document.querySelector('#customerrequest-partner_id, select[name="CustomerRequest[partner_id]"]'),option=select?.options?.[select.selectedIndex];
    const label=option?String(option.textContent || ''):String(document.querySelector('#select2-customerrequest-partner_id-container')?.getAttribute('title') || '');
    return /^(?:(?:парт|партнер|партнёр)\s+)?748(?:\s+(?:парт|партнер|партнёр))?$/iu.test(label.normalize('NFKC').replace(/\s*\(\d+\)\s*$/,'').trim());
  }
  function findPartnerInText(text,allowNamed=false) {
    const source = String(text || '');
    if (!source.trim() || !partnerByAlias.size) return null;

    let normText = normalizeAlias(source);
    if(allowNamed&&['АВИТО','ИСТОЧНИК NO3'].includes(normText))normText='748 '+normText;
    if (!normText) return null;

    const aliases = Array.from(partnerByAlias.keys()).sort((a, b) => b.length - a.length);

    const matches = new Map();
    for (const alias of aliases) {
      if (!alias) continue;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if (!new RegExp('(?:^| )' + escaped + '(?= |$)').test(normText)) continue;
      const partner = partnerByAlias.get(alias);
      if (!partner) return null;
      matches.set((partner.code || partner.label) + '|' + partner.url,{partner,matchedAlias:alias});
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }

  // ==== ПОЛЯ ====
  const TARGET_FIELD_SELECTORS = [
    '#customerrequest-comments',
    'textarea[name="CustomerRequest[comments]"]'
  ];
  const ALL_FIELD_SELECTORS = [
    ...TARGET_FIELD_SELECTORS,
    '#customerrequest-partner_comment',
    'textarea[name="CustomerRequest[partner_comment]"]'
  ];
  const PARTNER_ONLY_SELECTOR =
    '#customerrequest-partner_comment, textarea[name="CustomerRequest[partner_comment]"]';

  function getTargetField() {
    return document.querySelector(TARGET_FIELD_SELECTORS.join(', '));
  }

  function preserveTransferredText(field) {
    if (!field || field.dataset.lpTransferValue === undefined) return false;
    if (String(field.value || '') === field.dataset.lpTransferValue) return true;
    delete field.dataset.lpTransferValue;
    return false;
  }

  function getAllFields() {
    const seen = new Set();
    const fields = [];
    ALL_FIELD_SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((field) => {
        if (field && !seen.has(field)) {
          seen.add(field);
          fields.push(field);
        }
      });
    });
    return fields;
  }

  // Куда писать URL: если источник — partner_comment, пишем в comments. Иначе — в себя.
  function getDestinationField(sourceField) {
    const target = getTargetField();
    if (!target) return sourceField || null;
    if (!sourceField || !sourceField.matches(PARTNER_ONLY_SELECTOR)) return sourceField || target;
    return target;
  }

  // ==== БЕЛАЯ ЗАЯВКА ====
  function hasWhiteLine(text) {
    return String(text || '').includes(WHITE_LINE);
  }

  function isWhitePartnerSelected() {
    const select = document.querySelector('#customerrequest-partner_id, select[name="CustomerRequest[partner_id]"]');
    const option = select?.options?.[select.selectedIndex];
    const rendered = document.querySelector('#select2-customerrequest-partner_id-container');
    const title = String(option ? option.textContent || '' : rendered?.getAttribute('title') || rendered?.textContent || '').normalize('NFKC').trim();
    // CRM values are internal foreign keys; the visible label carries the external partner number.
    return /^(?:(?:парт|партн[её]р)\s*(?:[:№-]|No\.?)?\s*)?0*723(?=$|\s|[(:—-])/iu.test(title);
  }

  let suppress = false;
  function withSuppress(fn) {
    suppress = true;
    try { return fn(); }
    finally { setTimeout(() => { suppress = false; }, 0); }
  }

  function dispatchEvents(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function ensureWhiteLine(field) {
    if (!field || preserveTransferredText(field)) return false;
    const current = String(field.value || '');
    if (hasWhiteLine(current)) return false;
    const next = current.trim() ? `${WHITE_LINE}\n${current.trim()}` : WHITE_LINE;
    withSuppress(() => { field.value = next; dispatchEvents(field); });
    log('Добавлена белая заявка');
    return true;
  }

  function removeWhiteLine(field) {
    if (!field || preserveTransferredText(field)) return false;
    const current = String(field.value || '');
    if (!hasWhiteLine(current)) return false;
    const next = current
      .replace(new RegExp(WHITE_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '');
    withSuppress(() => { field.value = next; dispatchEvents(field); });
    log('Убрана белая заявка');
    return true;
  }

  // ==== ПОДСТАНОВКА URL ====
  function replaceOrAppendPartnerUrl(destination, partner) {
    if (!destination || !partner || !partner.url || preserveTransferredText(destination)) return false;

    const current = String(destination.value || '');
    if (current.includes(partner.url)) return false;

    const lines = current.split(/\r?\n/);
    let lastIdx = lines.length - 1;
    while (lastIdx >= 0 && !lines[lastIdx].trim()) lastIdx--;

    const isUrlLine = (s) => /^https?:\/\//i.test(String(s || '').trim());
    let next;
    if (lastIdx >= 0 && isUrlLine(lines[lastIdx])) {
      lines[lastIdx] = partner.url;
      next = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    } else if (!current.trim()) {
      next = partner.url;
    } else {
      next = `${current.trim()}\n${partner.url}`.replace(/\n{3,}/g, '\n\n').trim();
    }

    if (next === current.trim()) return false;
    withSuppress(() => { destination.value = next; dispatchEvents(destination); });
    log('Подставлена ссылка в', destination.id || destination.name, ':', partner.label, '→', partner.url);
    return true;
  }

  // ==== ОБРАБОТКА ОДНОГО ПОЛЯ ====
  function processField(sourceField) {
    if (!sourceField || suppress || preserveTransferredText(sourceField)) return;

    // 1) Белая заявка — только в основное поле «Комментарий»
    const target = getTargetField();
    if (target) {
      if (isWhitePartnerSelected()) ensureWhiteLine(target);
      else removeWhiteLine(target);
    }

    // 2) Подстановка ссылки по алиасу
    const profileComment = sourceField.dataset.lpLeadChatProfileComment;
    const text = String(sourceField.value || '').split(/\r?\n/)
      .filter(line => !profileComment || line.trim() !== profileComment).join('\n');
    const found = findPartnerInText(text,sourceField.matches(PARTNER_ONLY_SELECTOR)&&selectedPartner748());
    if (!found) return;

    const destination = getDestinationField(sourceField);
    if (!destination) return;
    replaceOrAppendPartnerUrl(destination, found.partner);
  }

  // ==== WATCHER ====
  const observedValues = new WeakMap();
  let processScheduled = false;

  function scheduleProcess(sourceField) {
    if (processScheduled) return;
    processScheduled = true;
    setTimeout(() => {
      processScheduled = false;
      processField(sourceField);
    }, 120);
  }

  function attachField(field) {
    if (!field || field.dataset.__partnerAutofillV4 === 'true') return;
    field.dataset.__partnerAutofillV4 = 'true';
    observedValues.set(field, String(field.value || ''));

    const handle = () => { if (!suppress) scheduleProcess(field); };
    field.addEventListener('input', handle);
    field.addEventListener('keyup', handle);
    field.addEventListener('change', handle);
    field.addEventListener('blur', () => { if (!suppress) processField(field); });
    field.addEventListener('paste', () => setTimeout(() => { if (!suppress) processField(field); }, 60));

    // первичная обработка
    setTimeout(() => { if (!suppress) processField(field); }, 50);
  }

  function attachPartnerWatcher() {
    const select = document.querySelector('#customerrequest-partner_id, select[name="CustomerRequest[partner_id]"]');
    if (select && select.dataset.__partnerWhiteV4 !== 'true') {
      select.dataset.__partnerWhiteV4 = 'true';
      const handler = () => {
        if (suppress) return;
        const target = getTargetField();
        if (!target) return;
        if (document.getElementById('customerRequestForm')?.dataset.lpTransferApplying !== '1') delete target.dataset.lpTransferValue;
        if (isWhitePartnerSelected()) ensureWhiteLine(target);
        else removeWhiteLine(target);
        setTimeout(()=>{if(!suppress)getAllFields().forEach(processField);},0);
      };
      select.addEventListener('change', handler);
      select.addEventListener('input', handler);
    }

    const rendered = document.querySelector('#select2-customerrequest-partner_id-container');
    if (rendered && rendered.dataset.__partnerWhiteV4 !== 'true') {
      rendered.dataset.__partnerWhiteV4 = 'true';
      const obs = new MutationObserver(() => {
        if (suppress) return;
        const target = getTargetField();
        if (!target) return;
        if (isWhitePartnerSelected()) ensureWhiteLine(target);
        else removeWhiteLine(target);
        setTimeout(()=>{if(!suppress)getAllFields().forEach(processField);},0);
      });
      ownedObservers.add(obs);
      obs.observe(rendered, { attributes: true, attributeFilter: ['title'], childList: true, characterData: true, subtree: true });
    }
  }

  function ensureWatcher() {
    if (window.__partnerAutofillV4Watcher) return;
    window.__partnerAutofillV4Watcher = setInterval(() => {
      if(document.hidden)return;
      const fields = getAllFields();
      fields.forEach((field) => {
        attachField(field);
        if (suppress) return;
        const current = String(field.value || '');
        if (observedValues.get(field) !== current) {
          observedValues.set(field, current);
          processField(field);
        }
      });
      attachPartnerWatcher();

      // отдельная проверка белой заявки
      const target = getTargetField();
      if (target && !suppress) {
        if (isWhitePartnerSelected() && !hasWhiteLine(target.value)) ensureWhiteLine(target);
        else if (!isWhitePartnerSelected() && hasWhiteLine(target.value)) removeWhiteLine(target);
      }
    }, 2000);
  }

  // ==== STORAGE LISTENERS ====
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEY]) return;
      currentPartnerLinks = normalizePartnerLinksPayload(changes[STORAGE_KEY].newValue);
      rebuildIndex();
      log('Источники обновлены:', currentPartnerLinks.length);
      getAllFields().forEach((f) => processField(f));
    });
  } catch (e) { warn('storage.onChanged недоступен:', e); }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'crmReloadPartnerLinks') {
        loadPartnerLinksFromStorage().then(() => {
          getAllFields().forEach((f) => processField(f));
          try { sendResponse({ ok: true, count: currentPartnerLinks.length }); } catch (e) {}
        });
        return true;
      }
      if (msg && msg.action === 'partnerAutofillDebug') {
        try {
          sendResponse({
            ok: true,
            initialized: true,
            storageAvailable: !!chrome?.storage?.local,
            linksCount: currentPartnerLinks.length,
            aliasesCount: partnerByAlias.size,
            sampleAliases: Array.from(partnerByAlias.keys()).slice(0, 30),
            hasCommentField: !!getTargetField(),
            hasPartnerCommentField: !!document.querySelector(PARTNER_ONLY_SELECTOR),
            hasPartnerSelect: !!document.querySelector('#customerrequest-partner_id'),
            whiteSelected: isWhitePartnerSelected(),
            commentValue: getTargetField()?.value || '',
            partnerCommentValue: document.querySelector(PARTNER_ONLY_SELECTOR)?.value || ''
          });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return true;
      }
    });
  } catch (e) { warn('runtime.onMessage недоступен:', e); }

  // ==== INIT ====
  async function init() {
    if (!ALLOWED_HOST_RE.test(window.location.hostname)) return;

    if (!chrome?.storage?.local) {
      warn('chrome.storage.local недоступен — проверьте manifest');
      return;
    }

    await loadPartnerLinksFromStorage();

    const fields = getAllFields();
    fields.forEach((f) => attachField(f));
    attachPartnerWatcher();
    ensureWatcher();

    // первичная обработка
    fields.forEach((f) => setTimeout(() => { if (!suppress) processField(f); }, 200));

    log('Инициализирован. Источников:', currentPartnerLinks.length, 'Алиасов:', partnerByAlias.size);
  }

  // публичная отладочная функция
  window.__partnerAutofillV4Debug = async () => {
    await loadPartnerLinksFromStorage();
    return {
      linksCount: currentPartnerLinks.length,
      aliasesCount: partnerByAlias.size,
      sampleAliases: Array.from(partnerByAlias.keys()).slice(0, 30),
      commentValue: getTargetField()?.value || '',
      partnerCommentValue: document.querySelector(PARTNER_ONLY_SELECTOR)?.value || '',
      whiteSelected: isWhitePartnerSelected()
    };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // следим за появлением полей
  if (document.body) {
    const obs = new MutationObserver(records => {
      const selector='input,textarea,select,#select2-customerrequest-partner_id-container';
      if(!records.some(record=>[...(record.addedNodes||[])].some(node=>node.nodeType===1&&(node.matches?.(selector)||node.querySelector?.(selector)))))return;
      getAllFields().forEach((f) => attachField(f));
      attachPartnerWatcher();
    });
    ownedObservers.add(obs);
    obs.observe(document.body, { childList: true, subtree: true });
  }
})();
