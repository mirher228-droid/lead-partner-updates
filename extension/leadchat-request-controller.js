/* Extension-origin application controller: verified CRM forms, exact source catalog, durable writes. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeadChatRequestController = api;
})(globalThis, function (root) {
  'use strict';
  const BASES = ['kp', 'mnc', 'bt'];
  const MAP_KEY = 'leadPartnerYandexGeocoderKey';
  const MAP_CONSTRUCTORS = Object.freeze({kp:'3a441478bf388f1b547feea234423b58044ed891044d8420a95175a4f37d3d71',mnc:'5334b1eac64665e4dbf0b1a57d801a0db433c7da380733a4932291434303d388',bt:'1d14f05bb28add9e89923b4a5ed00d06247b78aa8bc0bed89ac0a934bc07403f'});
  const text = value => String(value ?? '').trim();
  const normalize = value => text(value).normalize('NFKC').replace(/ё/g, 'е').toLocaleLowerCase('ru').replace(/\s+/g, ' ');
  const canonicalCode = value => root.CRMAvitoCore?.canonicalSourceCode(value) || text(value).normalize('NFKC').toUpperCase();
  const phone10 = value => text(value).replace(/\D/g, '').replace(/^[78](?=\d{10}$)/, '');
  const clientId = context => text(context.client?.id || context.clientId);
  const firstName = value => text(value).normalize('NFKC').match(/^([\p{L}]+(?:[-\u2010-\u2011'’][\p{L}]+)*)/u)?.[1] || '';
  const id = value => /^[1-9]\d{0,14}$/.test(text(value));
  const options = list => (list || []).filter(item => item && !item.disabled).map(item => ({ ...item, id: text(item.id ?? item.value), label: text(item.label ?? item.text) }));
  const types = { first: /^(?:Впервые|Первичн)/i, repeat: /Повтор/i, warranty: /Гарант/i };
  function cityDeliveryMode(record) {
    const status = text(record?.statusLabel || record?.status);
    return /^(?:В\s*работе\s+)?СД(?:$|[\s.,()/])/iu.test(status) ? 'sd' : /^в\s*работе(?:\s|$)/iu.test(status) ? 'zpch' : '';
  }
  const partnerNumberOf = label => {
    const match = normalize(label).match(/^(?:партнер\s*[:№-]?\s*)?(\d+)(?=$|[^\d])/u);
    return match ? match[1].replace(/^0+(?=\d)/, '') : '';
  };
  function canonicalRecord(record) {
    if (!record || !id(record.id)) throw Error('База не подтвердила номер заявки.');
    const values = record.form?.values || record.values || {}, names = record.fieldNames || {};
    const pick = (key, ...aliases) => { for (const name of [key, ...aliases]) if (Object.prototype.hasOwnProperty.call(values, name)) return values[name]; return ''; };
    const date = text(pick(names.date || 'CustomerRequest[opened_at]'));
    const match = date.match(/^(\d{2})[.-](\d{2})[.-](\d{4})/);
    const canonical = {
      base: record.base, cityId: text(pick('CustomerRequest[city_id]')), workId: text(pick('CustomerRequest[appliance_type_id]')),
      serviceId: text(names.service ? pick(names.service) : ''), partnerId: text(pick('CustomerRequest[partner_id]')),
      requestType: text(pick('CustomerRequest[type]')), phone: text(pick(names.phone || 'Customer[phone]') || record.phone || record.phones?.[0]), clientName: text(pick('Customer[first_name]')),
      age: text(pick('Customer[age]')), street: text(pick('Customer[address_street]', 'CustomerRequest[address_street]')),
      house: text(pick('Customer[address_building]', 'CustomerRequest[address_building]')), apartment: text(pick('Customer[address_office]', 'CustomerRequest[address_office]')),
      settlement: text(pick('Customer[address_locality]', 'CustomerRequest[address_locality]')),
      entrance:text(pick('Customer[address_entrance]','Customer[address_porch]','CustomerRequest[address_entrance]','CustomerRequest[address_porch]')),
      floor:text(pick('Customer[address_floor]','CustomerRequest[address_floor]')),
      intercom:text(pick('Customer[address_has_intercom]','Customer[address_intercom]','CustomerRequest[address_has_intercom]','CustomerRequest[address_intercom]')),
      farRide:text(pick('CustomerRequest[is_far_ride]')),
      callCheck:text(pick('CustomerRequest[is_need_call_check]')),callBeforeVisit:text(pick('CustomerRequest[is_need_call_before_visit]')),
      urgent:text(pick('CustomerRequest[is_urgent]')),zakrep:text(pick('CustomerRequest[is_zakrep]')),feedback:text(pick('CustomerRequest[is_req_fback]')),
      comments: text(pick('CustomerRequest[comments]')), commentsService: String(pick('CustomerRequest[comments_service]') ?? ''),
      partnerComment: text(pick('CustomerRequest[partner_comment]')),
      date: match ? match[3] + '-' + match[2] + '-' + match[1] : date.slice(0, 10), time: text(pick(names.time || 'cr_opened_at_time')).slice(0, 5)
    };
    const phones = [...new Set([canonical.phone,...(Array.isArray(record.phones)?record.phones:[]),...(Array.isArray(record.customerPhones)?record.customerPhones:[]),...Object.entries(values).filter(([name])=>/^Customer\[phone(?:_extra_[1-3])?\]$|^Customer\[contact_phones\]\[[^\]]+\]\[v\]$/.test(name)).map(([,value])=>value)].map(phone10).filter(value=>/^\d{10}$/.test(value)))];
    return { ...record, id: text(record.id), canonical, draft: canonical, phones, verified: true };
  }
  function sourceMatch(catalog, raw, partner, base) {
    return root.LeadPartnerSourceCatalog.match(catalog, raw, partner, base);
  }
  const appendLine = (value, line) => {
    const lines = text(value).split(/\r?\n/).filter(Boolean);
    if (text(line) && !lines.some(item => normalize(item) === normalize(line))) lines.push(text(line));
    return lines.join('\n');
  };
  function mapLinks(base, city, query, coordinates, view) {
    if(root.LeadChatMapSearch?.mapLinks)return root.LeadChatMapSearch.mapLinks(base,city,query,coordinates,view);
    const address = root.LeadChatAddress?.mapQuery ? root.LeadChatAddress.mapQuery(city,query) : [root.LeadChatAddress?.normalizeMapCity(city) || text(city), text(query)].filter(Boolean).join(', ');
    const frame = new URL('https://yandex.ru/map-widget/v1/');
    const external = new URL('https://yandex.ru/maps/');
    external.searchParams.set('mode','usermaps');
    if(MAP_CONSTRUCTORS[base])for(const url of [frame,external]){url.searchParams.set('um','constructor:'+MAP_CONSTRUCTORS[base]);url.searchParams.set('source','constructorLink');}
    if (address) {
      frame.searchParams.set('text', address);
      external.searchParams.set('text', address);
    }
    return {mapUrl:frame.href,externalUrl:external.href};
  }

  function create(config = {}) {
    const rpc = config.rpc || (message => chrome.runtime.sendMessage(message));
    const storage = config.storage || root.chrome?.storage?.local;
    const mapSearch = config.mapSearch || root.LeadChatMapSearch?.create({fetch:config.fetch});
    const mapRoute = config.mapRoute || root.LeadChatMapRoute?.create({fetch:config.fetch,mapSearch});
    const services = new Map(), metadata = new Map(), receipts = new Map(), receiptReadAt = new Map(), postSaveHandoffs = new Map();
    const freshForms = new Set();
    const now = config.now || Date.now, nativeTtl = 30000;
    const nativeForms = new Map(), nativeReads = new Map(), phoneLookups = new Map(), dependentLists = new Map(), formGenerations = new Map();
    const preloadedBindings = new WeakMap();
    const scopeDigests = new Map(), resolvedScopes = new Map(), metadataContexts = new Map(), dependencyRevisions = new Map(), livePreparations = new Set();
    function sharedResult(cache,key,load,refresh=false,retain) {
      const known=cache.get(key);
      if(known && (known.pending || !refresh && known.value?.ok && now()-known.at<nativeTtl))return known.promise;
      const entry={at:now(),pending:true};
      entry.promise=Promise.resolve().then(load).then(value=>{
        entry.pending=false;entry.at=now();entry.value=value;
        if(!value?.ok || value.incomplete || retain && !retain(value))cache.delete(key);
        return value;
      },error=>{cache.delete(key);throw error;});
      cache.set(key,entry);
      while(cache.size>250) {const oldest=[...cache].find(([,value])=>!value.pending);if(!oldest)break;cache.delete(oldest[0]);}
      return entry.promise;
    }
    function clearScoped(cache,key) {for(const candidate of cache.keys())if(candidate.startsWith(key+'|'))cache.delete(candidate);}
    async function currentCatalog() { return rpc({type:'LP_REQUEST_CATALOG'}); }
    function nativeIdentity(handle,recordId,phone) {
      return handle.key+'|'+(formGenerations.get(handle.key)||0)+'|'+(recordId?'record:'+text(recordId):'create:'+phone10(phone));
    }
    function rememberNative(handle,raw,at=now()) {
      const record=raw?.record;
      if(!raw?.ok || !record || !id(record.id))return;
      const key=nativeIdentity(handle,record.id);
      nativeForms.set(key,{at,value:raw,pending:false,promise:Promise.resolve(raw)});
    }
    const serviceModule = config.serviceModule || root.LeadChatCrmService;
    const foundLinks=new Map();
    function appendFoundName(context,base,handle,lookup) {
      const phone=phone10(context.proposals?.phone);
      if(!/^\d{10}$/.test(phone)||context.proposals?.ambiguous?.phone||context.client?.phoneConflict||lookup?.incomplete||lookup?.unavailableBases?.includes(base))return;
      const matches=[...new Map((lookup?.matches || []).filter(item=>item.base===base && id(item.id) && phone10(item.phone)===phone).map(item=>[text(item.id),item])).values()];
      if(matches.length!==1)return;
      const recordId=text(matches[0].id),key=handle.scope+'|'+clientId(context)+'|'+base+'|'+recordId+'|'+phone;
      if(foundLinks.has(key))return;
      const task=rpc({type:'LP_REQUEST_FOUND',command:'append',base,id:recordId,phone,scope:handle.scope,context:{operatorId:text(context.operatorId || context.scope?.operatorId),accountId:text(context.accountId || context.scope?.accountId),clientId:clientId(context),conversationId:text(context.chatId || context.conversationId),conversationUrl:context.dialogUrl || context.conversationUrl}});
      foundLinks.set(key,task);
      void Promise.resolve(task).then(result=>{if(!result?.ok)foundLinks.delete(key);},()=>foundLinks.delete(key));
    }

    function validate(context, base) {
      if (!context || context.ok === false || !text(context.chatId || context.conversationId) || !text(context.operatorId || context.scope?.operatorId) || !text(context.accountId || context.scope?.accountId) || !clientId(context)) throw Error('Дождитесь загрузки диалога, клиента и сотрудника LeadChat.');
      if (!BASES.includes(base)) throw Error('Выберите базу КП, МНЧ или БТ.');
      let url;
      try {url = new URL(context.dialogUrl || context.conversationUrl);} catch (_) {}
      if (!url || !['http:','https:'].includes(url.protocol) || !['188-225-34-82.sslip.io','72-56-68-159.sslip.io','chat.partner-lead-centre.ru'].includes(url.hostname)
          || url.username || url.password || url.port || url.search || url.hash || url.pathname.replace(/\/$/,'') !== '/chats/' + (context.chatId || context.conversationId)) throw Error('Адрес диалога не совпадает с открытой карточкой. Откройте панель заново.');
    }
    function scopeText(context) {
      return [context.operatorId || context.scope?.operatorId, context.accountId || context.scope?.accountId, context.chatId || context.conversationId, context.dialogUrl || context.conversationUrl].map(text).join('|');
    }
    async function scope(context) {
      const value=scopeText(context);
      if(!scopeDigests.has(value))scopeDigests.set(value,(async()=>{
        const bytes=new TextEncoder().encode(value),digest=await (config.crypto || root.crypto).subtle.digest('SHA-256',bytes);
        return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
      })());
      return scopeDigests.get(value);
    }
    async function serviceFor(context, base) {
      validate(context, base);
      const key = await scope(context);
      resolvedScopes.set(scopeText(context),key);
      if (!services.has(key)) services.set(key, serviceModule.create({ scope: key, request: async input => {
        const result = await rpc({ type: 'LP_REQUEST_HTTP', url: input.url, method: input.method || 'GET',
          ...(input.fullPage === true ? { fullPage: true } : {}),
          ...(input.body !== undefined ? { body: String(input.body) } : {}) });
        if (!result || !result.status) throw Error(result?.error || 'CRM не ответила. Проверьте подключение.');
        if (result.bodyReadError && (!input.method || input.method === 'GET')) throw Error(result.error || 'CRM не завершила чтение карточки.');
        return result;
      } }));
      return { service: services.get(key), scope: key, key: key + '|' + base + '|' + clientId(context) };
    }
    async function resolveBase({context, baseCandidates, workTitle}) {
      const semantic=root.LeadPartnerRules.resolveBase({...context,workTitle},baseCandidates);
      if(semantic.base || semantic.conflict)return {ok:true,...semantic};
      // Inspect actual, read-only CRM dropdowns. NEVER guess from the order of
      // БТ/МНЧ in the header and never auto-select on a partial/outage result.
      const choices = [...new Set((Array.isArray(baseCandidates) ? baseCandidates : []).filter(base => BASES.includes(base)))];
      const pieces = text(workTitle).split(/\s+[/|]\s+/).map(normalize).filter(Boolean);
      if (choices.length < 2 || !pieces.length || !text(context.cityName || context.city)) return {ok:true,base:'',reason:'Недостаточно данных для выбора базы.'};
      const catalog = root.LeadChatCrmCityCatalog;
      const checks = await Promise.all(choices.map(async base => {
        try {
          const cities = options(typeof catalog?.forBase === 'function' ? catalog.forBase(base) : catalog?.[base]);
          const city = root.LeadPartnerRules.routeCity(cities,context.cityName || context.city);
          if (!city) return {base,ok:false,reason:'Город не определён в справочнике ' + base};
          const handle = await serviceFor(context,base);
          const available = await handle.service.dependencies({base,cityId:city.id,applianceTypeId:'',partnerId:''});
          if (!available?.ok) return {base,ok:false,reason:available?.error || 'CRM не ответила'};
          const workTypes = options(available.workTypes);
          const matchWork = workTypes.filter(work => pieces.includes(normalize(work.label)));
          let score = matchWork.length ? 1 : 0, matchingWork = null;
          if (pieces.length > 1 && matchWork.length) {
            const extras = await Promise.all(matchWork.slice(0,5).map(async work => {
              const response = await handle.service.dependencies({base,cityId:city.id,applianceTypeId:work.id,partnerId:''});
              if (!response?.ok) return {ok:false};
              const serviceNames = options(response.services).map(service=>normalize(service.label));
              return {ok:true,pair:pieces.some(piece => piece !== normalize(work.label) && serviceNames.includes(piece)),work};
            }));
            if (extras.some(row=>!row.ok)) return {base,ok:false,reason:'Не удалось полностью проверить виды услуг'};
            const paired = extras.filter(row=>row.pair);
            if (paired.length === 1) {score=2;matchingWork=paired[0].work;}
          }
          return {base,ok:true,score,work:matchingWork || (matchWork.length===1?matchWork[0]:null)};
        } catch(error) {return {base,ok:false,reason:error?.message||'Ошибка проверки CRM'};}
      }));
      if (checks.some(row=>!row.ok)) return {ok:true,base:'',reason:'Одна из баз недоступна для сравнения: ' + checks.filter(row=>!row.ok).map(row=>row.base).join(', '),checks};
      const highest = Math.max(0,...checks.map(row=>row.score));
      const winners = checks.filter(row=>row.score===highest && row.score>0);
      if (winners.length !== 1) return {ok:true,base:'',reason:'По виду работ нельзя однозначно выбрать одну CRM; выберите базу вручную.',checks};
      return {ok:true,base:winners[0].base,workId:winners[0].work?.id||'',reason:highest===2?'Услуга и вид работ совпали только в выбранной CRM.':'Вид работ найден только в выбранной CRM.',checks};
    }
    const metadataKey = handle => 'leadPartnerRequestMetadataV1:' + handle.key;
    function cacheMetadata(handle, value) {
      if(value._nativeIdentity && !value._nativeIdentity.startsWith(handle.key+'|'+(formGenerations.get(handle.key)||0)+'|'))return;
      freshForms.delete(handle.key);
      metadata.set(handle.key, value);
      try { void Promise.resolve(storage?.set({[metadataKey(handle)]:value})).catch(() => {}); } catch (_) {}
    }
    function metadataContext(context) {
      return JSON.stringify([context.cityName || context.city,context.partnerNumber || context.partner,context.sourceCode || context.source,
        context.clientFirstName || context.clientName || context.client?.name,context.profileComment || context.masterComment,
        context.dialogUrl || context.conversationUrl,context.cityTimeZone || context.cityTimezone,context.messages || [],root.LeadPartnerSourceCatalog?.revision]);
    }
    function getCachedMetadata({context,draft={},id:recordId}) {
      const base=draft.base || context.base || context.baseId;
      if(context?.allowed===false || context?.routeSafe===false)return null;
      try {validate(context,base);} catch (_) {return null;}
      const resolved=resolvedScopes.get(scopeText(context));
      if(!resolved || recordId)return null;
      const handle={key:resolved+'|'+base+'|'+clientId(context)},identity=nativeIdentity(handle,null,draft.phone || context.phone || '');
      const value=metadata.get(handle.key),native=nativeForms.get(identity);
      // Only the current controller's native preparation can back an immediate
      // create editor. A persisted form never grants a cross-session cache hit.
      if(freshForms.has(handle.key) || !livePreparations.has(identity) || !native?.value?.ok || native.pending || now()-native.at>=nativeTtl
        || !value?.ok || !value.form || value.record || value._nativeIdentity!==identity || now()-value._nativeReadAt>=nativeTtl
        || metadataContexts.get(handle.key)!==metadataContext(context))return null;
      return value;
    }
    async function getMetadata({ context, draft = {}, id: recordId, allBases = false, refresh = false, preloadedMetadata }) {
      const base=draft.base || context.base || context.baseId,handle=await serviceFor(context,base);
      const phone=draft.phone || context.phone || '',identity=nativeIdentity(handle,recordId,phone);
      const catalogTask=currentCatalog();
      const binding=preloadedMetadata && preloadedBindings.get(preloadedMetadata);
      let native;
      if(!refresh && binding?.key===handle.key && now()-binding.at<nativeTtl
        && text(preloadedMetadata.record?.id || preloadedMetadata.id)===text(recordId)
        && (preloadedMetadata.record?.base || preloadedMetadata.base)===base) {
        native=preloadedMetadata.record?preloadedMetadata:{...preloadedMetadata,ok:true,record:preloadedMetadata};
      } else native=await sharedResult(nativeForms,identity,async()=>{
        if(!refresh && !freshForms.has(handle.key)) {
          const cached=metadata.get(handle.key);
          if(livePreparations.has(identity) && cached?.ok && cached.form && cached._nativeIdentity===identity && now()-cached._nativeReadAt<nativeTtl
            && (recordId ? cached.record?.base===base && text(cached.record?.id)===text(recordId) : !cached.record))return cached;
        }
        livePreparations.delete(identity);
        const fresh=recordId ? await sharedResult(nativeReads,identity,()=>handle.service.readRequest({base,id:text(recordId)}),true)
          : await handle.service.prepare({base,phone});
        if(fresh?.ok)livePreparations.add(identity);
        return fresh;
      },refresh);
      if(!native?.ok)return native;
      const prepared={...native,lists:{...native.lists}};
      if(prepared.record) {
        if(!recordId || prepared.record.base!==base || text(prepared.record.id)!==text(recordId))return {ok:false,state:'record_changed',error:'CRM вернула другую заявку.'};
        prepared.record=canonicalRecord(prepared.record);
      } else if(recordId)return {ok:false,state:'record_changed',error:'CRM не подтвердила выбранную заявку.'};
      const catalogResponse=await catalogTask;
      if(!catalogResponse?.ok && !recordId)throw Error('Не удалось прочитать рабочие источники.');
      const sources=catalogResponse?.catalog || [],source=sourceMatch(sources,context.sourceCode || context.source,context.partnerNumber || context.partner,base);
      const cities=options(prepared.lists?.cities),partners=options(prepared.lists?.partners);
      const matchedCity=root.LeadPartnerRules.routeCity(cities,context.cityName || context.city);
      const externalPartner=partnerNumberOf(context.partnerNumber || context.partner);
      const partnerMatches=partners.filter(item=>externalPartner && partnerNumberOf(item.label)===externalPartner);
      const addressDefaults=Object.fromEntries(['street','house','apartment','settlement','entrance','floor'].map(name=>[name,Object.hasOwn(draft,name)?draft[name]??'':prepared.record?.canonical?.[name]??'']));
      const defaults={base,age:31,clientName:firstName(context.clientFirstName || context.clientName || context.client?.name),phone:context.phone || context.client?.phone || '',
        cityId:matchedCity?.id || '',partnerId:partnerMatches.length===1?partnerMatches[0].id:'',
        sourceCode:source?.code || text(context.sourceCode || context.source),sourceUrl:source?.url || '',partnerComment:source?.code || text(context.sourceCode || context.source),
        comments:root.LeadPartnerRules.withFreeVisit(root.LeadPartnerRules.whiteComment(appendLine(context.profileComment || context.masterComment || '',source?.url || ''),externalPartner),context.messages),commentsService:root.LeadPartnerRules.serviceComment('',context.dialogUrl || context.conversationUrl),
        ...addressDefaults,cityTimeZone:context.cityTimeZone || context.cityTimezone || '',
        requestType:text(prepared.form?.values?.['CustomerRequest[type]']) || (options(prepared.lists?.types).filter(item=>/^впервые$|^первичн/i.test(item.label)).length===1?options(prepared.lists?.types).find(item=>/^впервые$|^первичн/i.test(item.label)).id:'')};
      const chosenCity=draft.cityId || defaults.cityId;
      if(!recordId && chosenCity) {
        const args={base,cityId:chosenCity,applianceTypeId:draft.workId || '',partnerId:defaults.partnerId,date:draft.date,time:draft.time};
        const dependent=await sharedResult(dependentLists,identity+'|'+JSON.stringify(args),()=>handle.service.dependencies({...args,preparedPhone:phone}),refresh);
        if(!dependent.ok)return dependent;
        const lists=dependent.lists || dependent;
        if(lists.workTypes)prepared.lists.workTypes=lists.workTypes;
        if(lists.services)prepared.lists.services=lists.services;
        prepared.cityNotice=dependent.cityNotice || '';prepared.cityNoticeCityId=text(dependent.cityNoticeCityId);
        prepared._dependencies=args;
      }
      const value={...prepared,cities,partners,sources,services:options(prepared.lists?.services),works:options(prepared.lists?.workTypes),requestTypes:options(prepared.lists?.types),defaults,owner:catalogResponse?.owner,
        _nativeIdentity:identity,_nativeReadAt:nativeForms.get(identity)?.at ?? now()};
      cacheMetadata(handle,value);
      if(metadata.get(handle.key)===value)metadataContexts.set(handle.key,metadataContext(context));
      if(recordId && prepared.record)receipts.set(handle.key,prepared.record);
      return value;
    }
    async function getDependencies({ context, draft }) {
      const base = draft.base || context.base, handle = await serviceFor(context, base);
      const previous=metadata.get(handle.key),generation=formGenerations.get(handle.key)||0,revision=(dependencyRevisions.get(handle.key)||0)+1;
      dependencyRevisions.set(handle.key,revision);
      const args={base,cityId:draft.cityId,applianceTypeId:draft.workId || '',partnerId:draft.partnerId,date:draft.date,time:draft.time};
      const identity=nativeIdentity(handle,null,draft.phone || context.phone || '');
      const result=await sharedResult(dependentLists,identity+'|'+JSON.stringify(args),()=>handle.service.dependencies({...args,...(!previous?.record?{preparedPhone:draft.phone || context.phone || ''}:{})}));
      if (!result.ok) return result;
      const resultLists = result.lists || result;
      if (previous && metadata.get(handle.key)===previous && (formGenerations.get(handle.key)||0)===generation && dependencyRevisions.get(handle.key)===revision) {
        if (resultLists.workTypes) {previous.lists.workTypes=resultLists.workTypes;previous.works=options(resultLists.workTypes);}
        if (resultLists.services) {previous.lists.services=resultLists.services;previous.services=options(resultLists.services);}
        previous.cityNotice = result.cityNotice || '';
        previous.cityNoticeCityId = text(result.cityNoticeCityId);
        previous._dependencies=args;
      }
      return { ...result, works: options(resultLists.workTypes), services: options(resultLists.services), partners: resultLists.partners ? options(resultLists.partners) : undefined };
    }
    async function duplicates({ context, phone, base, allBases = false, onProgress, refresh = false }) {
      if(!/^\d{10}$/.test(phone10(phone)))return {ok:false,error:'Укажите полный номер телефона клиента.'};
      const selected=base || context.base,choices=allBases?BASES:[selected],completed=new Map();
      function aggregate() {
        const results=choices.filter(candidate=>completed.has(candidate)).map(candidate=>completed.get(candidate));
        const chosen=completed.get(selected),available=results.filter(item=>item.result?.ok),pendingBases=choices.filter(candidate=>!completed.has(candidate));
        return {ok:!!available.length || !!pendingBases.length,base:selected,phone:phone10(phone),
          matches:available.flatMap(({base,result})=>(result.matches || []).map(item=>({...item,base}))),
          incomplete:!chosen?.result?.ok || !!chosen.result.incomplete,pendingBases,complete:!pendingBases.length,
          unavailableBases:results.filter(item=>!item.result?.ok).map(item=>item.base),
          ...(!available.length && !pendingBases.length?{error:chosen?.result?.error || 'CRM не ответили на поиск телефона.'}:{})};
      }
      await Promise.all(choices.map(async candidate=>{
        let result,handle;
        try {handle=await serviceFor(context,candidate);result=await sharedResult(phoneLookups,handle.key+'|'+phone10(phone),()=>handle.service.search({base:candidate,phone,lookupOnly:true}),refresh,value=>(value.matches || []).length>0);}
        catch(error){result={ok:false,error:error.message};}
        completed.set(candidate,{base:candidate,result});
        if(candidate===selected && result?.ok)appendFoundName(context,selected,handle,{...result,matches:(result.matches || []).map(item=>({...item,base:selected}))});
        if(typeof onProgress==='function')try {onProgress(aggregate());} catch (_) {}
      }));
      return aggregate();
    }
    async function mapped(context, draft, handle, requireSource = true) {
      const meta = metadata.get(handle.key) || await getMetadata({ context, draft });
      if (!meta.ok) throw Error(meta.error || 'Не загрузилась форма CRM.');
      const copy = { ...draft };
      if (types[copy.requestType]) {
        const matches = options(meta.lists?.types).filter(item => types[copy.requestType].test(item.label));
        if (matches.length !== 1) throw Error('Выберите тип заявки из списка CRM.');
        copy.requestType = matches[0].id;
      }
      const catalog = await currentCatalog();
      if (!catalog?.ok && requireSource) throw Error('Рабочий справочник источников недоступен.');
      let selectedPartner=context.partnerNumber || context.partner;
      if (requireSource || copy.sourceOverride === true) {
        const number = partnerNumberOf(selectedPartner);
        const matches = options(meta.lists?.partners || meta.partners).filter(item=>copy.sourceOverride === true ? item.id === text(copy.partnerId) : number && partnerNumberOf(item.label) === number);
        if (matches.length !== 1) throw Error('Выберите действующего партнёра из списка CRM.');
        copy.partnerId = matches[0].id;selectedPartner=matches[0].label;
      }
      const source = sourceMatch(catalog?.catalog, copy.sourceOverride === true ? copy.sourceCode : requireSource ? context.sourceCode || context.source : copy.partnerComment || copy.sourceCode,selectedPartner,copy.base || context.base);
      if (!source && (requireSource || copy.sourceOverride === true)) throw Error('Источник из шапки диалога не найден однозначно в рабочем справочнике. Проверьте данные канала и синхронизацию источников.');
      if (source && (requireSource || copy.sourceOverride === true)) {
        copy.partnerComment = source.code;
        const knownUrls = new Set((catalog.catalog || []).map(item => text(item.url)));
        copy.comments = appendLine(text(copy.comments).split(/\r?\n/).filter(line => !knownUrls.has(line.trim()) || line.trim() === source.url).join('\n'), source.url);
      }
      if(requireSource || copy.sourceOverride === true)copy.comments=root.LeadPartnerRules.whiteComment(copy.comments,selectedPartner);
      copy.comments=root.LeadPartnerRules.withFreeVisit(copy.comments,context.messages);
      const previousService=String(meta.form?.values?.['CustomerRequest[comments_service]']||'');
      const boundDialog=!requireSource&&previousService.split(/\r?\n/).find(line=>/^https?:\/\/(?:chat\.partner-lead-centre\.ru|188-225-34-82\.sslip\.io|72-56-68-159\.sslip\.io)\/chats\/[A-Za-z0-9_-]+\/?$/u.test(line.trim()));
      copy.commentsService=root.LeadPartnerRules.serviceComment(copy.commentsService,text(boundDialog || '') || context.dialogUrl || context.conversationUrl);

      if(requireSource)copy.comments=appendLine(copy.comments,text(context.profileComment || context.masterComment));
      const fields = { ...serviceModule.draftToFields(copy, meta) };
      // Raw history cached in older drafts is ignored. Only the explicit editor
      // may submit a changed value for an existing, natively writable record.
      const historyName='CustomerRequest[date_changes]',historyField=(meta.form?.fields || []).find(item=>item.name===historyName),historyBefore=String(meta.form?.values?.[historyName] ?? '');
      delete fields[historyName];
      if(!requireSource && Object.hasOwn(copy,'visitHistory') && String(copy.visitHistory)!==historyBefore && historyField && !historyField.disabled && !historyField.readOnly)fields[historyName]=String(copy.visitHistory);
      for (const [name, value] of Object.entries(copy.extraFields || {})) if (name !== 'CustomerRequest[date_changes]' && !(requireSource && name === 'CustomerRequest[advert_id]') && !Object.prototype.hasOwnProperty.call(fields, name) && (meta.form?.fields || []).some(item => item.name === name && !item.disabled && !item.readOnly)) fields[name] = value;
      if (requireSource && (meta.form?.fields || []).some(item=>item.name === 'CustomerRequest[advert_id]' && !item.disabled && !item.readOnly && !item.required)) fields['CustomerRequest[advert_id]'] = '';
      return { fields, meta, draft: copy };
    }
    function normalized(result) {
      if(result?.state === 'awaiting_reason' && id(result.id || result.record?.id)
        && result.record && text(result.id) === text(result.record.id) && BASES.includes(result.record.base) && ['cancel_kc','cancel_branch','not_taken'].includes(result.action)
        && Array.isArray(result.reasons) && result.reasons.length) return {...result,verified:false,record:canonicalRecord(result.record)};
      const verified = result?.ok === true && (result.verified === true || result.verified?.ok === true) && !!result.record && id(result.record.id) && BASES.includes(result.record.base);
      const retryDraft=result?.retryable && result.retryFields && result.record ? {...canonicalRecord({...result.record,form:{...result.record.form,values:{...result.record.form?.values,...result.retryFields}}}).canonical,reason:result.retryReason || ''} : null;
      return { ...result, verified, ...(retryDraft?{retryDraft}:{}), ...(verified ? {record:canonicalRecord(result.record)} : result?.ok ? {ok:false,state:'uncertain',error:'База не вернула подтверждённую карточку с точным номером.'} : {}) };
    }
    function boundCancellation(result,base,recordId,operationId) {
      if(result?.state==='awaiting_reason' && (text(result.id)!==text(recordId) || text(result.record?.id)!==text(recordId)
        || result.record?.base!==base || result.operationId!==operationId))return {ok:false,state:'uncertain',id:text(recordId),operationId,error:'CRM вернула форму отмены другой операции.'};
      return result;
    }
    async function finalizeVerified(result, kind, context, handle, meta) {
      if (!result.verified) return result;
      receipts.set(handle.key, result.record);
      clearScoped(phoneLookups,handle.key);
      rememberNative(handle,{...result.record,record:result.record,ok:true});
      cacheMetadata(handle, { ...(meta || metadata.get(handle.key)), ...result.record, record:result.record, ok:true });
      if (kind === 'create') {
        if (result.sourceCommitted !== true || !text(result.expectedSource)
            || text(result.record.form?.values?.['CustomerRequest[partner_comment]']) !== text(result.expectedSource)
            || result.fieldDifferences?.some(field => field.name === 'CustomerRequest[partner_comment]')) {
          result.notice = 'Заявка №' + result.record.id + ' создана. Источник пока не подтверждён — передача в «Созданные с Авито» не запускается. '
            + (result.sourceWarning || 'Проверьте комментарий партнёра в CRM.');
          return result;
        }
        const target = handle.key + '|' + result.record.id;
        const remember = postSave => {
          result.postSave = postSave;
          postSaveHandoffs.delete(target); postSaveHandoffs.set(target, postSave);
          while (postSaveHandoffs.size > 100) postSaveHandoffs.delete(postSaveHandoffs.keys().next().value);
        };
        const failed = error => {
          result.notice = error || 'Заявка сохранена. Обновление имени диалога ещё не подтверждено.';
          remember({state:'attention',name:{ok:false,error:result.notice}});
        };
        remember({state:'pending',handoffPending:true});
        try {
          // The verified receipt is already durable. Name and monitor handoff
          // cannot hold the saved CRM card behind an ancillary message reply.
          const task = rpc({ type: 'LP_REQUEST_SAVED', base: result.record.base || context.base, id: result.record.id, scope: handle.scope, operationId:result.operationId, result,
            context: { conversationId: context.chatId || context.conversationId, conversationUrl: context.dialogUrl || context.conversationUrl,
              clientId: clientId(context), clientName: context.clientName || context.client?.name,
              operatorId: context.operatorId || context.scope?.operatorId, accountId: context.accountId || context.scope?.accountId } });
          void Promise.resolve(task).then(notified => {
            if (notified?.postSave) remember(notified.postSave);
            else if (notified?.ok && notified.pending) remember({state:'pending'});
            if (!notified?.pending && (!notified?.ok || notified.name?.ok === false || notified.postSave?.name?.ok === false))
              failed(notified?.name?.error || notified?.postSave?.name?.error || notified?.error || 'Заявка сохранена. Добавление номера к имени диалога не подтверждено.');
          }, () => failed());
        } catch (_) { failed(); }
      }
      return result;
    }
    async function write(kind, { context, draft, patch, id: recordId, operationId, expectedRevision, action = 'save', submitAction }) {
      let input = draft || patch, base, handle, data;
      try {
      if (!input || typeof input !== 'object') throw Error('Не заполнена форма заявки.');
      if(submitAction !== undefined && (kind !== 'create' || submitAction !== 'clarify'))throw Error('Неизвестный способ создания заявки. Форма не отправлена.');
      input={...input,sourceOverride:input.sourceOverride===true && (kind==='create' || action==='save')};
      base = input.base || context.base;
      handle = await serviceFor(context, base);
      if (kind === 'update') {
        let previous = receipts.get(handle.key);
        if (!previous || previous.id !== text(recordId)) {
          // Register the exact existing form before mapping fields. Otherwise a
          // cold edit needlessly prepares an unrelated create form and customer.
          const read = await getRequest({ context, base, id:text(recordId), fresh:false });
          if (!read.ok) return read;
          previous = canonicalRecord(read.record);
        }
        input = input.sourceOverride === true ? {...previous.canonical,...input,base} : root.LeadPartnerRules.preserveBinding(previous.canonical,{ ...previous.canonical, ...input, base });
        if (input.rescheduleReason && !input.reason) input.reason = input.rescheduleReason;
      }
      data = await mapped(context, input, handle, kind === 'create');
      if (!operationId || !/^[a-zA-Z0-9_-]{8,160}$/.test(operationId)) throw Error('Не удалось закрепить операцию сохранения.');
      } catch (error) { return {ok:false,state:'rejected',safeToRetry:true,code:'preflight',error:error?.message || 'Проверьте заполнение заявки.'}; }
      const gate = { type: 'LP_REQUEST_OPERATION', kind, base, scope: handle.scope, operationId, clientId:clientId(context), ...(data.draft.creationCycleId ? { cycleId: data.draft.creationCycleId } : {}), ...(kind === 'update' ? { recordId: text(recordId) } : {}) };
      let result;
      try {
        result = normalized(kind === 'create' ? await handle.service.createRequest({ base, operationId, fields: data.fields, ...(submitAction ? {submitAction} : {}), primaryPhoneField:data.meta.fieldNames?.phone,
          allowDuplicate: true,
          existingRequestId: text(data.draft.existingRequestId),
          allowCustomerUpdate: input.allowCustomerUpdate === true }) : await handle.service.saveRequest({ base, id: text(recordId), operationId,
          fields: data.fields, action, allowBindingChange:action === 'save' && data.draft.sourceOverride === true, primaryPhoneField:data.meta.fieldNames?.phone, reason: input.reason || '', expectedRevision: expectedRevision || input.expectedRevision || input.revision || '' }));
      } catch (error) { result = { ok: false, state: 'uncertain', operationId, writeStarted: true, error: error?.message || 'Результат сохранения ещё не известен.' }; }
      result=boundCancellation(result,base,recordId,operationId);
      // Receipt storage and city/name handoff must not hold the native result.
      // The service owns same-operation POST deduplication.
      try {
        const task=rpc({...gate,command:'record',result});
        void Promise.resolve(task).then(finished=>{
          if(finished?.cityNotification)result.cityNotification=finished.cityNotification;
        },()=>{});
      } catch (_) {}
      await finalizeVerified(result, kind, context, handle, data.meta);
      return result.code === 'customer_change_required' ? { ...result, state: 'customer_change_required', changes: result.customerDiffs || [] } : result;
    }
    async function getRequest({ context, id: recordId, base, expectedPhone, expectedCustomerId, fresh = true, onRefresh }, refreshBinding) {
      if(!id(recordId))return {ok:false,error:'Нет точного номера заявки.'};
      if(expectedCustomerId!==undefined && (!id(expectedCustomerId) || !BASES.includes(base)))return {ok:false,state:'rejected',error:'Укажите точную базу и клиента истории.'};
      const choices=BASES.includes(base)?[base]:base===undefined && BASES.includes(context.base)?[context.base]:BASES;
      const results=await Promise.all(choices.map(async candidate=>{
        try {
          const handle=await serviceFor(context,candidate),identity=nativeIdentity(handle,recordId);
          const cached=nativeForms.get(identity);
          const cacheHit=!fresh && cached?.value?.ok && now()-cached.at<nativeTtl;
          const raw=cacheHit?cached.value
            :await sharedResult(nativeReads,identity,()=>handle.service.readRequest({base:candidate,id:text(recordId)}),true);
          return {handle,identity,cacheHit,readAt:cacheHit?cached.at:now(),raw,record:raw.ok?canonicalRecord(raw.record):null};
        } catch(error){return {raw:{ok:false,error:error.message},record:null};}
      }));
      let valid=results.filter((item,index)=>item.record && item.record.base===choices[index] && text(item.record.id)===text(recordId));
      if(expectedCustomerId!==undefined)valid=valid.filter(item=>text(item.record.customerId)===text(expectedCustomerId));
      if(expectedPhone!==undefined)valid=valid.filter(item=>/^\d{10}$/.test(phone10(expectedPhone)) && item.record.phones.includes(phone10(expectedPhone)));
      else if(valid.length>1) {
        const dialog=text(context.dialogUrl || context.conversationUrl);
        const bound=valid.filter(item=>text(item.record.canonical.commentsService).split(/\r?\n/).some(line=>text(line)===dialog));
        if(bound.length)valid=bound;
        if(valid.length>1) {
          const phone=phone10(context.phone || context.client?.phone);
          const phoneBound=valid.filter(item=>/^\d{10}$/.test(phone) && item.record.phones.includes(phone));
          if(phoneBound.length)valid=phoneBound;
        }
        if(valid.length>1) {
          // Repeated numeric IDs can exist in different CRMs. Only the
          // customer's incoming subject may break a remaining tie; the ad
          // title and broad account header are not identity evidence.
          const topics=new Set((Array.isArray(context.messages)?context.messages:[])
            .filter(message=>message?.direction==='in' && !message.isInternal && message.is_internal!==true
              && ['client','customer',''].includes(text(message.senderType || message.sender_type)))
            .map(message=>root.LeadPartnerRules.resolveBase({workTitle:message.body || ''},[]))
            .filter(result=>['service','television'].includes(result.reasonCode) && BASES.includes(result.base)).map(result=>result.base));
          if(topics.size===1) {
            const topicBound=valid.filter(item=>topics.has(item.record.base));
            if(topicBound.length===1)valid=topicBound;
          }
        }
      }
      if(valid.length!==1)return {ok:false,state:'rejected',error:valid.length>1?'Этот номер найден в нескольких базах. Уточните базу заявки.':expectedCustomerId!==undefined?'Заявка не принадлежит клиенту открытой истории.':expectedPhone!==undefined?'Телефон найденной карточки не совпал с номером клиента.':results.find(item=>item.raw.error)?.raw.error || 'Заявка не найдена в CRM.'};
      const {handle,identity,cacheHit,readAt,raw,record}=valid[0],loaded={...raw,verified:true,record};
      // A late background GET cannot replace a newer saved card or a new-form
      // generation. The panel also guards its current context and dirty fields.
      if(refreshBinding && (refreshBinding.identity!==identity || nativeForms.get(identity)!==refreshBinding.entry
        || receipts.get(handle.key)!==refreshBinding.record))return {ok:false,state:'superseded'};
      receipts.set(handle.key,record);receiptReadAt.set(handle.key,now());
      metadata.set(handle.key,{...metadata.get(handle.key),...raw,record});
      rememberNative(handle,{...raw,record},readAt);
      const binding={key:handle.key,at:readAt};preloadedBindings.set(loaded,binding);preloadedBindings.set(record,binding);
      if(cacheHit) {
        const refresh={identity,entry:nativeForms.get(identity),record};
        void getRequest({context,id:recordId,base:record.base,expectedPhone,expectedCustomerId,fresh:true},refresh).then(value=>{
          if(value.verified && typeof onRefresh==='function')try {onRefresh(value);} catch (_) {}
        },()=>{});
      }
      return loaded;
    }

    async function getAudioRecords({context,id:recordId,base}) {
      try {
        if (!id(recordId) || !BASES.includes(base)) return {ok:false,records:[],columns:[],error:'Выберите точную базу и заявку для загрузки аудиозаписей.'};
        const handle=await serviceFor(context,base),record=receipts.get(handle.key);
        if (!record || record.id!==text(recordId) || record.base!==base || !id(record.customerId))
          return {ok:false,records:[],columns:[],error:'Обновите выбранную карточку перед загрузкой аудиозаписей.'};
        return await handle.service.getAudioRecords({base,id:text(recordId),customerId:text(record.customerId)});
      } catch(error) {return {ok:false,records:[],columns:[],error:error.message};}
    }
    async function performAction({context,id:recordId,action,fields={},operationId,expectedRevision}) {
      const base=fields.base || context.base;
      if (!BASES.includes(base)) return {ok:false,state:'rejected',error:'База открытой заявки не определена.'};
      return write('update',{context,id:recordId,draft:{...fields,base},action,operationId,expectedRevision});
    }
    async function openChat({context,base,id:recordId,complaint=false}) {
      if(recordId && complaint){
        const targetBase=base || context.base,handle=await serviceFor(context,targetBase),known=receipts.get(handle.key);
        if(known?.verified===true && known.base===targetBase && text(known.id)===text(recordId))return rpc({type:'CRM_TELEGRAM',command:'openChat',payload:{base:known.base,city:'',complaint:true}});
      }
      if(!recordId) {
        const targetBase=base || context.base, handle=await serviceFor(context,targetBase);
        let meta=metadata.get(handle.key);
        if(!meta){meta=await handle.service.prepare({base:targetBase,phone:''});if(!meta?.ok)return meta;}
        const cities=options(meta.lists?.cities), cityId=text(context.cityId);
        const found=cities.filter(item=>cityId ? item.id===cityId : normalize(item.label)===normalize(context.cityName || context.city));
        if(!complaint && found.length!==1)return {ok:false,error:'Выберите город заявки.'};
        return rpc({type:'CRM_TELEGRAM',command:'openChat',payload:{base:targetBase,city:found[0]?.label || '',complaint:complaint===true}});
      }
      const loaded=await getRequest({context,base:base || context.base,id:recordId});
      if(!loaded.verified) return loaded;
      const record=loaded.record, cityId=record.canonical.cityId;
      const city=options(record.lists?.cities).find(item=>item.id===cityId)?.label || '';
      return rpc({type:'CRM_TELEGRAM',command:'openChat',payload:{base:record.base,city,complaint:complaint===true}});
    }
    async function prepareClaim({context,base,id:recordId}) {
      if(!id(recordId))return {ok:false,state:'rejected',error:'Откройте сохранённую заявку.'};
      const handle=await serviceFor(context,base || context.base);
      return handle.service.prepareClaim({base:base || context.base,id:text(recordId)});
    }
    async function cancellationStep(input, submit) {
      const {context,id:recordId,operationId}=input,base=input.base || context.base;
      if(!id(recordId) || !/^[a-zA-Z0-9_-]{8,160}$/.test(operationId || '') || !submit && !['cancel_kc','cancel_branch','not_taken'].includes(input.action))
        return {ok:false,state:'rejected',writeStarted:false,error:'Откройте заявку и выберите вид отмены.'};
      const handle=await serviceFor(context,base);
      const gate={type:'LP_REQUEST_OPERATION',kind:'update',base,recordId:text(recordId),scope:handle.scope,clientId:clientId(context),operationId};
      if(submit){
        const known=await rpc({...gate,command:'status'});
        if(!known?.ok || !known.operation || known.operation.scope!==handle.scope || known.operation.operationId!==operationId
          || known.operation.clientId && known.operation.clientId!==clientId(context))return {ok:false,state:'rejected',writeStarted:false,error:'Форма отмены принадлежит другому диалогу.'};
        if(known.operation.state==='saved')return finalizeVerified(normalized(known.operation.result),'update',context,handle);
        if(known.operation.state!=='awaiting_reason')return {ok:false,state:'uncertain',id:text(recordId),operationId,error:'Сохранение отмены ещё выполняется.'};
      }else{
        const begun=await rpc({...gate,command:'begin'});
        if(!begun?.ok)return {ok:false,state:begun?.state || 'uncertain',id:text(recordId),operationId:begun?.operation?.operationId || operationId,
          error:begun?.error || 'Заявка уже сохраняется.'};
        if(begun.existing)return begun.operation?.state==='saved' ? finalizeVerified(normalized(begun.operation.result),'update',context,handle) : reconcile({context,base,id:recordId,operationId,kind:'update'});
      }
      let result;
      try{
        const args={base,id:text(recordId),operationId};
        const notTaken=input.action==='not_taken';
        result=normalized(submit
          ? await handle.service[notTaken?'saveNotTakenRequest':'saveCancellation']({...args,reasonId:text(input.reasonId),comment:String(input.comment ?? '')})
          : await handle.service[notTaken?'prepareNotTakenRequest':'prepareCancellation']({...args,action:input.action,expectedRevision:input.expectedRevision || ''}));
        result=boundCancellation(result,base,recordId,operationId);
      }catch(error){result={ok:false,state:'uncertain',id:text(recordId),operationId,writeStarted:true,error:error?.message || 'Не удалось получить результат отмены.'};}
      const finished=await rpc({...gate,command:'finish',result});
      if(!finished?.ok)return {...result,ok:false,verified:false,state:'uncertain',error:finished?.error || 'Не удалось сохранить результат отмены.'};
      if(['saved','awaiting_reason'].includes(finished.operation?.state))result=normalized(finished.operation.result);
      if(finished.cityNotification)result.cityNotification=finished.cityNotification;
      return finalizeVerified(result,'update',context,handle);
    }
    const prepareCancellation=input=>cancellationStep(input,false);
    const saveCancellation=input=>cancellationStep(input,true);
    async function cancelRequest(input) {
      const prepared = await prepareCancellation(input);
      if (prepared?.state !== 'awaiting_reason') return prepared;
      const reason = (prepared.reasons || []).find(item => !item.disabled && text(item.id) && /^сделали\s+сами(?:\s*\/|$)/iu.test(text(item.text || item.label)));
      if (!reason) return {...prepared, ok:false, error:'CRM не вернула причину «Сделали сами». Отмена пока не сохранена.'};
      return saveCancellation({...input, reasonId:text(reason.id), comment:'Отмена с Авито'});
    }
    async function notTakenRequest(input) {
      const args={...input,action:'not_taken'};
      const prepared=await cancellationStep(args,false);
      if(prepared?.state!=='awaiting_reason')return prepared;
      if(prepared.action!=='not_taken')return {...prepared,ok:false,error:'CRM вернула другую операцию смены статуса.'};
      const matching=(prepared.reasons || []).filter(item=>!item.disabled && text(item.id)
        && /^(?:клиент\s+)?не\s+знает\s+когда\s+сможет\s+принять\s+мастера[.!]?$/iu.test(text(item.text || item.label)));
      if(matching.length!==1)return {...prepared,ok:false,error:'CRM не вернула однозначную причину «Клиент не знает когда сможет принять мастера». НФ пока не сохранена.'};
      return cancellationStep({...args,reasonId:text(matching[0].id),comment:'Отмена с Авито'},true);
    }
    async function createClaim({context,base,id:recordId,claimType,comment,operationId}) {
      base=base || context.base;
      if(!id(recordId) || !/^[a-zA-Z0-9_-]{8,160}$/.test(operationId || ''))return {ok:false,state:'rejected',error:'Откройте сохранённую заявку.'};
      const handle=await serviceFor(context,base);
      const gate={type:'LP_REQUEST_OPERATION',kind:'update',base,recordId:text(recordId),scope:handle.scope,clientId:clientId(context),operationId};
      const begin=await rpc({...gate,command:'begin'});
      if(!begin?.ok)return {ok:false,state:begin?.state || 'rejected',operationId:begin?.operation?.operationId || operationId,error:begin?.error || 'Сохранение заявки ещё выполняется.'};
      let result;
      try{result=normalized(await handle.service.saveClaim({base,id:text(recordId),claimType:text(claimType),comment:String(comment ?? ''),operationId}));}
      catch(error){result={ok:false,state:'uncertain',id:text(recordId),operationId,error:error.message};}
      const finished=await rpc({...gate,command:'finish',result});
      if(!finished?.ok)return {...result,ok:false,verified:false,state:'uncertain',error:finished?.error || 'Не удалось записать результат сохранения.'};
      if(finished.operation?.state==='saved')result=finished.operation.result;
      await finalizeVerified(result,'update',context,handle);
      return result;
    }
    async function whereMaster({context,base,id:recordId}) {
      const loaded=await getRequest({context,base:base || context.base,id:recordId});
      if(!loaded.verified)return loaded;
      const record=loaded.record,city=options(record.lists?.cities).find(item=>item.id===record.canonical.cityId)?.label;
      if(!city)return {ok:false,error:'В CRM не определён город заявки.'};
      const deliveryMode=cityDeliveryMode(record),phone=phone10(record.canonical?.phone || record.phone);
      if(deliveryMode && !/^[1-9]\d{9}$/.test(phone))return {ok:false,error:'В сохранённой заявке не указан полный телефон клиента.'};
      const handle=await serviceFor(context,record.base),key='leadPartnerWhereMasterV1:'+handle.scope+':'+record.base+':'+record.id+(deliveryMode?':'+deliveryMode+':'+phone:'');
      if(!storage?.get || !storage?.set)return {ok:false,error:'Не удалось подготовить отправку.'};
      const previous=(await storage.get(key))[key];
      const requestId=previous?.requestId || (config.crypto?.randomUUID ? config.crypto : root.crypto).randomUUID();
      await storage.set({[key]:{requestId,base:record.base,id:record.id,city,...(deliveryMode?{deliveryMode,phone}: {})}});
      const result=await rpc({type:'CRM_TELEGRAM',command:'whereMaster',payload:{base:record.base,city,id:record.id,requestId,...(deliveryMode?{deliveryMode,phone}: {})}});
      if(result?.ok && result.confirmed===true)await storage.set({[key]:null});
      return result;
    }
    async function reconcile({ context, operationId, base, kind, id: recordId, candidateId }) {
      const handle = await serviceFor(context, base || context.base);
      const gateKind = kind === 'update' || kind === 'reschedule' ? 'update' : 'create';
      const gate = { type: 'LP_REQUEST_OPERATION', kind: gateKind, base: base || context.base, scope: handle.scope, clientId:clientId(context), ...(gateKind === 'update' ? {recordId: text(recordId)} : {}) };
      const known = await rpc({ ...gate, command: 'status' });
      if (!known?.ok || known.operation?.operationId !== operationId || known.operation?.scope !== handle.scope || known.operation.clientId && known.operation.clientId !== clientId(context)
          || gateKind === 'create' && known.operation?.state === 'saved' && !known.operation.clientId) return {ok:false,verified:false,state:'uncertain',error:known?.error || 'Не подтверждена принадлежность операции текущему клиенту. Повторная отправка отключена.'};
      let result = normalized(await handle.service.reconcile({ base: base || context.base, operationId, ...(candidateId ? {candidateId: text(candidateId)} : {}) }));
      result=boundCancellation(result,base || context.base,recordId,operationId);
      if (result.code === 'operation_missing' && known.operation.phase === 'preparing') result = {ok:false,state:'rejected',safeToRetry:true,writeStarted:false,code:'write_not_started',error:'Отправка не начиналась. Проверьте форму и сохраните её ещё раз.'};
      const resolved = await rpc({ ...gate, command: 'resolve', operationId, result });
      if (!resolved?.ok) return {...result,ok:false,verified:false,state:'uncertain',error:resolved?.error || 'Не удалось закрепить результат проверки.'};
      if (resolved.operation?.state === 'saved') result = resolved.operation.result;
      if(resolved.cityNotification)result.cityNotification=resolved.cityNotification;
      await finalizeVerified(result, gateKind, context, handle);
      return result;
    }
    async function getPostSaveStatus({context,id:recordId,base}) {
      const handle = await serviceFor(context,base || context.base);
      const result = await rpc({type:'LP_REQUEST_POSTSAVE_STATUS',base:base || context.base,id:text(recordId),scope:handle.scope,clientId:clientId(context)});
      const target = handle.key + '|' + text(recordId), fallback = postSaveHandoffs.get(target);
      if (result?.postSave) { postSaveHandoffs.delete(target); return result; }
      if (fallback) {
        if (fallback.state !== 'pending') postSaveHandoffs.delete(target);
        return {...result,postSave:fallback};
      }
      return result;
    }
    async function setMapKey({ key }) {
      key = text(key);
      if (key.length > 200 || /[\r\n]/.test(key)) throw Error('Некорректный ключ карт.');
      await storage.set({ [MAP_KEY]: key });
      return { ok: true };
    }
    async function routeFromCity({context,destinationLocality,signal}) {
      if(!mapRoute)return {ok:false,state:'unavailable',reason:'Маршрут недоступен'};
      return mapRoute.route({base:context.base,city:context.cityName || context.cityLabel || context.city,cityId:context.cityId,destinationLocality,signal});
    }
    async function resolveBranchCity({context,cities,signal}={}) {
      const base=context?.base,city=text(context?.cityName || context?.cityLabel || context?.city);
      if(!BASES.includes(base)||!city||typeof mapRoute?.resolveBranchCity!=='function')return {ok:false,state:'unavailable',reason:'Город филиала не определён'};
      if(root.LeadPartnerRules.cityAlias(city) && !root.LeadPartnerRules.routeCity(options(cities),city))return {ok:false,state:'unavailable',reason:'configured-branch-unavailable'};
      return mapRoute.resolveBranchCity({base,city,cities:options(cities),signal});
    }
    async function newRequest({context, base, id: recordId}) {
      const handle=await serviceFor(context,base || context.base);
      formGenerations.set(handle.key,(formGenerations.get(handle.key)||0)+1);
      clearScoped(nativeForms,handle.key);clearScoped(nativeReads,handle.key);clearScoped(dependentLists,handle.key);
      receipts.delete(handle.key); metadata.delete(handle.key); receiptReadAt.delete(handle.key);
      freshForms.add(handle.key);
      try { void Promise.resolve(storage?.remove?.(metadataKey(handle))).catch(()=>{}); } catch (_) {}
      return {ok:true,cycleId:root.crypto.randomUUID()};
    }
    async function startCall({context,base,id:recordId}) {
      const loaded=await getRequest({context,base:base || context.base,id:recordId});
      if(!loaded.verified)return loaded;
      const record=loaded.record,url=String(record.callUrl || ''),match=/^(?:callto|tel):([^;?]+)(?:;sip_id=\d+)?$/iu.exec(url);
      if(!match || !record.phones.includes(phone10(match[1])))return {ok:false,error:'В CRM не найдена штатная кнопка звонка для этого телефона.'};
      return {ok:true,url};
    }
    async function resolveAddress({ context, query, signal, cityOnly = false, suggestionsOnly = false, selectedOfficeOnly = false, onAddressResult }) {
      const city = root.LeadChatAddress?.normalizeMapCity(context.cityName || context.city) || text(context.cityName || context.city), search = text(query).slice(0, 400);
      const base = context.base || context.baseId;
      if (!BASES.includes(base)) return {ok:false,error:'Выберите базу для карты.'};
      const links = mapLinks(base,city,search);
      if (!search && !cityOnly) return { ok: true, manual: true, candidates: [], ...links, notice:'Карта выбранной базы. Введите улицу и дом для поиска.' };
      if(mapSearch){
        try{return await mapSearch.search({base,city:context.cityName || context.city,query:search,signal,cityOnly,suggestionsOnly,selectedOfficeOnly,...(typeof onAddressResult==='function'?{onAddressResult}:{})});}
        catch(error){if(signal?.aborted || error?.name==='AbortError')throw error;return {ok:true,provider:'yandex',manual:true,candidates:[],...links,territory:{state:'unknown',label:'Территория не определена'},notice:error?.message || 'Поиск Яндекса временно недоступен.'};}
      }
      const key = text((await storage.get(MAP_KEY))[MAP_KEY]);
      if (!key) {
        const cityId = text(context.cityId);
        if (!/^\d+$/.test(cityId)) return {ok:true,manual:true,candidates:[],...links,notice:'Выберите город из CRM, чтобы получить штатные подсказки адреса.'};
        try {
          const url = new URL('https://' + base + '-lead-centre.ru/api/customer/search-address-street-v2');
          url.searchParams.set('city_id',cityId);url.searchParams.set('term',search);
          const result = await rpc({type:'LP_REQUEST_HTTP',url:url.href,method:'GET'});
          if (!result?.ok || result.bodyReadError || result.status < 200 || result.status >= 300) throw Error(result?.error || 'CRM не вернула подсказки адреса.');
          let payload;try {payload=JSON.parse(result.text);} catch (_) {throw Error('Штатная подсказка адреса CRM вернула неизвестный ответ.');}
          if (!Array.isArray(payload)) throw Error('CRM изменила формат адресных подсказок.');
          const candidates = payload.filter(item=>item && typeof item==='object' && text(item.street) && text(item.house)).slice(0,20).map((item,index)=>({
            id:text(item.fias) || String(index),provider:'crm',city,street:text(item.street),house:text(item.house),apartment:text(item.flat),settlement:text(item.settlement),
            label:text(item.label || item.value) || [city,item.street,item.house].filter(Boolean).join(', ')
          }));
          return {ok:true,provider:'crm',manual:!candidates.length,candidates,...links,notice:candidates.length?'Адресные подсказки из выбранной CRM. Выберите подходящий адрес и проверьте его на своей карте.':'Точный дом в подсказках CRM не найден. Уточните адрес или проверьте его вручную на карте.'};
        } catch(error) {return {ok:true,manual:true,candidates:[],...links,notice:error?.message || 'Подсказки адреса временно недоступны. Проверьте карту вручную.'};}
      }
      const url = new URL('https://geocode-maps.yandex.ru/v1/');
      for (const [name, value] of Object.entries({ apikey: key, format: 'json', lang: 'ru_RU', results: '5', geocode: [city, search].filter(Boolean).join(', ') })) url.searchParams.set(name, value);
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await (config.fetch || root.fetch)(url.href, { signal: controller.signal, credentials: 'omit' });
        if (!response.ok) throw Error('Яндекс не подтвердил адрес. Проверьте ключ карт или выберите адрес вручную.');
        const payload = await response.json(), members = payload?.response?.GeoObjectCollection?.featureMember;
        if (!Array.isArray(members)) throw Error('Яндекс вернул неизвестный формат адреса.');
        const candidates = members.map((entry, index) => {
          const object = entry.GeoObject || {}, meta = object.metaDataProperty?.GeocoderMetaData || {}, components = meta.Address?.Components || [];
          const component = kind => text(components.find(item => item.kind === kind)?.name);
          const parts=root.LeadChatAddress?.geocoderComponents(components,{city}) || {street:component('street'),house:component('house'),city:component('locality')};
          return { id: String(index), label: text(meta.text), ...parts, coordinates: text(object.Point?.pos).split(' ').map(Number),
            precision: meta.precision, exact: ['exact', 'number'].includes(meta.precision) && !!parts.street && !!parts.house };
        }).filter(item => item.exact && (!city || normalize(item.city) === normalize(city).replace(/^г\.?\s+/, '')));
        return { ok: true, provider:'yandex', candidates, ...links, notice: candidates.length ? '' : 'Точный дом не найден. Уточните адрес; ближайший дом автоматически не подставляется.' };
      } finally { clearTimeout(timer); }
    }
    return Object.freeze({ startCall, resolveBase, getMetadata, getCachedMetadata, getDependencies, duplicates, searchPhone: duplicates,
      createRequest: args => write('create', args), updateRequest: args => write('update', args), performAction,openChat,prepareClaim,createClaim,prepareCancellation,saveCancellation,cancelRequest,notTakenRequest,whereMaster,getRequest,getAudioRecords, reconcile, resolveAddress, routeFromCity, resolveBranchCity, setMapKey, newRequest, getPostSaveStatus });
  }
  return Object.freeze({ create, canonicalRecord, sourceMatch, appendLine, mapLinks, cityDeliveryMode });
});
