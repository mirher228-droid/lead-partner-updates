'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../extension/leadchat-crm-service.js');
const fs=require('node:fs'),vm=require('node:vm');
const rules=require('../extension/leadpartner-rules.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
function fixture(){
 const old=deferred(),fresh=deferred();let starts=0,createReads=0;
 const names={old:'CustomerRequest[subappltype_id]',fresh:'CustomerRequest[service_sub_type]'};
 const form=version=>({id:'customerRequestForm',fields:[{name:'CustomerRequest[city_id]',tag:'select',options:[{id:'1',text:'City'}]},{name:'CustomerRequest[appliance_type_id]',tag:'select',options:[]},{name:names[version],tag:'select',options:[]}],values:{}});
 const service=create({request:async input=>{const url=new URL(input.url);if(url.searchParams.has('_get_appltype'))return {status:200,url:input.url,text:'[{"id":"2","text":"Work"}]'};if(!url.pathname.endsWith('/create'))return {status:200,url:input.url,text:'fresh'};createReads++;if(starts++<2)return (starts===1?old:fresh).promise;return {status:200,url:input.url,text:'fresh'};},parseDocument:async body=>({forms:[form(body)]})});
 const reply=version=>({status:200,url:'https://kp-lead-centre.ru/admin/domain/customer-request/create',text:version});
 return {old,fresh,reply,service,get createReads(){return createReads}};
}
test('a slower old preparation cannot replace the newer create schema',async()=>{
 const f=fixture(),a=f.service.prepare({base:'kp',phone:''}),b=f.service.prepare({base:'kp',phone:''});
 f.fresh.resolve(f.reply('fresh'));await b;f.old.resolve(f.reply('old'));await a;
 const dependency=await f.service.dependencies({base:'kp',preparedPhone:'',cityId:'1'});
 assert.equal(dependency.serviceField,'CustomerRequest[service_sub_type]');assert.equal(f.createReads,2);
});
test('an older preparation failure cannot delete the newer native form cache',async()=>{
 const f=fixture(),a=f.service.prepare({base:'kp',phone:''}),b=f.service.prepare({base:'kp',phone:''});
 f.fresh.resolve(f.reply('fresh'));await b;f.old.reject(Error('Synthetic old transport failure'));assert.equal((await a).ok,false);
 const dependency=await f.service.dependencies({base:'kp',preparedPhone:'',cityId:'1'});
 assert.equal(dependency.serviceField,'CustomerRequest[service_sub_type]');assert.equal(f.createReads,2,'fresh preparation must still be reused');
});
function boundedFixture(){
 const maps=[];class ObservedMap extends Map{constructor(...args){super(...args);maps.push(this);}}
 let clock=100000,createReads=0,requestReads=0,pendingPhone='';const pending=deferred(),started=deferred();
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const sandbox={module:{exports:{}},Map:ObservedMap,Date:ClockDate,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,LeadPartnerRules:rules};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require.resolve('../extension/leadchat-crm-service.js'),'utf8'),sandbox);
 const form={id:'customerRequestForm',fields:[{name:'CustomerRequest[city_id]',tag:'select',options:[{id:'1',text:'City'}]},{name:'CustomerRequest[appliance_type_id]',tag:'select',options:[]}],values:{}};
 const service=sandbox.module.exports.create({request:async input=>{const url=new URL(input.url);if(url.pathname==='/api/customer/search')return {status:200,url:input.url,text:'[]'};if(url.pathname.endsWith('/create')){createReads++;if(pendingPhone){pendingPhone='';started.resolve();await pending.promise;}}else requestReads++;return {status:200,url:input.url,text:'form'};},parseDocument:async()=>({forms:[structuredClone(form)],errors:[],status:'В работе',cityNotice:'Synthetic timetable'})});
 return {service,maps,pending,started,setPending(){pendingPhone='pending'},advance(){clock+=31000},get createReads(){return createReads},get requestReads(){return requestReads}};
}
test('one hot service bounds settled forms after 1000 phone preparations',async()=>{
 const f=boundedFixture();for(let i=0;i<1000;i++)assert.equal((await f.service.prepare({base:'kp',phone:String(9000000000+i)})).ok,true);
 const cache=f.maps.find(map=>map.has('kp:9000000999'));assert(cache);assert.ok(cache.size<=256,'settled native forms must have a finite bound');
 assert.equal(cache.has('kp:9000000000'),false);assert.equal(cache.has('kp:9000000999'),true);
});
test('expired native forms are removed opportunistically instead of retained forever',async()=>{
 const f=boundedFixture();for(let i=0;i<8;i++)await f.service.prepare({base:'kp',phone:String(9000000000+i)});
 f.advance();await f.service.prepare({base:'kp',phone:'9000000100'});
 const cache=f.maps.find(map=>map.has('kp:9000000100'));assert.equal(cache.size,1);
});
test('evicting old settled forms cannot discard a pending preparation ticket',async()=>{
 const f=boundedFixture();f.setPending();const pending=f.service.prepare({base:'kp',phone:'9000000000'});await f.started.promise;
 for(let i=1;i<=300;i++)await f.service.prepare({base:'kp',phone:String(9000000000+i)});
 f.pending.resolve();assert.equal((await pending).ok,true);
 const cache=f.maps.find(map=>map.has('kp:9000000000'));assert(cache,'completed pending native form must remain usable');assert.ok(cache.size<=256);
});
test('one hot service bounds settled native record snapshots after 1000 distinct reads',async()=>{
 const f=boundedFixture();for(let i=1;i<=1000;i++)assert.equal((await f.service.readRequest({base:'kp',id:String(i)})).ok,true);
 const cache=f.maps.find(map=>map.has('kp:1000'));assert(cache);assert.ok(cache.size<=256);assert.equal(cache.has('kp:1'),false);assert.equal(cache.has('kp:1000'),true);
});
