const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../extension/leadchat-request-host.js'), 'utf8');

// The host runs in a content-script world; these are only its DOM/browser boundaries.
function fixture(options = {}) {
  const frames = [], intervals = [], observers = [], events = new Map(), windowEvents = new Map(), messages = [];
  let scans = 0, dialog = null, reads = 0, subscriber, layoutReads = 0, geometryReads = 0;
  function element() {
    const properties = new Map();
    return {
      style: {setProperty: (name, value) => properties.set(name, value),
        getPropertyValue: name => properties.get(name), getPropertyPriority: () => 'important'},
      children: [], isConnected: true,
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } },
      setAttribute() {}, removeAttribute() {}, toggleAttribute() {},
      addEventListener() {}, querySelector() { return null; },
      attachShadow() { return element(); },
      getBoundingClientRect() { geometryReads++; return {left: 0, top: 0, width: 400, height: 600}; },
      contentWindow: {postMessage(message) { messages.push(message); }}
    };
  }
  let container = element(); const thread = element();
  thread.closest = () => container;
  const document = {
    hidden: false, documentElement: element(), createElement: element,
    querySelector(selector) { scans++; return dialog && selector === '.chat-thread-pane' ? thread : null; },
    querySelectorAll() { scans++; return []; },
    addEventListener(name, callback) { events.set(name, callback); },
    hasFocus() { return false; }
  };
  const sandbox = {
    document, URL, location: {origin: 'https://chat.partner-lead-centre.ru'},
    crypto: {randomUUID: () => 'channel'},
    chrome: {runtime: {getURL: name => 'chrome-extension://fixture/' + name}},
    LeadChatRequestContext: {
      currentDialog: () => dialog,
      createAdapter: () => ({subscribe(callback) { subscriber = callback; }, read: async () => { reads++; return options.read ? options.read() : {ok: false}; }})
    },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
    getComputedStyle: () => { layoutReads++; return {display: 'block'}; },
    addEventListener(name, callback) { windowEvents.set(name, callback); }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'leadchat-request-host.js'});
  return {
    document, frames, events, windowEvents, messages,
    get container() { return container; },
    get scans() { return scans; }, get reads() { return reads; },
    get layoutReads() { return layoutReads; }, get geometryReads() { return geometryReads; },
    interval: () => intervals[0](), mutation: () => observers[0](),
    observed(value) { subscriber(value); },
    changeDialog(id) { dialog = id ? {conversationId: id} : null; },
    replaceLayout() { container = element(); },
    flushFrame() { frames.splice(0).forEach(callback => callback()); }
  };
}

function context(conversationId = 'first', clientId = 'client', operatorId = 'operator') {
  return {ok:true,conversationId,client:{id:clientId},scope:{key:operatorId+'|account|'+conversationId,operatorId,accountId:'account'}};
}

test('hidden-tab safety timer does not rescan the document', () => {
  const host = fixture(); host.document.hidden = true;
  const before = host.scans;
  for (let i = 0; i < 50; i++) host.interval();
  assert.equal(host.scans, before);
});

test('hidden-tab mutations do not queue layout work', () => {
  const host = fixture(); host.document.hidden = true;
  for (let i = 0; i < 100; i++) host.mutation();
  assert.equal(host.frames.length, 0);
});

test('an already queued mutation does not scan after tab becomes hidden', () => {
  const host = fixture(); host.mutation(); host.document.hidden = true;
  const before = host.scans; host.flushFrame();
  assert.equal(host.scans, before);
});

test('visible mutation storms share one frame', () => {
  const host = fixture();
  for (let i = 0; i < 100; i++) host.mutation();
  assert.equal(host.frames.length, 1);
  const before = host.scans; host.flushFrame();
  assert.ok(host.scans > before);
});

test('returning to a visible SPA dialog mounts its panel without waiting for the timer', () => {
  const host = fixture(); host.document.hidden = true; host.changeDialog('new-dialog');
  host.document.hidden = false; host.events.get('visibilitychange')();
  host.flushFrame();
  assert.ok(host.container.children.some(child => child.id === 'lp-request-card-slot'));
  assert.equal(host.reads, 1);
});

test('SPA layout replacement moves the slot and preserves the live panel', async () => {
  const host = fixture(); host.changeDialog('first'); host.interval();
  await new Promise(setImmediate);
  const panel = host.document.documentElement.children.find(child => child.id === 'lp-request-card-host');
  const slot = host.container.children.find(child => child.id === 'lp-request-card-slot');
  const before = host.reads;
  host.changeDialog('second'); host.replaceLayout(); host.mutation(); host.flushFrame();
  await new Promise(setImmediate);
  assert.equal(host.container.children.find(child => child.id === 'lp-request-card-slot'), slot);
  assert.equal(host.document.documentElement.children.filter(child => child.id === 'lp-request-card-host').length, 1);
  assert.equal(host.document.documentElement.children.find(child => child.id === 'lp-request-card-host'), panel);
  assert.equal(host.reads, before + 1);
});

test('leaving chats hides the panel and reopening restores the same instance', async () => {
  const host = fixture(); host.changeDialog('first'); host.interval(); await new Promise(setImmediate);
  const panel = host.document.documentElement.children.find(child => child.id === 'lp-request-card-host');
  host.changeDialog(null); host.interval(); assert.equal(panel.hidden, true);
  const before = host.reads; host.changeDialog('second'); host.interval();
  await new Promise(setImmediate);
  assert.equal(panel.hidden, false);
  assert.equal(host.document.documentElement.children.filter(child => child.id === 'lp-request-card-host').length, 1);
  assert.equal(host.reads, before + 1);
});

test('a timer that mounts the panel requests its first context only once', async () => {
  const host = fixture(); host.changeDialog('first'); host.interval();
  await new Promise(setImmediate);
  assert.equal(host.reads, 1);
});

test('an observer that mounts the panel requests its first context only once', async () => {
  const host = fixture(); host.changeDialog('first'); host.mutation(); host.flushFrame();
  await new Promise(setImmediate);
  assert.equal(host.reads, 1);
});

test('a subscription that mounts the panel reuses its validated context', async () => {
  const host = fixture(); host.changeDialog('first'); host.observed({ok: false});
  await new Promise(setImmediate);
  assert.equal(host.reads, 0);
});

test('hidden subscription bursts update context without querying or laying out the document', () => {
  const host = fixture(); host.changeDialog('first'); host.observed(context()); host.flushFrame();
  host.document.hidden = true;
  const before = [host.scans,host.layoutReads];
  for (let i = 0; i < 100; i++) host.observed(context());
  assert.deepEqual([host.scans,host.layoutReads],before);
  assert.equal(host.frames.length,0);
});

test('hidden context switches still invalidate the old card synchronously without DOM scans', () => {
  const host = fixture(); host.changeDialog('first'); host.observed(context()); host.flushFrame();
  host.document.hidden = true; host.messages.length = 0;
  const before = host.scans;
  host.observed(context('first','another-client'));
  assert.equal(host.scans,before);
  assert.equal(host.messages[0].type,'leadchat-request-context-invalid');
  assert.equal(host.messages.at(-1).context.client.id,'another-client');
});

test('hidden incomplete identity still suspends every old card action', () => {
  const host = fixture(); host.changeDialog('first'); host.observed(context()); host.flushFrame();
  host.document.hidden = true; host.messages.length = 0;
  host.observed({...context(),scope:{key:'',operatorId:'',accountId:'account'}});
  assert.equal(host.messages.at(-1).type,'leadchat-request-context-pending');
});

test('hidden route mutations invalidate immediately even when no layout frame will run', () => {
  const host = fixture(); host.changeDialog('first'); host.observed(context()); host.flushFrame();
  host.document.hidden = true; host.messages.length = 0; host.changeDialog('second');
  host.mutation();
  assert.equal(host.messages[0]?.type,'leadchat-request-context-invalid');
  assert.equal(host.frames.length,0);
});

test('hidden scroll and resize storms do not schedule geometry or force layout reads', () => {
  const host = fixture(); host.changeDialog('first'); host.observed(context()); host.flushFrame();
  host.document.hidden = true;
  const before = [host.scans,host.layoutReads,host.geometryReads];
  for (let i = 0; i < 100; i++) { host.windowEvents.get('scroll')(); host.windowEvents.get('resize')(); }
  host.flushFrame();
  assert.deepEqual([host.scans,host.layoutReads,host.geometryReads],before);
  assert.equal(host.frames.length,0);
});

test('visible resize storms share one layout computation', () => {
  const host = fixture(); host.changeDialog('first'); host.observed(context()); host.flushFrame();
  const before = host.layoutReads;
  for (let i = 0; i < 100; i++) host.windowEvents.get('resize')();
  assert.equal(host.frames.length,1);
  host.flushFrame();
  assert.equal(host.layoutReads,before+1);
});

test('a validated subscription supersedes an older in-flight bridge reply without another read', async () => {
  let settle;
  const host = fixture({read: () => new Promise(resolve => { settle = resolve; })});
  host.changeDialog('first'); host.observed(context()); host.flushFrame();
  host.interval(); host.messages.length = 0;
  const latest = {...context(),client:{id:'client',name:'Latest'}};
  host.observed(latest);
  assert.equal(host.messages.at(-1)?.type,'leadchat-request-context-pending', 'old actions must be suspended as soon as fresher context arrives');
  settle({...context(),client:{id:'client',name:'Old'}});
  await new Promise(setImmediate);
  assert.equal(host.reads,1);
  const sent = host.messages.filter(message => message.type === 'leadchat-request-context');
  assert.equal(sent.length,1);
  assert.equal(sent[0].context.client.name,'Latest');
});

test('a burst of validated subscriptions keeps the newest context while one old read settles', async () => {
  let settle;
  const host = fixture({read: () => new Promise(resolve => { settle = resolve; })});
  host.changeDialog('first'); host.observed(context()); host.flushFrame(); host.interval();
  for(let i=0;i<100;i++)host.observed({...context(),client:{id:'client',name:'Update '+i}});
  settle(context()); await new Promise(setImmediate);
  assert.equal(host.reads,1);
  assert.equal(host.messages.filter(message => message.type === 'leadchat-request-context').at(-1).context.client.name,'Update 99');
});

test('navigation discards a queued context from the old dialog before rereading the new route', async () => {
  const pending = [];
  const host = fixture({read: () => new Promise(resolve => pending.push(resolve))});
  host.changeDialog('first'); host.observed(context()); host.flushFrame(); host.interval();
  host.observed({...context(),client:{id:'client',name:'Old queued'}});
  host.changeDialog('second'); host.mutation(); pending[0](context()); await new Promise(setImmediate);
  assert.equal(host.reads,2);
  pending[1](context('second')); await new Promise(setImmediate);
  const sent = host.messages.filter(message => message.type === 'leadchat-request-context');
  assert.equal(sent.at(-1).context.conversationId,'second');
  assert.ok(!sent.some(message => message.context.client.name === 'Old queued'));
});
