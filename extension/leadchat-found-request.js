/* Existing-request name updates: fresh same-base phone proof, then durable name reconciliation. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else {root.LeadChatFoundRequest=api;api.install();}})(globalThis,function(root){
  'use strict';
  const BASES=['kp','mnc','bt'],identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value),requestId=value=>typeof value==='string'&&/^[1-9]\d{0,11}$/.test(value);
  const hosts=['188-225-34-82.sslip.io','72-56-68-159.sslip.io','chat.partner-lead-centre.ru'];
  function phone(value){if(typeof value!=='string'||!/^\+?[\d\s()-]+$/.test(value))return '';let digits=value.replace(/\D/g,'');if(/^[78]\d{10}$/.test(digits))digits=digits.slice(1);return /^\d{10}$/.test(digits)?digits:'';}
  function validate(input){
    const context=input?.context;
    if(!BASES.includes(input?.base)||!requestId(input?.id)||typeof input?.scope!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(input.scope)||!phone(input?.phone)||!context||!['operatorId','accountId','clientId','conversationId'].every(key=>identifier(context[key])))throw Error('Нет подтверждённого контекста найденной заявки.');
    let route;try{route=new URL(context.conversationUrl);}catch(_){throw Error('Не подтверждён диалог LeadChat.');}
    if(!['http:','https:'].includes(route.protocol)||!hosts.includes(route.hostname)||route.username||route.password||route.port||route.search||route.hash||route.pathname!=='/chats/'+context.conversationId)throw Error('Не подтверждён диалог LeadChat.');
    return {...input,phone:phone(input.phone),clientId:context.clientId};
  }
  function create({readVerifiedRecord,postSave}){
    return Object.freeze({
      async append(value){try{
        const input=validate(value),proof=await readVerifiedRecord(input);
        if(proof?.ok!==true||proof.verified!==true||proof.unique!==true||proof.base!==input.base||String(proof.id)!==input.id||phone(proof.phone)!==input.phone)throw Error(proof?.error||'В выбранной базе нет одной подтверждённой заявки с этим телефоном.');
        return await postSave.enqueue(input);
      }catch(error){return {ok:false,error:error?.message||'Номер найденной заявки к имени не добавлен.'};}},
      async status(value){try{return await postSave.status(validate(value));}catch(error){return {ok:false,error:error?.message||'Не удалось проверить обновление имени.'};}}
    });
  }
  function install(){
    if(!root.chrome?.runtime?.onMessage||!root.chrome?.storage?.local||root.__LP_FOUND_REQUEST_INSTALLED__)return;
    root.__LP_FOUND_REQUEST_INSTALLED__=true;
    const chrome=root.chrome;
    async function tabFor(input){const tabId=input.sender?.tab?.id;if(!Number.isInteger(tabId))throw Error('Вкладка LeadChat не подтверждена.');const tab=await chrome.tabs.get(tabId);let route,expected;try{route=new URL(tab.url);expected=new URL(input.context.conversationUrl);}catch(_){throw Error('Диалог LeadChat изменился.');}if(route.origin!==expected.origin||route.username||route.password||route.port||route.pathname.replace(/\/$/u,'')!==expected.pathname)throw Error('Диалог LeadChat изменился.');return tabId;}
    async function nativeContext(input){
      const tabId=await tabFor(input),result=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:async()=>{
        const adapter=globalThis.LeadChatRequestContext?.createAdapter();if(!adapter)return null;
        try{const value=await adapter.read();return {ok:value?.ok===true,conversationId:value?.conversationId,clientId:value?.client?.id,operatorId:value?.scope?.operatorId,accountId:value?.scope?.accountId,phone:value?.client?.phone,incomingPhone:value?.proposals?.phone,phoneConflict:value?.client?.phoneConflict===true||value?.proposals?.ambiguous?.phone===true,base:value?.base,baseCandidates:value?.baseCandidates||[]};}finally{adapter.destroy();}
      }});
      const value=result?.[0]?.result,context=input.context;
      if(value?.ok!==true||value.phoneConflict||phone(value.phone)!==input.phone||phone(value.incomingPhone)!==input.phone||value.conversationId!==context.conversationId||value.clientId!==context.clientId||value.operatorId!==context.operatorId||value.accountId!==context.accountId||value.base&&value.base!==input.base||value.baseCandidates?.length&&!value.baseCandidates.includes(input.base))throw Error('Клиент, входящий телефон или выбранная база диалога изменились.');
      return tabId;
    }
    async function serviceFor(input,tabId){
      await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',files:['leadchat-crm-html.js']});
      return root.LeadChatCrmService.create({scope:'found:'+input.scope,parseDocument:async(html,url)=>{
        await tabFor(input);
        const result=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:(body,href)=>globalThis.LeadChatCrmHtml.parse(body,href),args:[html,url]});
        if(!result?.[0]?.result)throw Error('CRM не прочиталась.');return result[0].result;
      },request:async init=>{
        const target=new URL(init.url),origin='https://'+input.base+'-lead-centre.ru';
        if(init.method!=='GET'||target.origin!==origin||target.username||target.password||target.port||!(target.pathname.startsWith('/admin/domain/')||target.pathname==='/api/customer/search'))throw Error('Для найденной заявки разрешено только чтение выбранной базы.');
        const response=await fetch(target.href,{method:'GET',credentials:'include',cache:'no-store',redirect:'follow',headers:init.headers,signal:init.signal}),final=new URL(response.url||target.href);
        if(!response.ok||final.origin!==origin||final.username||final.password||final.port||!(final.pathname.startsWith('/admin/domain/')||final.pathname==='/api/customer/search'))throw Error('Войдите в выбранную CRM и повторите проверку.');
        const text=await response.text();if(text.length>5000000)throw Error('Ответ CRM слишком большой.');return {status:response.status,url:final.href,headers:response.headers,text};
      }});
    }
    async function readVerifiedRecord(input){
      const tabId=await nativeContext(input),service=await serviceFor(input,tabId),lookup=await service.search({base:input.base,phone:input.phone});
      if(lookup?.ok!==true||lookup.base!==input.base||phone(lookup.phone)!==input.phone||lookup.incomplete!==false||lookup.matches?.length!==1||lookup.matches[0].base!==input.base||String(lookup.matches[0].id)!==input.id)throw Error('В выбранной базе не подтверждена одна заявка с этим телефоном.');
      const read=await service.readRequest({base:input.base,id:input.id}),record=read?.record;
      const phones=Object.entries(record?.form?.values||{}).filter(([name])=>/^Customer\[phone(?:_extra_[1-3])?\]$|^Customer\[contact_phones\]\[[^\]]+\]\[v\]$/.test(name)).map(([,value])=>phone(value)).filter(Boolean);
      if(read?.ok!==true||record?.base!==input.base||String(record?.id)!==input.id||!String(record.status||'').trim()||!phones.includes(input.phone))throw Error('Карточка найденной заявки не подтвердила телефон и статус.');
      await nativeContext(input);
      return {ok:true,verified:true,unique:true,base:input.base,id:input.id,phone:input.phone};
    }
    const foundKey=key=>key.replace(/^leadPartnerRequestPostSaveV1:/u,'leadPartnerFoundRequestNameV1:');
    const storage={get:async key=>{
      const localKey=foundKey(key),value=(await chrome.storage.local.get(localKey))[localKey];
      if(value)return {[key]:value};
      const legacy=(await chrome.storage.local.get(key))[key];
      // A created-request PUT may already have an unknown result. Inherit its
      // proof for verification only without changing its monitor/delivery log.
      return {[key]:legacy?.nameAttemptStarted?{...legacy,state:'attention',name:{...legacy.name,...(legacy.state==='pending'?{unknown:true}:{})}}:undefined};
    },set:async data=>chrome.storage.local.set(Object.fromEntries(Object.entries(data).map(([key,value])=>[foundKey(key),value])))};
    const postSave=root.LeadChatRequestGate.createPostSave({storage,notify:async()=>({ok:true}),runName:(input,verifyOnly)=>root.LeadChatRequestName.withClientLock(input.context.accountId+':'+input.context.clientId,async()=>{
      const tabId=await nativeContext(input),context=input.context,expected={operatorId:context.operatorId,accountId:context.accountId,clientId:context.clientId,conversationId:context.conversationId,requestId:input.id};
      const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:root.LeadChatRequestName.appendVerifiedCreatedId,args:[{expected,requestId:input.id,conversationUrl:context.conversationUrl,verifyOnly}]});
      return result?.[0]?.result||{ok:false,unknown:true,error:'LeadChat не подтвердил изменение имени.'};
    })});
    const flow=create({readVerifiedRecord,postSave});
    chrome.runtime.onMessage.addListener((message,sender,reply)=>{
      if(message?.type!=='LP_REQUEST_FOUND')return;
      let own=false;try{const url=new URL(sender?.url),panel=new URL(chrome.runtime.getURL('leadchat-request-panel.html'));own=sender.id===chrome.runtime.id&&url.protocol==='chrome-extension:'&&url.hostname===panel.hostname&&url.pathname===panel.pathname;}catch(_){}
      if(!own||!['append','status'].includes(message.command)){reply({ok:false,error:'Действие доступно только в карточке заявки.'});return;}
      const context=message.context||{},input={base:message.base,id:String(message.id||''),phone:message.phone,scope:message.scope,context:{operatorId:context.operatorId,accountId:context.accountId,clientId:context.clientId,conversationId:context.conversationId,conversationUrl:context.conversationUrl},sender};
      flow[message.command](input).then(reply,error=>reply({ok:false,error:error?.message||'Номер найденной заявки к имени не добавлен.'}));return true;
    });
  }
  return Object.freeze({create,install});
});
