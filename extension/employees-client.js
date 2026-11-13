/* One background presence reporter. No CRM polling and no customer/chat data. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LeadPartnerEmployeesClient = api; api.install(); }
})(globalThis, function (root) {
  'use strict';
  const DEVICE = 'leadPartnerEmployeesDeviceV1', STATE = 'leadPartnerEmployeesStateV1';
  const ALARM = 'leadPartnerEmployeesHeartbeatV1', PERIOD = 300000, TRANSITION_PERIOD = 30000, MAX_BACKOFF = 3600000, DEADLINE = 15000;
  const installations = new WeakMap();
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,86}$/.test(value);
  const operator = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  const name = value => typeof value === 'string' && value.length > 0 && value.length <= 120 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
  const presence = value => value === '' || value === 'online' || value === 'away';
  const reportedVersion = value => typeof value === 'string' && value.length <= 32 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
  const reasons = ['','deadline','network','http','redirect','response','storage','rate_limited','identity_rejected','service_busy','capacity','service'];
  const httpStatus = value => Number.isInteger(value) && value >= 100 && value <= 599;
  const failure = (reason, status) => ({reason,...(httpStatus(status) ? {httpStatus:status} : {})});
  function diagnosticsMessage(message, sender, chrome) {
    try {
      return message?.type === 'LP_EMPLOYEES_DIAGNOSTICS' && message.schema === 1
        && Object.keys(message).sort().join(',') === 'command,schema,type' && ['status','check'].includes(message.command)
        && typeof chrome?.runtime?.id === 'string' && sender?.id === chrome.runtime.id
        && typeof chrome.runtime.getURL === 'function' && sender.url === chrome.runtime.getURL('popup.html');
    } catch (_) { return false; }
  }
  function endpoint(value) {
    try {
      if (typeof value !== 'string' || value.length > 500) return '';
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'script.google.com' && !url.port && !url.username && !url.password && !url.search && !url.hash
        && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ? url.href : '';
    } catch (_) { return ''; }
  }
  function safeResponseUrl(value, target) {
    try {
      const url = new URL(value || target);
      return !url.username && !url.password && !url.port && url.protocol === 'https:'
        && (url.href === target || url.hostname === 'script.googleusercontent.com' && url.pathname === '/macros/echo');
    } catch (_) { return false; }
  }
  function identityMessage(message, sender, extensionId) {
    if (!message || typeof message !== 'object' || message.type !== 'LP_EMPLOYEES_IDENTITY' || message.schema !== 1 || sender?.id !== extensionId) return null;
    try {
      const url = new URL(sender.url);
      if (url.username || url.password || url.port) return null;
      const fields=Object.keys(message).sort().join(',');
      const legacy=fields === 'operatorId,schema,source,type';
      const paired=fields === 'displayName,operatorId,schema,source,type' && (message.displayName === '' || name(message.displayName));
      const current=fields === 'displayName,operatorId,presence,schema,source,type' && (message.displayName === '' || name(message.displayName)) && presence(message.presence);
      const logout=current && message.operatorId === '' && message.displayName === '' && message.presence === '';
      if (message.source === 'leadchat-session' && (legacy || paired || current) && (operator(message.operatorId) || logout)
        && ['https:','http:'].includes(url.protocol) && ['188-225-34-82.sslip.io','72-56-68-159.sslip.io','chat.partner-lead-centre.ru'].includes(url.hostname)
      ) return {operatorId:message.operatorId,displayName:legacy ? '' : message.displayName,presence:current ? message.presence : '',identitySource:'leadchat-session',legacy:!current};
    } catch (_) { /* Never reply with private state to a page. */ }
    return null;
  }
  function create(environment = {}) {
    const chrome = environment.chrome || root.chrome;
    const storage = environment.storage || chrome?.storage?.local;
    const config = environment.config || root.LeadPartnerEmployeesConfig || {};
    const target = config.schema === 1 ? endpoint(config.url) : '';
    const now = environment.now || Date.now, random = environment.random || Math.random;
    const fetch = environment.fetch || root.fetch?.bind(root), crypto = environment.crypto || root.crypto;
    const setTimer = environment.setTimeout || root.setTimeout.bind(root), clearTimer = environment.clearTimeout || root.clearTimeout.bind(root);
    const version = String(chrome?.runtime?.getManifest?.().version || '').slice(0,32);
    const variant = config.variant === 'admin' ? 'admin' : 'common';
    let publicState = {configured:!!target,state:target ? 'waiting' : 'not_configured',nextDueAt:0,lastSuccessAt:0};
    let queue = Promise.resolve(), inFlight = null, manualInFlight = null, reportSequence = 0, posting = false;
    let installation = '', result = failure('');
    const serialize = task => { const work = queue.catch(() => {}).then(task); queue = work; return work; };
    const getState = () => ({...publicState});
    function schedule(when) {
      try { const result = chrome?.alarms?.create(ALARM,{when:Math.max(now()+1000,when)}); result?.catch?.(() => {}); } catch (_) {}
    }
    function setState(state, stored, detail) {
      publicState = {configured:!!target,state,nextDueAt:stored?.nextDueAt || 0,lastSuccessAt:stored?.lastSuccessAt || 0};
      result = detail || failure(stored?.lastFailureReason || '',stored?.lastHttpStatus);
    }
    const storedState = state => state.failures ? 'unavailable' : state.lastSuccessAt ? 'ready' : 'waiting';
    const diagnosticsReply = () => ({ok:true,schema:1,...getState(),installation,version,variant,...result});
    function freshDevice() {
      // Refuse to manufacture weak or replacement credentials when secure randomness is unavailable.
      if (typeof crypto?.getRandomValues !== 'function') throw Error('storage');
      const bytes=crypto.getRandomValues(new Uint8Array(32));
      const deviceToken=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      const idBytes=crypto.getRandomValues(new Uint8Array(16)); idBytes[6]=(idBytes[6]&15)|64; idBytes[8]=(idBytes[8]&63)|128;
      const hex=Array.from(idBytes,b=>b.toString(16).padStart(2,'0')).join('');
      return {schema:1,installationId:[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-'),deviceToken};
    }
    async function read() {
      // A rejected/partial read is never interpreted as an empty installation.
      if (!storage?.get || !storage?.set) throw Error('storage');
      const all = await storage.get([DEVICE,STATE]);
      if (!all || typeof all !== 'object') throw Error('storage');
      const device=all[DEVICE], saved=all[STATE];
      if (device !== undefined && (!device || device.schema !== 1 || !uuid(device.installationId) || !token(device.deviceToken))) throw Error('storage');
      if (device === undefined && saved !== undefined) throw Error('storage');
      let state=saved === undefined ? {schema:1,serviceUrl:target,nextDueAt:0,lastSuccessAt:0,failures:0,operatorId:'',displayName:'',presence:'',identitySource:''} : saved;
      if (!state || state.schema !== 1 || !Number.isFinite(state.nextDueAt) || state.nextDueAt < 0 || !Number.isFinite(state.lastSuccessAt) || state.lastSuccessAt < 0
        || !Number.isInteger(state.failures) || state.failures < 0 || state.failures > 6 || state.operatorId !== '' && !operator(state.operatorId) || state.displayName !== '' && !name(state.displayName)
        || state.identitySource !== undefined && !['','leadchat-session'].includes(state.identitySource)
        || state.presence !== undefined && !presence(state.presence)
        || state.lastManualCheckAt !== undefined && (!Number.isFinite(state.lastManualCheckAt) || state.lastManualCheckAt < 0)
        || state.lastReportedVersion !== undefined && !reportedVersion(state.lastReportedVersion)
        || state.lastFailureReason !== undefined && !reasons.includes(state.lastFailureReason)
        || state.lastHttpStatus !== undefined && !httpStatus(state.lastHttpStatus)) throw Error('storage');
      // Old displayName values came from whichever CRM was loaded. Only the
      // authenticated LeadChat ID/name pair may supply a name after this update.
      state={...state,displayName:state.identitySource === 'leadchat-session' ? state.displayName : '',identitySource:state.identitySource === 'leadchat-session' ? 'leadchat-session' : '',presence:state.presence || ''};
      // Deployment state belongs to the configured service; the local device
      // credential remains unchanged when a deployment changes.
      if (state.serviceUrl !== target) {
        state={...state,serviceUrl:target,nextDueAt:0,lastSuccessAt:0,failures:0,lastFailureReason:''};
        delete state.lastHttpStatus;
      }
      // A PC clock correction must never defer the reporter for days or years.
      if (state.nextDueAt > now()+MAX_BACKOFF+30000 || state.lastSuccessAt > now()+60000) state={...state,nextDueAt:0,lastSuccessAt:0};
      if (state.lastManualCheckAt > now()+60000) state={...state,lastManualCheckAt:0};
      // Publish a new extension version promptly, without bypassing the server's
      // existing acknowledgement boundary or any recorded error backoff.
      if (state.failures === 0 && state.lastSuccessAt > 0 && state.lastReportedVersion !== version)
        state={...state,nextDueAt:Math.min(state.nextDueAt,state.lastSuccessAt+TRANSITION_PERIOD)};
      return {device,state,needsWrite:saved === undefined || Object.keys(state).some(key=>state[key] !== saved[key])};
    }
    function jitter() { return Math.floor(Math.max(0,Math.min(1,random())) * 30000); }
    async function post(body) {
      const controller=new AbortController(); let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimer(()=>{controller.abort();reject(failure('deadline'));},DEADLINE);});
      try {
        const work=(async()=>{
          let response,text,reply;
          try {
            response=await fetch(target,{method:'POST',credentials:'omit',cache:'no-store',redirect:'follow',referrerPolicy:'no-referrer',
              headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(body),signal:controller.signal});
          } catch (_) { throw failure('network'); }
          if (!response?.ok) throw failure(httpStatus(response?.status) ? 'http' : 'response',response?.status);
          if (!safeResponseUrl(response.url,target)) throw failure('redirect',response.status);
          try { text=await response.text(); } catch (_) { throw failure('network',response.status); }
          if (typeof text !== 'string' || text.length>2048) throw failure('response',response.status);
          try { reply=JSON.parse(text); } catch (_) { throw failure('response',response.status); }
          if (reply?.ok === false && reply.schema === 1) {
            const codes={UNAUTHORIZED:'identity_rejected',BUSY:'service_busy',CAPACITY_REACHED:'capacity',SERVICE_UNAVAILABLE:'service',INVALID_REQUEST:'response'};
            throw failure(Object.prototype.hasOwnProperty.call(codes,reply.code) ? codes[reply.code] : 'response',response.status);
          }
          if (reply?.ok !== true || reply.schema !== 1 || !Number.isFinite(reply.serverTime) || reply.serverTime <= 0 || reply.nextAfterMs !== PERIOD) throw failure('response',response.status);
          return httpStatus(response.status) ? response.status : undefined;
        })();
        return await Promise.race([work,timeout]);
      } finally { clearTimer(timer); }
    }
    async function run(manual = false, coalesced = false) {
      if (!target) {setState('not_configured');return getState();}
      let records;
      try {
        records=await read();
        const {state}=records;
        installation=records.device?.installationId.slice(0,8) || '';
        if (manual && (state.lastManualCheckAt > 0 && now() < state.lastManualCheckAt+TRANSITION_PERIOD
          || !coalesced && state.lastSuccessAt > 0 && now() < state.lastSuccessAt+TRANSITION_PERIOD)) {
          setState(storedState(state),state,failure('rate_limited'));return getState();
        }
        // A worker may stop after reserving the first POST but before its ACK.
        // Resume that unfinished join; a known failure still keeps its backoff.
        const unfinishedJoin=state.lastSuccessAt === 0 && state.failures === 0;
        if (!manual && !unfinishedJoin && state.nextDueAt>now()) {setState(storedState(state),state);schedule(state.nextDueAt);return getState();}
        const device=records.device || freshDevice();
        const reserved={...state,...(coalesced ? {} : {nextDueAt:now()+PERIOD+jitter()}),...(manual ? {lastManualCheckAt:now()} : {})};
        await storage.set({...(records.device ? {} : {[DEVICE]:device}),[STATE]:reserved});
        installation=device.installationId.slice(0,8);
        records={device,state:reserved}; schedule(reserved.nextDueAt);
        if (coalesced) {setState(storedState(reserved),reserved);return getState();}
      } catch (_) {setState('storage_error',undefined,failure('storage'));schedule(now()+PERIOD);return getState();}
      const {device,state}=records;
      let next;
      try {
        posting=true;reportSequence++;
        const status=await post({schema:1,action:'heartbeat',installationId:device.installationId,deviceToken:device.deviceToken,
          operatorId:state.operatorId,displayName:state.displayName,version,variant,...(state.presence ? {presence:state.presence} : {})});
        // Pace from the acknowledgement too: request latency must not make the
        // next heartbeat arrive before the server's own five-minute boundary.
        next={...state,failures:0,lastSuccessAt:now(),lastReportedVersion:version,nextDueAt:now()+PERIOD+jitter(),lastFailureReason:''};
        delete next.lastHttpStatus;
        if (httpStatus(status)) next.lastHttpStatus=status;
        await storage.set({[STATE]:next}); setState('ready',next);
      } catch (error) {
        const detail=error && reasons.includes(error.reason) && error.reason ? failure(error.reason,error.httpStatus) : failure('storage');
        const failures=Math.min(6,state.failures+1);
        // Before the first acknowledgement, transient startup/network failures
        // receive bounded early retries. Authentication/storage errors and known
        // installations retain the ordinary conservative backoff.
        const firstJoin=state.lastSuccessAt === 0 && (['network','deadline','service_busy','service'].includes(detail.reason)
          || detail.reason === 'http' && (detail.httpStatus === 429 || detail.httpStatus >= 500));
        const retry=firstJoin ? (failures < 6 ? 5000*2**(failures-1) : PERIOD) : Math.min(MAX_BACKOFF,PERIOD*2**(failures-1));
        next={...state,failures,nextDueAt:now()+retry+(firstJoin ? Math.min(1000,jitter()) : jitter()),lastFailureReason:detail.reason};
        delete next.lastHttpStatus;
        if (httpStatus(detail.httpStatus)) next.lastHttpStatus=detail.httpStatus;
        try {await storage.set({[STATE]:next});setState(detail.reason === 'storage' ? 'storage_error' : 'unavailable',next);}
        catch (_) {setState('storage_error',state,failure('storage'));next=state;}
      } finally { posting=false; }
      schedule(next.nextDueAt);return getState();
    }
    function tick() {
      if (inFlight) return inFlight;
      inFlight=serialize(()=>run()).finally(()=>{inFlight=null;});return inFlight;
    }
    function diagnostics(command) {
      if (command === 'status') return serialize(async()=>{
        try {
          const {device,state}=await read();installation=device?.installationId.slice(0,8) || '';
          setState(target ? storedState(state) : 'not_configured',state);
        } catch (_) {installation='';setState('storage_error',undefined,failure('storage'));}
        return diagnosticsReply();
      });
      if (manualInFlight) return manualInFlight;
      const active=inFlight,sequence=reportSequence,alreadyPosting=posting;
      const report=serialize(async()=>{
        // Share a report that really reached POST; a queued automatic deadline
        // check alone must not suppress the user's explicit connection test.
        await run(true,!!active && (alreadyPosting || reportSequence !== sequence));
        return diagnosticsReply();
      });
      manualInFlight=report.finally(()=>{manualInFlight=null;});
      if (!active) inFlight=report.then(()=>getState()).finally(()=>{inFlight=null;});
      return manualInFlight;
    }
    function updateIdentity(update) {
      if (!target || !update) return undefined;
      return serialize(async()=>{
        try {
          const {device,state,needsWrite}=await read();
          const {legacy,...identity}=update;
          const next={...state,...identity};
          // Old hosts may know only the ID while their same-account name loads.
          if (legacy && next.displayName === '' && next.operatorId === state.operatorId) next.displayName=state.displayName;
          const transition=next.operatorId !== state.operatorId || next.presence !== state.presence || next.displayName !== state.displayName;
          if (device && !needsWrite && !transition && next.displayName === state.displayName && next.identitySource === state.identitySource) return true;
          // Transition reports share the ordinary alarm and respect every error
          // backoff. Queue serialization paces from any in-flight acknowledgement.
          if (transition && state.failures === 0) next.nextDueAt=Math.min(state.nextDueAt,Math.max(now()+1000,state.lastSuccessAt+TRANSITION_PERIOD));
          await storage.set({...(device ? {} : {[DEVICE]:freshDevice()}),[STATE]:next});
          if (transition) {
            setState(next.failures ? 'unavailable' : next.lastSuccessAt ? 'ready' : 'waiting',next);
            schedule(next.nextDueAt);
          }
          return true;
        } catch (_) { return false; /* A failed write must not acknowledge a captured identity. */ }
      });
    }
    function handleMessage(message,sender) {
      if (diagnosticsMessage(message,sender,chrome)) return diagnostics(message.command);
      return updateIdentity(identityMessage(message,sender,chrome?.runtime?.id));
    }
    const client=Object.freeze({tick,handleMessage,getState});
    return client;
  }
  function install(environment = {}) {
    const chrome=environment.chrome || root.chrome;
    if (!chrome?.runtime?.onMessage || !chrome.storage?.local) return null;
    if (installations.has(chrome.runtime)) return installations.get(chrome.runtime);
    const client=create(environment); installations.set(chrome.runtime,client);
    chrome.runtime.onMessage.addListener((message,sender,reply)=>{
      const receipt=client.handleMessage(message,sender);
      if (!receipt) return;
      void receipt.then(value=>reply(typeof value === 'boolean' ? {ok:value===true} : value)).catch(()=>{});
      return true;
    });
    chrome.alarms?.onAlarm?.addListener(alarm=>{if(alarm?.name===ALARM)void client.tick();});
    chrome.runtime.onStartup?.addListener(()=>{void client.tick();});
    chrome.runtime.onInstalled?.addListener(()=>{void client.tick();});
    void client.tick();
    return client;
  }
  function reportCrmSession(displayName) {
    // Keep the existing background API for older callers, without allowing a
    // CRM account to overwrite the current authenticated LeadChat account.
    return null;
  }
  return Object.freeze({create,install,reportCrmSession});
});
