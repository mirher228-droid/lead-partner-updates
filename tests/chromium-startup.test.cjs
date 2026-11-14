'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {waitForChromium}=require('./helpers/chromium-startup.cjs');

async function fixture(t,respond) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lp-chrome-ready-'));
  const child=new EventEmitter();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;
  let requests=0;
  const server=http.createServer((req,res)=>{requests++;respond?.(req,res,requests);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const target={type:'page',id:'offline-page',url:'about:blank',webSocketDebuggerUrl:'ws://127.0.0.1:'+port+'/devtools/page/offline-page'};
  t.after(async()=>{child.stderr.end();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});});
  const line='DevTools listening on ws://127.0.0.1:'+port+'/devtools/browser/offline-browser\r\n';
  return {folder,child,server,port,target,line,get requests(){return requests;},ready:options=>waitForChromium({child,profileDir:folder,timeoutMs:1000,...options})};
}

test('split stderr lines and URL chunks resolve only after the complete DevTools endpoint is ready',async t=>{
  for(const splitAt of [9,37])await t.test('split at '+splitAt,async sub=>{
    const f=await fixture(sub,(_req,res)=>res.end(JSON.stringify([f.target])));
    const waiting=f.ready();
    f.child.stderr.write(f.line.slice(0,splitAt));
    await new Promise(resolve=>setImmediate(resolve));
    f.child.stderr.write(f.line.slice(splitAt));
    const result=await waiting;
    assert.equal(result.page.webSocketDebuggerUrl,f.target.webSocketDebuggerUrl);
    assert.equal(new URL(result.endpoint).port,String(f.port));
  });
});

test('HTTP availability and a usable page target are both required for readiness',async t=>{
  const f=await fixture(t,(_req,res,attempt)=>{
    if(attempt===1){res.writeHead(503).end('Starting');return;}
    if(attempt===2){res.end('[]');return;}
    if(attempt===3){res.end(JSON.stringify([{type:'page',id:'offline-page'}]));return;}
    res.end(JSON.stringify([f.target]));
  });
  const waiting=f.ready();f.child.stderr.write(f.line);
  const result=await waiting;
  assert.equal(result.page.id,'offline-page');assert.equal(f.requests,4);
});

test('DevToolsActivePort supplies a ready endpoint when stderr has no complete announcement',async t=>{
  const f=await fixture(t,(_req,res)=>res.end(JSON.stringify([f.target])));
  fs.writeFileSync(path.join(f.folder,'DevToolsActivePort'),String(f.port)+'\n/devtools/browser/offline-browser\n');
  f.child.stderr.write('Chrome starting without a DevTools stderr line\n');
  const result=await f.ready();assert.equal(result.page.id,'offline-page');
});

test('child exits and spawn errors fail immediately with bounded startup diagnostics',{timeout:1500},async t=>{
  for(const event of ['exit','error','already-exited'])await t.test(event,async sub=>{
    const f=await fixture(sub),failure=event==='error'?/spawn failed: synthetic launch failure/:/exited before DevTools was ready.*7/;
    f.child.stderr.write('Synthetic useful startup detail\n');
    if(event==='already-exited')f.child.exitCode=7;
    const waiting=f.ready({timeoutMs:20000});
    if(event==='exit')f.child.emit('exit',7,null);
    if(event==='error')f.child.emit('error',Error('synthetic launch failure'));
    await assert.rejects(waiting,error=>{assert.match(error.message,failure);assert.match(error.message,/Synthetic useful startup detail/);return true;});
  });
});

test('the wall-clock deadline bounds a hung endpoint and diagnostic stderr size',{timeout:1500},async t=>{
  const f=await fixture(t,()=>{});
  f.child.stderr.write('Discarded-prefix\n'+'x'.repeat(10000)+'\nUseful-stderr-tail\n');
  const waiting=f.ready({timeoutMs:80});f.child.stderr.write(f.line);
  const started=performance.now();
  await assert.rejects(waiting,error=>{
    assert.match(error.message,/DevTools readiness deadline.*80/);
    assert.match(error.message,/Useful-stderr-tail/);assert.doesNotMatch(error.message,/Discarded-prefix/);
    assert.ok(error.message.length<5000,'diagnostics must be bounded');return true;
  });
  assert.ok(performance.now()-started>=60,'the helper must wait for its configured deadline');
});

test('a child failure aborts an in-progress endpoint request instead of waiting for its deadline',{timeout:1500},async t=>{
  let received;const requestSeen=new Promise(resolve=>{received=resolve;});
  const f=await fixture(t,()=>received());
  const waiting=f.ready({timeoutMs:20000});f.child.stderr.write(f.line);
  await requestSeen;f.child.emit('error',Error('synthetic endpoint process failure'));
  await assert.rejects(waiting,/spawn failed: synthetic endpoint process failure/);
});
