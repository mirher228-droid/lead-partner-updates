'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
globalThis.LeadPartnerRules=require('../extension/leadpartner-rules.js');
const {create}=require('../extension/leadchat-crm-service.js');
const {create:gateCreate}=require('../extension/leadchat-request-background.js');
const fs=require('node:fs'),vm=require('node:vm');
const origin='https://kp-lead-centre.ru',path='/admin/domain/customer-request/';
const values={'CustomerRequest[city_id]':'1','CustomerRequest[appliance_type_id]':'2','CustomerRequest[type]':'1','Customer[phone]':'9000000000','CustomerRequest[is_urgent]':'0'};
function fixture({status=504,text='proxy error',nativeErrors=false,bodyReadError=false,saved=false,observe=false}={}){
 let journal={},commits=0,posts=0;
 const observation=observe?observedFactory():null;
 const form={id:'customerRequestForm',method:'POST',action:origin+path+'update?id=123',fields:Object.entries(values).map(([name,value])=>({name,value,type:'text',tag:'input',options:[]})),values};
 const claimForm={method:'POST',action:origin+path+'create-claim?id=123',fields:[{name:'Claim[type]',tag:'select',type:'select-one',label:'Тип претензии',options:[{id:'1',text:'Type'}],value:'1'},{name:'Claim[comment]',tag:'textarea',type:'textarea',label:'Комментарий',value:''}],values:{'Claim[type]':'1','Claim[comment]':''}};
 const service=(observation?.create || create)({scope:'http-fixture',storage:{get:async()=>structuredClone(journal),set:async(k,v)=>journal=structuredClone(v)},
  request:async input=>{const url=new URL(input.url);if(input.method==='POST'){posts++;commits++;return {status,url:saved?origin+path+'update?id=123':input.url,text:saved?'form':text,bodyReadError};}return {status:200,url:input.url,text:url.pathname==='/api/customer/search'?'[]':url.pathname.endsWith('/create-claim')?'claim':'form'};},
  parseDocument:async body=>({forms:body==='form'||nativeErrors?[structuredClone(form)]:body==='claim'?[structuredClone(claimForm)]:[],csrfParam:'_csrf',csrfToken:'synthetic',errors:nativeErrors?['Native validation failed']:[],status:'В работе',actions:[{key:'create_claim',enabled:true}]}),onBeforeWrite:async()=>({ok:true})});
 return {service,get posts(){return posts},get commits(){return commits},get journal(){return journal},get accepted(){return observation?.sets[0]}};
}
function observedFactory(){
 const sets=[];class ObservedSet extends Set{constructor(...args){super(...args);sets.push(this);}}
 const sandbox={module:{exports:{}},Set:ObservedSet,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,LeadPartnerRules:globalThis.LeadPartnerRules};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('../extension/leadchat-crm-service.js'),'utf8'),sandbox);
 return {create:sandbox.module.exports.create,sets};
}
function createArgs(operationId='operation_A'){return {base:'kp',operationId,fields:{...values}};}
for(const status of [500,502,503,504,408,429,403])test('POST HTTP '+status+' is uncertain even when a proxy displays an error',async()=>{
 const f=fixture({status,text:'{"error":"Proxy failed"}'}),result=await f.service.createRequest(createArgs());
 assert.equal(f.posts,1);assert.equal(f.commits,1);assert.equal(result.state,'uncertain');assert.equal(result.writeStarted,true);assert.equal(f.journal.operation_A.state,'uncertain');
});
test('HTTP 504 after commit leaves the durable gate locked and never sends a second create',async()=>{
 const f=fixture(),data={},gate=gateCreate({storage:{get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))}});
 const args={kind:'create',base:'kp',scope:'http-fixture',clientId:'synthetic-client',operationId:'operation_A'};
 await gate.run({...args,command:'begin'});await gate.run({...args,command:'dispatch'});
 const result=await f.service.createRequest(createArgs());await gate.run({...args,command:'finish',result});
 const next=await gate.run({...args,command:'begin',operationId:'operation_B'});
 if(next.ok)await f.service.createRequest(createArgs('operation_B'));
 assert.equal(next.ok,false);assert.equal(next.operation.state,'uncertain');assert.equal(f.posts,1);
});
for(const kind of ['update','claim'])test(kind+' HTTP 504 cannot become a definitive rejection',async()=>{
 const f=fixture(),args={base:'kp',id:'123',operationId:'operation_'+kind};
 const result=kind==='claim'?await f.service.saveClaim({...args,claimType:'1',comment:'Synthetic'}):await f.service.saveRequest({...args,fields:{'CustomerRequest[is_urgent]':'1'}});
 assert.equal(f.posts,1);assert.equal(result.state,'uncertain');assert.equal(result.writeStarted,true);
});
test('a truncated successful transport response remains uncertain',async()=>{
 const f=fixture({status:200,saved:true,bodyReadError:true}),result=await f.service.createRequest(createArgs());
 assert.equal(result.state,'uncertain');assert.equal(result.writeStarted,true);assert.equal(f.posts,1);
});
test('generic JSON success-status failure cannot prove that a dispatched write was refused',async()=>{
 const f=fixture({status:200,text:'{"ok":false,"error":"Backend failed after commit"}'}),result=await f.service.createRequest(createArgs());
 assert.equal(result.state,'uncertain');assert.equal(result.writeStarted,true);
});
test('explicit Yii field validation on HTTP 422 remains a definitive refusal',async()=>{
 const f=fixture({status:422,text:'{"customerrequest-city_id":["Select a city"]}'}),result=await f.service.createRequest(createArgs());
 assert.equal(result.state,'rejected');assert.match(result.error,/Select a city/);assert.equal(f.posts,1);
});
test('native request form validation on HTTP 400 remains a definitive refusal',async()=>{
 const f=fixture({status:400,text:'native-form-errors',nativeErrors:true}),result=await f.service.createRequest(createArgs());
 assert.equal(result.state,'rejected');assert.match(result.error,/Native validation/);
});
test('generic JSON on HTTP 422 cannot prove that a dispatched write was refused',async()=>{
 const f=fixture({status:422,text:'{"error":"Proxy rejected route"}'}),result=await f.service.createRequest(createArgs());
 assert.equal(result.state,'uncertain');assert.equal(result.writeStarted,true);
});
test('server status is ambiguous even with a native-looking validation form',async()=>{
 const f=fixture({status:500,text:'native-form-errors',nativeErrors:true}),result=await f.service.createRequest(createArgs());
 assert.equal(result.state,'uncertain');assert.equal(result.writeStarted,true);
});
test('confirmed saves release accepted write keys while already-saved reconciliation sends no POST',async()=>{
 const f=fixture({status:200,saved:true,observe:true});
 for(let i=0;i<40;i++)assert.equal((await f.service.createRequest(createArgs('operation_'+String(i).padStart(4,'0')))).state,'saved');
 assert.equal(f.accepted.size,0,'terminal operations cannot accumulate accepted gate keys');
 const posts=f.posts;assert.equal((await f.service.reconcile({base:'kp',operationId:'operation_0039',readOnly:true})).state,'saved');assert.equal(f.posts,posts);
});
test('definitive native refusal releases its accepted key',async()=>{
 const f=fixture({status:422,text:'{"customerrequest-city_id":["Select a city"]}',observe:true});
 assert.equal((await f.service.createRequest(createArgs())).state,'rejected');assert.equal(f.accepted.size,0);
});
test('uncertain operation retains its acceptance without replaying a POST',async()=>{
 const f=fixture({observe:true});assert.equal((await f.service.createRequest(createArgs())).state,'uncertain');
 assert.equal(f.accepted.has('operation_A'),true);await f.service.createRequest(createArgs());assert.equal(f.posts,1);assert.equal(f.accepted.size,1);
});
for(const [initialStatus,finalStatus] of [[200,200],[200,504],[504,200]])test('cancellation reason lifecycle remains bound after HTTP '+initialStatus+'/'+finalStatus,async()=>{
 const observed=observedFactory();let journal={},posts=0,dispatches=0,status='В работе';const auxiliary={};
 const requestValues={...values,'CustomerRequest[comments_service]':'Отмена с Авито'};
 const card={id:'customerRequestForm',method:'POST',action:origin+path+'update?id=123',fields:Object.entries(requestValues).map(([name,value])=>({name,value,type:'text',tag:'input',options:[]})),values:requestValues};
 const reasonForm={method:'POST',action:origin+path+'update?id=123',fields:[{name:'cancel_reason',tag:'select',type:'select-one',label:'Причина отмены',value:'1',options:[{id:'1',text:'Synthetic reason'}]}],values:{cancel_reason:'1'}};
 const service=observed.create({scope:'reason-fixture',storage:{get:async k=>structuredClone(k.startsWith('leadchatCrmOperationsV1:')?journal:auxiliary[k]),set:async(k,v)=>{if(k.startsWith('leadchatCrmOperationsV1:'))journal=structuredClone(v);else auxiliary[k]=structuredClone(v);}},onBeforeWrite:async()=>{dispatches++;return {ok:true};},
 request:async input=>{let text='card';if(input.method==='POST'){posts++;if(posts===1)text='reason';else status='Отмена КЦ';}return {status:input.method==='POST'?(posts>1?finalStatus:initialStatus):200,url:input.url,text};},
 parseDocument:async body=>({forms:[structuredClone(body==='reason'?reasonForm:card)],csrfParam:'_csrf',csrfToken:'synthetic',errors:[],status,actions:[{key:'cancel_kc',enabled:true,type:'submit',fields:{cancel_kc:'1'}}]})});
 const args={base:'kp',id:'123',operationId:'operation_cancel',action:'cancel_kc'};
 const prepared=await service.prepareCancellation(args);
 if(initialStatus!==200){assert.equal(prepared.state,'uncertain');assert.equal(prepared.writeStarted,true);assert.equal(posts,1);assert.equal(observed.sets[0].size,1);return;}
 assert.equal(prepared.state,'awaiting_reason');assert.equal(observed.sets[0].has(args.operationId),true);assert.equal(dispatches,1);
 const result=await service.saveCancellation({...args,reasonId:'1',comment:''});
 assert.equal(result.state,finalStatus===200?'saved':'uncertain');if(finalStatus!==200)assert.equal(result.writeStarted,true);
 assert.equal(dispatches,2);assert.equal(posts,2);assert.equal(observed.sets[0].size,finalStatus===200?0:1);
 assert.equal((await service.reconcile({base:'kp',operationId:args.operationId,readOnly:true})).state,'saved');assert.equal(posts,2);assert.equal(observed.sets[0].size,0);
});
