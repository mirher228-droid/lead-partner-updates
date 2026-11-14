'use strict';
// Browser boundaries only. The production HTML, scripts, DOM and event handlers run unchanged.
const api=window.module.exports;delete window.module;
window.fetch=async()=>{throw Error('Real network is forbidden in offline panel tests');};
window.harness={calls:[],errors:[],items:{},result:{ok:false,state:'uncertain',writeStarted:true,error:'Offline ambiguous response'}};
window.addEventListener('error',event=>harness.errors.push(event.message));
const conversation='https://chat.partner-lead-centre.ru/chats/123';
const context={ok:true,allowed:true,routeSafe:true,base:'kp',baseCandidates:['kp'],conversationId:'123',chatId:'123',conversationUrl:conversation,dialogUrl:conversation,operatorId:'offline-op',accountId:'offline-account',scope:{key:'offline-scope',operatorId:'offline-op',accountId:'offline-account'},client:{id:'123',name:'Offline'}};
harness.context=context;harness.key=api.scopeKey(context,'kp');
const scenario=new URLSearchParams(location.search);
const operation={operationId:'offline-operation-123',kind:scenario.get('kind') || 'create',id:scenario.get('kind')==='update'?'4321':'',state:'uncertain',createdAt:Date.now()};
const metadata={ok:true,form:{fields:[],values:{}},lists:{cities:[],partners:[],types:[],workTypes:[]},defaults:{},sources:[]};
if(scenario.get('durable')==='1')harness.durable=structuredClone(operation);
harness.items[harness.key]={version:1,draft:{base:'kp',extraFields:{}},operation:scenario.get('durable')==='1'?null:operation,metadata};
if(scenario.get('editor')==='1'){
 const canonical={base:'kp',cityId:'1',clientName:'Тест',phone:'9000000000',requestType:'1',workId:'1',date:'2099-01-01',time:'12:00',comments:'CRM baseline comment',commentsService:conversation};
 const record={id:'4321',base:'kp',customerId:'123',verified:true,...canonical,canonical,form:{fields:[],values:{}},capabilities:{readOnly:false,save:true},actions:[{key:'save',enabled:true,type:'submit'},{key:'cancel_kc',enabled:true,type:'link'}]};
 Object.assign(metadata,{record,lists:{cities:[{id:'1',label:'Москва'}],types:[{id:'1',label:'Впервые'},{id:'2',label:'Повтор'},{id:'3',label:'Гарантия'}],workTypes:[{id:'1',label:'Ремонт'}]}});
 harness.items[harness.key]={version:1,draft:{...canonical,extraFields:{}},record,recordOrigin:scenario.get('lookup')==='1'?'lookup':'created',metadata,operation:null};
}
if(scenario.get('editableComments')==='1'){
 const field={name:'CustomerRequest[comments]',type:'textarea',label:'Комментарий'};
 metadata.form.fields.push(field);metadata.record.form.fields.push(structuredClone(field));
}
if(scenario.get('pendingEdit')==='1'){
 const item=harness.items[harness.key];item.operation={...operation,kind:'update',id:'4321'};item.draft.comments='Intended unsent edit';item.touched=['comments'];
}
harness.delayedWrites=[];harness.reads=[];
harness.releaseWrites=()=>{harness.delayKey='';for(const resume of harness.delayedWrites.splice(0))resume();};
const storage={async get(key){harness.reads.push(key);return structuredClone(harness.items[key] || null);},async set(key,value){const snapshot=structuredClone(value);if(key===harness.delayKey)await new Promise(resolve=>harness.delayedWrites.push(resolve));harness.items[key]=snapshot;}};
const controller={async getMetadata(args){const next=structuredClone(metadata);if(harness.newCycle || args.context.chatId!=='123')delete next.record;return next;},async getOperationStatus(){return {ok:true,operation:harness.durable || null};},async reconcile(args){harness.calls.push({command:'reconcile',...args});if(harness.deferReconcile)return new Promise(resolve=>{harness.resolveReconcile=resolve;});if(harness.throwTransport)throw Error('Offline transport failure');return structuredClone(harness.result);},async newRequest(args){harness.calls.push({command:'newRequest',...args});harness.newCycle=true;harness.durable={state:'ready',cycleId:'offline-cycle-next'};return {ok:true,cycleId:'offline-cycle-next'};},async cancelRequest(args){harness.calls.push({command:'cancelRequest',...args});throw Error('Offline cancellation transport failure');},async performAction(args){harness.calls.push({command:'performAction',...args});if(harness.deferWrite)return new Promise(resolve=>{harness.resolveWrite=resolve;});throw Error('Offline write transport failure');},async getDependencies(){return {ok:true,works:[],services:[]};},async getRequest(args){if(harness.deferRequest){harness.calls.push({command:'getRequest',...args});return new Promise(resolve=>{harness.resolveRequest=resolve;});}return {ok:false,error:'Offline card unavailable'};}};
harness.instance=api.mount({document,window,controller,storage});
harness.send=(next=context)=>window.postMessage({type:'leadchat-request-context',channel:'offline-test',context:next},location.origin);
harness.send();
