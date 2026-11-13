// ==== Кнопка "Скопировать перенос" справа от заголовка "Переносы" ====
(function () {
  'use strict';

  if (window.__CRM_COPY_TRANSFER_INIT__) return;
  window.__CRM_COPY_TRANSFER_INIT__ = true;

  function getRequestId() {
    try {
      var m = window.location.href.match(/[?&]id=(\d+)/);
      if (m) return m[1];
      var h1 = document.querySelector('h1');
      if (h1) {
        var mm = h1.textContent.match(/№\s*(\d+)/);
        if (mm) return mm[1];
      }
    } catch (e) {}
    return '';
  }

  function copyText(text) {
    var value = String(text || '').trim();
    if (!value) return Promise.reject(new Error('empty'));

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).catch(function () {
        return fallbackCopy(value);
      });
    }
    return fallbackCopy(value);
  }

  function fallbackCopy(value) {
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        if (ok) resolve();
        else reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  function copyTransfer() {
    var ta = document.getElementById('customerrequest-date_changes');
    if (!ta) return;

    var lines = String(ta.value || '')
      .split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean);

    if (!lines.length) return;

    var lastLine = lines[lines.length - 1];
    var id = getRequestId();
    var out = id ? (id + ' ' + lastLine) : lastLine;

    copyText(out).catch(function () {});
  }

  function makeButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'crm-ct-btn';
    btn.className = 'btn btn-sm btn-primary';
    btn.textContent = 'Скопировать перенос';
    btn.title = 'Копирует последнюю строку из поля переносов + ID заявки';
    btn.style.cssText = [
      'margin-left:auto',
      'padding:4px 12px',
      'font-size:12px',
      'font-weight:600',
      'height:28px',
      'background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%)',
      'border:none',
      'color:#fff',
      'border-radius:6px',
      'cursor:pointer',
      'white-space:nowrap'
    ].join(';');

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      copyTransfer();
    });

    return btn;
  }

  function insertButton() {
    if (document.getElementById('crm-ct-btn')) return true;

    var ta = document.getElementById('customerrequest-date_changes');
    if (!ta) return false;

    var btn = makeButton();

    var labels = document.querySelectorAll('label');
    var labelEl = null;
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].textContent || '').trim() === 'Переносы') {
        labelEl = labels[i];
        break;
      }
    }

    if (labelEl) {
      var parent = labelEl.parentElement;
      if (parent) {
        var wrapper = parent.querySelector('.crm-ct-header');
        if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.className = 'crm-ct-header';
          wrapper.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;flex-wrap:wrap;';
          parent.insertBefore(wrapper, labelEl);
          wrapper.appendChild(labelEl);
        }
        labelEl.style.marginBottom = '0';
        wrapper.appendChild(btn);
      }
    } else {
      ta.parentNode.insertBefore(btn, ta);
    }

    return true;
  }

  function start() {
    insertButton();

    var obs = new MutationObserver(function () {
      if (!document.getElementById('crm-ct-btn')) insertButton();
    });

    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        obs.observe(document.body, { childList: true, subtree: true });
      }, { once: true });
    }

    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (document.getElementById('crm-ct-btn') || tries > 60) {
        clearInterval(timer);
        return;
      }
      insertButton();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();