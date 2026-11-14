'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../extension');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=ms=>new Promise(resolve=>setTimeout(resolve,ms).unref());
class CDP {
 constructor(socket){this.socket=socket;this.id=0;this.pending=new Map();socket.addEventListener('close',()=>{for(const p of this.pending.values())p.reject(Error('Chromium DevTools closed'));this.pending.clear();});socket.addEventListener('message',e=>{const x=JSON.parse(e.data);if(!x.id)return;const p=this.pending.get(x.id);if(!p)return;this.pending.delete(x.id);x.error?p.reject(Error(x.error.message)):p.resolve(x.result);});}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}));});}
 async eval(expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value;}
 async until(expression){for(let i=0;i<150;i++){if(await this.eval(expression))return;await sleep(40);}throw Error('Timed out: '+expression+'; page='+await this.eval('JSON.stringify({errors:window.harness?.errors,error:document.getElementById("error")?.textContent,items:window.harness?.items})'));}
}
test('real panel retains ambiguous writes and restores read-only recovery',async t=>{
 const executable=process.env.CHROMIUM_PATH || '/usr/bin/chromium';assert.ok(fs.existsSync(executable),'Chromium required; set CHROMIUM_PATH');
 const server=http.createServer((req,res)=>{let file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);if(file==='before.js'){res.setHeader('Content-Type','text/javascript');res.end('window.module={exports:{}};');return;}if(file==='fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(__dirname,'panel-recovery.fixture.js')));return;}
 file=file || 'leadchat-request-panel.html';const target=path.resolve(root,file);if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{let body=fs.readFileSync(file==='leadchat-request-panel.js' && process.env.PANEL_SOURCE || target);if(file==='leadchat-request-panel.html')body=body.toString().replace('<script defer="" src="leadchat-request-panel.js"></script>','<script defer src="before.js"></script><script defer src="leadchat-request-panel.js"></script><script defer src="fixture.js"></script>');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'lp-panel-recovery-'));
 const child=spawn(executable,['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});let socket,cdp,spawnFailure;child.on('error',error=>{spawnFailure=error;});
 t.after(async()=>{
  const exited=child.exitCode!==null || child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve));
  if(cdp && socket?.readyState===WebSocket.OPEN)void cdp.send('Browser.close').catch(()=>{});else child.kill();
  await Promise.race([exited,deadline(3000)]);
  if(child.exitCode===null && child.signalCode===null){child.kill('SIGKILL');await Promise.race([exited,deadline(3000)]);}
  socket?.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
 });
 let browserUrl='';child.stderr.on('data',b=>{const m=b.toString().match(/DevTools listening on (ws:\/\/\S+)/);if(m)browserUrl=m[1];});
 for(let i=0;i<150&&!browserUrl;i++)await sleep(40);if(spawnFailure)throw spawnFailure;assert.ok(browserUrl,'Chromium DevTools started');
 const debugOrigin=new URL(browserUrl);const targets=await (await fetch('http://'+debugOrigin.host+'/json/list')).json();socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});cdp=new CDP(socket);
 await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test'});
 await cdp.until('window.harness && document.getElementById("draft-state").textContent.includes("сохран")');
 await t.test('reload keeps ambiguous create and exposes recovery without a POST',async()=>{assert.equal(await cdp.eval('harness.items[harness.key].operation?.operationId'),'offline-operation-123');assert.equal(await cdp.eval('document.getElementById("recovery").hidden'),false);assert.equal(await cdp.eval('document.getElementById("create-request").disabled'),true);assert.deepEqual(await cdp.eval('harness.errors'),[]);});
 await t.test('ambiguous reconcile keeps same operation and never creates a new request',async()=>{await cdp.eval('document.getElementById("check-result").click()');await cdp.until('harness.calls.length>0');await sleep(60);assert.equal(await cdp.eval('harness.items[harness.key].operation?.operationId'),'offline-operation-123');assert.equal(await cdp.eval('harness.calls.every(x=>x.command==="reconcile")'),true);});
 await t.test('transport failure keeps recovery and durable state',async()=>{await cdp.eval('harness.throwTransport=true;document.getElementById("check-result").click()');await cdp.until('document.getElementById("error").textContent.includes("transport")');assert.equal(await cdp.eval('harness.items[harness.key].operation?.operationId'),'offline-operation-123');await cdp.eval('harness.throwTransport=false');});
 await t.test('safe rejection releases operation and permits corrected form',async()=>{await cdp.eval('harness.result={ok:false,state:"rejected",writeStarted:false,safeToRetry:true,code:"preflight",error:"Offline invalid input"};document.getElementById("check-result").click()');await cdp.until('harness.items[harness.key].operation===null');assert.equal(await cdp.eval('document.getElementById("recovery").hidden'),true);});
 await t.test('reload restores an update operation from durable status without a local pending write',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&kind=update&durable=1'});
  await cdp.until('window.harness && harness.items[harness.key]?.operation?.kind==="update"');
  assert.equal(await cdp.eval('harness.items[harness.key].operation.id'),'4321');
  assert.equal(await cdp.eval('document.getElementById("recovery").hidden'),false);
 });
 await t.test('verified success clears pending operation and displays exact saved card',async()=>{
  await cdp.eval('harness.result={ok:true,verified:true,state:"saved",record:{id:"4321",base:"kp",customerId:"123",verified:true,form:{fields:[],values:{}},capabilities:{readOnly:true}}};document.getElementById("check-result").click()');
  await cdp.until('harness.items[harness.key].operation===null && harness.items[harness.key].record?.id==="4321"');
  assert.equal(await cdp.eval('document.getElementById("recovery").hidden'),true);
 });
 await t.test('late uncertain result updates original scope without locking another dialog',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test'});
  await cdp.until('window.harness && harness.items[harness.key]?.operation?.state==="uncertain"');
  await cdp.eval('harness.deferReconcile=true;document.getElementById("check-result").click()');
  await cdp.until('typeof harness.resolveReconcile==="function"');
  await cdp.eval('harness.oldKey=harness.key;harness.send({...harness.context,conversationId:"124",chatId:"124",conversationUrl:"https://chat.partner-lead-centre.ru/chats/124",dialogUrl:"https://chat.partner-lead-centre.ru/chats/124",client:{id:"124",name:"Other"}})');
  await cdp.until('Object.keys(harness.items).filter(k=>k.startsWith("leadchat.request.panel.v3:")).length===2');
  await cdp.eval('harness.resolveReconcile(harness.result)');
  await cdp.until('document.getElementById("recovery").hidden');
  assert.equal(await cdp.eval('harness.items[harness.oldKey].operation.operationId'),'offline-operation-123');
  assert.equal(await cdp.eval('Object.entries(harness.items).find(([k])=>k!==harness.oldKey)[1].operation'),null);
  assert.deepEqual(await cdp.eval('harness.errors'),[]);
 });

 await t.test('a trusted Save click followed by transport failure keeps its operation ID',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1'});
  await cdp.until('window.harness && !document.getElementById("save-request").disabled && !document.body.inert');
  await cdp.eval('document.getElementById("save-request").focus()');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await cdp.until('harness.calls.some(x=>x.command==="performAction")');
  await cdp.until('harness.items[harness.key]?.operation?.state==="uncertain"');
  assert.equal(await cdp.eval('harness.items[harness.key].operation.operationId===harness.calls.find(x=>x.command==="performAction").operationId'),true);
  assert.equal(await cdp.eval('document.getElementById("save-request").disabled'),true);
  assert.equal(await cdp.eval('document.getElementById("recovery").hidden'),false);
 });

 await t.test('follow-up from a lookup card explicitly starts a fresh create cycle',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&lookup=1'});
  await cdp.until('window.harness && !document.getElementById("save-request").disabled && !document.body.inert');
  await cdp.eval('document.getElementById("record-followup").focus()');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await cdp.until('harness.items[harness.key]?.draft?.requestType==="2"');
  assert.equal(await cdp.eval('harness.calls.filter(x=>x.command==="newRequest").length'),1);
  assert.equal(await cdp.eval('harness.items[harness.key].draft.creationCycleId'),'offline-cycle-next');
 });

 await t.test('reload preserves edited draft while an update remains uncertain',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&pendingEdit=1'});
  await cdp.until('window.harness && harness.items[harness.key]?.operation?.state==="uncertain" && document.getElementById("draft-state").textContent.includes("сохран")');
  assert.equal(await cdp.eval('harness.items[harness.key].draft.comments'),'Intended unsent edit');
  assert.equal(await cdp.eval('document.getElementById("comments").value'),'Intended unsent edit');
 });
 await t.test('another writer is adopted only through same-scope durable status',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test'});
  await cdp.until('window.harness && !document.getElementById("check-result").hidden');
  await cdp.eval('harness.durable={operationId:"offline-other-writer",kind:"create",state:"uncertain"};harness.result={ok:false,state:"uncertain",operationId:"offline-other-writer",error:"Another writer active"};document.getElementById("check-result").click()');
  await cdp.until('harness.calls.length>0');await sleep(40);
  assert.equal(await cdp.eval('harness.items[harness.key].operation.operationId'),'offline-other-writer');
  await cdp.eval('document.getElementById("check-result").click()');
  await cdp.until('harness.calls.length>1');
  assert.equal(await cdp.eval('harness.calls.at(-1).operationId'),'offline-other-writer');
 });

 await t.test('unconfirmed other operation ID cannot replace current recovery target',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test'});
  await cdp.until('window.harness && !document.getElementById("check-result").hidden');
  await cdp.eval('harness.result={ok:false,state:"uncertain",operationId:"offline-untrusted-writer"};document.getElementById("check-result").click()');
  await cdp.until('harness.calls.length===1');await sleep(40);
  assert.equal(await cdp.eval('harness.items[harness.key].operation.operationId'),'offline-operation-123');
  await cdp.eval('document.getElementById("check-result").click()');
  await cdp.until('document.getElementById("error").textContent.includes("подтвердить")');
  assert.equal(await cdp.eval('harness.calls.length'),1);
 });
 await t.test('verified response for another card is rejected and keeps update guard',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&kind=update&durable=1'});
  await cdp.until('window.harness && harness.items[harness.key]?.operation?.kind==="update"');
  await cdp.eval('harness.result={ok:true,verified:true,state:"saved",record:{id:"9999",base:"kp",verified:true,form:{fields:[],values:{}}}};document.getElementById("check-result").click()');
  await cdp.until('document.getElementById("error").textContent.includes("другую карточку")');
  assert.equal(await cdp.eval('harness.items[harness.key].operation.id'),'4321');
  assert.equal(await cdp.eval('harness.items[harness.key].record'),null);
 });
 await t.test('cancellation transport failure retains its original guarded operation',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1'});
  await cdp.until('window.harness && !document.getElementById("save-request").disabled && !document.body.inert');
  await cdp.eval('document.querySelector("[data-native-action=cancel_kc]").focus()');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await cdp.until('harness.calls.some(x=>x.command==="cancelRequest")');await sleep(40);
  assert.equal(await cdp.eval('harness.items[harness.key].operation?.state'),'uncertain');
  assert.equal(await cdp.eval('harness.items[harness.key].operation?.operationId===harness.calls.find(x=>x.command==="cancelRequest").operationId'),true);
 });

 await t.test('proven unapplied edit unlocks corrected draft for deliberate retry',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&pendingEdit=1'});
  await cdp.until('window.harness && harness.items[harness.key]?.operation?.state==="uncertain" && !document.getElementById("check-result").disabled');
  await cdp.eval('harness.result={ok:false,state:"rejected",code:"edit_not_applied",retryable:true,writeStarted:true,operationId:"offline-operation-123",retryDraft:{comments:"Retained retry draft"},record:structuredClone(harness.items[harness.key].record),error:"Edit was not applied"};document.getElementById("check-result").click()');
  await cdp.until('harness.items[harness.key].operation===null');
  assert.equal(await cdp.eval('document.getElementById("comments").value'),'Retained retry draft');
  assert.equal(await cdp.eval('document.getElementById("save-request").disabled'),false);
  assert.equal(await cdp.eval('harness.calls.every(x=>x.command==="reconcile")'),true);
 });
 for(const mismatch of ['operation','id','base'])await t.test('unapplied-edit proof with another '+mismatch+' keeps original guard',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&pendingEdit=1'});
  await cdp.until('window.harness && harness.items[harness.key]?.operation?.state==="uncertain" && !document.getElementById("check-result").disabled');
  await cdp.eval('harness.beforeCalls=harness.calls.length;harness.result={ok:false,state:"rejected",code:"edit_not_applied",retryable:true,writeStarted:true,operationId:"offline-operation-123",retryDraft:{comments:"Invalid replacement"},record:structuredClone(harness.items[harness.key].record),error:"Untrusted retry proof"}');
  await cdp.eval(mismatch==='operation'?'harness.result.operationId="offline-other-operation"':mismatch==='id'?'harness.result.record.id="9999"':'harness.result.record.base="mnc"');
  await cdp.eval('document.getElementById("check-result").click()');
  await cdp.until('harness.calls.length>harness.beforeCalls');await sleep(40);
  assert.equal(await cdp.eval('harness.items[harness.key].operation?.operationId'),'offline-operation-123');
  assert.equal(await cdp.eval('document.getElementById("save-request").disabled'),true);
  assert.notEqual(await cdp.eval('document.getElementById("comments").value'),'Invalid replacement');
 });
 await t.test('safe refusal without a matching retry proof cannot replace the current card or draft',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&pendingEdit=1'});
  await cdp.until('window.harness && harness.items[harness.key]?.operation?.state==="uncertain" && !document.getElementById("check-result").disabled');
  await cdp.eval('harness.result={ok:false,state:"rejected",code:"edit_not_applied",retryable:true,writeStarted:false,operationId:"offline-operation-123",retryDraft:{comments:"Invalid replacement"},record:{...structuredClone(harness.items[harness.key].record),base:"mnc"},error:"Malformed retry proof"};document.getElementById("check-result").click()');
  await cdp.until('harness.items[harness.key].operation===null');
  assert.equal(await cdp.eval('harness.items[harness.key].record.base'),'kp');
  assert.notEqual(await cdp.eval('harness.items[harness.key].draft.comments'),'Invalid replacement');
 });

 await t.test('direct typing in an editable saved card autosaves before switching dialogs',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&editableComments=1'});
  await cdp.until('window.harness && !document.getElementById("comments").disabled && !document.body.inert');
  await cdp.eval('document.getElementById("comments").value="";document.getElementById("comments").focus()');
  await cdp.send('Input.insertText',{text:'Edited locally without submitting'});
  await sleep(350);
  assert.equal(await cdp.eval('harness.items[harness.key].draft.comments'),'Edited locally without submitting');
  assert.equal(await cdp.eval('harness.calls.some(x=>["performAction","cancelRequest"].includes(x.command))'),false);
 });

 await t.test('returning to a dialog before its queued disk write completes preserves the newest draft',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&editableComments=1'});
  await cdp.until('window.harness && !document.getElementById("comments").disabled && !document.body.inert && document.getElementById("draft-state").textContent.includes("сохран")');
  await cdp.eval('harness.delayKey=harness.key;document.getElementById("comments").value="";document.getElementById("comments").focus()');
  await cdp.send('Input.insertText',{text:'Newest draft while storage is slow'});
  await cdp.until('harness.delayedWrites.length===1');
  await cdp.eval('harness.send({...harness.context,conversationId:"124",chatId:"124",conversationUrl:"https://chat.partner-lead-centre.ru/chats/124",dialogUrl:"https://chat.partner-lead-centre.ru/chats/124",client:{id:"124",name:"Other"}})');
  await cdp.until('Object.keys(harness.items).filter(k=>k.startsWith("leadchat.request.panel.v3:")).length===2');
  await cdp.eval('harness.send()');await sleep(50);
  await cdp.eval('harness.releaseWrites()');
  await cdp.until('!document.body.inert && document.getElementById("comments").value==="Newest draft while storage is slow"');
  assert.equal(await cdp.eval('harness.items[harness.key].draft.comments'),'Newest draft while storage is slow');
 });

 await t.test('destroyed panel ignores pending card reads and later host context messages',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&editableComments=1'});
  await cdp.until('window.harness && !document.getElementById("comments").disabled && !document.body.inert');
  await cdp.eval('harness.deferRequest=true;document.getElementById("refresh-record").click()');
  await cdp.until('typeof harness.resolveRequest==="function"');
  await cdp.eval('harness.instance.destroy();const record=structuredClone(harness.items[harness.key].record);record.comments="Late response must not repaint";record.canonical.comments=record.comments;harness.resolveRequest({ok:true,verified:true,record})');
  await sleep(100);
  assert.equal(await cdp.eval('document.getElementById("comments").value'),'CRM baseline comment');
  await cdp.eval('harness.send({...harness.context,conversationId:"124",chatId:"124",conversationUrl:"https://chat.partner-lead-centre.ru/chats/124",dialogUrl:"https://chat.partner-lead-centre.ru/chats/124",client:{id:"124",name:"Other"}})');
  await sleep(100);
  assert.equal(await cdp.eval('Object.keys(harness.items).filter(k=>k.startsWith("leadchat.request.panel.v3:")).length'),1);
 });

 await t.test('destroying a panel still records an already dispatched verified write without repainting it',async()=>{
  await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-test&editor=1&editableComments=1'});
  await cdp.until('window.harness && !document.getElementById("save-request").disabled && !document.body.inert');
  await cdp.eval('harness.deferWrite=true;document.getElementById("save-request").focus()');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await cdp.until('typeof harness.resolveWrite==="function"');
  await cdp.eval('harness.instance.destroy();const record=structuredClone(harness.items[harness.key].record);record.comments="Already dispatched write confirmed";record.canonical.comments=record.comments;harness.resolveWrite({ok:true,verified:true,state:"saved",record})');
  await cdp.until('harness.items[harness.key].record?.comments==="Already dispatched write confirmed" && harness.items[harness.key].operation===null');
  assert.equal(await cdp.eval('document.getElementById("comments").value'),'CRM baseline comment');
  assert.deepEqual(await cdp.eval('harness.errors'),[]);
 });

});
