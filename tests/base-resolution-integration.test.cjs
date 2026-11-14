'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const controllerModule=require('../extension/leadchat-request-controller.js');
const crm=require('../extension/leadchat-crm-service.js');
const contextModule=require('../extension/leadchat-request-context.js');
globalThis.LeadPartnerRules=require('../extension/leadpartner-rules.js');

// Real context → rules → controller → CRM service, with only the HTTP/parser
// boundary replaced. No employee data, external sockets or writes are used.
function fixture(){
  const calls=[];let broken='';
  globalThis.LeadPartnerSourceCatalog={revision:'offline-integrated-1'};
  globalThis.LeadChatCrmCityCatalog={forBase:()=>[{id:'10',label:'Тестовый'}]};
  const context=contextModule.derive({conversationId:'offline-integrated',
    conversationUrl:'https://chat.partner-lead-centre.ru/chats/offline-integrated',
    operatorId:'offline-operator',client:{id:'offline-client',name:'Тест'},
    account:{id:'offline-account',title:'BT/MNC · Общий канал',lead_partner_number:'001'},
    item:{id:'offline-ad',title:'Работа Q/Подуслуга Q',city_name:'Тестовый'},messages:[]});
  const form=()=>({id:'customerRequestForm',fields:[
    {name:'CustomerRequest[city_id]',tag:'select',options:[{id:'10',text:'Тестовый'}]},
    {name:'CustomerRequest[partner_id]',tag:'select',options:[{id:'91',text:'Партнер 1'}]},
    {name:'CustomerRequest[appliance_type_id]',tag:'select',options:[]},
    {name:'CustomerRequest[subappltype_id]',tag:'select',options:[]}
  ],values:{}});
  const controller=controllerModule.create({crypto:webcrypto,
    serviceModule:{create:config=>crm.create({...config,parseDocument:async()=>({forms:[form()]})})},
    rpc:async message=>{
      assert.equal(message.type,'LP_REQUEST_HTTP','base selection must not enter a write operation');
      assert.equal(message.method,'GET','catalogue comparisons cannot write');
      const url=new URL(message.url),base=Object.keys(crm.BASES).find(key=>crm.BASES[key]===url.origin);
      assert(base,'only the known CRM origins may be requested');
      assert(url.pathname.endsWith('/customer-request/create'),'no customer, timetable or write endpoint');
      calls.push({base,url:message.url});
      let body='form';
      if(url.searchParams.has('_get_appltype')){
        if(base===broken)body='{"error":"Synthetic malformed catalogue"}';
        else if(url.searchParams.get('appl_id')){
          // Partnerless lists intentionally point at a different CRM. This
          // detects a regression that compares the wrong business catalogue.
          const winner=url.searchParams.get('has_partner')==='1'?'bt':'mnc';
          body=JSON.stringify([{id:'31',text:base===winner?'Подуслуга Q':'Другая услуга'}]);
        }else body=JSON.stringify([{id:'21',text:'Работа Q'}]);
      }
      return {status:200,url:message.url,text:body};
    }});
  return {controller,context,calls,input:()=>({context,baseCandidates:context.baseCandidates,workTitle:context.workTitle}),breakBase:base=>broken=base};
}

test('native context and real service select the exact partner catalogue with six cold GETs',async()=>{
  const f=fixture(),result=await f.controller.resolveBase(f.input());
  assert.equal(result.base,'bt');assert.equal(f.calls.length,6);
  const dropdowns=f.calls.filter(row=>new URL(row.url).searchParams.has('_get_appltype'));
  assert.equal(dropdowns.length,4);
  assert(dropdowns.every(row=>new URL(row.url).searchParams.get('has_partner')==='1'));
  result.checks[0].score=999;result.base='kp';
  assert.equal((await f.controller.resolveBase(f.input())).base,'bt');assert.equal(f.calls.length,6);
});

test('fifty simultaneous card notifications share one actual CRM catalogue comparison',async()=>{
  const f=fixture(),results=await Promise.all(Array.from({length:50},()=>f.controller.resolveBase(f.input())));
  assert(results.every(result=>result.base==='bt'));assert.equal(f.calls.length,6);
});

test('malformed catalogue cannot prove absence and is read again after recovery',async()=>{
  const f=fixture();f.breakBase('bt');
  const partial=await f.controller.resolveBase(f.input());
  assert.equal(partial.base,'');assert(partial.checks.some(check=>!check.ok));
  const before=f.calls.length;f.breakBase('');
  assert.equal((await f.controller.resolveBase(f.input())).base,'bt');assert.equal(f.calls.length,before+6);
});

test('another native client cannot inherit the previous comparison cache',async()=>{
  const f=fixture();assert.equal((await f.controller.resolveBase(f.input())).base,'bt');
  f.context.client={...f.context.client,id:'offline-other-client'};
  assert.equal((await f.controller.resolveBase(f.input())).base,'bt');assert.equal(f.calls.length,12);
});

test('many distinct work titles in one dialogue cannot retain an unbounded comparison cache',async()=>{
  const f=fixture();assert.equal((await f.controller.resolveBase(f.input())).base,'bt');
  for(let index=0;index<260;index++){
    const input={...f.input(),workTitle:f.context.workTitle+'/Уточнение '+index};
    assert.equal((await f.controller.resolveBase(input)).base,'bt');
  }
  const before=f.calls.length;
  assert.equal((await f.controller.resolveBase(f.input())).base,'bt');
  assert.equal(f.calls.length,before+6,'the old result must be evicted even within a single active scope');
});

test('a partner missing from either native catalogue keeps the decision manual',async()=>{
  const f=fixture();f.context.partner='2';
  const result=await f.controller.resolveBase(f.input());
  assert.equal(result.base,'');assert(result.checks.every(check=>!check.ok));
  assert.equal(f.calls.length,2,'only the two forms are read before partner validation fails');
});
