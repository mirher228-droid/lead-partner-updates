/* The offscreen parser owns the short verification clock; the worker owns data. */
(() => {
  'use strict';
  let pending = false;
  const wake = () => {
    if (pending) return;
    pending = true;
    try {
      chrome.runtime.sendMessage({type:'CRM_AVITO_CLOCK'},() => {
        void chrome.runtime.lastError;
        pending = false;
      });
    } catch (_) { pending = false; }
  };
  setInterval(wake,12000);
  wake();
})();
