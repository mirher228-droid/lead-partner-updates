/* LeadChat only: the CRM card is an extension-origin iframe, isolated from the conversation. */
(() => {
  'use strict';
  if (globalThis.__LP_REQUEST_HOST__) return;
  globalThis.__LP_REQUEST_HOST__ = true;
  const adapter = globalThis.LeadChatRequestContext?.createAdapter();
  if (!adapter) return;
  let host, slot, shadow, frame, channel, context, activeKey = '', sentSignature = '', opened = false, reading = false, pendingRead = false, awaitingContext = false, contextEpoch = 0;
  let headerRecord=null,geometryFrame=0,geometryRect='';
  const geometryObserver=typeof ResizeObserver==='function'?new ResizeObserver(()=>scheduleGeometry()):null;
  function scheduleGeometry(){
    if(geometryFrame)return;
    geometryFrame=requestAnimationFrame(()=>{
      geometryFrame=0;if(!opened || !host || !slot?.isConnected)return;
      const r=slot.getBoundingClientRect(),signature=[r.left,r.top,r.width,r.height].join('|');
      if(signature===geometryRect)return;geometryRect=signature;
      for(const [name,value]of [['left',r.left],['top',r.top],['width',r.width],['height',r.height]])host.style.setProperty('--lp-request-'+name,value+'px');
    });
  }
  const panelUrl = chrome.runtime.getURL('leadchat-request-panel.html');
  const extensionOrigin = new URL(panelUrl).origin;
  const hasEmployeeIdentity = typeof adapter.readIdentity === 'function' && typeof adapter.subscribeIdentity === 'function';
  let reportedEmployeeOperator = '', pendingEmployeeIdentity = null, employeeCandidate = null;
  let employeeFocusRevision = 0, employeeFocusRead = null;
  function employeeVisible() { return !document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus()); }
  function employeeIdentity(value) {
    if (hasEmployeeIdentity) {
      const {operatorId,displayName,presence} = value || {};
      const signedOut = operatorId === '' && displayName === '' && presence === '';
      if (value?.ok !== true || (!signedOut && (typeof operatorId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(operatorId)))
        || typeof displayName !== 'string' || displayName !== displayName.trim() || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName)
        || /[\ud800-\udfff]/u.test(displayName) || !['','online','away'].includes(presence)) return null;
      return {key:JSON.stringify([operatorId,displayName,presence]),payload:{type:'LP_EMPLOYEES_IDENTITY',schema:1,source:'leadchat-session',operatorId,displayName,presence}};
    }
    const operatorId = value?.scope?.operatorId, displayName = value?.operatorName;
    if (value?.ok !== true || value.conversationId !== globalThis.LeadChatRequestContext.currentDialog()?.conversationId || typeof operatorId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(operatorId)
      || typeof displayName !== 'string' || displayName !== displayName.trim() || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName) || /[\ud800-\udfff]/u.test(displayName)) return null;
    return {key:JSON.stringify([operatorId,displayName]),payload:{type:'LP_EMPLOYEES_IDENTITY',schema:1,source:'leadchat-session',operatorId,displayName}};
  }
  function sendEmployeeIdentity() {
    const next = employeeIdentity(employeeCandidate);
    if (!employeeVisible() || !next || next.key === reportedEmployeeOperator || pendingEmployeeIdentity || typeof chrome.runtime.sendMessage !== 'function') return;
    const attempt = {...next,revision:employeeFocusRevision};
    pendingEmployeeIdentity = attempt;
    let receipt;
    try { receipt = chrome.runtime.sendMessage(attempt.payload); }
    catch (_) { pendingEmployeeIdentity = null; return; }
    void Promise.resolve(receipt).then(result => {
      // Only acknowledged writes may suppress a later observation. A reply
      // from an earlier focus cannot suppress this tab reclaiming its account.
      if (result?.ok === true && attempt.revision === employeeFocusRevision) reportedEmployeeOperator = attempt.key;
    }).catch(() => {}).finally(() => {
      if (pendingEmployeeIdentity !== attempt) return;
      pendingEmployeeIdentity = null;
      const latest = employeeIdentity(employeeCandidate);
      if (latest && latest.key !== reportedEmployeeOperator && (latest.key !== attempt.key || attempt.revision !== employeeFocusRevision)) sendEmployeeIdentity();
    });
  }
  function reportEmployeeOperator(value) {
    // Older bridge callers retain ID/name capture. The dedicated own-session
    // stream is authoritative whenever available, even without a loaded chat.
    if (hasEmployeeIdentity) return;
    employeeCandidate = value;
    sendEmployeeIdentity();
  }
  function readFocusedEmployee() {
    if (!employeeVisible() || employeeFocusRead) return;
    const revision = employeeFocusRevision;
    // Read native state once on initial visibility/focus, never poll the app or CRM.
    employeeFocusRead = Promise.resolve().then(() => hasEmployeeIdentity ? adapter.readIdentity() : adapter.read()).then(value => {
      if (revision === employeeFocusRevision && employeeVisible()) { employeeCandidate = value; sendEmployeeIdentity(); }
    }).catch(() => {}).finally(() => {
      employeeFocusRead = null;
      if (revision !== employeeFocusRevision && employeeVisible()) readFocusedEmployee();
    });
  }
  function refreshFocusedEmployee() {
    reportedEmployeeOperator = '';
    employeeFocusRevision++;
    if (employeeVisible()) readFocusedEmployee();
    else employeeCandidate = null;
  }
  const layoutStyle = document.createElement('style');
  layoutStyle.id = 'lp-request-layout-style';
  layoutStyle.textContent = '[data-lp-request-layout]>.client-card,[data-lp-request-layout]>.client-card-backdrop{display:none!important}[data-lp-request-open] .thread-header__card-toggle,[data-lp-request-open] [data-lp-request-button]{display:none!important}[data-lp-request-layout]>.chat-thread-pane{order:1!important;flex:1 1 360px;min-width:280px}[data-lp-request-layout]>.chat-list-pane{order:0!important;flex:0 1 300px;min-width:210px;max-width:340px}[data-lp-request-layout]>#lp-request-card-slot{order:2147483647!important}#lp-request-card-slot{display:block;flex:0 0 calc(clamp(330px,30vw,440px) + var(--lp-request-gap-space,0px) + var(--lp-request-edge-space,0px));align-self:stretch;width:calc(clamp(330px,30vw,440px) + var(--lp-request-gap-space,0px) + var(--lp-request-edge-space,0px));margin-left:calc(0px - var(--lp-request-gap-space,0px));margin-right:calc(0px - var(--lp-request-edge-space,0px));min-height:0;max-height:100%;box-sizing:content-box;border:1px solid transparent;pointer-events:none}#lp-request-card-slot[hidden]{display:none!important}';
  document.documentElement.append(layoutStyle);
  layoutStyle.textContent+='[data-lp-request-open] .chat-thread-pane :is(.lc-copy-dialog,.lc-copy-client-id){display:none!important}[data-lp-request-open] .chat-thread-pane [data-lc-dialog-info]{--lc-dialog-actions-width:0px!important}[data-lp-request-open] .chat-thread-pane [data-lp-header-request]{--lc-dialog-actions-width:126px!important}.lp-open-request-header{position:absolute!important;right:0!important;top:var(--lc-dialog-top,0px)!important;height:28px!important;min-width:126px!important;padding:2px 8px!important;border:1px solid #54846a!important;border-radius:6px!important;background:#26352e!important;color:#eff8f2!important;font:500 11px/18px system-ui!important;white-space:nowrap!important;transform:none!important;animation:none!important;transition:none!important}.lp-open-request-header[hidden]{display:none!important}.lp-open-request-header:disabled{opacity:.6}';
  const key = value => value?.ok ? [value.scope?.key, value.conversationId, value.client?.id].join('|') : '';
  const currentRoute = () => { const dialog = globalThis.LeadChatRequestContext.currentDialog(); return dialog ? location.origin + '/chats/' + dialog.conversationId : ''; };
  let observedRoute = currentRoute();
  function syncRoute() {
    const route = currentRoute();
    if (route === observedRoute) return false;
    observedRoute = route; context = null; activeKey = ''; sentSignature = '';
    invalidate();
    if (reading && opened) pendingRead = true;
    return true;
  }
  function flat(value) {
    return {
      ...value, chatId: value.conversationId, dialogUrl: value.conversationUrl,
      accountId: String(value.scope?.accountId || ''), operatorId: String(value.scope?.operatorId || ''),
      clientName: value.clientFirstName || value.client?.name || '', phone: value.client?.phoneConflict ? '' : value.client?.phone || value.proposals?.phone || '',
      profileName: value.profileTitle || '', base: value.base || '', baseCandidates: value.baseCandidates || [],
      workTitle: value.workTitle || '', namedRequestId: value.namedRequestId || '',
      sourceCode: typeof value.source === 'string' ? value.source : value.source?.code || '',
      partnerNumber: typeof value.partner === 'string' ? value.partner : value.partner?.number || '',
      cityName: typeof value.city === 'string' ? value.city : value.city?.name || '',
      cityTimeZone: value.cityTimezone || value.city?.timeZone || value.city?.timezone || value.city?.tz || '',
      address: value.proposals?.address || '', apartment: value.proposals?.apartment || '',entrance:value.proposals?.entrance || '',floor:value.proposals?.floor || '',settlement:value.proposals?.settlement || ''
    };
  }
  function send(force = false) {
    syncRoute();
    if (!frame?.contentWindow || !context || awaitingContext) return;
    if (context.ok && (!observedRoute || context.conversationId !== globalThis.LeadChatRequestContext.currentDialog()?.conversationId)) { context = null; invalidate(); return; }
    const projected = flat(context), signature = JSON.stringify({ ...projected, observedAt: undefined, revision: undefined });
    if (!force && signature === sentSignature) return;
    sentSignature = signature;
    frame.contentWindow.postMessage({ type: 'leadchat-request-context', channel, context: projected }, extensionOrigin);
  }
  function invalidate() {
    contextEpoch++; awaitingContext = true; sentSignature = '';
    headerRecord=null;
    host?.removeAttribute('data-existing');slot?.parentElement?.removeAttribute('data-lp-request-placement');
    frame?.contentWindow?.postMessage({ type: 'leadchat-request-context-invalid', channel }, extensionOrigin);
  }
  function visibility() {
    if (host) host.hidden = !opened;
    if (slot) slot.hidden = !opened;
    if(opened)scheduleGeometry();
    document.documentElement.toggleAttribute('data-lp-request-open', opened);
    document.querySelectorAll('[data-lp-request-button]').forEach(button => button.setAttribute('aria-expanded', String(opened)));
    if(!opened)document.querySelectorAll('.lp-open-request-header').forEach(button=>{button.hidden=true;button.parentElement?.removeAttribute('data-lp-header-request');});
  }
  function syncHeaderButton() {
    const header=document.querySelector('.chat-thread-pane > header,.chat-thread-pane .thread-header');
    const info=header?.querySelector('.thread-header__info,.thread-header_info,.thread-headerinfo,[data-lc-dialog-info]') || header;
    if(!info)return;
    let button=info.querySelector('.lp-open-request-header');
    if(!button){button=document.createElement('button');button.type='button';button.className='lp-open-request-header';button.textContent='Открыть заявку';button.addEventListener('click',event=>{if(event.isTrusted&&!button.disabled)frame?.contentWindow?.postMessage({type:'leadchat-request-open-current',channel},extensionOrigin);});info.append(button);}
    const verified=headerRecord && headerRecord.contextKey===key(context);
    const hinted=/^[1-9]\d{3,14}$/.test(String(context?.namedRequestId || ''));
    button.hidden=!opened || !verified && !hinted;button.disabled=!verified || awaitingContext;
    button.title=verified?'Открыть заявку №'+headerRecord.id+' в '+headerRecord.base.toUpperCase():'Карточка определяется в CRM';
    info.toggleAttribute('data-lp-header-request',!button.hidden);
  }
  function close() { if (observedRoute) return; opened = false; visibility(); }
  function compactSidebarSpace(container) {
    if (!host || !container) return;
    const order=(node,value)=>{if(node && (node.style.getPropertyValue('order')!==value || node.style.getPropertyPriority('order')!=='important'))node.style.setProperty('order',value,'important');};
    order(container.querySelector(':scope > .chat-list-pane'),'0');
    order(container.querySelector(':scope > .chat-thread-pane'),'1');
    order(slot,'2147483647');
    const layout = getComputedStyle(container);
    const horizontal = /^(?:inline-)?flex$/.test(layout.display) && layout.flexDirection === 'row' && layout.flexWrap === 'nowrap' && layout.direction !== 'rtl';
    // Give only the unused space at the right back to this card. Its added
    // width and negative margins cancel out in flex sizing, so the chat and
    // conversation list keep their existing position and available width.
    const gap = horizontal ? Math.max(0, (parseFloat(layout.columnGap) || 0) - 8) : 0;
    const edge = horizontal ? Math.max(0, (parseFloat(layout.paddingRight) || 0) - 8) : 0;
    if(slot){
      for(const [name,value]of [['--lp-request-gap-space',gap+'px'],['--lp-request-edge-space',edge+'px']])if(slot.style.getPropertyValue(name)!==value)slot.style.setProperty(name,value);
    }
    scheduleGeometry();
  }
  function ensureFrame() {
    const thread = document.querySelector('.chat-thread-pane'), container = thread?.closest('.chats-page') || thread?.parentElement;
    if (!container) return false;
    if(host){
      // Only the empty layout slot follows React. The live iframe never leaves
      // its stable document-level parent, so a replaced chat layout cannot reload it.
      if(slot.parentElement!==container){slot.parentElement?.removeAttribute('data-lp-request-layout');container.append(slot);}
      container.setAttribute('data-lp-request-layout','');compactSidebarSpace(container);return false;
    }
    slot=document.createElement('aside');slot.id='lp-request-card-slot';slot.hidden=true;slot.setAttribute('aria-hidden','true');
    host = document.createElement('aside'); host.id = 'lp-request-card-host'; host.hidden = true;
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = ':host([data-expanded]){position:fixed!important;inset:14px!important;z-index:2147483640!important;order:2147483647!important;flex:none!important;width:auto!important;margin:0!important;min-height:0!important;max-height:none!important;height:auto!important;border-color:#536d83!important;border-radius:12px!important;box-shadow:0 10px 70px #000b!important;background:#161616!important}:host{position:fixed;left:var(--lp-request-left,0px);top:var(--lp-request-top,0px);width:var(--lp-request-width,0px);height:var(--lp-request-height,0px);display:flex;flex:none;margin:0;box-sizing:border-box;min-height:0;border:1px solid #397342;border-radius:14px;background:#06120c;overflow:hidden;z-index:100}:host([hidden]){display:none}iframe{border:0;width:100%;height:100%;min-height:0;flex:1;display:block;background:#06120c}';
    frame = document.createElement('iframe'); frame.title = 'Создание и изменение заявки';
    channel = crypto.randomUUID();
    frame.src = panelUrl + '?embed=permanent&hostOrigin=' + encodeURIComponent(location.origin) + '&channel=' + encodeURIComponent(channel);
    shadow.append(style,frame);document.documentElement.append(host);container.append(slot);geometryObserver?.observe(slot);container.setAttribute('data-lp-request-layout','');
    compactSidebarSpace(container);
    return true;
  }
  function ensureButton() {
    syncRoute();
    document.querySelectorAll('[data-lp-request-button]').forEach(button => button.remove());
    if (!globalThis.LeadChatRequestContext.currentDialog()) {
      document.querySelectorAll('[data-lp-request-layout]').forEach(node => node.removeAttribute('data-lp-request-layout'));
      close(); return;
    }
    const created = ensureFrame();
    opened = !!host?.isConnected; visibility();
    syncHeaderButton();
    if (created) { invalidate(); void refresh(); }
  }
  async function refresh(observedContext) {
    syncRoute();
    if (reading) { pendingRead = true; return; }
    if (!opened || !observedRoute) return;
    reading = true;
    const epoch = contextEpoch, route = observedRoute;
    try {
      // Subscription already read and validated this context. Reuse it instead
      // of issuing a second page-bridge read for the same notification.
      const next = observedContext || await adapter.read();
      reportEmployeeOperator(next);
      syncRoute();
      // Invalidating a card cannot be undone by a reply that began for the old
      // route, or before a close/reopen. Leave the card disabled for the queued read.
      if (epoch !== contextEpoch || route !== observedRoute) { if (opened) pendingRead = true; return; }
      if (next?.code === 'stale') { pendingRead = opened; return; }
      if (next?.ok && next.conversationId !== globalThis.LeadChatRequestContext.currentDialog()?.conversationId) { context = null; invalidate(); return; }
      // Stores can briefly omit the operator or account while the same client's
      // conversation stays open. Keep its verified view, but suspend every old
      // action until a complete identity is read again. Known identity changes
      // still invalidate immediately, even if another identity field is absent.
      const incompleteScope = next?.ok && (!next.scope?.key || !next.scope?.operatorId || !next.scope?.accountId);
      const sameKnownClient = context?.ok && context.scope?.key && activeKey === key(context) &&
        next?.conversationId === context.conversationId && next?.client?.id === context.client?.id &&
        (!next.scope?.operatorId || next.scope.operatorId === context.scope.operatorId) &&
        (!next.scope?.accountId || next.scope.accountId === context.scope.accountId);
      if (incompleteScope && sameKnownClient) {
        awaitingContext = true; sentSignature = '';
        frame?.contentWindow?.postMessage({ type: 'leadchat-request-context-pending', channel, contextKey: activeKey, conversationId: context.conversationId }, extensionOrigin);
        syncHeaderButton();
        return;
      }
      awaitingContext = false;
      if (next?.ok) {
        const nextKey = key(next);
        if (activeKey && nextKey !== activeKey) { invalidate(); awaitingContext = false; }
        context = next; activeKey = nextKey; send();
        syncHeaderButton();
      } else if (opened) { context = { ok: false, error: next?.error || 'Откройте нужный диалог и дождитесь его загрузки.' }; send(); }
    } catch (_) { syncRoute(); if (opened && epoch === contextEpoch && route === observedRoute) { awaitingContext = false; context = { ok: false, error: 'Не удалось прочитать текущий диалог. Обновите вкладку LeadChat.' }; send(); } }
    finally { reading = false; if (pendingRead) { pendingRead = false; void refresh(); } }
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== frame?.contentWindow || event.origin !== extensionOrigin || message?.channel !== channel) return;
    if (message.type === 'leadchat-request-expand') { host?.toggleAttribute('data-expanded', message.expanded === true); return; }
    if(message.type==='leadchat-request-layout'){
      if(!context?.ok || message.contextKey!==key(context))return;
      const existing=message.placement==='existing';host?.toggleAttribute('data-existing',existing);
      if(slot?.parentElement){slot.parentElement.setAttribute('data-lp-request-placement',existing?'existing':'create');compactSidebarSpace(slot.parentElement);}
      return;
    }
    if(message.type==='leadchat-request-record' && ['kp','mnc','bt'].includes(message.base) && /^[1-9]\d{0,14}$/.test(String(message.id || '')) && context?.ok && message.contextKey===key(context)){
      headerRecord={id:String(message.id),base:message.base,contextKey:key(context)};syncHeaderButton();return;
    }
    if (message.type === 'leadchat-request-ready') { send(true); if (opened) void refresh(); }
    if (message.type === 'leadchat-request-close' && !observedRoute) close();
    if (message.type === 'leadchat-request-created' && message.record?.id) {
      // The page never supplies delivery evidence. Name changes require private operation proof.
      void refresh();
    }
  });
  let scheduled = false;
  const schedule = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; const changed = syncRoute(); ensureButton(); if (opened && changed) void refresh(); }); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  adapter.subscribe(value => { reportEmployeeOperator(value); ensureButton(); if (opened) void refresh(value); });
  if (hasEmployeeIdentity) adapter.subscribeIdentity(value => { if (employeeVisible()) { employeeCandidate = value; sendEmployeeIdentity(); } });
  window.addEventListener('resize',()=>compactSidebarSpace(slot?.parentElement));
  window.addEventListener('scroll',scheduleGeometry,{capture:true,passive:true});
  const refreshRecord = () => { if (opened && !document.hidden && context?.ok && !awaitingContext) frame?.contentWindow?.postMessage({type:'leadchat-request-refresh',channel,contextKey:key(context)},extensionOrigin); };
  window.addEventListener('focus',()=>{refreshRecord();refreshFocusedEmployee();});
  window.addEventListener('blur',()=>{employeeFocusRevision++;employeeCandidate=null;});
  document.addEventListener('visibilitychange',()=>{refreshRecord();refreshFocusedEmployee();});
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && event.isTrusted && opened) close(); });
  setInterval(() => { ensureButton(); if (opened && !document.hidden) void refresh(); }, 3500);
  ensureButton();
  if (hasEmployeeIdentity) refreshFocusedEmployee();
})();
