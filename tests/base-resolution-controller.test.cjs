'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {create}=require('../extension/leadchat-request-controller.js');
globalThis.LeadPartnerRules=require('../extension/leadpartner-rules.js');
globalThis.LeadPartnerSourceCatalog={revision:'sources-1'};
function fixture({failedBase='',incompleteBase='',ambiguous=false,delay=0,maxCachedScopes,pause,lightweight=false,wholeTitleBase='',partnerSensitive=false,noMatchBase='',workCounts={}}={}){
 let clock=0;const calls=[],services=[];let firstCall;const started=new Promise(resolve=>firstCall=resolve);
 const cities={kp:[{id:'11',label:'Тестовый'}],bt:[{id:'22',label:'Тестовый'}]};
 globalThis.LeadChatCrmCityCatalog={forBase:base=>cities[base] || []};
 const load=async args=>{
  calls.push({...args});firstCall();if(pause)await pause;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  if(args.base===failedBase)return {ok:false,error:'Offline'};
  return {ok:true,...(args.base===incompleteBase?{incomplete:true}:{}),workTypes:Array.from({length:workCounts[args.base] || 1},(_,i)=>({id:args.base+'work'+(i || ''),label:args.base===noMatchBase?'Несовпадающая работа':args.base===wholeTitleBase?'Работа Q / Подуслуга Q':'Работа Q'})),services:args.applianceTypeId?[{id:'service',label:args.base===(partnerSensitive && args.partnerNumber!=='1'?'bt':'kp') || ambiguous?'Подуслуга Q':'Другая услуга'}]:[]};
 };
 const serviceModule={create:config=>{services.push(config.scope);return lightweight?{dependencies:()=>{throw Error('Unexpected full dependency path');},readWorkCatalog:async args=>partnerSensitive && args.partnerNumber===''?{ok:false,error:'Partner not verified'}:({...await load(args),servicesFor:workId=>load({...args,applianceTypeId:workId})})}:{dependencies:load};}};
 const controller=create({serviceModule,crypto:webcrypto,now:()=>clock,maxCachedScopes,rpc:async()=>({ok:true,operation:null})});
 const context={operatorId:'operator',accountId:'account',conversationId:'conversation',conversationUrl:'https://chat.partner-lead-centre.ru/chats/conversation',client:{id:'client'},base:'kp',cityName:'Тестовый',sourceCode:'SRC',partnerNumber:'1'};
 const input={context,baseCandidates:['kp','bt'],workTitle:'Работа Q / Подуслуга Q'};
 return{controller,calls,services,input,cities,started,tick:ms=>clock+=ms,setFailed:value=>failedBase=value,setIncomplete:value=>incompleteBase=value};
}
test('identical concurrent base comparisons share one read-only fallback probe',async()=>{
 const f=fixture({delay:5});const results=await Promise.all([f.controller.resolveBase(f.input),f.controller.resolveBase(f.input)]);
 assert.equal(results[0].base,'kp');assert.equal(results[1].base,'kp');assert.equal(f.calls.length,4,'two initial work lists plus two service lists');
});
test('completed comparison is reused briefly then revalidated after TTL',async()=>{
 const f=fixture();await f.controller.resolveBase(f.input);await f.controller.resolveBase(f.input);assert.equal(f.calls.length,4);
 f.tick(10001);await f.controller.resolveBase(f.input);assert.equal(f.calls.length,8);
});
test('partial outage remains manual and is not cached across recovery',async()=>{
 const f=fixture({failedBase:'bt'});const down=await f.controller.resolveBase(f.input);assert.equal(down.base,'');assert(down.checks.some(row=>!row.ok));
 const before=f.calls.length;f.setFailed('');const up=await f.controller.resolveBase(f.input);assert.equal(up.base,'kp');assert(f.calls.length>before);
});
test('equal scores remain manual even on a warm comparison',async()=>{
 const f=fixture({ambiguous:true});const first=await f.controller.resolveBase(f.input),warm=await f.controller.resolveBase(f.input);
 assert.equal(first.base,'');assert.equal(warm.base,'');assert.equal(f.calls.length,4);
});
test('changed operator/account/client/source/catalog/title/candidates cannot reuse prior comparison',async()=>{
 const f=fixture();await f.controller.resolveBase(f.input);
 const variants=[{context:{...f.input.context,operatorId:'other-operator'}},{context:{...f.input.context,accountId:'other-account'}},{context:{...f.input.context,client:{id:'other-client'}}},{context:{...f.input.context,sourceCode:'OTHER'}},{context:{...f.input.context,partnerNumber:'2'}},{workTitle:'Работа Q / Другая услуга'},{baseCandidates:['kp','bt','mnc']}];
 for(const variant of variants){const before=f.calls.length;await f.controller.resolveBase({...f.input,...variant});assert(f.calls.length>before,JSON.stringify(variant));}
 const sourceBefore=f.calls.length;globalThis.LeadPartnerSourceCatalog.revision='sources-2';await f.controller.resolveBase(f.input);assert(f.calls.length>sourceBefore);
 const cityBefore=f.calls.length;f.cities.bt.push({id:'23',label:'Другой город'});await f.controller.resolveBase(f.input);assert(f.calls.length>cityBefore);
});
test('LRU eviction removes completed comparison so cold revisit reads again',async()=>{
 const f=fixture({maxCachedScopes:2});await f.controller.resolveBase(f.input);
 for(let i=1;i<4;i++){const context={...f.input.context,conversationId:'conversation'+i,conversationUrl:'https://chat.partner-lead-centre.ru/chats/conversation'+i};await f.controller.resolveBase({...f.input,context});}
 const before=f.calls.length;await f.controller.resolveBase(f.input);assert.equal(f.calls.length,before+4);
});

test('lightweight work catalog path uses captured servicesFor without full dependencies',async()=>{
 const f=fixture({lightweight:true});const result=await f.controller.resolveBase(f.input);assert.equal(result.base,'kp');assert.equal(f.calls.length,4);
});
test('incomplete successful replies stay manual and are rechecked after recovery',async()=>{
 const f=fixture({incompleteBase:'bt'});assert.equal((await f.controller.resolveBase(f.input)).base,'');const before=f.calls.length;
 f.setIncomplete('');assert.equal((await f.controller.resolveBase(f.input)).base,'kp');assert(f.calls.length>before);
});
test('equivalent separator spacing resolves an exact work/service pair consistently',async()=>{
 const f=fixture();for(const workTitle of ['Работа Q / Подуслуга Q','Работа Q/Подуслуга Q','Работа Q /Подуслуга Q','Работа Q|Подуслуга Q'])assert.equal((await f.controller.resolveBase({...f.input,workTitle})).base,'kp',workTitle);
});
test('whole work titles containing separators are still recognized without a synthetic pair',async()=>{
 const f=fixture({wholeTitleBase:'bt'});const result=await f.controller.resolveBase({...f.input,workTitle:'Работа Q/Подуслуга Q'});assert.equal(result.base,'');
});
for(const change of ['context','catalog','source','generation'])test('changed '+change+' while a comparison is pending cannot apply an old base decision',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=fixture({pause:wait});const pending=f.controller.resolveBase(f.input);await f.started;
 if(change==='context')f.input.context.client.id='changed-client';
 if(change==='catalog')f.cities.bt.push({id:'23',label:'Другой город'});
 if(change==='source')globalThis.LeadPartnerSourceCatalog.revision='source-changed-while-pending';
 if(change==='generation')await f.controller.newRequest({context:f.input.context,base:'kp'});
 release();const result=await pending;assert.equal(result.base,'');assert.equal(result.state,'superseded');
});

test('a whole native work title is recognized when no other base has competing evidence',async()=>{
 const f=fixture({wholeTitleBase:'bt',noMatchBase:'kp'});const result=await f.controller.resolveBase({...f.input,workTitle:'Работа Q/Подуслуга Q'});assert.equal(result.base,'bt');assert.equal(result.workId,'btwork');assert.equal(f.calls.length,2);
});
test('lightweight comparison uses the verified context partner catalog instead of partnerless winner',async()=>{
 const f=fixture({lightweight:true,partnerSensitive:true});const result=await f.controller.resolveBase(f.input);assert.equal(result.base,'kp');assert(f.calls.every(call=>call.partnerNumber==='1'));
});
test('missing context partner cannot silently choose using a partnerless catalog',async()=>{
 const f=fixture({lightweight:true,partnerSensitive:true});const result=await f.controller.resolveBase({...f.input,context:{...f.input.context,partnerNumber:''}});assert.equal(result.base,'');assert(result.checks.some(row=>!row.ok));
});

test('more than five matching native works cannot auto-assign using a partial subset',async()=>{
 const f=fixture({workCounts:{kp:6},ambiguous:true});const result=await f.controller.resolveBase(f.input);assert.equal(result.base,'');assert(result.checks.some(row=>!row.ok));assert.equal(f.calls.filter(call=>call.base==='kp').length,1);
});
test('multiple paired work IDs still prove the base but leave work selection manual',async()=>{
 const f=fixture({workCounts:{kp:2}});const result=await f.controller.resolveBase(f.input);assert.equal(result.base,'kp');assert.equal(result.workId,'');assert.equal(result.checks.find(row=>row.base==='kp').score,2);
});
test('multiple paired works in one base cannot incorrectly favor a single pair in another',async()=>{
 const f=fixture({workCounts:{kp:2},ambiguous:true});const result=await f.controller.resolveBase(f.input);assert.equal(result.base,'');assert.equal(result.checks.find(row=>row.base==='kp').score,2);assert.equal(result.checks.find(row=>row.base==='bt').score,2);
});

test('reordered candidate sets share the same comparison without order deciding the base',async()=>{
 const f=fixture();const first=await f.controller.resolveBase(f.input),second=await f.controller.resolveBase({...f.input,baseCandidates:['bt','kp','bt']});assert.equal(first.base,'kp');assert.equal(second.base,'kp');assert.equal(f.calls.length,4);
});
test('caller annotations cannot corrupt the cached base result or checks',async()=>{
 const f=fixture();const first=await f.controller.resolveBase(f.input);first.base='bt';first.checks[0].score=999;
 const second=await f.controller.resolveBase(f.input);assert.equal(second.base,'kp');assert(!second.checks.some(row=>row.score===999));assert.equal(f.calls.length,4);
});
test('repeated identical title parts cannot manufacture a work/service pair',async()=>{
 const f=fixture();const result=await f.controller.resolveBase({...f.input,workTitle:'Работа Q/Работа Q'});assert.equal(result.base,'');assert(result.checks.every(row=>row.score===1));
});
test('late old-generation comparison cannot replace a newer generation cached result',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=fixture({pause:wait});const old=f.controller.resolveBase(f.input);await f.started;
 await f.controller.newRequest({context:f.input.context,base:'kp'});const fresh=f.controller.resolveBase(f.input);release();
 assert.equal((await old).state,'superseded');assert.equal((await fresh).base,'kp');const before=f.calls.length;
 assert.equal((await f.controller.resolveBase(f.input)).base,'kp');assert.equal(f.calls.length,before);
});
test('explicit refresh rechecks a completed comparison before its short TTL expires',async()=>{
 const f=fixture();await f.controller.resolveBase(f.input);await f.controller.resolveBase({...f.input,refresh:true});assert.equal(f.calls.length,8);
 await f.controller.resolveBase(f.input);assert.equal(f.calls.length,8);
});
test('simultaneous explicit refresh requests still share their pending comparison',async()=>{
 const f=fixture({delay:5});await f.controller.resolveBase(f.input);
 const results=await Promise.all([f.controller.resolveBase({...f.input,refresh:true}),f.controller.resolveBase({...f.input,refresh:true})]);assert(results.every(result=>result.base==='kp'));assert.equal(f.calls.length,8);
});
for(const [label,partnerNumber] of [['Партнёр № 007','7'],['7','Партнер No.007'],['Партнёр No 007','Партнёр №007']])test('native partner default recognizes number marker: '+label+' / '+partnerNumber,async()=>{
 globalThis.LeadPartnerSourceCatalog={revision:'metadata-fixture',match:()=>null};
 const controller=create({crypto:webcrypto,rpc:async()=>({ok:true,catalog:[]}),serviceModule:{create:()=>({prepare:async()=>({ok:true,form:{values:{},fields:[]},lists:{partners:[{id:'17',label}]}})})}});
 const context={operatorId:'operator',accountId:'account',conversationId:'conversation',conversationUrl:'https://chat.partner-lead-centre.ru/chats/conversation',client:{id:'client'},base:'kp',partnerNumber};
 const metadata=await controller.getMetadata({context,draft:{base:'kp',phone:'9991112233'}});assert.equal(metadata.defaults.partnerId,'17');
});
test('number markers do not confuse partner 7 with native partner 70',async()=>{
 globalThis.LeadPartnerSourceCatalog={revision:'metadata-fixture',match:()=>null};
 const controller=create({crypto:webcrypto,rpc:async()=>({ok:true,catalog:[]}),serviceModule:{create:()=>({prepare:async()=>({ok:true,form:{values:{},fields:[]},lists:{partners:[{id:'17',label:'Партнёр № 70'}]}})})}});
 const context={operatorId:'operator',accountId:'account',conversationId:'conversation',conversationUrl:'https://chat.partner-lead-centre.ru/chats/conversation',client:{id:'client'},base:'kp',partnerNumber:'Партнёр № 7'};
 const metadata=await controller.getMetadata({context,draft:{base:'kp',phone:'9991112233'}});assert.equal(metadata.defaults.partnerId,'');
});
