'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {create:gateCreate}=require('../extension/leadchat-request-background.js');
const {create}=require('../extension/leadchat-request-controller.js');
globalThis.LeadPartnerRules=require('../extension/leadpartner-rules.js');
globalThis.LeadPartnerSourceCatalog={match:()=>({code:'SRC',url:'https://example.invalid/source'})};
const clone=value=>structuredClone(value);
function fixture({outcome='saved',failFinish=false,failBegin='',reconcileMissing=false}={}) {
 const data={},calls=[],reconciliations=[];let posts=0,mutations=0,firstWrite,release,secondAttempted,begins=0,beginFailed=false;
 const started=new Promise(r=>firstWrite=r),wait=new Promise(r=>release=r),secondAttempt=new Promise(r=>secondAttempted=r);
 const storage={get:async key=>({[key]:clone(data[key])}),set:async values=>Object.assign(data,clone(values)),remove:async key=>delete data[key]};
 const gate=gateCreate({storage});
 const rpc=async message=>{calls.push(message.command || message.type);if(message.type==='LP_REQUEST_CATALOG')return{ok:true,catalog:[]};if(message.type==='LP_REQUEST_OPERATION'){if(failFinish && message.command==='finish')throw Error('Storage reply lost');if(message.command==='begin' && !beginFailed && failBegin==='before'){beginFailed=true;throw Error('Begin unavailable');}const result=await gate.run(message);if(message.command==='begin' && !beginFailed && failBegin==='after'){beginFailed=true;throw Error('Begin reply lost');}if(message.command==='begin' && ++begins===2)secondAttempted();return result;}return{ok:true};};
 const context={operatorId:'operator',accountId:'account',conversationId:'conversation',conversationUrl:'https://chat.partner-lead-centre.ru/chats/conversation',client:{id:'client'},base:'kp',sourceCode:'SRC',partnerNumber:'1'};
 const serviceModule={draftToFields:draft=>draft,create:config=>({prepare:async()=>({ok:true,form:{values:{},fields:[]},lists:{partners:[{id:'1',label:'1'}]}}),dependencies:async()=>({ok:true,lists:{}}),createRequest:async args=>{
  mutations++;
  if(outcome==='rejected')return{ok:false,state:'rejected',writeStarted:false,operationId:args.operationId,error:'Preflight rejected'};
  if(config.onBeforeWrite)await config.onBeforeWrite({base:args.base,operationId:args.operationId,kind:'create',id:''});
  posts++;firstWrite();if(posts===2)secondAttempted();await wait;
  if(outcome==='uncertain')return{ok:false,state:'uncertain',writeStarted:true,operationId:args.operationId,error:'Lost reply'};
  return {ok:true,state:'saved',verified:true,operationId:args.operationId,record:{id:'123',base:args.base,form:{values:{},fields:[]}}};
 },reconcile:async args=>{reconciliations.push(args);return reconcileMissing?{ok:false,state:'uncertain',code:'operation_missing',operationId:args.operationId}:{ok:false,state:'uncertain',operationId:args.operationId};}})};
 const controller=()=>create({rpc,storage,serviceModule,crypto:webcrypto});
 const input=operationId=>({context,operationId,draft:{base:'kp',phone:'9991112233'}});
 return {controller,input,started,secondAttempt,release,posts:()=>posts,mutations:()=>mutations,data,calls,context,reconciliations,setOutcome:value=>outcome=value};
}
test('two panels with distinct operation IDs cannot both send one dialogue create',async()=>{
 const f=fixture(),a=f.controller(),b=f.controller();const first=a.createRequest(f.input('operation-A'));await f.started;
 let secondDone=false;const second=b.createRequest(f.input('operation-B')).then(x=>{secondDone=true;return x});
 await f.secondAttempt;f.release();const results=await Promise.all([first,second]);
 assert.equal(f.posts(),1);assert.equal(results[0].ok,true);assert.equal(results[1].state,'uncertain');assert.equal(secondDone,true);
});
test('lost reply remains durable and cannot start a different create',async()=>{
 const f=fixture({outcome:'uncertain'}),a=f.controller();f.release();const first=await a.createRequest(f.input('operation-A'));
 const second=await f.controller().createRequest(f.input('operation-B'));
 assert.equal(first.state,'uncertain');assert.equal(second.state,'uncertain');assert.equal(f.posts(),1);
 const status=await a.getOperationStatus({context:f.context,base:'kp'});assert.equal(status.operation.operationId,'operation-A');assert.equal(status.operation.state,'uncertain');
});
test('explicit new request after saved creation opens one new cycle',async()=>{
 const f=fixture(),a=f.controller();f.release();await a.createRequest(f.input('operation-A'));
 const next=await a.newRequest({context:f.context,base:'kp',id:'123'});assert.equal(next.ok,true);
 await a.createRequest({...f.input('operation-B'),draft:{...f.input('').draft,creationCycleId:next.cycleId}});
 assert.equal(f.posts(),2);assert(f.calls.includes('new'));assert(f.calls.includes('dispatch'));assert(f.calls.includes('finish'));
});

test('automatic recovery delegates read-only reconciliation and keeps uncertain gate',async()=>{
 const f=fixture({outcome:'uncertain'}),a=f.controller();f.release();await a.createRequest(f.input('operation-A'));
 const result=await a.reconcile({context:f.context,base:'kp',kind:'create',operationId:'operation-A'});
 assert.equal(result.state,'uncertain');assert.equal(f.reconciliations.length,1);assert.equal(f.reconciliations[0].readOnly,true);
 assert.equal((await a.getOperationStatus({context:f.context,base:'kp'})).operation.state,'uncertain');
});

test('definitive preflight rejection releases gate for corrected new operation',async()=>{
 const f=fixture({outcome:'rejected'}),a=f.controller();f.release();
 const rejected=await a.createRequest(f.input('operation-A'));assert.equal(rejected.state,'rejected');assert.equal(f.posts(),0);
 f.setOutcome('saved');const saved=await a.createRequest(f.input('operation-B'));assert.equal(saved.ok,true);assert.equal(f.posts(),1);
});
test('durable status for another client cannot be adopted after reload',async()=>{
 const f=fixture({outcome:'uncertain'}),a=f.controller();f.release();await a.createRequest(f.input('operation-A'));
 const result=await f.controller().getOperationStatus({context:{...f.context,client:{id:'changed-client'}},base:'kp'});
 assert.equal(result.ok,false);assert.equal(result.state,'uncertain');assert.equal(result.operation,undefined);
});

test('lost durable finish acknowledgement cannot be reported as a verified save',async()=>{
 const f=fixture({failFinish:true}),a=f.controller();f.release();const result=await a.createRequest(f.input('operation-A'));
 assert.equal(result.ok,false);assert.equal(result.verified,false);assert.equal(result.state,'uncertain');assert.equal(result.operationId,'operation-A');
 const status=await a.getOperationStatus({context:f.context,base:'kp'});assert.equal(status.operation.phase,'sent');
 const blocked=await f.controller().createRequest(f.input('operation-B'));assert.equal(blocked.state,'uncertain');assert.equal(f.posts(),1);
});

test('repeat fields from found record B advance saved creation A using A proof',async()=>{
 const f=fixture(),a=f.controller();f.release();await a.createRequest(f.input('operation-A'));
 const next=await a.newRequest({context:f.context,base:'kp',id:'456'});
 assert.equal(next.ok,true);
 const status=await a.getOperationStatus({context:f.context,base:'kp'});
 assert.equal(status.operation.state,'ready');assert.equal(status.operation.previousRecords.at(-1).id,'123');
});
test('reopening a ready followup reuses the cycle without a second new transition',async()=>{
 const f=fixture(),a=f.controller();f.release();await a.createRequest(f.input('operation-A'));
 const first=await a.newRequest({context:f.context,base:'kp',id:'123'});
 const second=await a.newRequest({context:f.context,base:'kp',id:'456'});
 assert.equal(second.ok,true);assert.equal(second.cycleId,first.cycleId);assert.equal(f.calls.filter(x=>x==='new').length,1);
});
test('a safely rejected cycle can be reopened without discarding its cycle proof',async()=>{
 const f=fixture(),a=f.controller();f.release();await a.createRequest(f.input('operation-A'));
 const next=await a.newRequest({context:f.context,base:'kp',id:'123'});
 f.setOutcome('rejected');await a.createRequest({...f.input('operation-B'),draft:{...f.input('').draft,creationCycleId:next.cycleId}});
 const reopened=await a.newRequest({context:f.context,base:'kp',id:'456'});
 assert.equal(reopened.ok,true);assert.equal(reopened.cycleId,next.cycleId);assert.equal(f.calls.filter(x=>x==='new').length,1);
});
test('uncertain creation blocks explicit followup without losing the active checkpoint',async()=>{
 const f=fixture({outcome:'uncertain'}),a=f.controller();f.release();await a.createRequest(f.input('operation-A'));
 const result=await a.newRequest({context:f.context,base:'kp',id:'456'});
 assert.equal(result.ok,false);assert.equal(result.state,'uncertain');assert.equal(f.calls.filter(x=>x==='new').length,0);
 assert.equal((await a.getOperationStatus({context:f.context,base:'kp'})).operation.operationId,'operation-A');
});
test('active first write blocks a followup before its result is known',async()=>{
 const f=fixture(),a=f.controller();const saving=a.createRequest(f.input('operation-A'));await f.started;
 try{const next=await f.controller().newRequest({context:f.context,base:'kp',id:'456'});assert.equal(next.ok,false);assert.equal(next.state,'uncertain');assert.equal(f.calls.filter(x=>x==='new').length,0);}
 finally{f.release();await saving;}
});
test('rejected first attempt without a cycle can prepare a fresh followup',async()=>{
 const f=fixture({outcome:'rejected'}),a=f.controller();f.release();await a.createRequest(f.input('operation-A'));
 const next=await a.newRequest({context:f.context,base:'kp',id:'456'});assert.equal(next.ok,true);assert(next.cycleId);assert.equal(f.calls.filter(x=>x==='new').length,0);
 f.setOutcome('saved');const result=await a.createRequest({...f.input('operation-B'),draft:{...f.input('').draft,creationCycleId:next.cycleId}});
 assert.equal(result.ok,true);assert.equal(f.posts(),1);
});

test('begin failure before checkpoint is safe to retry without a sticky operation',async()=>{
 const f=fixture({failBegin:'before'}),a=f.controller();f.release();
 const result=await a.createRequest(f.input('operation-A'));
 assert.equal(result.state,'rejected');assert.equal(result.safeToRetry,true);assert.equal(result.writeStarted,false);assert.equal(result.code,'write_not_started');assert.equal(f.mutations(),0);
 assert.equal((await a.getOperationStatus({context:f.context,base:'kp'})).operation,null);
 const retry=await a.createRequest(f.input('operation-B'));assert.equal(retry.ok,true);assert.equal(f.posts(),1);
});
test('lost begin reply preserves stored preparation until read-only reconciliation clears it',async()=>{
 const f=fixture({failBegin:'after',reconcileMissing:true}),a=f.controller();f.release();
 const result=await a.createRequest(f.input('operation-A'));
 assert.equal(result.state,'rejected');assert.equal(result.writeStarted,false);assert.equal(f.mutations(),0);
 const status=await a.getOperationStatus({context:f.context,base:'kp'});assert.equal(status.operation.phase,'preparing');
 const blocked=await f.controller().createRequest(f.input('operation-B'));assert.equal(blocked.state,'uncertain');assert.equal(blocked.operationId,'operation-A');assert.equal(f.mutations(),0);
 const recovered=await a.reconcile({context:f.context,base:'kp',kind:'create',operationId:'operation-A'});
 assert.equal(recovered.state,'rejected');assert.equal(recovered.code,'write_not_started');assert.equal(recovered.writeStarted,false);assert.equal(f.reconciliations[0].readOnly,true);
 const retry=await a.createRequest(f.input('operation-C'));assert.equal(retry.ok,true);assert.equal(f.posts(),1);
});
