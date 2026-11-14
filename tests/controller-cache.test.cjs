'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const fs=require('node:fs'),vm=require('node:vm');
const {create}=require('../extension/leadchat-request-controller.js');
const {create:gateCreate}=require('../extension/leadchat-request-background.js');
globalThis.LeadPartnerRules=require('../extension/leadpartner-rules.js');
globalThis.LeadPartnerSourceCatalog={match:()=>({code:'SRC',url:'https://example.invalid/source'})};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};};
function fixture({maxCachedScopes,search,write,postSave,postSaveStatus,read,prepare,controllerFactory=create}={}){
 const data={},created=[],removed=[],gate=createGate();let preparations=0,searches=0,reads=0,writes=0;
 function createGate(){return gateCreate({storage:{get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))}});}
 const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values)),remove:async key=>{removed.push(key);delete data[key];}};
 const rpc=async message=>{
  if(message.type==='LP_REQUEST_CATALOG')return{ok:true,catalog:[]};
  if(message.type==='LP_REQUEST_OPERATION')return gate.run(message);
  if(message.type==='LP_REQUEST_SAVED')return postSave?postSave(message):{ok:true};
  if(message.type==='LP_REQUEST_POSTSAVE_STATUS')return postSaveStatus?postSaveStatus(message):{ok:true};
  return{ok:true};
 };
 const serviceModule={draftToFields:draft=>draft,create:config=>{
  const instance={scope:config.scope,prepares:0};created.push(instance);
  return{prepare:async args=>{preparations++;instance.prepares++;if(prepare)await prepare(args,instance);return {ok:true,form:{values:{},fields:[]},lists:{partners:[{id:'1',label:'1'}]}};},dependencies:async()=>({ok:true,lists:{}}),
   search:async args=>{searches++;return search?search(args,instance):{ok:true,matches:[]};},
   readRequest:async args=>{reads++;return read?read(args,instance):{ok:true,record:{id:args.id,base:args.base,form:{fields:[],values:{}}}};},
   createRequest:async args=>{writes++;await config.onBeforeWrite({...args,kind:'create',id:''});if(write)await write(args,instance);return{ok:true,state:'saved',verified:true,operationId:args.operationId,sourceCommitted:!!postSave,expectedSource:'SRC',record:{id:'123',base:args.base,form:{fields:[],values:{'CustomerRequest[partner_comment]':'SRC'}}}};},
  };
 }};
 const controller=controllerFactory({rpc,storage,serviceModule,crypto:webcrypto,...(maxCachedScopes?{maxCachedScopes}:{})});
 const context=i=>({operatorId:'operator',accountId:'account',conversationId:'conversation'+i,conversationUrl:'https://chat.partner-lead-centre.ru/chats/conversation'+i,client:{id:'client'+i},base:'kp',sourceCode:'SRC',partnerNumber:'1'});
 const status=i=>controller.getOperationStatus({context:context(i),base:'kp'});
 const draft={base:'kp',phone:'9991112233'};
 return{controller,context,status,created,data,removed,draft,preparations:()=>preparations,searches:()=>searches,reads:()=>reads,writes:()=>writes};
}
test('1000 dialogues release cold services while retaining the last 64 scopes',async()=>{
 const f=fixture();for(let i=0;i<1000;i++)await f.status(i);assert.equal(f.created.length,1000);
 for(let i=999;i>=936;i--)await f.status(i);assert.equal(f.created.length,1000);
 await f.status(0);assert.equal(f.created.length,1001,'cold scope must recreate its ephemeral service');
 await f.status(936);assert.equal(f.created.length,1001,'hot scope stays cached');assert.equal(f.removed.length,0,'eviction never removes storage');
});
test('pending writes pin a scope until completion under cache pressure',async()=>{
 const hold=deferred(),started=deferred(),f=fixture({maxCachedScopes:2,write:async()=>{started.resolve();await hold.promise;}});
 const saving=f.controller.createRequest({context:f.context(0),operationId:'operation-cache',draft:f.draft});await started.promise;
 for(let i=1;i<=12;i++)await f.status(i);
 const before=f.created.length;await f.status(0);assert.equal(f.created.length,before,'active writer service must not be recreated');
 hold.resolve();assert.equal((await saving).ok,true);
 for(let i=20;i<24;i++)await f.status(i);await f.status(0);assert.equal(f.created.length,before+5,'completed writer becomes evictable');
 const operation=(await f.status(0)).operation;assert.equal(operation.state,'saved');assert.equal(operation.operationId,'operation-cache');
});
test('an invalidated old failed lookup cannot delete a newer same-key lookup',async()=>{
 const old=deferred(),started=deferred();let calls=0;
 const f=fixture({search:async()=>{if(++calls===1){started.resolve();return old.promise;}return{ok:true,matches:[{id:'123',phone:'9991112233'}]};}});
 const input={context:f.context(0),phone:'9991112233',base:'kp'};
 const stale=f.controller.duplicates(input);await started.promise;
 await f.controller.createRequest({context:f.context(0),operationId:'operation-cache',draft:f.draft});
 assert.equal((await f.controller.duplicates(input)).matches.length,1);
 old.reject(Error('Old request failed'));await stale;
 await f.controller.duplicates(input);assert.equal(calls,2,'new cached lookup must survive an old rejection');
});
test('an explicit fresh create cycle keeps its generation while scope remains hot',async()=>{
 const f=fixture({maxCachedScopes:2}),context=f.context(0);
 await f.controller.getMetadata({context,draft:f.draft});
 await f.controller.newRequest({context,base:'kp',id:'123'});
 await f.controller.getMetadata({context,draft:f.draft});assert.equal(f.preparations(),2);
 await f.status(1);await f.controller.getMetadata({context,draft:f.draft});assert.equal(f.preparations(),2);
});

test('synchronous metadata cache access refreshes the dialogue LRU',async()=>{
 const f=fixture({maxCachedScopes:2}),context=f.context(0);
 await f.controller.getMetadata({context,draft:f.draft});await f.status(1);
 assert(f.controller.getCachedMetadata({context,draft:f.draft}));await f.status(2);
 const before=f.created.length;await f.status(0);assert.equal(f.created.length,before);
 await f.status(1);assert.equal(f.created.length,before+1);
});
test('pending background cached reads pin their scope and cold preloads cannot revive evicted service state',async()=>{
 const hold=deferred(),reading=deferred(),refreshed=deferred();let calls=0;
 const record=args=>({ok:true,record:{id:args.id,base:args.base,form:{fields:[],values:{}}}});
 const f=fixture({maxCachedScopes:2,read:async args=>{if(++calls===2){reading.resolve();return hold.promise;}return record(args);}}),context=f.context(0);
 const loaded=await f.controller.getRequest({context,base:'kp',id:'123',fresh:true});
 await f.controller.getRequest({context,base:'kp',id:'123',fresh:false,onRefresh:()=>refreshed.resolve()});await reading.promise;
 for(let i=1;i<6;i++)await f.status(i);
 const before=f.created.length;await f.status(0);assert.equal(f.created.length,before,'background read retains its service');
 hold.resolve(record({id:'123',base:'kp'}));await refreshed.promise;
 for(let i=6;i<9;i++)await f.status(i);
 await f.controller.getMetadata({context,draft:f.draft,id:'123',preloadedMetadata:loaded});
 assert.equal(calls,3,'preload from an evicted service must be re-read');
});
test('pending handoff pins until ACK then idle revisit reads durable post-save status without another write',async()=>{
 const hold=deferred(),sent=deferred();let acknowledged=false,statusReads=0;
 const f=fixture({maxCachedScopes:2,postSave:async()=>{sent.resolve();const ack=await hold.promise;acknowledged=true;return ack;},postSaveStatus:async()=>{statusReads++;return {ok:true,postSave:{state:acknowledged?'done':'pending'}};}}),context=f.context(0);
 assert.equal((await f.controller.createRequest({context,operationId:'operation-handoff',draft:f.draft})).ok,true);await sent.promise;
 for(let i=1;i<6;i++)await f.status(i);
 const before=f.created.length;await f.status(0);assert.equal(f.created.length,before,'in-flight handoff pins scope');
 hold.resolve({ok:true,pending:true,postSave:{state:'pending'}});await hold.promise;await new Promise(resolve=>setImmediate(resolve));
 for(let i=6;i<9;i++)await f.status(i);
 const result=await f.controller.getPostSaveStatus({context,base:'kp',id:'123'});
 assert.equal(result.postSave.state,'done');assert.equal(statusReads,1);assert.equal(f.writes(),1);assert(f.created.length>before+3,'idle scope was recreated after ACK');
});
test('a read started before a new form generation cannot refill its fresh metadata',async()=>{
 const hold=deferred(),reading=deferred();
 const f=fixture({read:async()=>{reading.resolve();return hold.promise;}}),context=f.context(0);
 const stale=f.controller.getRequest({context,base:'kp',id:'123',fresh:true});await reading.promise;
 await f.controller.newRequest({context,base:'kp',id:'123'});
 await f.controller.getMetadata({context,draft:f.draft});
 hold.resolve({ok:true,record:{id:'123',base:'kp',form:{fields:[],values:{}}}});
 assert.equal((await stale).state,'superseded');
 const current=f.controller.getCachedMetadata({context,draft:f.draft});assert(current);assert.equal(current.record,undefined);
});

function observeController(){
 const maps=[],sets=[];
 class ObservedMap extends Map{constructor(...args){super(...args);maps.push(this);}}
 class ObservedSet extends Set{constructor(...args){super(...args);sets.push(this);}}
 const sandbox={module:{exports:{}},Map:ObservedMap,Set:ObservedSet,URL,URLSearchParams,TextEncoder,AbortController,setTimeout,clearTimeout,crypto:webcrypto,LeadPartnerRules:globalThis.LeadPartnerRules,LeadPartnerSourceCatalog:globalThis.LeadPartnerSourceCatalog};
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/leadchat-request-controller.js'),'utf8'),sandbox,{filename:'leadchat-request-controller.js'});
 const forms=()=>maps.filter(cache=>[...cache.keys()].some(key=>typeof key==='string' && /\|(?:record|create):/.test(key)));
 const preparations=()=>sets.flatMap(cache=>[...cache].filter(key=>typeof key==='string' && /\|create:/.test(key)));
 return{create:sandbox.module.exports.create,maps,sets,forms,preparations};
}
test('1000 record reads in one hot dialogue keep every native read cache bounded',async()=>{
 const observed=observeController(),f=fixture({controllerFactory:observed.create}),context=f.context(0);
 for(let i=1;i<=1000;i++)await f.controller.getRequest({context,base:'kp',id:String(i),fresh:true});
 assert(observed.forms().length>=2);for(const cache of observed.forms())assert(cache.size<=250,'native record cache exceeded 250');
 assert.equal(f.removed.length,0);
});
test('1000 phone preparations keep live preparation markers within retained native forms',async()=>{
 const observed=observeController(),f=fixture({controllerFactory:observed.create}),context=f.context(0);
 for(let i=0;i<1000;i++)await f.controller.getMetadata({context,draft:{...f.draft,phone:String(9000000000+i)}});
 assert(observed.preparations().length<=250,'live preparation markers exceeded retained native forms');
 assert(!observed.preparations().some(key=>key.endsWith('create:9000000000')),'evicted form marker retained');
});
test('1000 explicit new cycles clear obsolete native preparation markers',async()=>{
 const observed=observeController(),f=fixture({controllerFactory:observed.create}),context=f.context(0);
 for(let i=0;i<1000;i++){await f.controller.getMetadata({context,draft:f.draft});await f.controller.newRequest({context,base:'kp'});}
 assert.equal(observed.preparations().length,0,'prior generations left preparation markers');
});
test('a burst of pending preparations can exceed the cap but settles back to 250',async()=>{
 const observed=observeController(),hold=deferred(),started=deferred();let count=0;
 const f=fixture({controllerFactory:observed.create,prepare:async()=>{if(++count===300)started.resolve();await hold.promise;}}),context=f.context(0);
 const pending=Array.from({length:300},(_,i)=>f.controller.getMetadata({context,draft:{...f.draft,phone:String(9000000000+i)}}));
 await started.promise;assert(observed.forms().some(cache=>cache.size===300),'pending entries should stay pinned');hold.resolve();await Promise.all(pending);
 for(const cache of observed.forms())assert(cache.size<=250,'settled native cache did not regain its cap');
 assert(observed.preparations().length<=250);
});
test('a late old preparation cannot recreate its cleared generation marker',async()=>{
 const observed=observeController(),hold=deferred(),started=deferred();let count=0;
 const f=fixture({controllerFactory:observed.create,prepare:async()=>{if(++count===1){started.resolve();await hold.promise;}}}),context=f.context(0);
 const stale=f.controller.getMetadata({context,draft:f.draft});await started.promise;
 await f.controller.newRequest({context,base:'kp'});await f.controller.getMetadata({context,draft:f.draft});hold.resolve();await stale;
 assert.equal(observed.preparations().length,1);assert(observed.preparations()[0].includes('|1|create:'),'old generation marker was resurrected');
});
