(() => {
  'use strict';

  if (globalThis.__leadPartnerCommentPasteLoaded) return;
  globalThis.__leadPartnerCommentPasteLoaded = true;

  // CRM has several comment fields and their exact IDs differ between bases/pages.
  // We intentionally detect comment fields semantically instead of relying on a
  // short hard-coded selector list.
  const PAGE_IS_LOCAL_CREATE = location.protocol === 'chrome-extension:' && location.pathname === '/create-request.html';
  const PAGE_IS_NEW_REQUEST = /^\/admin\/domain\/customer-request\/create\/?$/i.test(location.pathname) || PAGE_IS_LOCAL_CREATE;
  const PAGE_IS_REQUEST_EDITOR = /\/admin\/domain\/customer-request\/(?:create|update)/i.test(location.pathname) || PAGE_IS_LOCAL_CREATE;
  const COMMENT_HINT_RE = /(comment|comments|коммент)/i;
  const HARD_SELECTORS = [
    '#customerrequest-comments',
    'textarea[name="CustomerRequest[comments]"]',
    '#customerrequest-comments_service',
    'textarea[name="CustomerRequest[comments_service]"]',
    '#customerrequest-partner_comment',
    'textarea[name="CustomerRequest[partner_comment]"]',
    '#customerrequest-recommendation_comment',
    'textarea[name="CustomerRequest[recommendation_comment]"]'
  ];

  function getAssociatedLabelText(field) {
    let text = '';
    const id = field.id;
    if (id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) text += ' ' + (label.textContent || '');
      } catch (_) {}
    }

    const group = field.closest?.('.form-group, .mb-3, .form-floating, [class*="field-customerrequest"]');
    if (group) {
      group.querySelectorAll?.(':scope > label, :scope > .control-label, :scope > .d-flex > label')
        .forEach(label => { text += ' ' + (label.textContent || ''); });
    }
    return text;
  }

  function isCommentField(node) {
    if (!PAGE_IS_REQUEST_EDITOR || !node || node.nodeType !== Node.ELEMENT_NODE) return false;

    const field = node.closest?.('textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (!field) return false;

    if (HARD_SELECTORS.some(selector => {
      try { return field.matches(selector); } catch (_) { return false; }
    })) return true;

    const tag = field.tagName?.toLowerCase();
    const type = String(field.getAttribute?.('type') || '').toLowerCase();
    if (tag === 'input' && !['text', 'search', 'url', ''].includes(type)) return false;

    const ownHints = [
      field.id,
      field.getAttribute?.('name'),
      field.getAttribute?.('placeholder'),
      field.getAttribute?.('aria-label'),
      field.getAttribute?.('data-field')
    ].filter(Boolean).join(' ');

    if (COMMENT_HINT_RE.test(ownHints)) return true;
    // Unknown CRM comment fields are normally textareas. Do not use broad label
    // matching for ordinary text inputs, so phone/address formatting stays native.
    return tag === 'textarea' && COMMENT_HINT_RE.test(getAssociatedLabelText(field));
  }

  function markRawPaste(field) {
    if (!field?.dataset) return;
    const current = 'value' in field ? String(field.value ?? '') : String(field.textContent ?? '');
    field.dataset.lpRawPasteValue = current;
    field.dataset.lpRawPasteUntil = String(Date.now() + 5000);
    field.dataset.partnerLinkObservedValue = current;
  }

  function setPlainTextAtSelection(field, text) {
    if ('value' in field) {
      const value = String(field.value ?? '');
      const start = Number.isInteger(field.selectionStart) ? field.selectionStart : value.length;
      const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;

      if (typeof field.setRangeText === 'function') {
        field.setRangeText(text, start, end, 'end');
      } else {
        field.value = value.slice(0, start) + text + value.slice(end);
        const caret = start + text.length;
        try { field.setSelectionRange(caret, caret); } catch (_) {}
      }
      return;
    }

    // Rare CRM widgets can be contenteditable. Preserve plain text and current
    // selection there too, without bringing Telegram/HTML formatting into CRM.
    const selection = window.getSelection?.();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (field.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }
    field.textContent = String(field.textContent || '') + text;
  }

  function getClipboardText(clipboard) {
    if (!clipboard) return null;

    const plain = clipboard.getData('text/plain');
    if (typeof plain === 'string' && plain.length) return plain;

    const html = clipboard.getData('text/html');
    if (typeof html === 'string' && html.length) {
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        doc.querySelectorAll('p,div,li').forEach(el => el.append('\n'));
        return (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/\n$/, '');
      } catch (_) {}
    }

    // Empty text is a valid paste (for example some clipboard managers).
    return typeof plain === 'string' ? plain : null;
  }

  function leadChatInformation(text) {
    if (!PAGE_IS_NEW_REQUEST || typeof text !== 'string' || text.length > 600) return null;
    const match = /^Диалог: (https?:\/\/[^\r\n]+)\r?\nМастер: ([^\r\n]+)$/.exec(text.trim());
    if (!match) return null;
    if (!/^https?:\/\/188-225-34-82\.sslip\.io\/chats\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match[1])) return null;
    const comment = match[2].trim();
    if (!comment || comment.length > 100 || /[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/.test(comment)) return null;
    try {
      const url = new URL(match[1]);
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== '188-225-34-82.sslip.io' ||
          url.username || url.password || url.port || url.search || url.hash ||
          !/^\/chats\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname)) return null;
      return {url: url.href, comment};
    } catch (_) { return null; }
  }

  function requestCommentFields(field) {
    const scope = field.closest('form') || (PAGE_IS_LOCAL_CREATE ? field.closest('.create-container') : null);
    if (!scope) return null;
    const find = selector => {
      const fields = [...scope.querySelectorAll(selector)].filter(node => !node.disabled && !node.readOnly &&
        !node.closest('fieldset[disabled]') && (!field.form || node.form === field.form));
      return fields.length === 1 ? fields[0] : null;
    };
    const comment = find('textarea#customerrequest-comments, textarea[name="CustomerRequest[comments]"]');
    const service = find('textarea#customerrequest-comments_service, textarea[name="CustomerRequest[comments_service]"]');
    return comment && service && comment !== service ? {comment, service} : null;
  }

  function appendLine(value, line) {
    if (value.split(/\r?\n/).some(existing => existing.trim() === line)) return value;
    return value + (value && !/[\r\n]$/.test(value) ? '\n' : '') + line;
  }

  function notifyPaste(field, text, change = false) {
    let inputEvent;
    try { inputEvent = new InputEvent('input', {bubbles: true, composed: true, inputType: 'insertFromPaste', data: text}); }
    catch (_) { inputEvent = new Event('input', {bubbles: true, composed: true}); }
    field.dispatchEvent(inputEvent);
    if (change) field.dispatchEvent(new Event('change', {bubbles: true}));
  }

  document.addEventListener('paste', (event) => {
    const field = event.target?.closest?.('textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (!isCommentField(field) || field.disabled || field.readOnly) return;

    const text = getClipboardText(event.clipboardData);
    if (text === null) return;

    // Block CRM/page handlers from interpreting clipboard text as partner IDs,
    // links or service commands. The user gets exactly the plain text copied.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const information = leadChatInformation(text), targets = information && requestCommentFields(field);
    if (information && targets) {
      // Compute and write both fields before notifying the form. Do not move focus,
      // overwrite a draft, or interpret the copied profile as a partner/source.
      const nextComment = appendLine(targets.comment.value, information.comment);
      const nextService = appendLine(targets.service.value, information.url);
      const changedComment = targets.comment.value !== nextComment, changedService = targets.service.value !== nextService;
      targets.comment.value = nextComment;
      targets.service.value = nextService;
      targets.comment.dataset.lpLeadChatProfileComment = information.comment;
      markRawPaste(targets.comment);
      markRawPaste(targets.service);
      if (changedComment) notifyPaste(targets.comment, information.comment, true);
      if (changedService) notifyPaste(targets.service, information.url, true);
      return;
    }

    setPlainTextAtSelection(field, text);
    markRawPaste(field);

    notifyPaste(field, text);
  }, true);
})();
