const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../extension/leadpartner-rules.js');
const {create} = require('../extension/leadchat-crm-service.js');

const ID = '12345', PHONE = '9000000000';
const PREFIX = 'CustomerRequest[';
const key = short => PREFIX + short + ']';
const dialog = 'https://chat.partner-lead-centre.ru/chats/fixture';

function fixture(kind, options = {}) {
  const reads = [], writes = [], journalWrites = [];
  let status = 'В работе';
  const values = {
    [key('city_id')]: '1', [key('appliance_type_id')]: '2', [key('partner_id')]: '7',
    [key('comments')]: kind === 'postEdit' ? 'Отмена КЦ\nСохранить' : '',
    [key('comments_service')]: dialog, [key('date_changes')]: '',
    [key('partner_comment')]: '', 'Customer[phone]': PHONE
  };
  const entry = {
    operationId: 'operation', base: 'kp', kind: 'save', phase: 'sent', state: 'sent',
    createdAt: Date.now(), id: ID, phone: PHONE, beforeIds: [], transport: 'native-form-v3', expected: {}
  };
  if (kind === 'source') Object.assign(entry, {kind:'create', sourceCode:'A1', commentsPhase:'pending',
    expected:{[key('partner_comment')]:'A1', [key('comments_service')]:dialog, [key('partner_id')]:'7'}});
  if (kind === 'native') Object.assign(entry, {nativeActionPhase:'pending', expected:{
    [key('comments_service')]:dialog, _nativeAction:{key:'cancel_kc', beforeStatus:status}
  }});
  if (kind === 'nativeGet') Object.assign(entry, {nativeActionPhase:'pending', expected:{
    [key('comments_service')]:dialog, [key('comments')]:'', [key('partner_comment')]:'',
    _nativeAction:{key:'not_taken', beforeStatus:status}, _nativeReasonPending:true
  }});
  if (kind === 'postEdit') Object.assign(entry, {postEditIntent:{kind:'restore',cancelKind:'cancel'}});
  if (options.postEditCommitted) {
    entry.postEditExpected = {[key('comments')]:'Сохранить'};
    entry.postEditPhase = 'replied';
    values[key('comments')] = 'Сохранить';
  }
  if (options.candidate) delete entry.id;
  if (options.alreadySaved) values[key('partner_comment')] = 'A1';
  let journal = {operation:entry};
  function card() {
    const action = kind === 'nativeGet'
      ? {key:'not_taken',enabled:true,type:'link',method:'GET',url:'https://kp-lead-centre.ru/admin/domain/customer-request/cancel-to-not-taken?id='+ID}
      : {key:'cancel_kc',enabled:true,type:'submit',fields:{cancel_kc:'1'}};
    const fields = Object.entries(values).map(([name,value]) => ({name,value,type:'text',tag:'input',options:[]}));
    return {
      forms:[{id:'customerRequestForm',method:'POST',action:'https://kp-lead-centre.ru/admin/domain/customer-request/update?id='+ID, fields, values:{...values}}],
      errors:[], status, actions:[action], csrfParam:'_csrf', csrfToken:'fixture-csrf',
      commentsSave:{mode:'comments-only',url:'https://kp-lead-centre.ru/admin/domain/customer-request/update?id='+ID},
      nativeComments:Object.fromEntries(['comments','comments_service','date_changes','partner_comment'].map(short => [short,{value:values[key(short)],type:'textarea'}]))
    };
  }
  const service = create({scope:'reconcile-fixture',
    storage:{get:async () => structuredClone(journal),set:async (name,value) => { journal=structuredClone(value); journalWrites.push(name); }},
    request:async input => {
      const url = new URL(input.url);
      const mutation = input.method !== 'GET' || url.pathname.endsWith('/cancel-to-not-taken');
      (mutation ? writes : reads).push({url:input.url,method:input.method});
      if (mutation) {
        const body = new URLSearchParams(input.body);
        if (kind === 'source') values[key('partner_comment')] = body.get('partner_comment');
        if (kind === 'native') status = 'Отмена КЦ';
        if (kind === 'nativeGet') status = 'НФ';
        if (kind === 'postEdit') values[key('comments')] = body.get('comments');
      }
      return {status:200,url:input.url,text:url.pathname === '/api/customer/search' ? '[]' : url.pathname.endsWith('/index') ? 'list' : 'card'};
    },
    parseDocument:async body => body === 'list' ? {forms:[],errors:[],requestList:true,hasNext:false,rows:[{id:ID,phone:PHONE,status}]} : card()
  });
  return {service,reads,writes,journalWrites,get entry() { return journal.operation; }};
}

for (const scenario of ['source','native','nativeGet','postEdit']) {
  test('read-only reconcile never dispatches the pending '+scenario+' continuation', async () => {
    const f = fixture(scenario);
    const result = await f.service.reconcile({base:'kp',operationId:'operation',readOnly:true});
    assert.ok(f.reads.length > 0, 'must verify the current native record');
    assert.equal(f.writes.length, 0, 'verification must not send CRM writes or native action GETs');
    assert.equal(result.state, 'uncertain', JSON.stringify(result));
    assert.equal(result.writeStarted, true);
    assert.ok(f.journalWrites.length > 0, 'the pending result remains durably recorded');
    assert.equal(f.entry.state, 'uncertain');
  });
  test('legacy explicit reconcile still dispatches pending '+scenario+' continuation once', async () => {
    const f = fixture(scenario);
    await f.service.reconcile({base:'kp',operationId:'operation'});
    assert.equal(f.writes.length, 1, 'fixture must exercise the real continuation branch');
  });
}

test('read-only candidate reconciliation does not send its pending source edit', async () => {
  const f = fixture('source',{candidate:true});
  const result = await f.service.reconcile({base:'kp',operationId:'operation',candidateId:ID,readOnly:true});
  assert.equal(f.writes.length,0);
  assert.equal(result.state,'uncertain');
  assert.equal(result.writeStarted,true);
  assert.equal(f.entry.id,ID,'a verified candidate may still be recorded locally');
});

test('read-only reconciliation acknowledges an already committed source without sending', async () => {
  const f = fixture('source',{alreadySaved:true});
  const result = await f.service.reconcile({base:'kp',operationId:'operation',readOnly:true});
  assert.equal(f.writes.length,0);
  assert.equal(result.state,'saved');
  assert.equal(result.sourceCommitted,true);
});

test('read-only reconciliation can acknowledge a previously sent post-edit proved by the native card', async () => {
  const f = fixture('postEdit',{postEditCommitted:true});
  const result = await f.service.reconcile({base:'kp',operationId:'operation',readOnly:true});
  assert.equal(f.writes.length,0);
  assert.equal(result.state,'saved');
  assert.equal(f.entry.state,'saved');
});

test('repeated read-only verification preserves the pending source without dispatching it', async () => {
  const f = fixture('source');
  for (let i = 0; i < 3; i++) {
    const result = await f.service.reconcile({base:'kp',operationId:'operation',readOnly:true});
    assert.equal(result.state,'uncertain');
  }
  assert.equal(f.writes.length,0);
  assert.equal(f.entry.commentsPhase,'pending');
});

test('an explicit readOnly false keeps the deliberate candidate-source continuation', async () => {
  const f = fixture('source',{candidate:true});
  const result = await f.service.reconcile({base:'kp',operationId:'operation',candidateId:ID,readOnly:false});
  assert.equal(f.writes.length,1);
  assert.equal(result.state,'saved');
  assert.equal(result.sourceCommitted,true);
});
