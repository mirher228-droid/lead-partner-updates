/* Shared catalogue only. No CRM records, chats or phones are sent to Google. */
(() => {
  'use strict';
  const KEY='leadPartnerSharedCatalogV1',CONFIG='leadPartnerSharedConfigV1',STATE='leadPartnerSharedStatusV1',ALARM='leadPartnerSharedSourcesV1',PERIOD=3*60000,RETRY=60000;
  let running,commands=Promise.resolve();
  function endpoint(value){const url=new URL(String(value));if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/u.test(url.pathname)||url.username||url.password||url.search||url.hash)throw Error('Нужна ссылка опубликованного Google Apps Script, заканчивающаяся на /exec, без параметров.');return url.href;}
  async function configuration(){const stored=(await chrome.storage.local.get(CONFIG))[CONFIG];if(stored?.url)return {url:endpoint(stored.url)};const response=await fetch(chrome.runtime.getURL('sources-config.json'));const config=await response.json();return config?.url?{url:endpoint(config.url)}:{url:''};}
  function result(config,status,ok){return {ok,configured:!!config?.url,url:config?.url||'',status:status||null,count:LeadPartnerSourceCatalog.entries.length,revision:LeadPartnerSourceCatalog.revision,...(!ok&&status?.error?{error:status.error}:{})};}
  function serviceError(value){
    if(typeof value!=='string')return '';
    const text=value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/gu,' ').replace(/\s+/gu,' ').trim();
    if(!text||text.length>240||/[<>\\/?#&=@]|(?:https?:|www\.)|[a-z\d][a-z\d.-]*\.[a-z]{2,}|(?:token|secret|password|credential|cookie|session|bearer|authorization|api.?key|токен|парол|секрет|куки|ключ)|[A-Za-z0-9_-]{24,}/iu.test(text))return '';
    return 'Сервис каталога: '+text;
  }
  function successTime(previous,catalog){return [previous?.lastSuccessAt,previous?.ok?previous.checkedAt:0,catalog?.receivedAt].find(value=>Number.isFinite(value)&&value>0)||0;}
  async function failedStatus(config,error){
    const stored=await chrome.storage.local.get([STATE,KEY]),url=config?.url||stored[STATE]?.endpoint||'';
    const previous=stored[STATE]?.endpoint===url?stored[STATE]:null,catalog=stored[KEY]?.endpoint===url?stored[KEY]:null;
    return {...previous,ok:false,endpoint:url,checkedAt:Date.now(),nextAutomaticAt:Date.now()+RETRY,lastSuccessAt:successTime(previous,catalog),error};
  }
  async function sync(automatic=false){
    if(running)return running;
    running=(async()=>{
      let config;
      try{config=await configuration();}catch(_){const status=await failedStatus(null,'Не удалось прочитать настройку общего каталога.');await chrome.storage.local.set({[STATE]:status});return result(null,status,false);}
      if(!config.url)return result(config,null,false);
      const stored=await chrome.storage.local.get([STATE,KEY]),previousStatus=stored[STATE],startedAt=Date.now();
      const due=Number.isFinite(previousStatus?.nextAutomaticAt)?previousStatus.nextAutomaticAt:previousStatus?.checkedAt+(previousStatus?.ok?PERIOD:RETRY);
      if(automatic&&previousStatus?.endpoint===config.url&&Number.isFinite(due)&&due>startedAt&&due<=startedAt+PERIOD)return result(config,previousStatus,previousStatus.ok===true);
      // A restarted worker must not duplicate a slow GET. Keep verified data intact.
      const previousHere=previousStatus?.endpoint===config.url?previousStatus:null,catalogHere=stored[KEY]?.endpoint===config.url?stored[KEY]:null;
      await chrome.storage.local.set({[STATE]:{...previousHere,ok:false,endpoint:config.url,checkedAt:startedAt,nextAutomaticAt:startedAt+RETRY,lastSuccessAt:successTime(previousHere,catalogHere),error:'Проверяем общий каталог. Используется последний исправный или встроенный каталог.'}});
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
      try{
        const response=await fetch(config.url,{method:'GET',credentials:'omit',redirect:'follow',cache:'no-store',signal:controller.signal});const final=new URL(response.url||config.url);
        if(!response.ok||final.protocol!=='https:'||final.username||final.password||final.port||!['script.google.com','script.googleusercontent.com'].includes(final.hostname))throw Error('Общий каталог временно недоступен.');
        const body=await response.text();if(body.length>2000000)throw Error('Ответ каталога слишком большой.');let data;try{data=JSON.parse(body);}catch(_){throw Error('Сервис не вернул каталог JSON.');}
        if(data?.ok===false)throw Error(serviceError(data.error)||'Сервис каталога сообщил об ошибке.');
        if(data?.ok!==true||data.schema!==1||!Number.isSafeInteger(data.revision)||data.revision<1)throw Error('Неподтверждённая версия общего каталога.');
        if(data.stale===true)throw Error('Сервис каталога вернул резервную копию. Используется последний исправный или встроенный каталог.');
        const entries=LeadPartnerSourceCatalog.validate(data.entries),previous=(await chrome.storage.local.get(KEY))[KEY];
        if(previous?.endpoint===config.url&&data.revision<previous.revision)throw Error('Получена устаревшая версия каталога. Предыдущая версия сохранена.');
        if(previous?.endpoint===config.url&&previous?.entries?.length>6&&entries.length<previous.entries.length/2)throw Error('Каталог резко уменьшился. Предыдущая версия сохранена.');
        const changed=JSON.stringify(entries)!==JSON.stringify(previous?.entries);
        // A fresh validated endpoint response remains authoritative when its revision is reused.
        const checkedAt=Date.now(),status={ok:true,endpoint:config.url,checkedAt,nextAutomaticAt:checkedAt+PERIOD,lastSuccessAt:checkedAt,updatedAt:data.updatedAt||'',revision:data.revision,count:entries.length};
        if(changed||previous?.revision!==data.revision||previous?.endpoint!==config.url){await chrome.storage.local.set({[KEY]:{entries,revision:data.revision,endpoint:config.url,updatedAt:data.updatedAt||'',receivedAt:Date.now()},...(changed?{partnerLinksCache:entries}:{}),[STATE]:status});LeadPartnerSourceCatalog.setEntries(entries,data.revision);}
        else await chrome.storage.local.set({[STATE]:status});
        return result(config,status,true);
      }catch(error){
        const status=await failedStatus(config,'Обновление не выполнено. Используется последний исправный или встроенный каталог.');
        if(/^(?:Общий каталог|Ответ каталога|Сервис не вернул|Сервис каталога|Неподтверждённая версия|Получена устаревшая|Каталог резко|Содержимое изменилось|Некорректн|Противоречив|ID источника)/u.test(error?.message||''))status.error=error.message;
        await chrome.storage.local.set({[STATE]:status});return result(config,status,false);
      }finally{clearTimeout(timer);}
    })().finally(()=>{running=null});
    return running;
  }
  async function status(){const config=await configuration(),stored=await chrome.storage.local.get([STATE,KEY]),current=stored[STATE],catalog=stored[KEY]?.endpoint===config.url?stored[KEY]:null;return result(config,current?.endpoint===config.url?{...current,lastSuccessAt:successTime(current,catalog)}:null,true);}
  function serial(task){const pending=commands.catch(()=>{}).then(task);commands=pending;return pending;}
  async function configure(value){let url;try{url=endpoint(value);}catch(_){const current=await status();return {...current,ok:false,error:'Укажите опубликованную ссылку https://script.google.com/macros/s/…/exec без параметров.'};}
    if(running)await running;
    await chrome.storage.local.set({[CONFIG]:{url},[STATE]:{ok:false,endpoint:url,checkedAt:Date.now(),error:'Ссылка сохранена. Каталог ещё не проверен.'}});
    return sync();
  }
  function start(){void LeadPartnerSourceCatalog.ready().then(()=>serial(async()=>{const alarm=await chrome.alarms.get(ALARM);if(alarm?.periodInMinutes!==3)await chrome.alarms.create(ALARM,{periodInMinutes:3});return sync(true);})).catch(()=>{});}
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM)void serial(()=>sync(true)).catch(()=>{})});chrome.runtime.onStartup.addListener(start);chrome.runtime.onInstalled.addListener(start);
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.type!=='LP_SHARED_SOURCES')return;
    const own=sender?.id===chrome.runtime.id&&['popup.html','leadpartner-owner-setup.html'].some(name=>sender.url===chrome.runtime.getURL(name));
    if(!own||!['status','configure','sync'].includes(message.command)){reply({ok:false,error:'Команда недоступна для этой страницы.'});return;}
    const task=message.command==='status'?status():serial(()=>message.command==='configure'?configure(message.url):sync());
    task.then(reply).catch(()=>reply({ok:false,error:'Не удалось обновить общий каталог. Предыдущая версия сохранена.'}));return true;
  });
  start();
})();
