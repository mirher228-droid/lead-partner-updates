const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createAdapter,CHANNEL} = require('../extension/leadchat-request-context.js');

function fixture(options = {}) {
  const listeners = new Map(), timers = new Map(), intervals = new Map(), requests = [];
  let nextId = 0;
  const win = {
    location:{href:'https://chat.partner-lead-centre.ru/chats/first',origin:'https://chat.partner-lead-centre.ru'},
    crypto:{randomUUID:() => String(++nextId)},
    addEventListener(type,callback) { if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback); },
    removeEventListener(type,callback) { listeners.get(type)?.delete(callback); },
    setTimeout(callback,delay) { const id=++nextId;timers.set(id,{callback,delay});return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { const id=++nextId;intervals.set(id,callback);return id; },
    clearInterval(id) { intervals.delete(id); },
    postMessage(message) { requests.push(message); }
  };
  function emit(data,source=win,origin=win.location.origin) {
    for(const callback of listeners.get('message') || [])callback({data,source,origin});
  }
  const adapter=createAdapter({window:win,...options});
  return {adapter,win,listeners,timers,intervals,requests,emit,
    changed() { emit({channel:CHANNEL,kind:'changed'}); },
    respond(request,result) { emit({channel:CHANNEL,kind:'response',id:request.id,result}); },
    async scheduled() {
      const jobs=[...timers].filter(([,job])=>job.delay===60);
      for(const [id,job] of jobs){timers.delete(id);await job.callback();}
    },
    route(id) { win.location.href=win.location.origin+'/chats/'+id;for(const callback of intervals.values())callback(); }
  };
}

test('destroy removes listeners, route polling and queued context/identity timers', () => {
  const f=fixture();f.adapter.subscribe(()=>{});f.adapter.subscribeIdentity(()=>{});
  f.emit({channel:CHANNEL,kind:'identity-changed'});
  assert.equal(f.timers.size,2);assert.equal(f.intervals.size,1);
  f.adapter.destroy();
  assert.equal(f.timers.size,0);assert.equal(f.intervals.size,0);
  assert.ok([...f.listeners.values()].every(set=>set.size===0));
});

test('destroy settles an outstanding bridge read and ignores its later response', async () => {
  const f=fixture();const reading=f.adapter.read();const request=f.requests[0];
  assert.equal(f.timers.size,1);f.adapter.destroy();
  assert.equal((await reading).code,'stale');
  f.respond(request,{ok:true});
  assert.equal(f.timers.size,0);
});

test('route change settles the old bridge read before timeout and accepts a new route response', async () => {
  const f=fixture();const old=f.adapter.read(),oldRequest=f.requests[0];
  f.route('second');assert.equal((await old).code,'stale');
  assert.equal(f.timers.size,0);
  const current=f.adapter.read(),currentRequest=f.requests.at(-1);
  f.respond(oldRequest,{ok:false,code:'old'});
  f.respond(currentRequest,{ok:false,code:'current'});
  assert.equal((await current).code,'current');f.adapter.destroy();
});

test('responses from another window or origin cannot settle the bridge request', async () => {
  const f=fixture();let settled=false;
  const reading=f.adapter.read().then(value=>{settled=true;return value;});
  const message={channel:CHANNEL,kind:'response',id:f.requests[0].id,result:{ok:false,code:'foreign'}};
  f.emit(message,{});f.emit(message,f.win,'https://another.example');
  await Promise.resolve();assert.equal(settled,false);
  f.respond(f.requests[0],{ok:false,code:'genuine'});
  assert.equal((await reading).code,'genuine');f.adapter.destroy();
});

test('a burst of cache notifications shares one refresh and a bad listener cannot block another', async () => {
  let reads=0;const f=fixture({request:async()=>{reads++;return {ok:false,code:'fixture'};}});
  const observed=[];
  f.adapter.subscribe(()=>{throw Error('isolated listener');});f.adapter.subscribe(value=>observed.push(value.code));
  for(let i=0;i<100;i++)f.changed();
  assert.equal(f.timers.size,1);await f.scheduled();
  assert.equal(reads,1);assert.deepEqual(observed,['fixture']);f.adapter.destroy();
});

test('destroyed adapter does not notify listeners after an injected read completes', async () => {
  let complete;const f=fixture({request:()=>new Promise(resolve=>{complete=resolve;})});
  let calls=0;f.adapter.subscribe(()=>calls++);
  const scheduled=f.scheduled();f.adapter.destroy();complete({ok:false,code:'late'});
  await scheduled;assert.equal(calls,0);
});

test('identity reads keep their separate lifecycle and do not leak conversation payloads', async () => {
  const f=fixture();const identity=f.adapter.readIdentity();const request=f.requests[0];
  assert.equal(request.action,'read-identity');assert.equal(request.conversationId,undefined);
  f.respond(request,{ok:true,operatorId:'operator',displayName:'Fixture',presence:'online',token:'must not cross'});
  assert.deepEqual(await identity,{ok:true,operatorId:'operator',displayName:'Fixture',presence:'online'});
  f.adapter.destroy();
});
