'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('../tools/benchmark_base_catalog.cjs');

test('one comparison reuses its form and work list without loading irrelevant timetables',async()=>{
  const f=fixture();
  assert.equal(typeof f.service.readWorkCatalog,'function');
  const catalog=await f.service.readWorkCatalog({base:'kp',cityId:'1'});
  assert.equal(catalog.ok,true);assert.equal(catalog.workTypes.length,3);
  const results=await Promise.all([catalog.servicesFor('11'),catalog.servicesFor('12')]);
  assert.deepEqual(results.map(row=>row.services[0].text),['kp-lead-centre.ru / 1 / 11','kp-lead-centre.ru / 1 / 12']);
  assert.equal(f.calls.length,4,'one live form + one work list + two service lists');
  assert.ok(f.calls.every(call=>call.method==='GET'));
  assert.equal(f.calls.some(call=>call.url.includes('city-timetable')),false);
});

test('ordinary dependencies still use a fresh form and city timetable after a comparison',async()=>{
  const f=fixture(),args={base:'kp',cityId:'1'};
  assert.equal(typeof f.service.readWorkCatalog,'function');
  await f.service.readWorkCatalog(args);
  const before=f.calls.length,result=await f.service.dependencies({...args,applianceTypeId:'11'});
  assert.equal(result.ok,true);assert.equal(result.cityNotice,'Расписание');
  assert.equal(f.calls.length-before,4,'standalone form + work + service + timetable');
});

test('comparison sessions isolate base, city and mutable caller selections',async()=>{
  const f=fixture({delay:2}),args={base:'kp',cityId:'1',partnerId:'7'};
  assert.equal(typeof f.service.readWorkCatalog,'function');
  const pending=f.service.readWorkCatalog(args);
  args.base='bt';args.cityId='2';args.partnerId='999';
  const kp=await pending,bt=await f.service.readWorkCatalog({base:'bt',cityId:'2'});
  assert.equal(kp.ok,true);assert.equal(bt.ok,true);
  const results=await Promise.all([kp.servicesFor('11'),bt.servicesFor('12')]);
  assert.equal(results[0].services[0].text,'kp-lead-centre.ru / 1 / 11');
  assert.equal(results[1].services[0].text,'bt-lead-centre.ru / 2 / 12');
  for(const call of f.calls.filter(call=>new URL(call.url).searchParams.has('_get_appltype'))) {
    const url=new URL(call.url);assert.equal(url.searchParams.get('has_partner'),url.hostname.startsWith('kp')?'1':'0');
  }
});

test('a public result cannot alter the private work or service catalogues',async()=>{
  const f=fixture();assert.equal(typeof f.service.readWorkCatalog,'function');
  const catalog=await f.service.readWorkCatalog({base:'kp',cityId:'1'});
  catalog.workTypes[0].disabled=true;catalog.workTypes.push({id:'99',text:'Forged work'});
  const first=await catalog.servicesFor('11');assert.equal(first.ok,true);
  first.services[0].text='Forged service';first.workTypes[0].disabled=true;
  const next=await catalog.servicesFor('11');assert.equal(next.ok,true);
  assert.equal(next.services[0].text,'kp-lead-centre.ru / 1 / 11');
  const before=f.calls.length,forged=await catalog.servicesFor('99');
  assert.equal(forged.ok,false);assert.equal(f.calls.length,before);
});

test('unavailable or invalid work IDs are rejected without reading service endpoints',async()=>{
  const f=fixture();assert.equal(typeof f.service.readWorkCatalog,'function');
  const catalog=await f.service.readWorkCatalog({base:'kp',cityId:'1'}),before=f.calls.length;
  for(const id of ['13','99','','x',null])assert.equal((await catalog.servicesFor(id)).ok,false,String(id));
  assert.equal(f.calls.length,before);
});

test('invalid base, city, or partner cannot open an unrestricted catalogue',async()=>{
  const f=fixture();assert.equal(typeof f.service.readWorkCatalog,'function');
  for(const args of [{base:'other',cityId:'1'},{base:'kp',cityId:'x'},{base:'kp',cityId:''},{base:'kp',cityId:'1',partnerId:'99'}]) {
    const result=await f.service.readWorkCatalog(args);assert.equal(result.ok,false,JSON.stringify(args));
  }
  assert.equal(f.calls.length,1,'only a valid city/base may read the form before checking its partner');
});

test('recognized empty arrays are valid; malformed work payloads do not become an empty successful base',async t=>{
  for(const [body,ok] of [['[]',true],['{"output":[]}',true],['{"output":[],"errors":[]}',true],['{"error":"proxy unavailable"}',false],['malformed',false],['login',false],['http-error',false]])await t.test(body,async()=>{
    const f=fixture({workBody:body});assert.equal(typeof f.service.readWorkCatalog,'function');
    const result=await f.service.readWorkCatalog({base:'kp',cityId:'1'});assert.equal(result.ok,ok);
  });
});

test('login or missing initial form fails before work-list reading',async t=>{
  for(const createBody of ['login','malformed','http-error'])await t.test(createBody,async()=>{
    const f=fixture({createBody});assert.equal(typeof f.service.readWorkCatalog,'function');
    assert.equal((await f.service.readWorkCatalog({base:'kp',cityId:'1'})).ok,false);
    assert.equal(f.calls.length,1);
  });
});

test('malformed or HTTP-failed service results stay failures and recover on a fresh session',async t=>{
  for(const body of ['{"error":"proxy unavailable"}','malformed','login','http-error'])await t.test(body,async()=>{
    let reply=body;const f=fixture({serviceBody:()=>reply});assert.equal(typeof f.service.readWorkCatalog,'function');
    const catalog=await f.service.readWorkCatalog({base:'kp',cityId:'1'});assert.equal(catalog.ok,true);
    assert.equal((await catalog.servicesFor('11')).ok,false);
    reply='[{"id":"101","text":"Услуга после восстановления"}]';
    const fresh=await f.service.readWorkCatalog({base:'kp',cityId:'1'});
    assert.equal((await fresh.servicesFor('11')).services[0].text,'Услуга после восстановления');
  });
});

test('read-only native service depdrop keeps original CSRF and rejects cross-origin or mutation endpoints',async()=>{
  const f=fixture({serviceBody:'[]',dependencies:[
    {url:'https://other.example/admin/domain/sub-list',depdrop:true},
    {url:'/admin/domain/customer-request/update?id=99',depdrop:true},
    {url:'/admin/domain/sub-list',depdrop:true,parentId:'parent-work'}
  ]});
  assert.equal(typeof f.service.readWorkCatalog,'function');
  const catalog=await f.service.readWorkCatalog({base:'kp',cityId:'1'}),result=await catalog.servicesFor('11');
  assert.equal(result.ok,true);assert.equal(result.services[0].text,'Резервная услуга');
  const posts=f.calls.filter(call=>call.method==='POST');assert.equal(posts.length,1);
  assert.equal(posts[0].url,'https://kp-lead-centre.ru/admin/domain/sub-list');
  const body=new URLSearchParams(posts[0].body);
  assert.equal(body.get('_csrf'),'offline-token');assert.equal(body.get('depdrop_parents[0]'),'11');
  assert.equal(body.get('depdrop_all_params[parent-work]'),'11');
});

test('native exact partner number selects its own live work catalogue without an extra request',async()=>{
  const f=fixture({partnerOptions:[{id:'73',text:'Партнёр № 007 — Тест'}]});
  assert.equal(typeof f.service.readWorkCatalog,'function');
  const args={base:'kp',cityId:'1',partnerId:'',partnerNumber:'Партнер 7'};
  const catalog=await f.service.readWorkCatalog(args);
  assert.equal(catalog.ok,true);assert.equal(catalog.partnerId,'73');
  assert.equal(catalog.selection.partnerId,'73');
  assert.equal(catalog.selection.partnerNumber,'Партнер 7');assert.equal(Object.isFrozen(catalog.selection),true);
  assert.equal(f.calls.length,2);
  assert.equal(new URL(f.calls[1].url).searchParams.get('has_partner'),'1');
  await catalog.servicesFor('11');
  assert.equal(new URL(f.calls[2].url).searchParams.get('has_partner'),'1');
});

test('normalized native No. partner labels preserve their exact numeric identity',async()=>{
  const f=fixture({partnerOptions:[{id:'73',text:'Партнер No. 007 — Тест'}]});
  assert.equal(typeof f.service.readWorkCatalog,'function');
  const result=await f.service.readWorkCatalog({base:'kp',cityId:'1',partnerNumber:'7'});
  assert.equal(result.ok,true);assert.equal(result.selection.partnerId,'73');
});

test('missing ambiguous disabled or non-numeric partner hints never silently use the no-partner catalogue',async t=>{
  const cases=[
    ['missing','7',[{id:'8',text:'Партнёр 8'}]],
    ['ambiguous','7',[{id:'71',text:'Партнер 7 A'},{id:'72',text:'7 Б'}]],
    ['disabled','7',[{id:'7',text:'Партнер 7',disabled:true}]],
    ['unparseable','неизвестен',[{id:'7',text:'Партнер 7'}]],
    ['invalid native id','7',[{id:'other',text:'Партнер 7'}]]
  ];
  for(const [name,partnerNumber,partnerOptions] of cases)await t.test(name,async()=>{
    const f=fixture({partnerOptions});assert.equal(typeof f.service.readWorkCatalog,'function');
    const result=await f.service.readWorkCatalog({base:'kp',cityId:'1',partnerNumber});
    assert.equal(result.ok,false);assert.equal(f.calls.length,1,'read form only; do not use a wrong partner filter');
  });
});

test('a conflicting explicit partner ID is rejected instead of overriding its native number',async()=>{
  const f=fixture({partnerOptions:[{id:'71',text:'7 A'},{id:'81',text:'8 Б'}]});
  assert.equal(typeof f.service.readWorkCatalog,'function');
  const result=await f.service.readWorkCatalog({base:'kp',cityId:'1',partnerId:'81',partnerNumber:'7'});
  assert.equal(result.ok,false);assert.equal(f.calls.length,1);
});

test('partly malformed work arrays are unavailable, not evidence that a base has no matching work',async()=>{
  const f=fixture({workBody:'[{"id":"11","text":"Работа Q"},{"error":"missing row"}]'});
  assert.equal(typeof f.service.readWorkCatalog,'function');
  assert.equal((await f.service.readWorkCatalog({base:'kp',cityId:'1'})).ok,false);
});

test('error-bearing placeholder rows and malformed empty groups never prove that a base is absent',async t=>{
  for(const body of [
    '[{"id":"","error":"Synthetic unavailable"}]',
    '[{"children":[],"error":"Synthetic unavailable"}]',
    '[{"text":"Group","children":[{"id":"","error":"Synthetic unavailable"}]}]',
    '[{"children":[]}]',
    '[{"id":""}]'
  ])await t.test(body,async()=>{
    const f=fixture({workBody:body});assert.equal(typeof f.service.readWorkCatalog,'function');
    assert.equal((await f.service.readWorkCatalog({base:'kp',cityId:'1'})).ok,false);
  });
});

test('native empty placeholders and labelled empty groups remain recognized empty catalogues',async t=>{
  for(const body of ['[{"id":"","text":""}]','[{"text":"Group","children":[]}]'])await t.test(body,async()=>{
    const f=fixture({workBody:body});assert.equal(typeof f.service.readWorkCatalog,'function');
    const result=await f.service.readWorkCatalog({base:'kp',cityId:'1'});
    assert.equal(result.ok,true);assert.deepEqual(result.workTypes,[]);
  });
});

test('a comparison snapshot cannot replace the current native preparation',async()=>{
  const f=fixture();assert.equal(typeof f.service.readWorkCatalog,'function');
  const formReads=()=>f.calls.filter(call=>{const url=new URL(call.url);return url.pathname.endsWith('/create')&&!url.search;}).length;
  assert.equal((await f.service.readWorkCatalog({base:'kp',cityId:'1'})).ok,true);
  assert.equal((await f.service.dependencies({base:'kp',cityId:'1',preparedPhone:''})).ok,true);
  assert.equal(formReads(),2,'comparison form must not be found as a prepared write');
  assert.equal((await f.service.prepare({base:'kp',phone:''})).ok,true);assert.equal(formReads(),3);
  assert.equal((await f.service.dependencies({base:'kp',cityId:'1',preparedPhone:''})).ok,true);
  assert.equal(formReads(),3,'ordinary preparation still owns its own form');
});

test('redirected foreign or non-create forms cannot supply a comparison snapshot',async t=>{
  for(const responseUrl of ['https://bt-lead-centre.ru/admin/domain/customer-request/create','https://kp-lead-centre.ru/admin/domain/customer-request/update?id=99'])await t.test(responseUrl,async()=>{
    const f=fixture({responseUrl:()=>responseUrl});assert.equal(typeof f.service.readWorkCatalog,'function');
    assert.equal((await f.service.readWorkCatalog({base:'kp',cityId:'1'})).ok,false);
    assert.equal(f.calls.length,1,'stop before using a form from a different route or base');
  });
});

test('real inert HTML parser distinguishes native catalogues from generic error and unrelated select pages',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lp-catalog-html-'));
  const extension=path.resolve(__dirname,'../extension');
  const script=String.raw`
    (async()=>{
      const initial='<form id="customerRequestForm"><select name="CustomerRequest[city_id]"><option value="1">City</option></select><select name="CustomerRequest[appliance_type_id]"><option value="11">Work Q</option></select><select name="CustomerRequest[subappltype_id]"><option value="101">Service Q</option></select></form>';
      const language='<select name="language"><option value="11">English</option></select>';
      const named='<select name="CustomerRequest[appliance_type_id]"><option value="11">Work Q</option></select>';
      const error='<div class="alert-danger">Synthetic gateway error</div>';
      const cases=[
        {name:'genericErrorPage',work:'<html><head><title>Service unavailable</title></head><body>'+error+language+'</body></html>'},
        {name:'genericLanguagePage',work:'<html><head><title>Service unavailable</title></head><body>'+language+'</body></html>'},
        {name:'unrelatedRawSelect',work:language},
        {name:'unrelatedWrappedSelect',work:'<div>'+language+'</div>'},
        {name:'rawOptionFragment',work:'<option value="11">Work Q</option>'},
        {name:'rawOptgroupFragment',work:'<!-- native --><optgroup label="Group"><option value="11">Work Q</option></optgroup>'},
        {name:'rawNativeSelect',work:named},
        {name:'emptyNativeSelect',work:'<select name="CustomerRequest[appliance_type_id]"></select>'},
        {name:'disabledNativeSelect',work:'<select disabled name="CustomerRequest[appliance_type_id]"><option value="11">Work Q</option></select>'},
        {name:'disabledNativeFormField',work:initial.replace('<select name="CustomerRequest[appliance_type_id]">','<select disabled name="CustomerRequest[appliance_type_id]">')},
        {name:'disabledStandaloneFieldset',work:'<fieldset disabled>'+named+'</fieldset>'},
        {name:'disabledNativeFieldset',work:'<fieldset disabled>'+initial+'</fieldset>'},
        {name:'disabledStandaloneOptgroup',work:'<select disabled name="CustomerRequest[appliance_type_id]"><optgroup label="Group"><option value="11">Work Q</option></optgroup></select>'},
        {name:'disabledFormOptgroup',work:'<form><select disabled name="CustomerRequest[appliance_type_id]"><optgroup label="Group"><option value="11">Work Q</option></optgroup></select></form>'},
        {name:'nativeForm',work:initial},
        {name:'duplicateNativeField',work:initial+named},
        {name:'errorWithNativeField',work:error+initial},
        {name:'initialFormErrors',initial:error+initial},
        {name:'createRedirectStatus',createStatus:302},
        {name:'workRedirectStatus',workStatus:302},
        {name:'serviceRedirectStatus',serviceStatus:302,service:true},
        {name:'serviceErrorPage',serviceBody:'<html><body>'+error+language+'</body></html>',service:true},
        {name:'blankFragment',work:''},
        {name:'commentsOnlyFragment',work:'  <!-- empty response -->  '},
        {name:'optionWithError',work:error+'<option value="11">Work Q</option>'}
      ];
      const rows=[];
      for(const item of cases){
        const service=LeadChatCrmService.create({request:async input=>{
          const url=new URL(input.url),isWork=url.searchParams.has('_get_appltype'),isService=url.searchParams.has('get_subappltypes');
          return {url:input.url,status:isService?(item.serviceStatus||200):isWork?(item.workStatus||200):(item.createStatus||200),
            text:isService?(item.serviceBody===undefined?'[{"id":"101","text":"Service Q"}]':item.serviceBody):isWork?(item.work===undefined?'[{"id":"11","text":"Work Q"}]':item.work):(item.initial===undefined?initial:item.initial)};
        }});
        const catalog=await service.readWorkCatalog({base:'kp',cityId:'1'});
        const result=item.service&&catalog.ok?await catalog.servicesFor('11'):catalog;
        rows.push({name:item.name,ok:result.ok,ids:(result.workTypes||[]).map(row=>row.id)});
      }
      document.getElementById('result').textContent=JSON.stringify({rows});
    })().catch(error=>document.getElementById('result').textContent=JSON.stringify({error:String(error)}));
  `;
  let child,socket,debug='',counter=0;const pending=new Map();
  const server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/'){res.setHeader('Content-Type','text/html');res.end('<script src="/leadchat-crm-html.js"></script><script src="/leadchat-crm-service.js"></script><pre id="result"></pre>');return;}
    if(!['/leadchat-crm-html.js','/leadchat-crm-service.js'].includes(name)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(extension,name.slice(1))));
  });
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++counter,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP deadline '+method));},10000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  t.after(async()=>{
    if(socket?.readyState===WebSocket.OPEN)void send('Browser.close').catch(()=>{});else child?.kill();
    if(child?.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(2000)]);
    if(child?.exitCode===null)child.kill('SIGKILL');socket?.close();
    for(const entry of pending.values())clearTimeout(entry.timer);pending.clear();
    server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(folder,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  child=spawn(process.env.CHROMIUM_PATH||'/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+path.join(folder,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',buffer=>{const match=buffer.toString().match(/DevTools listening on (ws:\/\/\S+)/);if(match)debug=match[1];});
  for(let i=0;i<200&&!debug;i++)await sleep(25);assert.ok(debug,'Chromium available');
  const targets=await(await fetch('http://'+new URL(debug).host+'/json/list')).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data),entry=pending.get(message.id);if(!entry)return;
    pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(message.error.message)):entry.resolve(message.result);
  });
  await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*']});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  let loaded=false;for(let i=0;i<200;i++){if(await evaluate('!!window.LeadChatCrmHtml && !!window.LeadChatCrmService')){loaded=true;break;}await sleep(25);}
  assert.ok(loaded,'real parser and service loaded');
  await evaluate(script);
  const result=JSON.parse(await evaluate('document.getElementById("result").textContent'));
  assert.equal(result.error,undefined,result.error);
    assert.deepEqual(result.rows.map(({name,ok})=>({name,ok})),[
      {name:'genericErrorPage',ok:false},{name:'genericLanguagePage',ok:false},{name:'unrelatedRawSelect',ok:false},{name:'unrelatedWrappedSelect',ok:false},
      {name:'rawOptionFragment',ok:true},{name:'rawOptgroupFragment',ok:true},{name:'rawNativeSelect',ok:true},{name:'emptyNativeSelect',ok:true},
      {name:'disabledNativeSelect',ok:false},{name:'disabledNativeFormField',ok:false},{name:'disabledStandaloneFieldset',ok:false},{name:'disabledNativeFieldset',ok:false},
      {name:'disabledStandaloneOptgroup',ok:false},{name:'disabledFormOptgroup',ok:false},{name:'nativeForm',ok:true},
      {name:'duplicateNativeField',ok:false},{name:'errorWithNativeField',ok:false},{name:'initialFormErrors',ok:false},{name:'createRedirectStatus',ok:false},{name:'workRedirectStatus',ok:false},
      {name:'serviceRedirectStatus',ok:false},{name:'serviceErrorPage',ok:false},{name:'blankFragment',ok:false},{name:'commentsOnlyFragment',ok:false},{name:'optionWithError',ok:false}
    ]);
    assert.deepEqual(result.rows.find(row=>row.name==='rawNativeSelect').ids,['11']);
    assert.deepEqual(result.rows.find(row=>row.name==='emptyNativeSelect').ids,[]);
});
