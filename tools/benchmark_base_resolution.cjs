'use strict';
// Offline comparison benchmark. Every dependency response is synthetic; no CRM I/O.
const {performance}=require('node:perf_hooks');
const {webcrypto}=require('node:crypto');
const path=require('node:path');
const controllerPath=process.argv[2]?path.resolve(process.argv[2]):path.join(__dirname,'../extension/leadchat-request-controller.js');
const {create}=require(controllerPath);
globalThis.LeadPartnerRules=require('../extension/leadpartner-rules.js');
globalThis.LeadPartnerSourceCatalog={revision:'synthetic-source-1'};
globalThis.LeadChatCrmCityCatalog={kp:[{id:'11',label:'Тестовый'}],bt:[{id:'22',label:'Тестовый'}]};
const input={context:{operatorId:'synthetic-operator',accountId:'synthetic-account',conversationId:'synthetic-conversation',conversationUrl:'https://chat.partner-lead-centre.ru/chats/synthetic-conversation',client:{id:'synthetic-client'},cityName:'Тестовый',sourceCode:'SYNTHETIC',partnerNumber:'1'},baseCandidates:['kp','bt'],workTitle:'Работа Q / Подуслуга Q'};
async function run(concurrent){
 let calls=0;
 const controller=create({crypto:webcrypto,serviceModule:{create:()=>({dependencies:async args=>{
  calls++;await new Promise(resolve=>setTimeout(resolve,200));
  return {ok:true,workTypes:[{id:args.base+'work',label:'Работа Q'}],services:args.applianceTypeId?[{id:'service',label:args.base==='kp'?'Подуслуга Q':'Другая услуга'}]:[]};
 }})}});
 const start=performance.now();
 const results=concurrent?await Promise.all([controller.resolveBase(input),controller.resolveBase(input)]):[await controller.resolveBase(input),await controller.resolveBase(input)];
 return{scenario:concurrent?'two simultaneous identical probes':'two sequential identical probes',syntheticResponseDelayMs:200,dependencyCalls:calls,elapsedMs:Math.round(performance.now()-start),selectedBases:results.map(result=>result.base)};
}
(async()=>{for(const concurrent of [false,true])console.log(JSON.stringify(await run(concurrent)));})().catch(error=>{console.error(error.message);process.exitCode=1;});
