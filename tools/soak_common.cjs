#!/usr/bin/env node
'use strict';
// Long-lived production panel, synthetic boundaries, real elapsed-time assertions.
// Requires Node 22+ and Chromium; installs nothing and never publishes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const crypto=require('node:crypto'),{spawn}=require('node:child_process'),{parseArgs}=require('node:util');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ROOT=path.resolve(__dirname,'..'),EXT=path.join(ROOT,'extension');
const FIXTURE=path.join(ROOT,'tests/helpers/soak-panel.fixture.js');
const FIVE_HOURS=18000000,COMMAND_TIMEOUT=12000;
function integer(raw,name,min,max) {
  if(!/^\d+$/.test(raw || '') || !Number.isSafeInteger(Number(raw)) || Number(raw)<min || Number(raw)>max)
    throw Error(name+' must be an integer from '+min+' to '+max);
  return Number(raw);
}
function fingerprint() {
  const files=[];
  function visit(directory) {for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw Error('Source symlink is not allowed: '+path.relative(ROOT,file));
    if(entry.isDirectory())visit(file);else if(entry.isFile())files.push(file);
  }}
  visit(EXT);files.push(__filename,FIXTURE);
  const hash=crypto.createHash('sha256');
  for(const file of files.sort()){hash.update(path.relative(ROOT,file)+'\0');hash.update(fs.readFileSync(file));hash.update('\0');}
  return {sha256:hash.digest('hex'),files:files.length};
}
class CDP {
  constructor(socket) {
    this.socket=socket;this.id=0;this.pending=new Map();this.handlers=new Map();this.failure=null;
    socket.addEventListener('close',()=>this.rejectAll(Error('Chromium DevTools closed')));
    socket.addEventListener('message',event=>{
      let message;try{message=JSON.parse(event.data);}catch(error){this.failure=error;return;}
      if(!message.id){const handler=this.handlers.get(message.method);if(handler)Promise.resolve(handler(message.params)).catch(error=>{this.failure=error;});return;}
      const job=this.pending.get(message.id);if(!job)return;
      this.pending.delete(message.id);clearTimeout(job.timer);
      message.error?job.reject(Error(message.error.message)):job.resolve(message.result);
    });
  }
  rejectAll(error){for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(error);}this.pending.clear();}
  send(method,params={}) {
    if(this.failure)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{
      const id=++this.id,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP command deadline: '+method));},COMMAND_TIMEOUT);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({id,method,params}));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async evaluate(expression) {
    const result=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async until(expression,timeout=8000) {
    const end=performance.now()+timeout;
    while(performance.now()<end){if(await this.evaluate(expression))return;await sleep(35);}
    throw Error('Browser condition deadline: '+expression+'; '+await this.evaluate('JSON.stringify({failures:window.soak?.failures,error:document.getElementById("error")?.textContent,inert:document.body.inert})'));
  }
  close(){this.rejectAll(Error('CDP cleanup'));this.socket.close();}
}
async function connect(url) {
  const socket=new WebSocket(url);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.close();reject(Error('WebSocket connection deadline'));},COMMAND_TIMEOUT);
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('WebSocket connection failed'));},{once:true});
  });
  return new CDP(socket);
}
function controllerWorkload() {
  // Actual long-lived controller + durable operation gate, synthetic CRM service.
  // Observe only maps allocated by create(); recording every temporary map would
  // itself create an artificial leak in a multi-hour measurement.
  const maps=[],data=Object.create(null);
  let tracking=false,createdServices=0,recordReads=0,removed=0,batches=0;
  class ObservedMap extends Map {constructor(...args){super(...args);if(tracking)maps.push(this);}}
  const rules=require(path.join(EXT,'leadpartner-rules.js'));
  const sandbox={module:{exports:{}},Map:ObservedMap,Set,URL,URLSearchParams,TextEncoder,AbortController,
    setTimeout,clearTimeout,crypto:crypto.webcrypto,LeadPartnerRules:rules,LeadPartnerSourceCatalog:{match:()=>null}};
  vm.runInNewContext(fs.readFileSync(path.join(EXT,'leadchat-request-controller.js'),'utf8'),sandbox,{filename:'leadchat-request-controller.js'});
  const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values)),remove:async()=>{removed++;throw Error('Cache eviction removed durable storage');}};
  const gate=require(path.join(EXT,'leadchat-request-background.js')).create({storage});
  const serviceModule={draftToFields:draft=>draft,create:()=>{
    createdServices++;
    return {readRequest:async args=>{recordReads++;return {ok:true,record:{id:args.id,base:args.base,form:{fields:[],values:{}}}};}};
  }};
  const rpc=async message=>message.type==='LP_REQUEST_OPERATION'?gate.run(message):{ok:true};
  tracking=true;
  const controller=sandbox.module.exports.create({rpc,storage,serviceModule,crypto:crypto.webcrypto});
  tracking=false;
  const contexts=Array.from({length:129},(_,index)=>({operatorId:'soak-op',accountId:'soak-account',conversationId:'soak-cache-'+index,
    conversationUrl:'https://chat.partner-lead-centre.ru/chats/soak-cache-'+index,client:{id:'soak-client-'+index},base:'kp'}));
  function inspect() {
    const sizes=maps.map(map=>map.size),largest=Math.max(0,...sizes);
    if(largest>250)throw Error('Long-lived controller map exceeded250: '+sizes.join(','));
    if(removed)throw Error('Cache churn removed durable journal data');
    if(Object.keys(data).length>129)throw Error('Synthetic durable storage escaped finite cache contexts');
    return {batches,hotRecordIds:1000,coldContexts:128,createdServices,recordReads,mapSizes:sizes,
      largestMap:largest,durableKeys:Object.keys(data).length,nodeMemory:process.memoryUsage()};
  }
  return {inspect,async cycle() {
    for(let offset=0;offset<32;offset++){
      const id=String(100000+(batches*32+offset)%1000);
      const result=await controller.getRequest({context:contexts[0],base:'kp',id,fresh:true});
      if(result?.record?.id!==id || result?.record?.base!=='kp')throw Error('Actual controller returned another hot record');
    }
    for(let offset=0;offset<8;offset++)await controller.getOperationStatus({context:contexts[1+(batches*8+offset)%128],base:'kp'});
    batches++;return inspect();
  }};
}
function createMemoryMonitor() {
  let memoryBaseline=null,warmupBaseline=null,lastSampleOrder=null;
  const warmupSamples=[],trend={samples:0,sumX:0,sumY:0,sumXY:0,sumXX:0};
  const warmupPolicy=Object.freeze({minimumCycles:1200,maximumCycles:1320,requiredStableSamples:3,maximumNativeNodeRange:32,
    measuredNativeUndoDepth:1000,description:'First1200 active cycles include measured Chromium editor undo-cache warmup; no idle padding.'});
  const snapshot=()=>structuredClone({memoryBaseline,warmupBaseline,warmupPolicy,warmupSamples});
  function observe({cycles,elapsedMs,heap,metrics,liveDom}) {
    if(!Number.isSafeInteger(cycles) || cycles<0 || !Number.isFinite(elapsedMs) || elapsedMs<0
      || !Number.isFinite(heap?.usedSize) || heap.usedSize<=0 || !Number.isFinite(metrics?.Nodes) || metrics.Nodes<1
      || !Number.isFinite(metrics?.Documents) || metrics.Documents<1 || !Number.isFinite(metrics?.JSEventListeners) || metrics.JSEventListeners<0
      || !Number.isFinite(liveDom?.nodes) || liveDom.nodes<1)throw Error('Invalid browser memory sample');
    if(lastSampleOrder && (cycles<lastSampleOrder.cycles || elapsedMs<lastSampleOrder.elapsedMs))throw Error('Invalid non-monotonic browser memory sample');
    if(!warmupBaseline)warmupBaseline={heap:heap.usedSize,liveNodes:liveDom.nodes,listeners:metrics.JSEventListeners,documents:metrics.Documents};
    const startupBounds={heap:Math.max(warmupBaseline.heap*2,warmupBaseline.heap+32*1024*1024),
      liveNodes:Math.max(warmupBaseline.liveNodes*1.25,warmupBaseline.liveNodes+256),
      listeners:Math.max(warmupBaseline.listeners*1.25,warmupBaseline.listeners+64),documents:warmupBaseline.documents+2};
    if(heap.usedSize>startupBounds.heap || liveDom.nodes>startupBounds.liveNodes || metrics.JSEventListeners>startupBounds.listeners || metrics.Documents>startupBounds.documents)
      throw Error('Connected DOM/heap/listener growth exceeded fixed startup bounds: '+JSON.stringify({heap:heap.usedSize,liveDom,metrics,bounds:startupBounds}));
    // Controls with the actual panel and a bare textarea demonstrate a1000-step
    // native UndoStack cap. Require its plateau before fixing retained-node bounds.
    if(!memoryBaseline && cycles>=1000){
      if(cycles>warmupPolicy.maximumCycles)throw Error('Native editor cache did not reach a stable plateau by the fixed warmup deadline: '+JSON.stringify(warmupSamples));
      if(!warmupSamples.length || cycles>warmupSamples.at(-1).cycles){
        warmupSamples.push({cycles,elapsedMs,nodes:metrics.Nodes,listeners:metrics.JSEventListeners,documents:metrics.Documents});
        if(warmupSamples.length>warmupPolicy.requiredStableSamples)warmupSamples.shift();
      }
      const stable=warmupSamples.length===warmupPolicy.requiredStableSamples
        && Math.max(...warmupSamples.map(value=>value.nodes))-Math.min(...warmupSamples.map(value=>value.nodes))<=warmupPolicy.maximumNativeNodeRange
        && warmupSamples.every(value=>value.listeners===metrics.JSEventListeners && value.documents===metrics.Documents);
      if(cycles>=warmupPolicy.minimumCycles && stable)memoryBaseline={elapsedMs,heap:heap.usedSize,nodes:metrics.Nodes,listeners:metrics.JSEventListeners,documents:metrics.Documents};
      else if(cycles>=warmupPolicy.maximumCycles)throw Error('Native editor cache did not reach a stable plateau by the fixed warmup deadline: '+JSON.stringify(warmupSamples));
    }
    let postWarmupBounds=null;
    if(memoryBaseline){
      postWarmupBounds={heap:Math.max(memoryBaseline.heap*2,memoryBaseline.heap+32*1024*1024),
        nodes:Math.max(memoryBaseline.nodes*1.25,memoryBaseline.nodes+256),
        listeners:Math.max(memoryBaseline.listeners*1.25,memoryBaseline.listeners+64),documents:memoryBaseline.documents+2};
      if(heap.usedSize>postWarmupBounds.heap || metrics.Nodes>postWarmupBounds.nodes || metrics.JSEventListeners>postWarmupBounds.listeners || metrics.Documents>postWarmupBounds.documents)
        throw Error('Post-warmup retained heap/DOM/listener growth exceeded fixed bounds: '+JSON.stringify({heap:heap.usedSize,metrics,bounds:postWarmupBounds}));
      const x=(elapsedMs-memoryBaseline.elapsedMs)/3600000,y=heap.usedSize/1024/1024;
      trend.samples++;trend.sumX+=x;trend.sumY+=y;trend.sumXY+=x*y;trend.sumXX+=x*x;
    }
    const divisor=trend.samples*trend.sumXX-trend.sumX**2;
    const heapSlopeMiBPerHour=divisor>0?(trend.samples*trend.sumXY-trend.sumX*trend.sumY)/divisor:null;
    lastSampleOrder={cycles,elapsedMs};
    return {...snapshot(),startupBounds,postWarmupBounds,heapSlopeMiBPerHour};
  }
  return Object.freeze({observe,snapshot});
}

async function main() {
  const {values}=parseArgs({options:{'duration-ms':{type:'string',default:String(FIVE_HOURS)},
    'interval-ms':{type:'string',default:'1500'},output:{type:'string'},'negative-control':{type:'string'},help:{type:'boolean'}}});
  if(values.help){console.log('node tools/soak_common.cjs [--duration-ms 18000000] [--interval-ms 1500] [--output /workspace/reliability-runs/RUN]\nA short duration is a smoke test, never a five-hour result. No dependencies or external network.');return;}
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22+ is required');
  const duration=integer(values['duration-ms'],'duration-ms',1000,7*24*3600000);
  const interval=integer(values['interval-ms'],'interval-ms',1000,5000);
  const negative=values['negative-control'];if(negative && !['draft','mutation'].includes(negative))throw Error('negative-control must be draft or mutation');
  const executable=process.env.CHROMIUM_PATH || '/usr/bin/chromium';
  if(!fs.existsSync(executable))throw Error('Chromium not found; set CHROMIUM_PATH');
  const output=path.resolve(values.output || path.join('/workspace/reliability-runs',new Date().toISOString().replace(/[:.]/g,'-')));
  if(fs.existsSync(path.join(output,'status.json')))throw Error('Output already contains a run; choose a fresh directory');
  fs.mkdirSync(output,{recursive:true});
  const launched=performance.now(),source=fingerprint(),startedUtc=new Date().toISOString();
  let workloadStart=null,cycles=0,cancel=null,failed=null,finalState='starting',browser,server,profile,cdp,cover;
  let diagnostics='',cleanup=false,lastSample=null,lastFixture=null,lastController=null,blocked=0;
  const monitor=createMemoryMonitor();
  const cache=controllerWorkload();
  const blockedOrigins=[];
  const elapsed=()=>workloadStart===null?0:performance.now()-workloadStart;
  const event=(type,data={})=>fs.appendFileSync(path.join(output,'events.jsonl'),JSON.stringify({type,utc:new Date().toISOString(),elapsedMs:Math.round(elapsed()),...data})+'\n');
  function status(extra={}) {
    const result={schema:1,state:finalState,startedUtc,updatedUtc:new Date().toISOString(),pid:process.pid,
      requestedDurationMs:duration,elapsedMs:Math.round(elapsed()),totalElapsedMs:Math.round(performance.now()-launched),
      completedCycles:cycles,source,workload:'production HTML/scripts and DOM; synthetic controller/storage; real Chromium trusted inputs',
      fixtureSlots:128,externalRequestsBlocked:blocked,blockedOrigins,lastFixture,lastController,lastSample,
      negativeControl:negative || null,error:failed?.message,...monitor.snapshot(),
      fiveHourClaim:finalState==='passed' && elapsed()>=FIVE_HOURS && duration>=FIVE_HOURS,
      browserStderrTail:failed?diagnostics.slice(-4000):undefined,...extra};
    const temporary=path.join(output,'status.json.tmp');fs.writeFileSync(temporary,JSON.stringify(result,null,2)+'\n');
    fs.renameSync(temporary,path.join(output,'status.json'));return result;
  }
  const stop=signal=>{cancel=signal;event('cancellation-requested',{signal});};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  async function intercept(client,allowFixture) {
    client.handlers.set('Fetch.requestPaused',async ({requestId,request})=>{
      let allowed=false;
      try{const url=new URL(request.url);allowed=allowFixture && url.origin===origin;}catch{}
      if(allowed)await client.send('Fetch.continueRequest',{requestId});
      else {
        blocked++;
        try{const url=new URL(request.url);const label=url.protocol+'//'+url.hostname;if(!blockedOrigins.includes(label)&&blockedOrigins.length<16)blockedOrigins.push(label);}catch{}
        await client.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
      }
    });
    await client.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  }
  let origin='';
  async function click(id) {
    await cdp.evaluate('(()=>{const node=document.getElementById('+JSON.stringify(id)+');if(!node || node.disabled || node.hidden)throw Error("Button unavailable: '+id+'");node.focus();})()');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  }
  async function sample() {
    const before=await cdp.send('Runtime.getHeapUsage');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap=await cdp.send('Runtime.getHeapUsage'),performanceMetrics=await cdp.send('Performance.getMetrics');
    const keep=new Set(['Documents','Nodes','JSEventListeners','JSHeapUsedSize','JSHeapTotalSize','LayoutCount','RecalcStyleCount','TaskDuration']);
    const metrics=Object.fromEntries(performanceMetrics.metrics.filter(item=>keep.has(item.name)).map(item=>[item.name,item.value]));
    const liveDom=await cdp.evaluate('(()=>{let nodes=1;const walker=document.createTreeWalker(document,NodeFilter.SHOW_ALL);while(walker.nextNode())nodes++;return {nodes,elements:document.querySelectorAll("*").length}})()');
    const memory=monitor.observe({cycles,elapsedMs:elapsed(),heap,metrics,liveDom});
    lastSample={utc:new Date().toISOString(),elapsedMs:Math.round(elapsed()),warmup:memory.memoryBaseline===null,
      postWarmupBounds:memory.postWarmupBounds,heapSlopeMiBPerHour:memory.heapSlopeMiBPerHour,liveDom,startupBounds:memory.startupBounds,
      heapBeforeGc:before,heapAfterGc:heap,metrics,fixture:await cdp.evaluate('soak.assert()'),actualController:cache.inspect()};
    event('memory-sample',lastSample);status();
  }
  try {
    status();event('launch',{source,requestedDurationMs:duration,node:process.versions.node});
    server=http.createServer((request,response)=>{
      try {
        let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname).slice(1),body;
        if(name==='before.js'){response.setHeader('Content-Type','text/javascript');response.end('window.module={exports:{}};');return;}
        if(name==='fixture.js'){response.setHeader('Content-Type','text/javascript');response.end(fs.readFileSync(FIXTURE));return;}
        name=name || 'leadchat-request-panel.html';const file=path.resolve(EXT,name);
        if(!file.startsWith(EXT+path.sep)){response.writeHead(403).end();return;}
        body=fs.readFileSync(file);
        if(name==='leadchat-request-panel.html'){
          const target='<script defer="" src="leadchat-request-panel.js"></script>';
          if(!body.toString().includes(target))throw Error('Production mount injection marker changed');
          body=body.toString().replace(target,'<script defer src="before.js"></script>'+target+'<script defer src="fixture.js"></script>');
        }
        const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'};
        response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');response.end(body);
      }catch{response.writeHead(404).end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    origin='http://127.0.0.1:'+server.address().port;
    profile=fs.mkdtempSync(path.join(os.tmpdir(),'lp-soak-'));
    let debugUrl='',spawnError=null;
    browser=spawn(executable,['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
      '--no-first-run','--no-default-browser-check','--disable-sync','--disable-component-update',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
    browser.on('error',error=>{spawnError=error;});
    browser.stderr.on('data',buffer=>{diagnostics=(diagnostics+buffer.toString()).slice(-8192);const match=diagnostics.match(/DevTools listening on (ws:\/\/\S+)/);if(match)debugUrl=match[1];});
    const startupDeadline=performance.now()+15000;
    while(!debugUrl && !spawnError && performance.now()<startupDeadline)await sleep(40);
    if(spawnError)throw spawnError;if(!debugUrl)throw Error('Chromium did not expose DevTools');
    const debugOrigin='http://'+new URL(debugUrl).host;
    const targets=await (await fetch(debugOrigin+'/json/list',{signal:AbortSignal.timeout(COMMAND_TIMEOUT)})).json();
    const target=targets.find(item=>item.type==='page');if(!target)throw Error('Chromium page target not found');
    cdp=await connect(target.webSocketDebuggerUrl);await intercept(cdp,true);
    await cdp.send('Performance.enable');
    await cdp.send('Page.navigate',{url:origin+'/leadchat-request-panel.html?hostOrigin='+encodeURIComponent(origin)+'&channel=offline-soak'});
    await cdp.until('window.soak && soak.ready(0)');
    const coverTarget=await cdp.send('Target.createTarget',{url:'about:blank',background:true});
    const all=await (await fetch(debugOrigin+'/json/list',{signal:AbortSignal.timeout(COMMAND_TIMEOUT)})).json();
    const coverInfo=all.find(item=>item.id===coverTarget.targetId);if(!coverInfo)throw Error('Visibility cover tab not found');
    cover=await connect(coverInfo.webSocketDebuggerUrl);await intercept(cover,false);
    await cdp.send('Page.bringToFront');await cdp.until('!document.hidden');
    if(fingerprint().sha256!==source.sha256)throw Error('Source changed during runner startup');
    workloadStart=performance.now();finalState='running';event('workload-start');status();
    await sample();let nextSample=60000;
    do {
      if(cancel)break;
      const cycleStart=performance.now(),slot=cycles%128,other=(slot+1)%128;
      if(fingerprint().sha256!==source.sha256)throw Error('Source fingerprint changed; run invalidated');
      if(cdp.failure || cover.failure)throw cdp.failure || cover.failure;
      await cdp.evaluate('soak.activate('+slot+')');await cdp.until('soak.ready('+slot+')');
      const text='slot-'+slot+'-cycle-'+cycles;
      await cdp.evaluate('soak.expected('+slot+','+JSON.stringify(text)+');document.getElementById("comments").value="";document.getElementById("comments").focus()');
      await cdp.send('Input.insertText',{text});
      await cdp.until('soak.persisted('+slot+','+JSON.stringify(text)+')');
      if(cycles%4===0){
        await cdp.evaluate('soak.armSave('+slot+')');await click('save-request');
        await cdp.until('soak.pending('+slot+') && !document.getElementById("check-result").disabled');
        const before=await cdp.evaluate('({...soak.stats})');
        await cdp.evaluate('soak.setRecovery("network")');await click('check-result');
        await cdp.until('soak.stats.networkFaults>'+before.networkFaults+' && !document.getElementById("check-result").disabled');
        await cdp.evaluate('soak.setRecovery("uncertain")');await click('check-result');
        await cdp.until('soak.stats.uncertainReplies>'+before.uncertainReplies+' && !document.getElementById("check-result").disabled');
        await cdp.evaluate('soak.setRecovery("saved")');await click('check-result');
        await cdp.until('soak.recovered('+slot+') && soak.ready('+slot+')');
        if(await cdp.evaluate('soak.stats.deliberateWrites')!==before.deliberateWrites)throw Error('Read-only recovery dispatched an additional mutation');
      }
      await cdp.evaluate('soak.activate('+other+')');await cdp.until('soak.ready('+other+')');
      await cdp.evaluate('soak.activate('+slot+')');await cdp.until('soak.ready('+slot+')');
      if(cycles%5===0){
        await cover.send('Page.bringToFront');await cdp.until('document.hidden',3000);
        await sleep(150);await cdp.send('Page.bringToFront');await cdp.until('!document.hidden && soak.ready('+slot+')');
      }
      if(negative && cycles===0)await cdp.evaluate('soak.injectFault('+JSON.stringify(negative)+','+slot+')');
      lastFixture=await cdp.evaluate('soak.assert()');lastController=await cache.cycle();cycles++;
      event('cycle-complete',{cycle:cycles,slot,durationMs:Math.round(performance.now()-cycleStart),stats:lastFixture.stats});
      status();
      if(elapsed()>=nextSample){await sample();nextSample+=60000;}
      // Duration is checked only after a complete asserted cycle; no idle padding.
      if(elapsed()>=duration || cancel)break;
      await sleep(Math.max(0,interval-(performance.now()-cycleStart)));
    }while(true);
    if(fingerprint().sha256!==source.sha256)throw Error('Source fingerprint changed before final verification');
    await sample();
    finalState=cancel?'cancelled':'passed';
    if(!cancel && elapsed()<duration)throw Error('Requested elapsed workload duration was not reached');
    if(!cancel && duration>=FIVE_HOURS && !monitor.snapshot().memoryBaseline)throw Error('Five-hour run did not complete required editor-cache warmup and plateau verification');
    event(finalState,{completedCycles:cycles});status({cancellation:cancel});
  }catch(error){failed=error;finalState=cancel?'cancelled':'failed';event(finalState,{error:error.stack || String(error)});status({error:error.message,cancellation:cancel});}
  finally {
    try{if(cdp)await cdp.evaluate('window.soak?.stop()');}catch{}
    if(browser && browser.exitCode===null && browser.signalCode===null){
      const exited=new Promise(resolve=>browser.once('exit',resolve));
      if(cdp)void cdp.send('Browser.close').catch(()=>{});else browser.kill();
      await Promise.race([exited,sleep(3000)]);
      if(browser.exitCode===null && browser.signalCode===null){browser.kill('SIGKILL');await Promise.race([exited,sleep(3000)]);}
    }
    cover?.close();cdp?.close();
    if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
    if(profile)try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});}catch(error){event('cleanup-error',{error:error.message});}
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    cleanup=true;
    status({cancellation:cancel,cleanupComplete:cleanup});
  }
  console.log(JSON.stringify({state:finalState,completedCycles:cycles,elapsedMs:Math.round(elapsed()),output,fiveHourClaim:finalState==='passed' && elapsed()>=FIVE_HOURS && duration>=FIVE_HOURS}));
  if(failed)process.exitCode=1;else if(cancel)process.exitCode=130;
}
module.exports={createMemoryMonitor};
if(require.main===module)main().catch(error=>{console.error(error.stack || error);process.exitCode=1;});
