/* Bounded operation diagnostics. Arguments, customer data and server bodies are never recorded. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.LeadChatPanelTools=api;})(globalThis,function(root){
 'use strict';
 const records=[],wrappedControllers=new WeakMap(),bindings=new WeakMap();
 const operations=['getMetadata','getRequest','dependencies','duplicates','resolveAddress','routeFromCity','createRequest','updateRequest','performAction','newRequest','getAudioRecords'];
 const states=new Set(['verified','confirmed','committed','saved','saved_primary','rejected','uncertain','unavailable','superseded','pending','ready','failed','known']);
 const clock=()=>root.performance?.now?.() ?? Date.now();
 function instrument(controller){
  if(!controller||typeof controller!=='object')return controller;
  if(wrappedControllers.has(controller))return wrappedControllers.get(controller);
  const copy=Object.create(controller);
  for(const operation of operations)if(typeof controller[operation]==='function')Object.defineProperty(copy,operation,{value:function(...args){
   const started=clock(),candidate=args[0]?.base || args[0]?.context?.base,base=['kp','mnc','bt'].includes(candidate)?candidate:'auto';
   const finish=result=>{records.push({operation,base,durationMs:Math.max(0,Math.round(clock()-started)),result});if(records.length>60)records.splice(0,records.length-60);};
   try{
    const result=controller[operation].apply(controller,args);
    if(result&&typeof result.then==='function')return result.then(value=>{finish(states.has(value?.state)?value.state:value?.ok===false?'failed':'ok');return value;},error=>{finish('exception');throw error;});
    finish(result?.ok===false?'failed':'ok');return result;
   }catch(error){finish('exception');throw error;}
  }});
  wrappedControllers.set(controller,copy);wrappedControllers.set(copy,copy);return copy;
 }
 function snapshot(){return records.map(row=>({...row}));}
 function report(){
  let version='';try{version=String(root.chrome?.runtime?.getManifest?.().version || '');}catch(_){}
  return JSON.stringify({extensionVersion:version,createdAt:new Date().toISOString(),operations:snapshot()},null,2);
 }
 function attach(instance,doc=root.document){
  if(!doc||!instance||bindings.has(doc))return;
  const dialog=doc.getElementById('panel-tools-dialog'),form=doc.getElementById('panel-tools-form'),input=doc.getElementById('panel-tools-id'),status=doc.getElementById('panel-tools-status'),button=doc.getElementById('panel-tools-search'),link=doc.getElementById('panel-tools-crm');
  if(!dialog||!form||!input||!status||!button||!link)return;
  const controller=new AbortController();let searchAbort=null,sequence=0;
  const close=()=>{searchAbort?.abort();++sequence;button.disabled=false;if(dialog.open)dialog.close();};
  const open=event=>{if(!event.isTrusted)return;status.textContent='';link.hidden=true;if(!dialog.open)dialog.showModal();input.focus();input.select();};
  for(const trigger of doc.querySelectorAll('[data-panel-tool="find"]'))trigger.addEventListener('click',open,{signal:controller.signal});
  doc.getElementById('panel-tools-close')?.addEventListener('click',close,{signal:controller.signal});
  dialog.addEventListener('cancel',()=>{searchAbort?.abort();++sequence;button.disabled=false;},{signal:controller.signal});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();},{signal:controller.signal});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(!event.isTrusted||button.disabled)return;
   const id=input.value.trim();if(!/^[1-9]\d{0,19}$/.test(id)){status.textContent='Введите номер заявки цифрами.';return;}
   if(typeof instance.findRequestById!=='function'){status.textContent='Поиск пока недоступен. Обновите панель.';return;}
   searchAbort?.abort();searchAbort=new AbortController();const signal=searchAbort.signal,revision=++sequence;
   button.disabled=true;status.textContent='Ищем в КП, МНЧ и БТ…';link.hidden=true;
   try{
    const result=await instance.findRequestById(id,{signal});
    if(signal.aborted||revision!==sequence)return;
    if(result?.ok){close();return;}
    status.textContent=String(result?.error || 'Заявка не найдена.');
    if(result?.url)try{const url=new URL(result.url);if(['https://kp-lead-centre.ru','https://mnc-lead-centre.ru','https://bt-lead-centre.ru'].includes(url.origin)&&/^\/admin\/domain\/customer-request\/(?:update|view)$/.test(url.pathname)&&url.searchParams.get('id')===id&&!url.username&&!url.password){link.href=url.href;link.hidden=false;}}catch(_){}
   }catch(_){if(!signal.aborted&&revision===sequence)status.textContent='Не удалось прочитать заявку. Повторите поиск.';}
   finally{if(revision===sequence)button.disabled=false;}
  },{signal:controller.signal});
  doc.getElementById('panel-tools-copy')?.addEventListener('click',async event=>{
   if(!event.isTrusted)return;
   try{await root.navigator.clipboard.writeText(report());status.textContent='Диагностика скопирована.';}
   catch(_){
    const area=doc.createElement('textarea');area.value=report();area.readOnly=true;area.style.cssText='position:fixed;left:-10000px;top:0';dialog.append(area);
    try{area.select();if(!doc.execCommand('copy'))throw Error();status.textContent='Диагностика скопирована.';}catch(_){status.textContent='Не удалось скопировать диагностику.';}finally{area.remove();}
   }
  },{signal:controller.signal});
  const destroy=()=>{searchAbort?.abort();controller.abort();bindings.delete(doc);};bindings.set(doc,destroy);root.addEventListener?.('pagehide',destroy,{once:true});
 }
 return Object.freeze({instrument,attach,snapshot,report,clear(){records.length=0;}});
});
