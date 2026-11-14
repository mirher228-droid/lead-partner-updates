/* Durable single-writer gate for the embedded request card. No timer permits a second POST. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.LeadChatRequestGate = api; api.install(); }
})(globalThis, function () {
  'use strict';
  const PREFIX = 'leadPartnerRequestOperationV1:';
  const BASES = ['kp', 'mnc', 'bt'];
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
  const requestId = value => /^[1-9]\d{0,14}$/.test(String(value || ''));
  function validateCheckpoint(record, input) {
    if (record === undefined) return;
    if (!record || typeof record !== 'object' || record.version !== 1 || record.base !== input.base || record.kind !== input.kind || !id(record.scope)
        || (input.kind === 'create' && record.scope !== input.scope) || !['running', 'uncertain', 'awaiting_reason', 'rejected', 'saved', 'ready'].includes(record.state)
        || (record.state === 'ready' ? !id(record.cycleId) : !id(record.operationId))
        || (input.kind === 'update' && String(record.recordId) !== String(input.recordId))
        || (record.cycleId !== undefined && !id(record.cycleId))
        || (record.clientId !== undefined && !id(record.clientId))
        || (record.phase !== undefined && !['preparing', 'sent'].includes(record.phase))
        || (record.state === 'saved' && (record.result?.ok !== true || record.result?.verified !== true || !requestId(record.result?.record?.id) || record.result.record.base !== input.base))) {
      throw Error('Журнал заявки повреждён. Новая отправка остановлена; проверьте результат в CRM.');
    }
  }
  function create({ storage, now = Date.now, onRecorded }) {
    let queue = Promise.resolve();
    const transact = task => { const job = queue.catch(() => {}).then(task); queue = job; return job; };
    const keyOf = input => {
      if (!BASES.includes(input.base) || !id(input.scope) || !['create', 'update'].includes(input.kind)) throw Error('Неизвестная операция заявки.');
      if (input.kind === 'update' && !requestId(input.recordId)) throw Error('Не указан номер изменяемой заявки.');
      return PREFIX + (input.kind === 'update' ? input.base + ':record:' + input.recordId : input.base + ':chat:' + input.scope);
    };
    function run(input) {
      return transact(async () => {
        const key = keyOf(input);
        if (input.command === 'record') {
          if (!id(input.operationId) || !id(input.clientId)) throw Error('Не подтверждена операция клиента.');
          const result=input.result;
          if (!result || typeof result!=='object' || JSON.stringify(result).length>250000) throw Error('Не удалось записать результат сохранения.');
          const saved=result.ok===true && result.verified===true && requestId(result.record?.id);
          if (saved && (result.record.base!==input.base || input.kind==='update' && String(result.record.id)!==String(input.recordId))) throw Error('База вернула другую заявку.');
          if (result.operationId && result.operationId!==input.operationId) throw Error('Результат относится к другой операции.');
          const operation={version:1,scope:input.scope,kind:input.kind,base:input.base,recordId:input.recordId || '',operationId:input.operationId,clientId:input.clientId,
            state:saved?'saved':result.state==='rejected'?'rejected':'uncertain',updatedAt:now(),result};
          const receipt=PREFIX+'receipt:'+input.scope+':'+input.base+':'+input.operationId;
          const previous=(await storage.get(receipt))[receipt];
          if(previous?.state==='saved' && (previous.clientId!==input.clientId || !saved || String(previous.result?.record?.id)!==String(result.record.id))) throw Error('Нельзя заменить подтверждённый номер заявки.');
          const current=(await storage.get(key))[key];
          validateCheckpoint(current,input);
          if(current?.operationId===input.operationId && current.state==='saved'
              && (current.clientId!==input.clientId || !saved || String(current.result?.record?.id)!==String(result.record.id)))
            throw Error('Нельзя заменить подтверждённый номер заявки.');
          // A delayed handoff can finish after an explicit new cycle starts.
          // Keep its exact receipt without rolling the active writer backwards.
          const sameOperation=current?.operationId===input.operationId;
          const checkpoint=sameOperation?{...current,...operation}:operation;
          await storage.set({[receipt]:checkpoint,...(!current || sameOperation?{[key]:checkpoint}:{})});
          // Enqueue the exact receipt before another save can replace the
          // record-level proof. The panel does not await this background job.
          let cityNotification;
          if (onRecorded) try { cityNotification=await onRecorded(operation); }
          catch(error){cityNotification={ok:false,error:error?.message || 'Сообщение пока не принято в очередь.'};}
          return {ok:true,operation,...(cityNotification?{cityNotification}:{})};
        }
        const stored = (await storage.get(key))[key];
        validateCheckpoint(stored, input);
        if (input.command === 'status') return { ok: true, operation: stored || null };
        if (!id(input.operationId)) throw Error('Не указан идентификатор сохранения.');
        if (input.clientId !== undefined && !id(input.clientId)) throw Error('Клиент диалога не подтверждён.');
        if (input.kind === 'create' && stored && stored.state !== 'rejected' && (stored.clientId && input.clientId && stored.clientId !== input.clientId || stored.state === 'saved' && !stored.clientId && input.clientId)) return {ok:false,state:'rejected',code:'client_binding_changed',error:'Операция принадлежит другому или неподтверждённому клиенту. Проверьте привязку диалога; прежняя карточка не используется.'};
        if (input.command === 'new') {
          if (input.kind !== 'create' || stored?.state !== 'saved' || String(stored.result?.record?.id) !== String(input.recordId)) throw Error('Сначала подтвердите сохранение текущей заявки.');
          const previousRecords = [...(stored.previousRecords || []), { id: String(input.recordId), url: stored.result.record.url || '', savedAt: stored.updatedAt || now() }];
          const operation = { version: 1, scope: input.scope, kind: 'create', base: input.base, state: 'ready', cycleId: input.operationId, previousRecords, updatedAt: now(), ...(input.clientId ? {clientId:input.clientId} : {}) };
          await storage.set({ [key]: operation });
          return { ok: true, cycleId: input.operationId, operation };
        }
        if (input.command === 'begin') {
          if (stored?.cycleId && stored.cycleId !== input.cycleId) return { ok: false, state: 'rejected', error: 'В этом диалоге уже открыто другое обращение. Обновите карточку перед созданием.' };
          if (stored?.state === 'awaiting_reason' && stored.operationId === input.operationId && stored.scope === input.scope) return {ok:true,existing:true,operation:stored};
          if (stored && ['running', 'uncertain', 'awaiting_reason'].includes(stored.state)) return {
            ok: false, state: 'uncertain', operation: stored,
            error: 'Результат предыдущего сохранения ещё не подтверждён. Сначала проверьте его; повторное создание отключено.'
          };
          if (stored?.state === 'saved' && (input.kind === 'create' || stored.operationId === input.operationId && stored.scope === input.scope)) return { ok: true, existing: true, operation: stored };
          const operation = { version: 1, scope: input.scope, kind: input.kind, base: input.base, recordId: input.recordId || '', operationId: input.operationId, state: 'running', phase: 'preparing', startedAt: now(), ...(input.clientId ? {clientId:input.clientId} : {}), ...(stored?.cycleId ? {cycleId: stored.cycleId, previousRecords: stored.previousRecords || []} : {}) };
          await storage.set({ [key]: operation });
          return { ok: true, operation };
        }
        if (!stored || stored.operationId !== input.operationId) throw Error('Сохранение уже принадлежит другой операции.');
        if (input.command === 'dispatch') {
          if (!['running','awaiting_reason'].includes(stored.state) || stored.scope !== input.scope) throw Error('Операция уже завершена или изменилась. Форма не отправлена.');
          const operation = {...stored, state:'running', phase: 'sent', dispatchedAt: now()};
          await storage.set({[key]:operation}); return {ok:true,operation};
        }
        if (!['finish', 'resolve'].includes(input.command)) throw Error('Неизвестная команда сохранения.');
        const result = input.result;
        if (!result || typeof result !== 'object' || JSON.stringify(result).length > 250000) throw Error('Не удалось записать результат сохранения.');
        const saved = result.ok === true && result.verified === true && requestId(result.record?.id);
        const awaitingReason = result.state === 'awaiting_reason' && input.kind === 'update'
          && ['cancel_kc','cancel_branch','not_taken'].includes(result.action) && String(result.id || result.record?.id) === String(input.recordId)
          && String(result.record?.id) === String(input.recordId) && result.operationId === input.operationId
          && result.record?.base === input.base && Array.isArray(result.reasons) && result.reasons.length > 0
          && result.reasons.every(item => item && typeof item.id === 'string' && item.id.trim() && typeof item.text === 'string' && item.text.trim());
        if (saved && result.record.base !== input.base) throw Error('База вернула карточку другого направления.');
        if (saved && input.kind === 'update' && String(result.record.id) !== String(input.recordId)) throw Error('База вернула другую заявку.');
        if (stored.state === 'saved') {
          if (saved && String(stored.result.record.id) !== String(result.record.id)) throw Error('Нельзя заменить подтверждённый номер заявки.');
          // A previously confirmed creation can only be upgraded with a second,
          // independently verified source-commit receipt for the SAME record.
          // A second CREATE is never allowed by this transition.
          if (input.command === 'resolve' && saved && input.kind === 'create' &&
              stored.result?.sourceCommitted !== true && result.sourceCommitted === true &&
              typeof result.expectedSource === 'string' && result.expectedSource.trim() &&
              String(result.record.id) === String(stored.result.record.id)) {
            const upgraded = {...stored,result,updatedAt:now()};
            await storage.set({[key]:upgraded});
            return {ok:true,operation:upgraded};
          }
          return {ok:true,operation:stored};
        }
        const rejected = result.state === 'rejected' && (result.writeStarted !== true || input.kind==='update'
          && result.code==='edit_not_applied' && result.retryable===true && String(result.record?.id)===String(input.recordId) && result.record?.base===input.base);
        const operation = { ...stored, state: saved ? 'saved' : awaitingReason ? 'awaiting_reason' : rejected ? 'rejected' : 'uncertain', updatedAt: now(), result };
        await storage.set({ [key]: operation });
        return { ok: true, operation };
      });
    }
    return Object.freeze({ run });
  }
  function createPostSave({storage, runName, now = Date.now}) {
    const pending = new Map(); let serial = Promise.resolve();
    const transaction = task => {const job = serial.catch(() => {}).then(task); serial = job; return job;};
    const keyOf = input => {
      if (!BASES.includes(input.base) || !requestId(input.id) || !id(input.scope)) throw Error('Нет подтверждённой заявки.');
      return 'leadPartnerRequestPostSaveV1:' + input.scope + ':' + input.base + ':' + input.id;
    };
    const view = record => record ? {state:record.state,name:record.name || null,updatedAt:record.updatedAt || record.startedAt} : null;
    function status(input) { return transaction(async () => {
      const key = keyOf(input), record = (await storage.get(key))[key];
      if (record && record.clientId !== input.clientId) return {ok:true,postSave:{state:'attention',name:{ok:false,error:'Клиент диалога изменился. Номер прежней заявки к новому клиенту не добавляется.'}}};
      if (record?.state === 'pending' && !pending.has(key)) {
        const recovered = {...record,state:'attention',name:{ok:false,unknown:true,error:'Проверка имени прервалась. Обновите карточку для проверки результата без повторной записи.'},updatedAt:now()};
        await storage.set({[key]:recovered}); return {ok:true,postSave:view(recovered)};
      }
      return {ok:true,postSave:view(record)};
    }); }
    function enqueue(input) {
      return transaction(async () => {
        const key = keyOf(input), previous = (await storage.get(key))[key];
        if (previous && (previous.version !== 1 || !['pending','done','attention'].includes(previous.state))) throw Error('Не удалось проверить журнал обновления диалога.');
        const boundClient = input.clientId || input.context?.clientId;
        if (!id(boundClient) || previous && previous.clientId !== boundClient) throw Error('Не подтверждён исходный клиент созданной заявки.');
        if (previous?.state === 'done' || pending.has(key)) return {ok:true,pending:previous?.state === 'pending',postSave:view(previous)};
        const checkpoint = {...previous,version:1,clientId:boundClient,state:'pending',startedAt:previous?.startedAt || now(),nameAttemptStarted:true,updatedAt:now()};
        await storage.set({[key]:checkpoint});
        const task = (async () => {
          const verifyOnly = !!previous?.nameAttemptStarted && (previous.state === 'pending' || previous.name?.unknown === true || previous.name?.changed === true || previous.name?.ok === true);
          let name;
          try { name = await runName(input, verifyOnly); }
          catch (_) { name = {ok:false,unknown:true,error:'Обновление имени диалога не подтверждено.'}; }
          const record = {...checkpoint,state:name?.ok === true ? 'done' : 'attention',name,updatedAt:now()};
          await storage.set({[key]:record});
        })();
        pending.set(key,task);
        void task.catch(() => {}).finally(() => {if (pending.get(key) === task) pending.delete(key);});
        return {ok:true,pending:true,postSave:view(checkpoint)};
      });
    }
    return Object.freeze({enqueue,status});
  }
  function install() {
    if (!globalThis.chrome?.runtime?.onMessage || !chrome.storage?.local) return;
    const gate = create({ storage: chrome.storage.local });
    const postSave = createPostSave({storage:chrome.storage.local,
      runName:async (input, verifyOnly) => {
        const tabId = input.sender?.tab?.id, context = input.context || {};
        if (!Number.isInteger(tabId) || !globalThis.LeadChatRequestName?.appendVerifiedCreatedId)
          return {ok:false,error:'Вкладка LeadChat не подтверждена. Номер заявки сохранён, имя не изменено.'};
        const expected = {operatorId:String(context.operatorId || ''), accountId:String(context.accountId || ''),
          clientId:String(context.clientId || ''), conversationId:String(context.conversationId || ''), requestId:String(input.id)};
        if (!Object.values(expected).every(value=>/^[A-Za-z0-9_-]{1,100}$/.test(value)) || !/^[1-9]\d{0,11}$/.test(expected.requestId))
          return {ok:false,error:'Нет подтверждённого контекста диалога для изменения имени.'};
        const tab = await chrome.tabs.get(tabId);
        let route;
        try { route = new URL(tab.url); } catch (_) { return {ok:false,error:'Не удалось проверить текущий адрес диалога.'}; }
        if (!['188-225-34-82.sslip.io','72-56-68-159.sslip.io','chat.partner-lead-centre.ru'].includes(route.hostname)
          || route.pathname !== '/chats/' + expected.conversationId) return {ok:false,error:'Открыт другой диалог; имя не изменено.'};
        const result = await LeadChatRequestName.withClientLock(expected.accountId + ':' + expected.clientId, async () => {
          const exec = await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:LeadChatRequestName.appendVerifiedCreatedId,
            args:[{expected, requestId:expected.requestId, conversationUrl:context.conversationUrl, verifyOnly}]});
          return exec?.[0]?.result || {ok:false,error:'LeadChat не подтвердил сохранение имени.'};
        });
        return result;
      }
    });
    const trusted = sender => {
      try { const url = new URL(sender.url); return sender.id === chrome.runtime.id && url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id && url.pathname === '/leadchat-request-panel.html'; }
      catch (_) { return false; }
    };
    async function openCrmInCurrentWindow(url, sender) {
      let target;
      try { target = new URL(url); } catch (_) {throw Error('Адрес заявки некорректен.');}
      if (target.protocol !== 'https:' || !/^(?:kp|mnc|bt)-lead-centre\.ru$/.test(target.hostname)
          || target.username || target.password || target.port || !/^\/admin\/domain\/customer-request\/(?:update|view)(?:\/|$)/.test(target.pathname)) throw Error('Разрешены только карточки CRM.');
      const windowId=sender.tab?.windowId;
      if(!Number.isInteger(windowId) || windowId<0)throw Error('Не удалось определить окно LeadChat. Откройте заявку из панели.');
      const index=sender.tab?.index;
      const tab=await chrome.tabs.create({windowId,url:target.href,active:true,...(Number.isInteger(index) && index>=0?{index:index+1}:{})});
      return {ok:true,windowId,tabId:tab.id};
    }
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (!['LP_REQUEST_OPERATION', 'LP_REQUEST_CATALOG', 'LP_REQUEST_SAVED', 'LP_REQUEST_HTTP', 'LP_REQUEST_POSTSAVE_STATUS', 'LP_REQUEST_OPEN_CRM_UPPER'].includes(message?.type)) return;
      if (!trusted(sender)) { reply({ ok: false, error: 'Действие доступно только в карточке заявки.' }); return; }
      (async () => {
        if (message.type === 'LP_REQUEST_OPEN_CRM_UPPER') return openCrmInCurrentWindow(message.url,sender);
        if (message.type === 'LP_REQUEST_HTTP') {
          const url = new URL(message.url), method = String(message.method || 'GET').toUpperCase();
          const base = url.hostname.split('-')[0];
          if (!BASES.includes(base) || url.origin !== 'https://' + base + '-lead-centre.ru' || url.username || url.password || url.port ||
              !['GET', 'POST'].includes(method) || !(url.pathname.startsWith('/admin/domain/') || method === 'GET' && ['/api/customer/search','/api/customer/search-address-street-v2'].includes(url.pathname))) throw Error('Адрес CRM не разрешён.');
          if (method === 'POST' && (typeof message.body !== 'string' || message.body.length > 250000)) throw Error('Некорректная форма CRM.');
          const controller = new AbortController(), timer = setTimeout(() => controller.abort(), method === 'POST' ? 120000 : 20000);
          try {
            const response = await fetch(url.href, { method, credentials: 'include', cache: 'no-store', redirect: 'follow', signal: controller.signal,
              headers: { Accept: message.fullPage === true ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' : 'text/html,application/json;q=0.9,*/*;q=0.8',
                ...(message.fullPage === true ? {} : { 'X-Requested-With': 'XMLHttpRequest' }),
                ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } : {}) },
              ...(method === 'POST' ? { body: message.body } : {}) });
            const final = new URL(response.url || url.href);
            if (final.origin !== url.origin || /\/login(?:\/|$)/.test(final.pathname)) return { ok: false, status: 401, url: final.href, text: '', error: 'Войдите в выбранную базу.' };
            const result = { ok: response.ok, status: response.status, url: final.href, headers: { 'X-Redirect': response.headers.get('X-Redirect') || '', Location: response.headers.get('Location') || '' } };
            try { return {...result,text:await response.text()}; }
            catch (_) { return {...result,text:'',bodyReadError:true,error:'Соединение прервалось при чтении ответа CRM.'}; }
          } finally { clearTimeout(timer); }
        }
        if (message.type === 'LP_REQUEST_OPERATION') {
          const result=await gate.run(message);
          return result;
        }
        if (message.type === 'LP_REQUEST_POSTSAVE_STATUS') return postSave.status(message);
        if (message.type === 'LP_REQUEST_CATALOG') {
          await globalThis.LeadPartnerSourceCatalog.ready();
          return {ok:true,catalog:globalThis.LeadPartnerSourceCatalog.entries,revision:globalThis.LeadPartnerSourceCatalog.revision};
        }
        if (!BASES.includes(message.base) || !requestId(message.id) || !id(message.scope)) throw Error('Нет подтверждённой заявки.');
        if (message.result) {
          const context=message.context || {}, identity=[context.operatorId,context.accountId,context.conversationId,context.conversationUrl].map(value=>String(value || '').trim());
          const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity.join('|')));
          const expectedScope=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
          if(identity.some(value=>!value) || expectedScope!==message.scope)throw Error('Результат относится к другому диалогу.');
        }
        const proof = await gate.run({ ...message, type: undefined, command: message.result ? 'record' : 'status', kind: 'create',clientId:message.context?.clientId });
        if (proof.operation?.state !== 'saved' || String(proof.operation.result?.record?.id) !== String(message.id)) throw Error('Сохранение заявки не подтверждено.');
        // Update the dialogue name only after the source field is verified.
        if (proof.operation.result?.sourceCommitted !== true || !String(proof.operation.result?.expectedSource || '').trim()
            || String(proof.operation.result?.record?.form?.values?.['CustomerRequest[partner_comment]'] || '').trim() !== String(proof.operation.result.expectedSource).trim()
            || proof.operation.result?.fieldDifferences?.some(field => field.name === 'CustomerRequest[partner_comment]'))
          throw Error('Источник в комментарии партнёра не подтверждён. Проверьте сохранённую заявку.');
        if (!proof.operation.clientId || proof.operation.clientId !== message.context?.clientId) throw Error('Исходный клиент этой заявки не подтверждён. Автоматическое изменение имени отключено.');
        return {...await postSave.enqueue({...message,sender}),verified:true,id:String(message.id)};
      })().then(reply, error => reply({ ok: false, error: error?.message || 'Сохранение не подтверждено.' }));
      return true;
    });
  }
  return Object.freeze({ create, createPostSave, install });
});
