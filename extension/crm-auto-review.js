(() => {
  'use strict';

  if (globalThis.__leadPartnerAutoReviewLoaded) return;
  globalThis.__leadPartnerAutoReviewLoaded = true;

  const STORAGE = {
    enabled: 'autoReviewEnabled',
    partners: 'autoReviewPartners',
    log: 'autoReviewLog'
  };

  const DEFAULT_PARTNERS = ['7', '007', '723', '748'];
  const PARTNER_CONTAINER = '#select2-customerrequest-partner_id-container';
  const PARTNER_SELECT = '#customerrequest-partner_id';
  const REVIEW_INPUT = '#customerrequest-is_req_fback';

  let enabled = true;
  let partnerAliases = [...DEFAULT_PARTNERS];
  let applying = false;
  // true only when THIS script turned the review switch on during the current page session.
  // Existing/manual review values are never treated as ours and therefore are never auto-removed.
  let reviewOwnedByAuto = false;
  let previousPartnerClass = 'unknown';
  let lastPartnerSignature = '';
  let lastAction = null;
  let evaluateTimer = null;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const lower = value => clean(value).toLocaleLowerCase('ru-RU');

  function normalizePartnerList(value) {
    const raw = Array.isArray(value) ? value : DEFAULT_PARTNERS;
    const seen = new Set();
    const result = [];
    for (const item of raw) {
      const normalized = clean(item);
      if (!normalized) continue;
      const key = normalized.toLocaleLowerCase('ru-RU');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    // Earlier releases saved this default list in settings. Extend only that
    // exact legacy default; deliberately configured partner lists stay intact.
    if (result.length === 3 && ['7', '007', '723'].every(alias => seen.has(alias))) result.push('748');
    return result.length ? result : [...DEFAULT_PARTNERS];
  }

  function isPlaceholder(text) {
    const value = lower(text);
    return !value || value === 'без партнера' || value === 'без партнёра' || value === 'не выбран' || value === 'не выбрано';
  }

  function collectCandidateValues(select, option, rendered) {
    const values = [];
    const add = value => {
      const normalized = clean(value);
      if (normalized && !values.includes(normalized)) values.push(normalized);
    };

    add(select?.value);
    add(option?.value);
    add(option?.textContent);
    add(rendered?.textContent);
    add(select?.getAttribute?.('data-value'));
    add(option?.getAttribute?.('data-id'));
    add(option?.getAttribute?.('data-value'));
    add(rendered?.getAttribute?.('data-value'));

    if (option?.dataset) Object.values(option.dataset).forEach(add);
    if (rendered?.dataset) Object.values(rendered.dataset).forEach(add);

    return values;
  }

  function candidateMatchesAlias(candidate, alias) {
    const c = lower(candidate);
    const a = lower(alias);
    if (!c || !a) return false;
    if (c === a) return true;

    // The selected option label is a partner code, not the CRM foreign key.
    // Ignore display padding without matching a different number or a note.
    if (/^\d+$/.test(a)) {
      const code = c.match(/^(?:(?:парт|партнер|партнёр)\s*[:№-]?\s*)?(\d+)(?=$|[^\p{L}\p{N}_.])/u)?.[1];
      return !!code && code.replace(/^0+(?=\d)/u, '') === a.replace(/^0+(?=\d)/u, '');
    }

    const tokens = c.split(/[\s,;|:/()[\]{}<>]+/).filter(Boolean);
    return tokens.includes(a);
  }

  function getPartnerSnapshot() {
    const select = document.querySelector(PARTNER_SELECT);
    const rendered = document.querySelector(PARTNER_CONTAINER);
    const option = select?.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;

    const renderedText = clean(rendered?.textContent);
    const optionText = clean(option?.textContent);
    const displayText = !isPlaceholder(optionText) ? optionText : !option ? renderedText : '';
    const rawValue = clean(select?.value || option?.value);
    const candidates = collectCandidateValues(select, option, rendered);
    const labels = !isPlaceholder(displayText) ? [displayText] : [];

    let matchedAlias = '';
    outer: for (const alias of partnerAliases) {
      for (const candidate of labels) {
        if (candidateMatchesAlias(candidate, alias)) {
          matchedAlias = alias;
          break outer;
        }
      }
    }

    const hasSelection = Boolean(
      matchedAlias ||
      (rawValue && rawValue !== '0') ||
      (displayText && !isPlaceholder(displayText))
    );

    return {
      selectFound: Boolean(select),
      renderedFound: Boolean(rendered),
      value: rawValue,
      text: displayText,
      candidates,
      matchedAlias,
      isTarget: Boolean(matchedAlias),
      hasSelection,
      signature: `${rawValue}||${displayText}||${matchedAlias}`
    };
  }

  function getReviewSnapshot() {
    const input = document.querySelector(REVIEW_INPUT);
    return {
      found: Boolean(input),
      checked: Boolean(input?.checked),
      disabled: Boolean(input?.disabled)
    };
  }

  function desiredStateFor(partner, previousClass) {
    if (!enabled) return null;

    // Managed partners always need the review switch ON.
    if (partner.isTarget) return true;

    // IMPORTANT: a review that was already ON when an existing request was opened,
    // or that the operator enabled manually, belongs to the request/operator.
    // Never remove it just because the partner is not in our auto list.
    if (!reviewOwnedByAuto) return null;

    // We only switch OFF a review that this extension itself switched ON earlier
    // (for example: 723 -> another partner in the same edit/create session).
    if (partner.hasSelection || previousClass === 'target') return false;
    return null;
  }

  function partnerClass(partner) {
    if (partner.isTarget) return 'target';
    if (partner.hasSelection) return 'other';
    return 'empty';
  }

  function writeLog(action, partner, review, extra = {}) {
    const entry = {
      time: Date.now(),
      action,
      partnerText: partner?.text || '',
      partnerValue: partner?.value || '',
      matchedAlias: partner?.matchedAlias || '',
      reviewChecked: Boolean(review?.checked),
      ...extra
    };
    lastAction = entry;

    chrome.storage.local.get({ [STORAGE.log]: [] }, result => {
      const list = Array.isArray(result[STORAGE.log]) ? result[STORAGE.log] : [];
      list.push(entry);
      chrome.storage.local.set({ [STORAGE.log]: list.slice(-25) });
    });
  }

  function dispatchStateEvents(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function forceCheckedState(input, desired) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
      if (descriptor?.set) descriptor.set.call(input, desired);
      else input.checked = desired;
    } catch (_) {
      input.checked = desired;
    }
    dispatchStateEvents(input);
  }

  function applyReviewState(desired, reason, partner) {
    if (desired === null || applying) return;

    const input = document.querySelector(REVIEW_INPUT);
    if (!input) return;
    if (input.checked === desired) return;
    if (input.disabled) {
      writeLog('blocked-disabled', partner, getReviewSnapshot(), { desired, reason });
      return;
    }

    applying = true;
    let clickFailed = false;

    try {
      input.click();
    } catch (_) {
      clickFailed = true;
    }

    window.setTimeout(() => {
      const current = document.querySelector(REVIEW_INPUT);
      if (!current) {
        applying = false;
        return;
      }

      if (current.checked !== desired) {
        forceCheckedState(current, desired);
      }

      window.setTimeout(() => {
        const verified = document.querySelector(REVIEW_INPUT);
        const success = Boolean(verified) && verified.checked === desired;
        if (success) {
          if (desired) reviewOwnedByAuto = true;
          else reviewOwnedByAuto = false;
        }
        writeLog(
          success ? (desired ? 'review-on' : 'review-off') : 'apply-failed',
          partner,
          getReviewSnapshot(),
          { desired, reason, clickFailed, reviewOwnedByAuto }
        );
        applying = false;
      }, 60);
    }, 45);
  }

  function evaluate(reason = 'check') {
    const partner = getPartnerSnapshot();
    const currentClass = partnerClass(partner);
    const previousClass = previousPartnerClass;
    const desired = desiredStateFor(partner, previousClass);

    lastPartnerSignature = partner.signature;
    previousPartnerClass = currentClass;

    if (!enabled) return;
    applyReviewState(desired, reason, partner);
  }

  function scheduleEvaluate(reason = 'event', delay = 20) {
    window.clearTimeout(evaluateTimer);
    evaluateTimer = window.setTimeout(() => evaluate(reason), delay);
  }

  function diagnosticSnapshot() {
    const partner = getPartnerSnapshot();
    const review = getReviewSnapshot();
    return {
      ok: true,
      enabled,
      partners: [...partnerAliases],
      url: location.href,
      partner,
      review,
      desired: desiredStateFor(partner, previousPartnerClass),
      reviewOwnedByAuto,
      lastAction
    };
  }

  function bindEvents() {
    document.addEventListener('change', event => {
      const target = event.target;
      if (target?.matches?.(PARTNER_SELECT)) {
        scheduleEvaluate('partner-change', 0);
        scheduleEvaluate('partner-change-confirm', 100);
        return;
      }
      if (target?.matches?.(REVIEW_INPUT) && !applying) {
        // Any direct operator action makes the current state manual.  In particular,
        // an existing/manual review for partner 666 (or any other non-managed partner)
        // must stay exactly as the operator/request set it.
        reviewOwnedByAuto = false;
        const partner = getPartnerSnapshot();
        // For managed partners the feature still guarantees ON.  If the operator
        // turned it off, it will be restored; for other partners we do nothing.
        if (partner.isTarget && !target.checked) scheduleEvaluate('review-manual-target-off', 25);
      }
    }, true);

    document.addEventListener('input', event => {
      if (event.target?.matches?.(PARTNER_SELECT)) scheduleEvaluate('partner-input', 0);
    }, true);

    document.addEventListener('click', event => {
      if (event.target?.closest?.('.select2-results__option, .select2-selection, ' + PARTNER_CONTAINER)) {
        scheduleEvaluate('select2-click', 0);
        scheduleEvaluate('select2-click-confirm', 90);
        scheduleEvaluate('select2-click-late', 220);
      }
    }, true);

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const node = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;
        if (!node) continue;

        if (
          node.matches?.(PARTNER_CONTAINER) ||
          node.closest?.(PARTNER_CONTAINER) ||
          node.matches?.(REVIEW_INPUT) ||
          node.closest?.('.field-customerrequest-is_req_fback')
        ) {
          scheduleEvaluate('dom-mutation', 15);
          return;
        }
      }
    });
    // Наблюдаем только форму заявки, а не весь документ: это заметно снижает нагрузку CRM.
    const observerTarget = document.querySelector('#customerRequestForm') || document.body || document.documentElement;
    observer.observe(observerTarget, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'checked', 'aria-checked', 'value']
    });

    // Редкая страховочная проверка на случай, если Select2 поменял значение без событий.
    // Основная реакция остаётся мгновенной через change/input/click/MutationObserver.
    window.setInterval(() => {
      if (document.hidden || !enabled) return;
      const partner = getPartnerSnapshot();
      const review = getReviewSnapshot();
      const signatureChanged = partner.signature !== lastPartnerSignature;
      const desired = desiredStateFor(partner, previousPartnerClass);
      const needsRepair = review.found && desired !== null && review.checked !== desired;

      if (signatureChanged || needsRepair) {
        evaluate(signatureChanged ? 'poll-partner-change' : 'poll-repair');
      }
    }, 1200);

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.action !== 'autoReviewDiagnose') return;
      sendResponse(diagnosticSnapshot());
    });
  }

  chrome.storage.local.get({
    [STORAGE.enabled]: true,
    [STORAGE.partners]: DEFAULT_PARTNERS,
    [STORAGE.log]: []
  }, result => {
    enabled = result[STORAGE.enabled] !== false;
    partnerAliases = normalizePartnerList(result[STORAGE.partners]);
    const existingLog = Array.isArray(result[STORAGE.log]) ? result[STORAGE.log] : [];
    lastAction = existingLog.length ? existingLog[existingLog.length - 1] : null;

    const initialPartner = getPartnerSnapshot();
    previousPartnerClass = partnerClass(initialPartner);
    lastPartnerSignature = initialPartner.signature;

    bindEvents();
    // On load, managed partners are forced ON. Non-managed partners are left untouched,
    // including existing requests where review was already enabled intentionally.
    reviewOwnedByAuto = false;
    scheduleEvaluate('initial-load', 60);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes[STORAGE.enabled]) {
      enabled = changes[STORAGE.enabled].newValue !== false;
      if (enabled) scheduleEvaluate('feature-enabled', 0);
    }

    if (changes[STORAGE.partners]) {
      partnerAliases = normalizePartnerList(changes[STORAGE.partners].newValue);
      scheduleEvaluate('partner-list-updated', 0);
    }
  });
})();
