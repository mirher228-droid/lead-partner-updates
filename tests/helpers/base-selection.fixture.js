'use strict';
(() => {
  const api=window.module.exports;delete window.module;
  const scenario=new URLSearchParams(location.search).get('scenario') || 'unknown';
  const conversation='https://chat.partner-lead-centre.ru/chats/shared-id';
  const context={ok:true,allowed:true,routeSafe:true,base:'',baseCandidates:['mnc','bt'],workTitle:'Неизвестная техника',cityName:'Москва',
    conversationId:'shared-id',chatId:'shared-id',conversationUrl:conversation,dialogUrl:conversation,
    operatorId:'operator-1',accountId:'account-1',scope:{key:'scope-1',operatorId:'operator-1',accountId:'account-1'},
    client:{id:'client-1',name:'Synthetic'},clientName:'Synthetic',adId:'same-ad'};
  if(['named','named-found','named-pending'].includes(scenario))context.namedRequestId='12345';
  if(scenario==='named-pending')context.baseCandidates=['bt'];
  if(scenario==='metadata-pending')context.baseCandidates=['bt'];
  if(scenario==='tv' || scenario==='saved-choice')context.workTitle='Ремонт телевизора';
  if(scenario==='record'){context.base='bt';context.baseCandidates=['bt'];}
  const items={},calls=[],errors=[],pending=[];
  const h={scenario,context,items,calls,errors,pending,result:{ok:false,reason:'No unique base'},deferred:['identity','manual','dirty'].includes(scenario)};
  if(['named','retry','phone','source','named-update'].includes(scenario))h.result={ok:false,reason:'Transient offline failure'};
  if(scenario==='named')h.result={ok:true,base:'bt',reason:'Fixture exact dropdown evidence'};
  if(['selected','operation'].includes(scenario))h.result={ok:true,base:'bt',reason:'Fixture exact dropdown evidence'};
  if(scenario==='saved-choice')items[api.scopeKey(context,'kp').replace('leadchat.request.panel.v3:','leadchat.request.baseChoice.v1:')]={version:1,base:'mnc'};
  const copy=value=>structuredClone(value),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const record=base=>({id:'12345',base,verified:true,customerId:'44',phone:'9000000000',commentsService:conversation,
    canonical:{base,cityId:'1',clientName:'Synthetic',phone:'9000000000',requestType:'1',workId:'1',comments:'Existing record',commentsService:conversation},
    form:{fields:[{name:'CustomerRequest[comments]',type:'textarea'}],values:{}},capabilities:{readOnly:false,save:true},actions:[]});
  const metadata=base=>({ok:true,form:{fields:[{name:'CustomerRequest[comments]',type:'textarea',label:'Комментарий'}],values:{}},
    lists:{cities:[{id:base==='mnc'?'2':'1',label:'Москва'}],types:[{id:'1',label:'Впервые'}],workTypes:[{id:base==='mnc'?'9':'1',label:'Ремонт'}]},defaults:{},sources:[],
    ...(scenario==='record' || scenario==='named-found'?{record:record(base)}:{})});
  const log=(command,args)=>{calls.push({command,at:performance.now(),context:copy(args.context),base:args.base,id:args.id,refresh:args.refresh===true});};
  window.fetch=async()=>{throw Error('Real network forbidden in base-selection fixture');};
  window.addEventListener('error',event=>errors.push(event.message));
  window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason?.message || event.reason)));
  const controller={
    async resolveBase(args){log('resolveBase',args);if(h.deferred)return new Promise(resolve=>pending.push(resolve));return copy(h.result);},
    async getRequest(args){log('getRequest',args);if(scenario==='named-pending')return new Promise(resolve=>pending.push(resolve));await sleep(90);return scenario==='named-found'?{ok:true,verified:true,record:record('bt')}:{ok:false,error:'No verified named record'};},
    async duplicates(args){log('duplicates',args);return {ok:true,matches:[]};},
    async getMetadata(args){log('getMetadata',args);if(scenario==='metadata-pending')return new Promise(resolve=>pending.push(resolve));return metadata(args.base || args.draft?.base);},
    async getDependencies(){return {ok:true,works:[],services:[]};},
    async getOperationStatus(){return {ok:true,operation:scenario==='operation'?{operationId:'held-operation',kind:'create',state:'uncertain'}:null};},
    async createRequest(){throw Error('Unexpected CRM mutation');},
    async performAction(){throw Error('Unexpected CRM mutation');}
  };
  const storage={async get(key){return copy(items[key] || null);},async set(key,value){items[key]=copy(value);}};
  h.instance=api.mount({document,window,controller,storage});
  h.send=(next=context)=>window.postMessage({type:'leadchat-request-context',channel:'base-test',context:copy(next)},location.origin);
  h.resolve=(index,result)=>{if(!pending[index])throw Error('No deferred base probe');pending[index](result);};
  h.namedRecord=()=>record('bt');
  h.metadata=metadata;
  h.count=command=>calls.filter(call=>call.command===command).length;
  h.base=()=>document.getElementById('base').value;
  h.ready=base=>h.base()===base && !document.body.inert && !document.getElementById('comments').disabled;
  window.baseHarness=h;h.send();
})();
