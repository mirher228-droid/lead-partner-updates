'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const CONFIG='leadPartnerSharedConfigV1',KEY='leadPartnerSharedCatalogV1';
const endpoint=name=>'https://script.google.com/macros/s/'+name+'/exec';
const entries=(prefix,count)=>Array.from({length:count},(_,i)=>({code:prefix+i,url:'https://example.test/'+prefix+i}));
async function fixture(){
 const initial=entries('old',12),data={[CONFIG]:{url:endpoint('old')},[KEY]:{endpoint:endpoint('old'),revision:12,entries:initial}};
 const listeners=[],responses=new Map([[endpoint('old'),{ok:true,schema:1,revision:12,entries:initial}],[endpoint('new'),{ok:true,schema:1,revision:1,entries:entries('new',2)}]]);
 const event=()=>({addListener(){}}),storage={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])])),set:async values=>Object.assign(data,structuredClone(values))};
 const chrome={storage:{local:storage,onChanged:event()},runtime:{id:'fixture',getURL:n=>'chrome-extension://fixture/'+n,onStartup:event(),onInstalled:event(),onMessage:{addListener:f=>listeners.push(f)}},alarms:{get:async()=>({periodInMinutes:3}),create:async()=>{},onAlarm:event()}};
 const sandbox=vm.createContext({URL,console,chrome,AbortController,setTimeout,clearTimeout,fetch:async url=>{
  assert.ok(responses.has(url),'only synthetic catalogue endpoints are allowed');
  return {ok:true,url,text:async()=>JSON.stringify(responses.get(url))};
 }});
 for(const name of ['leadpartner-rules.js','crm-avito-owner-sources.js','avito-source-catalog.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',name),'utf8'),sandbox,{filename:name});
 await sandbox.LeadPartnerSourceCatalog.ready();
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/shared-sources-background.js'),'utf8'),sandbox);
 const send=(command,url)=>new Promise(resolve=>{
  assert.equal(listeners[0]({type:'LP_SHARED_SOURCES',command,url},{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve),true);
 });
 await send('sync');
 return {data,responses,send,api:sandbox.LeadPartnerSourceCatalog};
}
test('explicit new catalogue endpoint can legitimately start with fewer entries and lower revision',async()=>{
 const f=await fixture(),result=await f.send('configure',endpoint('new'));
 assert.equal(result.ok,true);assert.equal(f.data[KEY].endpoint,endpoint('new'));
 assert.equal(f.api.entries.length,2);assert.equal(f.api.entries[0].code,'new0');
});
test('same endpoint still rejects drastic shrink and retains verified catalogue',async()=>{
 const f=await fixture();f.responses.set(endpoint('old'),{ok:true,schema:1,revision:13,entries:entries('old',2)});
 const result=await f.send('sync');assert.equal(result.ok,false);assert.equal(f.api.entries.length,12);assert.equal(f.data[KEY].revision,12);
});
