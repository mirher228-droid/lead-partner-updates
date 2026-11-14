'use strict';
// Synthetic browser boundaries for a long-lived, otherwise unchanged production panel.
// All state is bounded by SLOTS; no CRM, employee or customer data is used.
(() => {
  const api = window.module.exports;
  delete window.module;
  const SLOTS = 128, CHANNEL = 'offline-soak';
  const copy = value => structuredClone(value);
  const slots = Array.from({length:SLOTS}, (_, index) => {
    const id = String(10000 + index), dialog = 'https://chat.partner-lead-centre.ru/chats/soak-' + index;
    const context = {ok:true,allowed:true,routeSafe:true,base:'kp',baseCandidates:['kp'],
      conversationId:'soak-' + index,chatId:'soak-' + index,conversationUrl:dialog,dialogUrl:dialog,
      operatorId:'soak-operator',accountId:'soak-account',scope:{key:'soak-scope',operatorId:'soak-operator',accountId:'soak-account'},
      client:{id:String(20000 + index),name:'Synthetic ' + index}};
    const canonical = {base:'kp',cityId:'1',clientName:'Synthetic',phone:'900' + String(index).padStart(7,'0'),
      requestType:'1',workId:'1',date:'2099-01-01',time:'12:00',comments:'baseline-' + index,commentsService:dialog};
    const fields = [{name:'CustomerRequest[comments]',type:'textarea',tag:'textarea',label:'Комментарий'}];
    const record = {id,base:'kp',customerId:context.client.id,verified:true,...canonical,canonical,
      form:{fields,values:{}},capabilities:{readOnly:false,save:true},actions:[{key:'save',enabled:true,type:'submit'}]};
    const metadata = {ok:true,form:{fields:copy(fields),values:{}},lists:{cities:[{id:'1',label:'Москва'}],
      types:[{id:'1',label:'Впервые'}],workTypes:[{id:'1',label:'Ремонт'}]},defaults:{},sources:[],record:copy(record)};
    return {context,key:api.scopeKey(context,'kp'),record,metadata,durable:null,expected:canonical.comments};
  });
  const byKey = new Map(slots.map((slot,index) => [slot.key,index]));
  const readableKeys = new Set(slots.flatMap(slot => [slot.key,
    api.scopeKey(slot.context,'mnc'),api.scopeKey(slot.context,'bt'),
    slot.key.replace('leadchat.request.panel.v3:','leadchat.request.baseChoice.v1:')]));
  const items = Object.fromEntries(slots.map(slot => [slot.key,{version:1,draft:{...copy(slot.record.canonical),extraFields:{}},
    record:copy(slot.record),recordOrigin:'created',metadata:copy(slot.metadata),operation:null}]));
  const stats = {activations:0,storageReads:0,storageWrites:0,cardReads:0,metadataReads:0,deliberateWrites:0,
    reconciles:0,networkFaults:0,uncertainReplies:0,successfulRecoveries:0,blockedFetches:0,errors:0};
  const failures = [];
  function fail(message) {
    stats.errors++;
    if(failures.length < 16) failures.push(String(message).slice(0,500));
    throw Error(message);
  }
  let current = 0, armed = null, recoveryMode = 'uncertain';
  function indexOf(args) {
    const dialog = args.context?.conversationId || args.context?.chatId;
    const match = /^soak-(\d+)$/.exec(dialog || '');
    const index = match ? Number(match[1]) : -1;
    if(!Number.isInteger(index) || index < 0 || index >= SLOTS) fail('Unknown synthetic context');
    if(args.id && String(args.id) !== slots[index].record.id) fail('Cross-context card request');
    return index;
  }
  window.fetch = async () => { stats.blockedFetches++;throw Error('Offline soak blocks browser fetch'); };
  window.addEventListener('error', event => {stats.errors++;if(failures.length<16)failures.push(String(event.message).slice(0,500));});
  window.addEventListener('unhandledrejection', event => {stats.errors++;if(failures.length<16)failures.push(String(event.reason?.message || event.reason).slice(0,500));});
  const storage = {
    async get(key) {stats.storageReads++;if(!readableKeys.has(key))fail('Unexpected storage key: '+key);return copy(items[key] || null);},
    async set(key,value) {stats.storageWrites++;if(!byKey.has(key))fail('Unexpected storage key: '+key);items[key]=copy(value);}
  };
  const controller = {
    async getMetadata(args) {const index=indexOf(args);stats.metadataReads++;return {...copy(slots[index].metadata),record:copy(slots[index].record)};},
    async getOperationStatus(args) {return {ok:true,operation:copy(slots[indexOf(args)].durable)};},
    async getRequest(args) {stats.cardReads++;return {ok:true,verified:true,record:copy(slots[indexOf(args)].record)};},
    async getDependencies() {return {ok:true,works:[],services:[]};},
    async performAction(args) {
      const index=indexOf(args);
      if(armed !== index || args.action !== 'save')fail('Unexpected mutation outside a deliberately armed trusted Save');
      armed=null;stats.deliberateWrites++;
      const slot=slots[index],value=args.fields?.comments;
      if(typeof value !== 'string' || value !== slot.expected)fail('Saved draft belongs to another context');
      slot.record.comments=value;slot.record.canonical.comments=value;
      slot.durable={operationId:args.operationId,kind:'update',state:'uncertain',id:slot.record.id,createdAt:Date.now()};
      throw Error('SOAK lost write acknowledgement');
    },
    async reconcile(args) {
      const index=indexOf(args),slot=slots[index];stats.reconciles++;
      // Match the real controller's readOnly=true default at this mocked boundary.
      if(args.readOnly === false)fail('Recovery must be read-only');
      if(args.operationId !== slot.durable?.operationId)fail('Recovery operation crossed contexts');
      if(recoveryMode === 'network') {stats.networkFaults++;throw Error('SOAK read transport failure');}
      if(recoveryMode === 'uncertain') {stats.uncertainReplies++;return {ok:false,state:'uncertain',writeStarted:true,operationId:args.operationId,error:'SOAK response still uncertain'};}
      stats.successfulRecoveries++;slot.durable=null;
      return {ok:true,verified:true,state:'saved',record:copy(slot.record),operationId:args.operationId};
    },
    async createRequest() {fail('Creation is not part of this synthetic workload');},
    async cancelRequest() {fail('Cancellation is not part of this synthetic workload');}
  };
  const instance = api.mount({document,window,controller,storage});
  const soak = {
    stats,failures,SLOTS,
    activate(index) {
      if(!Number.isInteger(index) || index<0 || index>=SLOTS)fail('Invalid synthetic ring slot');
      current=index;stats.activations++;
      window.postMessage({type:'leadchat-request-context-invalid',channel:CHANNEL},location.origin);
      window.postMessage({type:'leadchat-request-context',channel:CHANNEL,context:copy(slots[index].context)},location.origin);
    },
    expected(index,value) {slots[index].expected=value;},
    armSave(index) {if(current!==index)fail('Save armed for another active context');armed=index;},
    setRecovery(mode) {if(!['network','uncertain','saved'].includes(mode))fail('Bad recovery mode');recoveryMode=mode;},
    ready(index) {
      const item=items[slots[index].key],input=document.getElementById('comments');
      return current===index && !document.body.inert && !input.disabled && !document.getElementById('save-request').disabled
        && input.value===slots[index].expected && !item?.operation;
    },
    persisted(index,value) {return items[slots[index].key]?.draft?.comments===value;},
    pending(index) {const slot=slots[index];return !!slot.durable && items[slot.key]?.operation?.operationId===slot.durable.operationId;},
    recovered(index) {const slot=slots[index];return !slot.durable && items[slot.key]?.operation===null
      && items[slot.key]?.record?.id===slot.record.id && document.getElementById('comments').value===slot.expected;},
    async injectFault(kind,index) {
      if(kind==='draft')items[slots[index].key].draft.comments='NEGATIVE CONTROL wrong-context draft';
      else if(kind==='mutation')await controller.performAction({context:slots[index].context,id:slots[index].record.id,action:'save',fields:{comments:'NEGATIVE CONTROL'}});
      else fail('Unknown negative control');
    },
    assert() {
      if(stats.errors)fail('Browser fixture errors: '+failures.join('; '));
      if(Object.keys(items).length!==SLOTS)fail('Fixture storage escaped its finite ring');
      for(let index=0;index<SLOTS;index++) {
        const slot=slots[index],item=items[slot.key];
        if(item?.record && (item.record.id!==slot.record.id || item.record.base!=='kp'))fail('Persisted wrong card');
        if(item?.draft?.comments!==slot.expected)fail('Draft lost or crossed contexts in slot '+index);
        if(item?.operation && item.operation.operationId!==slot.durable?.operationId)fail('Persisted wrong operation');
      }
      return {slot:current,fixtureSlots:SLOTS,storageKeys:Object.keys(items).length,stats:{...stats}};
    },
    stop() {instance.destroy();}
  };
  window.soak=soak;
  soak.activate(0);
})();
