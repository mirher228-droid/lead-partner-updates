(() => {
  'use strict';
  const status=document.getElementById('shared-source-status'),form=document.getElementById('shared-source-config'),input=document.getElementById('shared-source-url'),save=document.getElementById('shared-source-save'),refresh=document.getElementById('shared-source-refresh');
  let configured=false,busy=false;
  async function render(){await LeadPartnerSourceCatalog.ready();const sources=LeadPartnerSourceCatalog.entries;document.getElementById('source-count').textContent=String(sources.length);const list=document.getElementById('source-list');list.replaceChildren();for(const source of sources){const item=document.createElement('li'),link=document.createElement('a'),url=document.createElement('small');link.textContent=source.code;link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';url.textContent=source.url;item.append(link,url);list.append(item);}}
  function controls(){input.disabled=busy;save.disabled=busy;refresh.disabled=busy||!configured;form.setAttribute('aria-busy',String(busy));}
  function paint(result,loadUrl=false){
    if(typeof result?.configured==='boolean')configured=result.configured;
    if(loadUrl&&result?.url)input.value=result.url;
    if(!result?.ok){status.dataset.state='error';status.textContent=result?.error||result?.status?.error||'Проверка не выполнена. Используется последний исправный или встроенный каталог.';}
    else if(!configured){status.dataset.state='unconfigured';status.textContent='Общий каталог не подключён. Встроенные источники доступны.';}
    else if(result.status?.ok){status.dataset.state='ready';status.textContent='Каталог проверен · версия '+result.status.revision+' · '+new Date(result.status.checkedAt).toLocaleString('ru-RU');}
    else{status.dataset.state=result.status?'error':'unverified';status.textContent=result.status?.error||'Ссылка сохранена. Каталог ещё не проверен.';}
    controls();
  }
  async function run(command,url){
    if(busy)return;busy=true;controls();status.dataset.state='pending';status.textContent='Проверяем общий каталог…';
    try{const result=await chrome.runtime.sendMessage({type:'LP_SHARED_SOURCES',command,...(url===undefined?{}:{url})});paint(result);await render();}
    catch(_){paint({ok:false,error:'Не удалось проверить каталог. Используется последний исправный или встроенный каталог.'});}
    finally{busy=false;controls();}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void run('configure',input.value.trim());});refresh.addEventListener('click',()=>void run('sync'));
  void render();LeadPartnerSourceCatalog.subscribe(()=>void render());
  if(globalThis.chrome?.runtime?.sendMessage){busy=true;controls();void chrome.runtime.sendMessage({type:'LP_SHARED_SOURCES',command:'status'}).then(result=>paint(result,true)).catch(()=>paint({ok:false,error:'Настройка каталога временно недоступна. Встроенные источники доступны.'})).finally(()=>{busy=false;controls();});}
  else paint({ok:false,error:'Настройка каталога недоступна.'});
})();
