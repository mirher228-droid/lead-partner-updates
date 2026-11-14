'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {create}=require('../extension/leadchat-request-controller.js');
globalThis.LeadPartnerRules=require('../extension/leadpartner-rules.js');
globalThis.LeadPartnerSourceCatalog={revision:'synthetic',match:()=>null};
function fixture(flag){
 let reads=0,services=0;
 const controller=create({crypto:webcrypto,rpc:async()=>{reads++;return {ok:true,operation:null,catalog:[]};},serviceModule:{create:()=>{services++;return {prepare:async()=>({ok:true,form:{values:{},fields:[]},lists:{}}),createRequest:async()=>{throw Error('Mutation must not be called');}};}}});
 const context={operatorId:'synthetic-operator',accountId:'synthetic-account',conversationId:'synthetic-conversation',conversationUrl:'https://chat.partner-lead-centre.ru/chats/synthetic-conversation',client:{id:'synthetic-client'},base:'kp',...(flag?{[flag]:false}:{})};
 return{controller,context,reads:()=>reads,services:()=>services};
}
for(const flag of ['ok','allowed','routeSafe']){
 test(flag+' false blocks metadata before service creation or RPC',async()=>{
  const f=fixture(flag);await assert.rejects(f.controller.getMetadata({context:f.context,draft:{base:'kp'}}));assert.equal(f.services(),0);assert.equal(f.reads(),0);
 });
 test(flag+' false blocks durable status reads before service creation or RPC',async()=>{
  const f=fixture(flag);await assert.rejects(f.controller.getOperationStatus({context:f.context,base:'kp'}));assert.equal(f.services(),0);assert.equal(f.reads(),0);
 });
 test(flag+' false rejects creation before service creation or RPC',async()=>{
  const f=fixture(flag),result=await f.controller.createRequest({context:f.context,draft:{base:'kp',phone:'9991112233'},operationId:'synthetic-operation'});assert.equal(result.ok,false);assert.equal(result.state,'rejected');assert.equal(f.services(),0);assert.equal(f.reads(),0);
 });
 test(flag+' false blocks a semantic base choice without service or RPC',async()=>{
  const f=fixture(flag),result=await f.controller.resolveBase({context:f.context,baseCandidates:['kp','bt'],workTitle:'Телевизоры'});assert.equal(result.ok,false);assert.equal(result.base,'');assert.equal(f.services(),0);assert.equal(f.reads(),0);
 });
}
test('legacy undefined context flags still allow status reads and semantic selection',async()=>{
 const f=fixture();const status=await f.controller.getOperationStatus({context:f.context,base:'kp'});assert.equal(status.ok,true);assert.equal(f.services(),1);assert.equal(f.reads(),1);
 const semantic=await f.controller.resolveBase({context:f.context,baseCandidates:['kp','bt'],workTitle:'Телевизоры'});assert.equal(semantic.ok,true);assert.equal(semantic.base,'kp');assert.equal(f.services(),1);assert.equal(f.reads(),1);
});
for(const flag of ['ok','allowed','routeSafe'])test(flag+' becoming false during a pending comparison suppresses its old decision',async()=>{
 let release,started;const pause=new Promise(resolve=>release=resolve),reading=new Promise(resolve=>started=resolve);
 globalThis.LeadChatCrmCityCatalog={kp:[{id:'11',label:'Тестовый'}],bt:[{id:'22',label:'Тестовый'}]};
 const controller=create({crypto:webcrypto,serviceModule:{create:()=>({dependencies:async args=>{started();await pause;return {ok:true,workTypes:[{id:args.base+'work',label:args.base==='kp'?'Работа Q':'Другое'}],services:[]};}})}});
 const context={operatorId:'operator',accountId:'account',conversationId:'conversation',conversationUrl:'https://chat.partner-lead-centre.ru/chats/conversation',client:{id:'client'},cityName:'Тестовый'};
 const pending=controller.resolveBase({context,baseCandidates:['kp','bt'],workTitle:'Работа Q'});await reading;context[flag]=false;release();
 const result=await pending;assert.equal(result.base,'');assert.equal(result.state,'superseded');
});
